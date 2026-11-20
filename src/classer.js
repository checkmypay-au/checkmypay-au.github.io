// Classement d'un service en segments (minutes par catégorie), selon le jeu de règles branché.
import { enMinutes, jourSemaine, lundiDe, chevauchement, ajouterJours } from './temps.js';
import { categorieDuJour, categorieFerie, heuresSupPour, RegleManquante, tauxCategorie } from './regles_pur.js';

/**
 * Décompte des minutes d'une majoration horaire, selon le paramètre `decompte` du jeu de règles :
 *  - « minute » : minutes réelles dans la plage ;
 *  - « heure_entamee » : chaque heure commencée dans la plage compte entière (par service).
 */
function decompterMajoration(m, minutes) {
  switch (m.decompte) {
    case 'minute':
      return minutes;
    case 'heure_entamee':
      return 60 * Math.ceil(minutes / 60);
    case undefined:
      throw new RegleManquante(`décompte de la majoration « ${m.categorie} »`);
    default:
      throw new RegleManquante(`décompte inconnu « ${m.decompte} » pour la majoration « ${m.categorie} »`);
  }
}

const ajouter = (obj, cle, n) => {
  if (n) obj[cle] = (obj[cle] ?? 0) + n;
};

/** Erreur de saisie de l'heure de pause, avec un code lisible par la page. */
export class PauseHorsService extends Error {
  constructor(message) {
    super(message);
    this.name = 'PauseHorsService';
    this.code = 'pause_hors_service';
  }
}

/**
 * Intervalle de la pause [de, a) en minutes absolues du service, si son heure de début est indiquée
 * (`pause_debut`, « HH:MM ») ; sinon null (comportement d'avant : la pause n'est placée nulle part).
 * Une pause qui commence avant le début (heure plus petite) est lue après minuit. Hors du service → erreur.
 */
function intervallePause(service, debut, fin) {
  if (service.pause_debut === undefined || service.pause_debut === null || service.pause_debut === '') return null;
  const pause = Number(service.pause_min || 0);
  if (!(pause > 0)) throw new PauseHorsService(`Service du ${service.date} : heure de pause indiquée sans pause`);
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(service.pause_debut))) {
    throw new PauseHorsService(`Service du ${service.date} : heure de pause « ${service.pause_debut} » illisible`);
  }
  let de = enMinutes(service.pause_debut);
  if (de < debut) de += 24 * 60;
  const a = de + pause;
  if (de < debut || a > fin) {
    throw new PauseHorsService(`Service du ${service.date} : pause de ${service.pause_debut} (${pause} min) hors du service ${service.debut}–${service.fin}`);
  }
  return { de, a };
}

/** Minutes TRAVAILLÉES dans [x, y) : la durée, moins la partie qui tombe dans la pause (si elle est placée). */
const travaillees = (x, y, pauseIv) => Math.max(0, y - x) - (pauseIv ? chevauchement(x, y, pauseIv.de, pauseIv.a) : 0);

/**
 * Classe un service. `feries` : liste [{ date, debut? }] de l'État concerné.
 * Retourne { date, semaine, minutes_nettes, segments, categorieFin, repli }.
 * Les heures sup. sont appliquées ensuite à l'échelle de la semaine (appliquerHeuresSup).
 */
export function classerService(service, regles, feries) {
  const { date, pause_min: pause, minutes_nettes: net } = service;
  const debut = enMinutes(service.debut);
  let fin = enMinutes(service.fin);
  // Service après minuit : il appartient au jour de début (règle « service_apres_minuit »).
  if (fin <= debut) fin += 24 * 60;
  if (fin - debut - pause !== net) {
    throw new Error(
      `Service du ${date} incohérent : ${service.debut}–${service.fin} moins ${pause} min ≠ ${net} min`,
    );
  }

  const jour = jourSemaine(date);
  const catNormale = categorieDuJour(regles, jour);
  const catFerie = categorieFerie(regles);
  const ferie = feries.find((f) => f.date === date);
  const debutFerie = ferie ? (ferie.debut ? enMinutes(ferie.debut) : 0) : Infinity;

  // Heure de pause indiquée : les minutes de la pause sont retirées des plages où elle tombe (férié, soirée,
  // nuit…). Non indiquée : placée de la façon la moins favorable (placerPauseDefavorable, plus bas).
  const pauseIv = intervallePause(service, debut, fin);
  let minutesFerie = !ferie ? 0
    : pauseIv ? travaillees(Math.max(debut, debutFerie), fin, pauseIv)
      : Math.min(net, chevauchement(debut, fin, debutFerie, Infinity));
  const segments = {};
  ajouter(segments, catNormale, net - minutesFerie);
  if (minutesFerie) {
    if (!catFerie) throw new Error(`Jour férié ${date} mais aucune catégorie « ferie » dans les règles`);
    ajouter(segments, catFerie, minutesFerie);
  }

  // Majorations horaires (ex. soirée) : chevauchement de la plage, plafonné aux minutes nettes,
  // puis décompté selon le paramètre « decompte » du jeu de règles.
  // La plage retenue est mémorisée pour retirer ensuite les minutes payées en heures sup.
  const majorations = [];
  for (const m of regles.majorations ?? []) {
    if (!m.jours_semaine.includes(jour)) continue;
    const borneFin = ferie && m.exclut_feries ? Math.min(fin, debutFerie) : fin;
    const n = pauseIv
      ? travaillees(Math.max(debut, enMinutes(m.debut)), Math.min(borneFin, enMinutes(m.fin)), pauseIv)
      : Math.min(net, chevauchement(debut, borneFin, enMinutes(m.debut), enMinutes(m.fin)));
    const compte = decompterMajoration(m, n);
    ajouter(segments, m.categorie, compte);
    majorations.push({
      regle: m,
      plages: [[Math.max(debut, enMinutes(m.debut)), Math.min(borneFin, enMinutes(m.fin))]],
      minutes: n,
      compte,
      // Minutes de la plage dans le service, pause comprise (sert à placer une pause sans heure).
      brut: chevauchement(debut, borneFin, enMinutes(m.debut), enMinutes(m.fin)),
    });
  }

  // Service qui passe minuit (clause 29.2 : la majoration est due « for hours worked between 7.00 pm and 7.00 am
  // on a Monday to Friday ») : les minutes après minuit sont travaillées LE LENDEMAIN ; la plage du lendemain
  // (ex. nuit 00:00–07:00) compte si le lendemain est un jour de la majoration.
  // Limites (aucune règle inventée) : rien n'est ajouté pour les heures fériées du lendemain (29.3 : seul le taux
  // le plus élevé est dû ; un férié partiel ne compte qu'à partir de son heure de début) ni si le début est un jour
  // férié, ni si le lendemain n'a pas la même catégorie de jour que le
  // début (dimanche → lundi…) : le moteur paie tout le service au taux du jour de début (« jour de début »),
  // et ajouter la majoration s'y cumulerait avec un taux de jour qui n'est pas celui du lendemain.
  if (fin > 24 * 60 && !ferie) {
    const lendemain = ajouterJours(date, 1);
    const jourL = jourSemaine(lendemain);
    const ferieL = feries.find((f) => f.date === lendemain);
    const debutFerieL = ferieL ? (ferieL.debut ? enMinutes(ferieL.debut) : 0) + 24 * 60 : Infinity;
    if (categorieDuJour(regles, jourL) === catNormale) {
      for (const m of regles.majorations ?? []) {
        if (!m.jours_semaine.includes(jourL)) continue;
        const de = Math.max(debut, enMinutes(m.debut) + 24 * 60);
        const a = Math.min(fin, enMinutes(m.fin) + 24 * 60, m.exclut_feries ? debutFerieL : Infinity);
        if (a <= de) continue;
        const brut = pauseIv ? travaillees(de, a, pauseIv) : chevauchement(debut, fin, de, a);
        let mj = majorations.find((x) => x.regle === m);
        if (!mj) {
          mj = { regle: m, plages: [], minutes: 0, compte: 0, brut: 0 };
          majorations.push(mj);
        }
        mj.brut += chevauchement(debut, fin, de, a);
        const minutes = Math.min(net, mj.minutes + brut);
        const compte = decompterMajoration(m, minutes);
        ajouter(segments, m.categorie, compte - mj.compte);
        if (segments[m.categorie] === 0) delete segments[m.categorie];
        mj.plages.push([de, a]);
        mj.minutes = minutes;
        mj.compte = compte;
      }
    }
  }

  // Pause sans heure (décision du 2026-11-20, choix A) : comptée de la façon la MOINS favorable au salarié.
  if (!pauseIv && pause > 0) {
    minutesFerie = placerPauseDefavorable({
      segments, majorations, regles, pause, net, catNormale, catFerie,
      duree: fin - debut,
      ferieBrut: ferie ? chevauchement(debut, fin, debutFerie, Infinity) : 0,
    });
  }

  // Pause repas manquée : aucune pause et service plus long que le seuil → du seuil à la fin.
  const pm = regles.pause_manquee;
  if (pm && pause === 0 && net > pm.seuil_min) {
    ajouter(segments, pm.categorie, net - pm.seuil_min);
  }

  const categorieFin = minutesFerie && fin > debutFerie ? catFerie : catNormale;
  // Catégorie de jour du service entier ; null si le service est en partie férié, en partie non.
  const categorieJour = minutesFerie === 0 ? catNormale : minutesFerie === net ? catFerie : null;
  const resultat = {
    date,
    semaine: lundiDe(date),
    debut: service.debut,
    fin: service.fin,
    minutes_nettes: net,
    segments,
    categorieFin,
    categorieJour,
    repli: minutesFerie ? { [catFerie]: catNormale } : {},
    finAbsolue: fin,
    majorations,
    ...(pauseIv ? { pause: pauseIv } : {}),
  };
  // Pause sans heure : les heures sup. (appliquées plus tard, à la semaine) peuvent changer la place la moins
  // favorable ; appliquerHeuresSup essaie alors chaque heure réelle possible (propriété cachée, hors résultats).
  if (!pauseIv && pause > 0) {
    Object.defineProperty(resultat, 'placements', {
      enumerable: false,
      value: () => {
        const liste = [];
        for (let t = debut; t + pause <= fin; t += 1) {
          const h = `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
          liste.push(() => classerService({ ...service, pause_debut: h }, regles, feries));
        }
        return liste;
      },
    });
  }
  return resultat;
}

/**
 * Pause dont l'heure n'est pas indiquée (choix A, décision du 2026-11-20) : ses minutes sont retirées là où elles
 * coûtent le plus (prime la plus chère d'abord : nuit, soirée, partie fériée, selon les vrais taux du jeu de règles),
 * de sorte que le total des minutes de primes ne dépasse jamais les minutes travaillées et que le montant dû
 * calculé ne dépasse jamais celui d'aucune heure réelle de la pause.
 * Méthode : le service est partagé en « réserves » disjointes — chaque plage de prime (même jour et lendemain
 * additionnés), la partie fériée, le reste. Toutes les répartitions des minutes de pause entre ces réserves sont
 * essayées (même découpée, la vraie pause est l'une d'elles) ; on garde celle du plus petit montant
 * (décompte de chaque prime compris, ex. heure entamée). Aucune règle de paie nouvelle : seulement les taux,
 * plages et décomptes déjà dans les règles. Modifie `segments` et `majorations` ; renvoie les minutes fériées.
 */
function placerPauseDefavorable({ segments, majorations, regles, pause, net, catNormale, catFerie, duree, ferieBrut }) {
  const reserves = majorations.filter((mj) => mj.brut > 0);
  const somme = reserves.reduce((t, mj) => t + mj.brut, 0);
  if (!reserves.length && !ferieBrut) return 0;
  // Avec les règles actuelles, les plages sont disjointes entre elles et de la partie fériée ; sinon : refus clair.
  if (somme + ferieBrut > duree) throw new RegleManquante('place d\'une pause sans heure quand des majorations se chevauchent');
  const tauxNormal = tauxCategorie(regles, catNormale);
  const tauxFerie = ferieBrut ? tauxCategorie(regles, catFerie) : 0;
  const taux = reserves.map((mj) => tauxCategorie(regles, mj.regle.categorie));
  const ordre = reserves.map((_, i) => i).sort((a, b) => taux[b] - taux[a]); // prime la plus chère d'abord
  const autres = duree - ferieBrut - somme; // minutes sans prime, hors férié
  let meilleur = null;
  const xs = new Array(reserves.length).fill(0);
  const essayer = (k, reste) => {
    if (k === ordre.length) {
      // Le reste va à la partie fériée (si elle coûte plus) puis aux minutes sans prime.
      const xF = tauxFerie >= tauxNormal ? Math.min(ferieBrut, reste) : Math.max(0, reste - autres);
      const xO = reste - xF;
      if (xF < 0 || xF > ferieBrut || xO < 0 || xO > autres) return;
      let cout = (ferieBrut - xF) * tauxFerie + (net - (ferieBrut - xF)) * tauxNormal;
      reserves.forEach((mj, i) => { cout += decompterMajoration(mj.regle, mj.brut - xs[i]) * taux[i]; });
      if (!meilleur || cout < meilleur.cout) meilleur = { cout, xF, xs: [...xs] };
      return;
    }
    const i = ordre[k];
    for (let x = Math.min(reste, reserves[i].brut); x >= 0; x--) {
      xs[i] = x;
      essayer(k + 1, reste - x);
    }
    xs[i] = 0;
  };
  essayer(0, pause);
  if (!meilleur) throw new Error('pause sans heure : aucune place possible dans le service');
  reserves.forEach((mj, i) => {
    const minutes = mj.brut - meilleur.xs[i];
    const compte = decompterMajoration(mj.regle, minutes);
    const cat = mj.regle.categorie;
    segments[cat] = (segments[cat] ?? 0) - mj.compte + compte;
    if (segments[cat] === 0) delete segments[cat];
    mj.minutes = minutes;
    mj.compte = compte;
  });
  const minutesFerie = ferieBrut - meilleur.xF;
  if (net - minutesFerie) segments[catNormale] = net - minutesFerie; else delete segments[catNormale];
  if (minutesFerie) segments[catFerie] = minutesFerie; else if (catFerie) delete segments[catFerie];
  return minutesFerie;
}

/**
 * Clause 29.1 : une minute payée en heures sup. ne reçoit aucune majoration horaire.
 * Les `sup` minutes sup. sont les dernières minutes du service ; chaque majoration est
 * recomptée sur les seules minutes de sa plage qui ne sont pas des heures sup.,
 * avec le même décompte (ex. heure entamée, par service).
 */
function retirerMajorationsSurHeuresSup(s, sup) {
  // Pause placée : les `sup` dernières minutes TRAVAILLÉES commencent plus tôt si la pause tombe dedans.
  let debutSup = s.finAbsolue - sup;
  if (s.pause) {
    let t = s.finAbsolue;
    for (let compte = 0; compte < sup;) {
      t -= 1;
      if (!(t >= s.pause.de && t < s.pause.a)) compte += 1;
    }
    debutSup = t;
  }
  for (const mj of s.majorations ?? []) {
    // Une majoration peut avoir deux plages (le jour même et le lendemain après minuit) : on additionne.
    const somme = (f) => mj.plages.reduce((t, [de, a]) => t + f(de, a), 0);
    const enSup = somme((de, a) => (s.pause
      ? travaillees(Math.max(de, debutSup), Math.min(a, s.finAbsolue), s.pause)
      : chevauchement(de, a, debutSup, s.finAbsolue)));
    if (enSup === 0) continue;
    const horsSup = s.pause
      ? Math.max(0, Math.min(s.minutes_nettes - sup, somme((de, a) => travaillees(de, a, s.pause)) - enSup))
      // Pause sans heure : les minutes de pause retirées de cette plage (choix A) le restent hors heures sup.
      : Math.max(0, Math.min(s.minutes_nettes - sup, somme((de, a) => Math.max(0, a - de)) - (mj.brut - mj.minutes) - enSup));
    const compte = decompterMajoration(mj.regle, horsSup);
    const cat = mj.regle.categorie;
    s.segments[cat] = (s.segments[cat] ?? 0) - mj.compte + compte;
    if (s.segments[cat] === 0) delete s.segments[cat];
    mj.compte = compte;
  }
}

/**
 * Heures sup. d'une semaine : au-delà du seuil journalier, puis au-delà du seuil hebdomadaire
 * (en cumul chronologique). Les minutes sup. sont prises sur la fin du service.
 * Paliers de taux : comptés PAR JOUR (date du service), chaque jour repart de zéro ;
 * les premières minutes sup. du jour vont au premier palier, dans l'ordre chronologique.
 * Modifie et retourne les services classés.
 */
export function appliquerHeuresSup(servicesSemaine, regles) {
  const hs = regles.heures_sup;
  if (!hs) return servicesSemaine;
  const tries = [...servicesSemaine].sort((a, b) =>
    a.date === b.date ? a.debut.localeCompare(b.debut) : a.date.localeCompare(b.date),
  );
  let cumul = 0;
  const supDuJour = {};
  for (const s of tries) {
    const supJour = Math.max(0, s.minutes_nettes - hs.seuil_jour_min);
    const ordinaires = s.minutes_nettes - supJour;
    const disponible = Math.max(0, hs.seuil_semaine_min - cumul);
    const supSemaine = Math.max(0, ordinaires - disponible);
    cumul += ordinaires - supSemaine;
    const sup = supJour + supSemaine;
    if (sup === 0) continue;
    /** Heures sup. sur un service classé ; renvoie les minutes sup. du jour après lui. */
    const appliquer = (x) => {
      const paliers = heuresSupPour(regles, x.categorieFin);
      if ((x.segments[x.categorieFin] ?? 0) < sup) {
        throw new Error(`Heures sup. du ${x.date} : segment « ${x.categorieFin} » trop court`);
      }
      x.segments[x.categorieFin] -= sup;
      if (x.segments[x.categorieFin] === 0) delete x.segments[x.categorieFin];
      let deja = supDuJour[x.date] ?? 0;
      let reste = sup;
      let borne = 0;
      for (const p of paliers) {
        borne = p.minutes_par_jour === undefined ? Infinity : borne + p.minutes_par_jour;
        const n = Math.min(reste, Math.max(0, borne - deja));
        ajouter(x.segments, p.categorie, n);
        deja += n;
        reste -= n;
      }
      retirerMajorationsSurHeuresSup(x, sup);
      return deja;
    };
    if (!s.placements) {
      supDuJour[s.date] = appliquer(s);
      continue;
    }
    // Pause sans heure + heures sup. (choix A, relecture) : chaque heure réelle de la pause est essayée, heures sup.
    // comprises ; on garde le plus petit montant (aux taux du jeu de règles). Le montant ne dépasse donc jamais
    // celui d'aucune heure réelle.
    const valeur = (seg) => Object.entries(seg).reduce((t, [c, n]) => t + n * tauxCategorie(regles, c), 0);
    let meilleur = null;
    let premiereErreur = null;
    for (const essai of s.placements()) {
      try {
        const c = essai();
        const deja = appliquer(c);
        const v = valeur(c.segments);
        if (!meilleur || v < meilleur.v) meilleur = { c, deja, v };
      } catch (e) {
        premiereErreur ??= e;
      }
    }
    if (!meilleur) throw premiereErreur;
    s.segments = meilleur.c.segments;
    s.majorations = meilleur.c.majorations;
    supDuJour[s.date] = meilleur.deja;
  }
  return servicesSemaine;
}

/**
 * Minimum d'engagement : chaque service de moins de `minutes` nettes est complété jusqu'à ce minimum
 * en minutes PAYÉES, au taux de la catégorie de jour du service. À appeler APRÈS appliquerHeuresSup :
 * le complément ne compte pas dans les seuils, n'est jamais une heure sup. et ne reçoit aucune majoration.
 * minutes_nettes reste inchangé ; le complément est noté dans complement_min.
 * Modifie et retourne les services classés.
 */
export function appliquerMinimumEngagement(services, regles) {
  const me = regles.minimum_engagement;
  if (!me) return services;
  if (!(Number.isInteger(me.minutes) && me.minutes > 0)) {
    throw new RegleManquante('durée « minutes » du minimum d\'engagement');
  }
  if (me.par !== 'service') {
    throw new RegleManquante(`unité « par » du minimum d'engagement (${me.par}) : seul « service » est géré`);
  }
  for (const s of services) {
    const manque = Math.max(0, me.minutes - s.minutes_nettes);
    if (manque === 0) continue;
    if (!s.categorieJour) {
      throw new RegleManquante(`catégorie du complément de minimum d'engagement pour le service mixte du ${s.date}`);
    }
    ajouter(s.segments, s.categorieJour, manque);
    s.complement_min = manque;
  }
  return services;
}
