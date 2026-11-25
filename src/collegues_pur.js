// Version collègues, partie PURE (importable par le navigateur et par les tests Node) :
// - entrées simples de la page : vraies heures d'un jour (remplacent Humanforce ce jour-là), montant reçu en banque ;
// - synthèse du rapport du moteur : par semaine OK / écart, total, super ;
// - textes en français et en anglais : phrases des constats, résumé à montrer au manager.
// Aucune date ni montant n'est formaté par Intl (résultat identique dans Node et dans Edge).
import { dureeNette } from './heures.js';
import { reglesFwcAu, joursFeries, categorieFerie, categorieDuJour } from './regles_pur.js';
import { classerService, appliquerHeuresSup } from './classer.js';
import { jourSemaine, lundiDe, enMinutes, ajouterJours } from './temps.js';
import { analyserAvec } from './moteur_pur.js';
import { rapportAffiche } from './affichage.js';

export const LANGUES = ['fr', 'en'];

// ---------- Entrées de la page ----------

/**
 * Montant tapé par la personne : « 615.42 », « 615,42 », « $615.42 » → 615.42, « 615 » → 615 (nombre).
 * Vide → null. Autre chose → erreur (message court, la page le traduit par son code).
 */
export function lireMontant(texte) {
  const t = String(texte ?? '').trim().replace(/^\$\s*|\s*\$$/g, '');
  if (t === '') return null;
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m) {
    const e = new Error(`montant « ${texte} » illisible`);
    e.code = 'montant_illisible';
    throw e;
  }
  return Number(`${m[1]}.${(m[2] ?? '0').padEnd(2, '0')}`);
}

/**
 * Vraies heures quand le badge était faux : [{ date, debut, fin, pause_min }].
 * Chaque jour corrigé remplace TOUS les services Humanforce de ce jour (ajouté s'il n'y en avait pas).
 */
export function appliquerVraiesHeures(services, vraies) {
  const jours = new Map();
  for (const v of vraies) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date ?? '') || !/^\d{1,2}:\d{2}$/.test(v.debut ?? '') || !/^\d{1,2}:\d{2}$/.test(v.fin ?? '')) {
      const e = new Error(`vraies heures incomplètes (${v.date || '?'} ${v.debut || '?'}–${v.fin || '?'})`);
      e.code = 'vraies_heures_incompletes';
      throw e;
    }
    // Pause vide = 0 ; tout autre texte doit être un entier ≥ 0 (la page passe 'invalide' pour une saisie illisible).
    const pause = v.pause_min === '' || v.pause_min == null ? 0 : Number(v.pause_min);
    if (!Number.isInteger(pause) || pause < 0) {
      const e = new Error(`pause « ${v.pause_min} » invalide (${v.date})`);
      e.code = 'pause_invalide';
      throw e;
    }
    const minutes = v.debut === v.fin ? 0 : dureeNette(v.debut, v.fin, pause);
    if (minutes <= 0) {
      const e = new Error(`vraies heures du ${v.date} : durée nulle ou négative`);
      e.code = 'vraies_heures_incompletes';
      throw e;
    }
    if (!jours.has(v.date)) jours.set(v.date, []);
    jours.get(v.date).push({ date: v.date, debut: v.debut, fin: v.fin, pause_min: pause, minutes_nettes: minutes, autorise: true });
  }
  const gardes = services.filter((s) => !jours.has(s.date));
  return [...gardes, ...[...jours.values()].flat()].sort((a, b) => (a.date + a.debut).localeCompare(b.date + b.debut));
}

/**
 * Code de texte (clé de TEXTES) pour un message d'erreur du moteur ou des lecteurs ; null si inconnu.
 * Les messages techniques restent en français : la page les montre seulement comme « détail ».
 */
export function codeErreur(message) {
  const m = String(message ?? '');
  if (/^Humanforce\b/.test(m)) return 'erreur_humanforce';
  if (/^Libellé de fiche non reconnu/.test(m)) return 'erreur_libelle';
  if (/^Deux fiches pour la semaine/.test(m)) return 'erreur_doublon';
  if (/période non hebdomadaire/.test(m)) return 'erreur_periode';
  if (/taux Fair Work .* non valables/.test(m)) return 'erreur_taux';
  return null;
}

// ---------- Qui je suis (cycle Q4+Q5) ----------
// Trois réponses de la personne : contrat, convention, État. RIEN n'est pré-choisi, sauf le contrat « casual »
// quand TOUTES les fiches à la semaine le montrent (libellé connu contenant « Casual ») (la personne peut le changer ; une contradiction bloque).
// L'outil ne vérifie que les cas de reglages.cas_couverts (un jeu de règles officiel chacun) ; tout autre cas,
// « je ne sais pas » compris, est refusé avec une phrase claire, sans aucun calcul.

export const CONTRATS = ['casual', 'temps_partiel', 'temps_plein', 'ne_sait_pas'];
export const CONVENTIONS = ['hospitality', 'autre', 'ne_sait_pas'];
export const ETATS = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'ACT', 'NT'];

/**
 * La fiche montre-t-elle « casual » ? Oui si une de ses lignes de salaire a un libellé CONNU (dans la correspondance
 * publiée) qui contient le mot « Casual » (décision du responsable, 2026-11-20 : la Classification des vraies
 * fiches ne le dit pas). Le contrat est alors pré-rempli, modifiable, avec « lu sur ta fiche ».
 */
export function ficheDitCasual(fiche, correspondance) {
  return (fiche?.lignes ?? []).some((l) => Object.hasOwn(correspondance ?? {}, l.description ?? '') && /\bCasual\b/i.test(l.description));
}

/** Contrat proposé par les fiches : 'casual' si toutes les fiches données le montrent, sinon null. */
export function contratDesFiches(fiches) {
  return fiches.length > 0 && fiches.every((f) => f.casual === true) ? 'casual' : null;
}

/**
 * Qui je suis { contrat, convention, etat } (+ fiches lues [{ casual }]) → null si l'outil sait vérifier ce cas,
 * sinon un code (clé de TEXTES) :
 * - manque_qui        : une réponse manque ;
 * - qui_contradiction : la personne dit temps partiel / plein alors qu'une fiche montre « casual » ;
 * - qui_ne_sait_pas   : « je ne sais pas » (contrat ou convention) ;
 * - qui_non_couvert   : réponse valable, mais cas absent de reglages.cas_couverts (aucune règle inventée).
 */
export function codeQui(qui, fiches, reglages) {
  const { contrat, convention, etat } = qui ?? {};
  if (!CONTRATS.includes(contrat) || !CONVENTIONS.includes(convention) || !ETATS.includes(etat)) return 'manque_qui';
  if ((contrat === 'temps_partiel' || contrat === 'temps_plein') && fiches.some((f) => f.casual === true)) return 'qui_contradiction';
  if (contrat === 'ne_sait_pas' || convention === 'ne_sait_pas') return 'qui_ne_sait_pas';
  // Un seul jeu de règles (reglages.regles) pour tous les cas couverts : le jour où un 2e cas est ajouté, chaque
  // entrée de cas_couverts devra porter son propre jeu de règles (relecture Q4+Q5 ; L3 vérifie qu'il n'y en a qu'un).
  const couvert = (reglages.cas_couverts ?? []).some((c) => c.contrat === contrat && c.convention === convention && c.etat === etat);
  return couvert ? null : 'qui_non_couvert';
}

/** Refus codé si l'outil ne sait pas vérifier ce cas (voir codeQui). */
export function verifierQui(qui, fiches, reglages) {
  const code = codeQui(qui, fiches, reglages);
  if (code) throw Object.assign(new Error('qui je suis'), { code });
}

// ---------- Liste unique des services (cycle 3f) ----------

const enMin = (h) => {
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(h ?? ''))) return null;
  return enMinutes(h);
};

/**
 * Durée d'une pause tapée « de [début] à [fin] » (une pause qui passe minuit est comptée le lendemain).
 * null si l'une des heures manque ; erreur codée si elles sont illisibles ou si la fin n'est pas après le début.
 */
export function dureePause(de, a, date) {
  const valeurs = { date: dateCourte(date) };
  if (a && !de) throw Object.assign(new Error('fin de pause sans début'), { code: 'pause_debut_manquant', valeurs });
  if (!de || !a) return null;
  const d = enMin(de);
  let f = enMin(a);
  if (d === null || f === null) throw Object.assign(new Error('heure de pause illisible'), { code: 'pause_illisible', valeurs });
  if (f <= d) f += 24 * 60;
  const duree = f - d;
  // Plus de 12 h : c'est une fin AVANT le début (ex. 19:30 → 19:00), pas une pause passée minuit.
  if (duree <= 0 || duree > 12 * 60) throw Object.assign(new Error('fin de pause avant son début'), { code: 'pause_fin_avant', valeurs });
  return duree;
}

/** Fin de pause proposée : début + durée (« HH:MM »), ou '' si le début est illisible. */
export function finPauseProposee(de, pauseMin) {
  const d = enMin(de);
  if (d === null || !(Number(pauseMin) > 0)) return '';
  const f = (d + Number(pauseMin)) % (24 * 60);
  return `${String(Math.floor(f / 60)).padStart(2, '0')}:${String(f % 60).padStart(2, '0')}`;
}

/**
 * Liste unique « Tes services » → services pour le moteur.
 * - hf : services Humanforce ; chaque ligne garde sa clé d'origine (cleService), même corrigée ;
 * - corrections : Map clé → { debut, fin, pause_min } (heures corrigées dans la ligne) ;
 * - pauses : Map clé → { de, a } (heures de pause ; sans fin, la durée de la ligne est gardée ; avec une fin,
 *   la durée devient fin − début) ;
 * - ajouts : services ajoutés [{ date, debut, fin, pause_min, pause_de?, pause_a? }] — comme en v0.21, un jour
 *   ajouté remplace les services Humanforce de ce jour.
 * Sans correction ni fin de pause, résultat identique à la v0.21 (mêmes fonctions : appliquerVraiesHeures,
 * appliquerHeuresPause).
 */
export function servicesDeLaListe(hf, { corrections = new Map(), pauses = new Map(), ajouts = [] } = {}) {
  const heures = new Map(); // clé du service FINAL → heure de début de pause
  // Jours remplacés par un service ajouté : leurs lignes Humanforce (et leurs saisies cachées) sont ignorées,
  // jamais appliquées au service ajouté ni bloquantes.
  const remplaces = new Set(ajouts.map((j) => j.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '')));
  const lignes = hf.filter((s) => !remplaces.has(s.date)).map((s) => {
    const cle = cleService(s);
    const c = corrections.get(cle);
    const p = pauses.get(cle) ?? {};
    const base = c ? { date: s.date, debut: c.debut, fin: c.fin, pause_min: c.pause_min } : { ...s };
    const duree = dureePause(p.de, p.a, s.date);
    if (duree !== null) base.pause_min = duree;
    // Ligne corrigée ou durée de pause changée : mêmes contrôles que des heures tapées (date, début, fin, pause).
    const service = c || duree !== null ? appliquerVraiesHeures([], [base])[0] : s;
    if (p.de) heures.set(cleService(service), p.de);
    return service;
  });
  const vraies = ajouts.map((j) => {
    const duree = dureePause(j.pause_de, j.pause_a, j.date);
    return duree === null ? j : { ...j, pause_min: String(duree) };
  });
  const services = appliquerVraiesHeures(lignes, vraies);
  for (const j of ajouts) if (j.pause_de && j.date && j.debut) heures.set(`${j.date} ${j.debut}`, j.pause_de);
  return appliquerHeuresPause(services, heures);
}

/**
 * Services qui passent minuit vers un AUTRE type de jour (samedi, dimanche, jour férié…) : le moteur les paie
 * entièrement au taux du jour où ils commencent (règle « jour de début » des règles, non trouvée dans la clause 29,
 * où le tableau 14 dépend du moment où les heures sont travaillées). Aucun taux n'est inventé : on les signale
 * « à vérifier ». `semaines` : semaines vraiment vérifiées (sinon aucune alerte).
 */
export function alertesMinuit(services, reglesAu, etat, semaines = null) {
  const alertes = [];
  for (const s of services) {
    if (enMinutes(s.fin) > enMinutes(s.debut)) continue; // ne passe pas minuit
    if (semaines && !semaines.has(lundiDe(s.date))) continue;
    const regles = reglesAu(s.date);
    const feries = joursFeries(regles, etat);
    const lendemain = ajouterJours(s.date, 1);
    const autreJour = categorieDuJour(regles, jourSemaine(lendemain)) !== categorieDuJour(regles, jourSemaine(s.date));
    const ferie = feries.some((f) => f.date === s.date || f.date === lendemain);
    if (autreJour || ferie) alertes.push({ date: s.date, debut: s.debut, fin: s.fin });
  }
  return alertes;
}

export const phraseMinuit = (a, langue) => remplir(TEXTES[langue].minuit_alerte, { date: dateCourte(a.date), debut: a.debut, fin: a.fin });

/** Jour court + date courte : « Lun 17/08 » / « Mon 17/08 ». */
export function jourEtDate(dateIso, langue) {
  const jours = TEXTES[langue].jours_courts.split(',');
  return `${jours[jourSemaine(dateIso) - 1]} ${dateIso.slice(8, 10)}/${dateIso.slice(5, 7)}`;
}

// ---------- Heure de la pause (cycle 3e) ----------

/** Clé d'un service pour son heure de pause : « 2026-08-19 17:00 ». */
export const cleService = (s) => `${s.date} ${s.debut}`;

/**
 * Ajoute l'heure de début de pause tapée (`heures` : Map clé → « HH:MM » ou vide) aux services qui ont une pause.
 * Vérifie qu'elle tombe pendant le service ; sinon erreur codée `pause_hors_service` (avec la date et les heures),
 * jamais de calcul. Vide → service inchangé (le moteur garde son comportement d'avant).
 */
export function appliquerHeuresPause(services, heures) {
  return services.map((s) => {
    const h = String(heures?.get?.(cleService(s)) ?? '').trim();
    // Pas d'heure, ou service sans pause (ex. remplacé par une vraie heure sans pause) : rien à placer.
    if (!h || !(Number(s.pause_min) > 0)) return s;
    const valeurs = { date: dateCourte(s.date), debut: s.debut, fin: s.fin };
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(h)) {
      throw Object.assign(new Error(`heure de pause illisible le ${s.date}`), { code: 'pause_illisible', valeurs });
    }
    const refus = () => Object.assign(new Error(`pause du ${s.date} hors du service`), { code: 'pause_hors_service', valeurs });
    const debut = enMinutes(s.debut);
    let fin = enMinutes(s.fin);
    if (fin <= debut) fin += 24 * 60;
    let de = enMinutes(h);
    if (de < debut) de += 24 * 60;
    if (de < debut || de + Number(s.pause_min) > fin) throw refus();
    return { ...s, pause_debut: h };
  });
}

/**
 * Effet de l'heure de pause, service par service (seulement ceux qui ont une pause) :
 * - heure non indiquée et service qui touche une prime (soirée, nuit) ou un jour férié : comptée de la façon la moins favorable ;
 * - heure indiquée : primes comptées avec et sans cette heure (même moteur), ou « ne change aucune prime ».
 * Renvoie des éléments neutres ; phrasePause() les écrit dans la langue voulue.
 */
export function effetsPauses(services, reglesAu, etat, semaines = null) {
  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  // Segments FINAUX du service n° i de la semaine (classement puis heures sup. de toute la semaine, comme le moteur).
  const segmentsDans = (liste, i) => {
    const regles = reglesAu(liste[0].date);
    const classes = liste.map((x) => classerService(x, reglesAu(x.date), joursFeries(reglesAu(x.date), etat)));
    appliquerHeuresSup(classes, regles);
    return classes[i].segments;
  };
  const parSemaine = new Map();
  for (const s of services) {
    const lundi = lundiDe(s.date);
    if (!parSemaine.has(lundi)) parSemaine.set(lundi, []);
    parSemaine.get(lundi).push(s);
  }
  const effets = [];
  for (const [lundi, liste] of [...parSemaine].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (semaines && !semaines.has(lundi)) continue; // semaine non vérifiée (sans fiche, refusée…) : rien à expliquer
    liste.forEach((s, i) => {
      if (!(Number(s.pause_min) > 0)) return;
      const regles = reglesAu(s.date);
      const sensibles = [...(regles.majorations ?? []).map((m) => m.categorie), categorieFerie(regles)].filter(Boolean);
      const avecHeure = (h) => liste.map((x, j) => (j === i ? { ...x, pause_debut: h } : x));
      const sans = segmentsDans(avecHeure(undefined), i);
      if (!s.pause_debut) {
        // Catégories dont le compte dépend vraiment de la place de la pause (toutes les positions, au quart d'heure).
        const debut = enMinutes(s.debut);
        let fin = enMinutes(s.fin);
        if (fin <= debut) fin += 24 * 60;
        const derniere = fin - Number(s.pause_min);
        const positions = [];
        for (let t = debut; t <= derniere; t += 15) positions.push(t);
        if (positions.at(-1) !== derniere) positions.push(derniere);
        const comptes = {};
        for (const t of positions) {
          const seg = segmentsDans(avecHeure(hhmm(t)), i);
          for (const c of sensibles) (comptes[c] ??= new Set()).add(seg[c] ?? 0);
        }
        const touchees = sensibles.filter((c) => comptes[c]?.size > 1);
        if (touchees.length) effets.push({ type: 'non_indiquee', date: s.date, debut: s.debut, fin: s.fin, categories: touchees });
        return;
      }
      const avec = segmentsDans(liste, i);
      const ecarts = sensibles.filter((c) => (avec[c] ?? 0) !== (sans[c] ?? 0))
        .map((c) => ({ categorie: c, avec: (avec[c] ?? 0) / 60, sans: (sans[c] ?? 0) / 60 }));
      effets.push({ type: ecarts.length ? 'effet' : 'sans_effet', date: s.date, debut: s.debut, fin: s.fin, heure: s.pause_debut, ecarts });
    });
  }
  return effets;
}

/** Phrase simple pour un effet de pause. */
export function phrasePause(e, langue) {
  const t = TEXTES[langue];
  const date = dateCourte(e.date);
  if (e.type === 'non_indiquee') {
    const liste = e.categories.map((c) => nomCategorie(c, langue)).join(` ${t.et} `);
    return remplir(t.pause_non_indiquee, { date, debut: e.debut, fin: e.fin, liste });
  }
  if (e.type === 'sans_effet') return remplir(t.pause_sans_effet, { date, heure: e.heure });
  const liste = e.ecarts.map((x) => remplir(t.pause_effet_item, {
    cat: nomCategorie(x.categorie, langue), avec: duree(x.avec, langue), sans: duree(x.sans, langue),
  })).join(' ; ');
  return remplir(t.pause_effet, { date, heure: e.heure, liste });
}

// ---------- Niveau et rythme lus sur la fiche (cycle 3c) ----------

/** Texte de la ligne « Classification » de la fiche (motif du gabarit), ou null. */
export function classificationDe(morceaux, gabarit) {
  const motif = gabarit?.entete?.classification;
  if (!motif) return null;
  const re = new RegExp(motif);
  for (const m of morceaux) {
    const r = re.exec(String(m.str ?? ''));
    if (r?.groups?.classification) return r.groups.classification.trim();
  }
  return null;
}

/**
 * Niveau lu sur la fiche (« Level N »), ou null s'il n'est pas SÛR.
 * Sûr = la ligne Classification contient un seul nombre N ET le taux de base de la fiche est exactement celui
 * du niveau N chez Fair Work. Le numéro de grade n'est pas toujours le niveau dans l'Award (cuisinier grade 1
 * = niveau 2, par exemple) : sans cet accord des deux, la page pose la question au lieu de deviner.
 */
export function niveauDeFiche(classification, tauxBase, niveauxFwc) {
  if (!classification) return null;
  const nombres = classification.match(/\b\d+\b/g) ?? [];
  if (nombres.length !== 1) return null;
  const candidat = `Level ${Number(nombres[0])}`;
  const n = niveauxFwc.find((x) => x.classification === candidat);
  if (!n || typeof tauxBase !== 'number' || !Number.isFinite(tauxBase)) return null;
  return Math.round(tauxBase * 100) === n.taux_base_cents ? candidat : null;
}

/** Nombre de jours couverts par une période { du, au } (bornes comprises). */
export const dureeJours = ({ du, au }) => Math.round((Date.parse(`${au}T00:00:00Z`) - Date.parse(`${du}T00:00:00Z`)) / 86400000) + 1;

/**
 * Prépare le calcul à partir des fiches lues [{ fiche, niveau_lu }], des services et du niveau choisi (ou null) :
 * - une fiche qui ne couvre pas 7 jours, ou pas du lundi au dimanche, est REFUSÉE (aucun calcul, jamais de faux
 *   résultat ; raison 'jours' ou 'lundi') et les services de sa période sont retirés ;
 * - chevauchement : une fiche refusée qui recouvre une fiche gardée → `chevauchement` vrai ; la page refuse alors
 *   TOUT le calcul (retirer ces services fausserait la semaine gardée, les garder fausserait la refusée) ;
 * - niveau de chaque semaine : choix de la personne, sinon niveau lu sur la fiche de cette semaine ;
 * - manque_niveau : une fiche gardée n'a pas de niveau sûr et la personne n'en a pas choisi.
 */
export function preparer({ fiches, services, niveauChoisi = null }) {
  const gardees = [];
  const refusees = [];
  for (const f of fiches) {
    const jours = dureeJours(f.fiche.periode);
    const { du, au } = f.fiche.periode;
    if (jours !== 7) refusees.push({ du, au, jours, raison: 'jours' });
    else if (jourSemaine(du) !== 1) refusees.push({ du, au, jours, raison: 'lundi' });
    else gardees.push(f);
  }
  const chevauchement = refusees.some((r) => gardees.some((g) => r.du <= g.fiche.periode.au && g.fiche.periode.du <= r.au));
  const horsRefus = (d) => !refusees.some((r) => d >= r.du && d <= r.au);
  const niveauxLus = [...new Set(gardees.map((f) => f.niveau_lu).filter(Boolean))].sort();
  const niveauParSemaine = {};
  for (const f of gardees) niveauParSemaine[lundiDe(f.fiche.periode.du)] = niveauChoisi ?? f.niveau_lu ?? null;
  // Semaines sans fiche (non comptées) : niveau choisi, sinon le niveau lu le plus fréquent.
  const freq = {};
  for (const f of gardees) if (f.niveau_lu) freq[f.niveau_lu] = (freq[f.niveau_lu] ?? 0) + 1;
  const plusFrequent = Object.entries(freq).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  return {
    fiches: gardees.map((f) => f.fiche),
    refusees,
    services: services.filter((s) => horsRefus(s.date)),
    niveauParSemaine,
    niveauxLus,
    niveauDefaut: niveauChoisi ?? plusFrequent,
    manque_niveau: !niveauChoisi && gardees.some((f) => !f.niveau_lu),
    chevauchement,
  };
}

/** reglesAu(date) avec le niveau de la semaine de `date` (taux Fair Work figés). Niveau inconnu → erreur codée. */
export function reglesAuPour(regles, taux, prep) {
  const parNiveau = new Map();
  return (date) => {
    const niveau = prep.niveauParSemaine[lundiDe(date)] ?? prep.niveauDefaut;
    if (!niveau) throw Object.assign(new Error(`niveau inconnu pour la semaine du ${lundiDe(date)}`), { code: 'manque_niveau' });
    if (!parNiveau.has(niveau)) parNiveau.set(niveau, reglesFwcAu(regles, taux, niveau));
    return parNiveau.get(niveau)(date);
  };
}

/**
 * Le moteur rapproche deux semaines payées ensemble (paiement décalé) avec les règles de la 1re : si leurs
 * niveaux diffèrent, il ne sait pas faire → refus clair (erreur codée), jamais un calcul faux.
 */
export function verifierNiveauxDecales(rapport, prep) {
  for (const c of rapport.constats) {
    if (c.type !== 'paiement_decale') continue;
    const a = prep.niveauParSemaine[c.semaine] ?? prep.niveauDefaut;
    const b = prep.niveauParSemaine[c.paye_avec] ?? prep.niveauDefaut;
    if (a !== b) throw Object.assign(new Error('niveaux différents sur un paiement décalé'), { code: 'niveaux_decale' });
  }
}

/**
 * Calcul de la page (cycle 5 : sorti de web/verifier.js, même code, pour que la comparaison sur vraies fiches
 * passe par EXACTEMENT ce que fait la page). Entrées : fiches lues [{ fiche, niveau_lu }], services (liste unique),
 * niveau choisi ou null, montants reçus en banque (Map période_du → texte tapé). Erreurs codées comme avant :
 * aucune_hebdo, manque_niveau, montant_illisible, niveaux_decale, et celles du moteur.
 * Renvoie { rapport (rapportAffiche), prep, reglesAu }.
 */
export function calculerPage({ fiches, services, niveauChoisi = null, montants = new Map(), qui = null }, { regles, params, taux, reglages }) {
  // Qui je suis (cycle Q4+Q5) : jamais de calcul pour un cas que l'outil ne sait pas vérifier.
  verifierQui(qui, fiches, reglages);
  const prep = preparer({ fiches, services, niveauChoisi });
  // Fiche qui n'est pas à la semaine : aucun calcul pour elle (jamais un faux résultat).
  if (!prep.fiches.length) throw Object.assign(new Error('fiche'), { code: 'aucune_hebdo' });
  if (prep.manque_niveau) throw Object.assign(new Error('niveau'), { code: 'manque_niveau' });
  const reglesAu = reglesAuPour(regles, taux, prep);
  const banque = [];
  for (const f of prep.fiches) {
    const m = lireMontant(montants.get(f.periode.du));
    if (m !== null) banque.push({ periode_du: f.periode.du, montant_recu: m });
  }
  const rapport = rapportAffiche(analyserAvec(
    {
      services: prep.services,
      fiches: prep.fiches,
      correspondance: reglages.correspondance,
      profil: { regles: reglages.regles, etat: qui.etat, retenues_autorisees: [] },
      ...(banque.length ? { banque } : {}),
    },
    { reglesAu, params },
  ));
  verifierNiveauxDecales(rapport, prep);
  return { rapport, prep, reglesAu };
}

/** Niveaux de la vérification, pour le résumé : « Level 2 », ou « Level 2 / Level 3 ». */
export function niveauxDuCalcul(prep) {
  return [...new Set(Object.values(prep.niveauParSemaine).filter(Boolean))].sort().join(' / ') || prep.niveauDefaut;
}

// ---------- Synthèse ----------

const enCents = (dollars) => Math.round(dollars * 100);

const plus6 = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
};

/**
 * Rapport affiché (rapportAffiche) → { semaines: [{ semaine, semaine_fin?, avec_fiche, ecart_cents, etat, constats }],
 * total_cents, super_cents, banque_cents, semaines_non_comptees }.
 * etat : 'ok' | 'ecart' | 'a_verifier' | 'sans_fiche' | 'sans_heures' | 'liste_incomplete'.
 * - Chaque constat est rangé sous la 1re semaine qu'il concerne ; paiement décalé → les 2 semaines en une seule carte.
 * - Semaine non comptée dans le total (ni dans le super) : sans fiche, fiche sans service Humanforce, ou semaine
 *   dont un jour tombe dans un mois absent de la liste Humanforce (`services`, facultatif) : son « écart » ne
 *   viendrait que d'une liste incomplète.
 * - Super (écart de super + super mal inscrit sur la fiche) et banque (reçu ≠ net) : à part du salaire.
 */
export function synthese(rapport, services = null) {
  const semaines = rapport.semaines.map((s) => ({
    semaine: s.semaine,
    avec_fiche: Boolean(s.fiche),
    ecart_cents: s.fiche ? s.ecart_cents : 0,
    constats: [],
  }));
  const parId = new Map(semaines.map((s) => [s.semaine, s]));
  for (const c of rapport.constats) {
    const id = c.semaines?.[0] ?? c.semaine;
    let s = parId.get(id);
    if (!s) {
      s = { semaine: id, avec_fiche: false, ecart_cents: 0, constats: [] };
      parId.set(id, s);
      semaines.push(s);
    }
    s.constats.push(c);
  }
  // Paiement décalé : la semaine B rejoint la carte de la semaine A (un seul écart, celui des deux semaines).
  for (const c of rapport.constats.filter((x) => x.type === 'paiement_decale')) {
    const a = parId.get(c.semaine);
    const b = parId.get(c.paye_avec);
    if (!a || !b || a === b) continue;
    a.semaine_fin = b.semaine;
    a.avec_fiche = a.avec_fiche && b.avec_fiche;
    a.ecart_cents += b.ecart_cents;
    a.constats.push(...b.constats);
    semaines.splice(semaines.indexOf(b), 1);
    parId.set(b.semaine, a);
  }
  semaines.sort((a, b) => a.semaine.localeCompare(b.semaine));
  const mois = services ? new Set(services.map((s) => s.date.slice(0, 7))) : null;
  let superCents = 0;
  let banqueCents = 0;
  for (const s of semaines) {
    const fin = plus6(s.semaine_fin ?? s.semaine);
    const horsListe = mois && mois.size > 0 && (!mois.has(s.semaine.slice(0, 7)) || !mois.has(fin.slice(0, 7)));
    if (!s.avec_fiche) s.etat = 'sans_fiche';
    else if (s.constats.some((c) => c.type === 'fiche_sans_heures')) s.etat = 'sans_heures';
    else if (horsListe) s.etat = 'liste_incomplete';
    else if (s.ecart_cents !== 0) s.etat = 'ecart';
    else if (s.constats.length) s.etat = 'a_verifier';
    else s.etat = 'ok';
    s.comptee = !['sans_fiche', 'sans_heures', 'liste_incomplete'].includes(s.etat);
    for (const c of s.constats) {
      if (typeof c.montant !== 'number') continue;
      if (c.type === 'banque_differente_net') banqueCents += enCents(c.montant);
      if (s.comptee && (c.type === 'ecart_super' || c.type === 'super_incoherent')) superCents += enCents(c.montant);
    }
  }
  const comptees = semaines.filter((s) => s.comptee);
  return {
    semaines,
    total_cents: comptees.reduce((t, s) => t + s.ecart_cents, 0),
    super_cents: superCents,
    banque_cents: banqueCents,
    semaines_non_comptees: semaines.length - comptees.length,
  };
}

// ---------- Formats ----------

export function argent(cents, langue) {
  const a = Math.abs(cents);
  const entier = String(Math.floor(a / 100));
  const dec = String(a % 100).padStart(2, '0');
  const signe = cents < 0 ? '-' : '';
  if (langue === 'fr') return `${signe}${entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec} $`;
  return `${signe}$${entier.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

const dollars = (montant, langue) => argent(enCents(montant), langue);

export function duree(heures, langue) {
  const m = Math.round(Math.abs(heures) * 60);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return langue === 'fr' ? `${h} h ${mm}` : `${h}h ${mm}m`;
}

/** AAAA-MM-JJ → JJ/MM/AAAA (même écriture en français et en anglais d'Australie). */
export const dateCourte = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

// ---------- Textes ----------

const CATEGORIES = {
  ordinaire_semaine: { fr: 'heures normales (lun.–ven.)', en: 'ordinary hours (Mon–Fri)' },
  samedi: { fr: 'heures du samedi', en: 'Saturday hours' },
  dimanche: { fr: 'heures du dimanche', en: 'Sunday hours' },
  jour_ferie: { fr: 'heures de jour férié', en: 'public holiday hours' },
  heures_sup_150: { fr: 'heures sup. à 150 %', en: 'overtime at 150%' },
  heures_sup_200: { fr: 'heures sup. à 200 %', en: 'overtime at 200%' },
  soiree: { fr: 'prime de soirée (19 h–minuit)', en: 'evening penalty (7pm–midnight)' },
  nuit: { fr: 'prime de nuit (minuit–7 h)', en: 'night penalty (midnight–7am)' },
  pause_manquee: { fr: 'prime de pause repas manquée', en: 'missed meal break penalty' },
};
const PRIMES = new Set(['soiree', 'nuit', 'pause_manquee']);

// Catégorie inconnue des textes : mot simple, jamais le nom interne.
export const nomCategorie = (c, langue) => CATEGORIES[c]?.[langue] ?? (langue === 'fr' ? 'autres heures' : 'other hours');

const leJour = (date, langue) => (date ? (langue === 'fr' ? ` le ${dateCourte(date)}` : ` on ${dateCourte(date)}`) : '');

/** Une phrase simple pour un constat du moteur. */
export function phrase(c, langue) {
  const fr = langue === 'fr';
  const cat = nomCategorie(c.categorie, langue);
  const m = typeof c.montant === 'number' ? dollars(Math.abs(c.montant), langue) : '';
  const h = typeof c.heures === 'number' ? duree(c.heures, langue) : '';
  if (c.type === 'ecart_heures') {
    if (c.heures < 0 || c.montant < 0) {
      return fr ? `Payé en trop : ${h} de ${cat}${leJour(c.date, langue)} (${m}).`
        : `Overpaid: ${h} of ${cat}${leJour(c.date, langue)} (${m}).`;
    }
    if (PRIMES.has(c.categorie)) {
      return fr ? `Prime oubliée : ${h} de ${cat}${leJour(c.date, langue)}, il manque ${m}.`
        : `Missed penalty: ${h} of ${cat}${leJour(c.date, langue)}, ${m} missing.`;
    }
    return fr ? `Heures non payées : ${h} de ${cat}${leJour(c.date, langue)}, il manque ${m}.`
      : `Unpaid hours: ${h} of ${cat}${leJour(c.date, langue)}, ${m} missing.`;
  }
  if (c.type === 'ecart_super') {
    return c.montant >= 0
      ? (fr ? `Super (retraite) : il manque ${m}, à verser au fonds de super.` : `Super: ${m} missing, to be paid into the super fund.`)
      : (fr ? `Super (retraite) : ${m} versés en trop.` : `Super: ${m} overpaid.`);
  }
  if (c.type === 'taux_different') {
    const tf = dollars(c.taux_fiche, langue);
    const tr = dollars(c.taux_regles, langue);
    return fr ? `Mauvais taux sur la fiche pour « ${c.libelle} » : ${tf} de l'heure au lieu de ${tr} (Fair Work).`
      : `Wrong rate on the pay slip for "${c.libelle}": ${tf} an hour instead of ${tr} (Fair Work).`;
  }
  if (/_paye_taux_ordinaire$/.test(c.type)) {
    return fr ? `Mauvais taux : ${h} de ${cat}${leJour(c.date, langue)} payées au taux normal, il manque ${m}.`
      : `Wrong rate: ${h} of ${cat}${leJour(c.date, langue)} paid at the normal rate, ${m} missing.`;
  }
  if (/_non_payee$/.test(c.type)) {
    return fr ? `Prime oubliée${leJour(c.date, langue)} : ${cat}, il manque ${m}.`
      : `Missed penalty${leJour(c.date, langue)}: ${cat}, ${m} missing.`;
  }
  switch (c.type) {
    case 'retenue_non_autorisee':
      return fr ? `Retenue « ${c.libelle} » de ${m} sans accord écrit connu : à demander.`
        : `Deduction "${c.libelle}" of ${m} with no known written agreement: ask about it.`;
    case 'remboursement_retenue':
      return fr ? `Remboursement « ${c.libelle} » de ${m} sur la fiche.` : `Refund "${c.libelle}" of ${m} on the pay slip.`;
    case 'brut_incoherent':
      return fr ? `Le total brut de la fiche ne correspond pas à la somme des lignes (écart ${m}).`
        : `The pay slip gross total does not match the sum of its lines (gap ${m}).`;
    case 'super_incoherent':
      return fr ? `Le super inscrit sur la fiche ne correspond pas au pourcentage légal (écart ${m}).`
        : `The super shown on the pay slip does not match the legal percentage (gap ${m}).`;
    case 'banque_differente_net':
      return c.montant > 0
        ? (fr ? `Banque : reçu ${dollars(c.recu, langue)}, la fiche annonce ${dollars(c.net, langue)} net ; il manque ${m}.`
          : `Bank: received ${dollars(c.recu, langue)}, the pay slip says ${dollars(c.net, langue)} net; ${m} missing.`)
        : (fr ? `Banque : reçu ${dollars(c.recu, langue)}, la fiche annonce ${dollars(c.net, langue)} net ; ${m} de plus.`
          : `Bank: received ${dollars(c.recu, langue)}, the pay slip says ${dollars(c.net, langue)} net; ${m} extra.`);
    case 'banque_net_absent':
    case 'banque_net_illisible':
      return fr ? 'Banque : net de la fiche illisible, comparaison impossible.' : 'Bank: the pay slip net pay could not be read, no comparison.';
    case 'banque_sans_fiche':
      return fr ? 'Montant reçu en banque sans fiche pour cette semaine.' : 'Bank amount with no pay slip for this week.';
    case 'periode_sans_fiche':
      return fr ? 'Services trouvés, mais aucune fiche de paie déposée pour cette semaine.'
        : 'Shifts found, but no pay slip dropped for this week.';
    case 'fiche_sans_heures':
      return fr ? 'Fiche déposée, mais aucun service Humanforce pour cette semaine.'
        : 'Pay slip dropped, but no Humanforce shift for this week.';
    case 'paiement_decale':
      return fr ? `Heures payées la semaine suivante (semaine du ${dateCourte(c.paye_avec)}) : vérifiez le total des deux semaines.`
        : `Hours paid the following week (week of ${dateCourte(c.paye_avec)}): check the total of both weeks.`;
    default:
      // Constat inconnu des textes : phrase simple, jamais son nom interne.
      return fr ? 'Un point de cette semaine est à vérifier : montre ta fiche au manager.'
        : 'Something in this week needs checking: show your pay slip to your manager.';
  }
}

/** Titre d'une semaine : « Semaine du 17/08/2026 ». */
export const titreSemaine = (s, langue) => {
  if (s.semaine_fin) {
    return langue === 'fr' ? `Semaines du ${dateCourte(s.semaine)} et du ${dateCourte(s.semaine_fin)}`
      : `Weeks of ${dateCourte(s.semaine)} and ${dateCourte(s.semaine_fin)}`;
  }
  return `${langue === 'fr' ? 'Semaine du' : 'Week of'} ${dateCourte(s.semaine)}`;
};

/** État d'une semaine : « OK » ou « Écart de 2,95 $ (manquant) »… */
export function etatSemaine(s, langue) {
  const fr = langue === 'fr';
  switch (s.etat) {
    case 'ok': return 'OK';
    case 'sans_fiche': return fr ? 'Pas de fiche' : 'No pay slip';
    case 'a_verifier': return fr ? 'À vérifier' : 'To check';
    case 'sans_heures': return fr ? 'Aucun service Humanforce : non comptée' : 'No Humanforce shift: not counted';
    case 'liste_incomplete': return fr ? 'Liste Humanforce incomplète : non comptée' : 'Humanforce list incomplete: not counted';
    default: {
      const m = argent(Math.abs(s.ecart_cents), langue);
      if (s.ecart_cents > 0) return fr ? `Écart de ${m} (manquant)` : `Gap of ${m} (underpaid)`;
      return fr ? `Écart de ${m} (payé en trop)` : `Gap of ${m} (overpaid)`;
    }
  }
}

/** Lignes du total : salaire manquant / payé en trop, semaines non comptées, super, banque. */
export function lignesTotal(syn, langue) {
  const fr = langue === 'fr';
  const t = syn.total_cents;
  const lignes = [];
  if (t > 0) lignes.push(fr ? `Total manquant : ${argent(t, langue)}` : `Total underpaid: ${argent(t, langue)}`);
  else if (t < 0) lignes.push(fr ? `Total payé en trop : ${argent(-t, langue)}` : `Total overpaid: ${argent(-t, langue)}`);
  else lignes.push(fr ? 'Aucun écart sur le salaire' : 'No gap in wages');
  const n = syn.semaines_non_comptees ?? 0;
  if (n === 1) lignes.push(fr ? '(1 semaine non comptée, voir plus haut)' : '(1 week not counted, see above)');
  else if (n > 1) lignes.push(fr ? `(${n} semaines non comptées, voir plus haut)` : `(${n} weeks not counted, see above)`);
  if (syn.super_cents > 0) lignes.push(fr ? `Super manquant : ${argent(syn.super_cents, langue)}` : `Super owed: ${argent(syn.super_cents, langue)}`);
  else if (syn.super_cents < 0) lignes.push(fr ? `Super versé en trop : ${argent(-syn.super_cents, langue)}` : `Super overpaid: ${argent(-syn.super_cents, langue)}`);
  const b = syn.banque_cents ?? 0;
  if (b > 0) lignes.push(fr ? `Banque : ${argent(b, langue)} de moins que le net des fiches` : `Bank: ${argent(b, langue)} less than the pay slip net pay`);
  else if (b < 0) lignes.push(fr ? `Banque : ${argent(-b, langue)} de plus que le net des fiches` : `Bank: ${argent(-b, langue)} more than the pay slip net pay`);
  return lignes;
}

/** Raison d'un refus, en phrase simple : plus ou moins de 7 jours, ou semaine qui ne commence pas un lundi. */
export const raisonRefus = (r, langue) => (r.raison === 'lundi' ? TEXTES[langue].fiche_lundi : remplir(TEXTES[langue].fiche_jours, { n: r.jours }));

/** Cartes des fiches refusées (pas à la semaine) : titre, « non vérifiée », la raison. Aucun montant. */
export function cartesRefusees(refusees, langue) {
  const t = TEXTES[langue];
  return (refusees ?? []).map((r) => ({
    titre: remplir(t.fiche_du, { du: dateCourte(r.du), au: dateCourte(r.au) }),
    etat: t.non_verifiee,
    phrases: [raisonRefus(r, langue)],
  }));
}

/**
 * Résumé prêt à copier pour le manager. `contexte` : { classification, date_effet, refusees?, aMain?, sansHumanforce? }.
 * aMain : services saisis à la main (servicesAMain), listés à part ; sansHumanforce : aucune liste Humanforce.
 */
export function resumeManager(syn, contexte, langue) {
  const fr = langue === 'fr';
  const lignes = [];
  lignes.push(fr ? 'Bonjour,' : 'Hello,');
  lignes.push('');
  if (contexte.sansHumanforce) {
    lignes.push(fr
      ? `J'ai comparé mes fiches de paie avec mes services saisis à la main et les taux Fair Work (Hospitality Industry (General) Award 2020, ${contexte.classification}, casual, taux au ${dateCourte(contexte.date_effet)}).`
      : `I compared my pay slips with my shifts entered by hand and the Fair Work rates (Hospitality Industry (General) Award 2020, ${contexte.classification}, casual, rates from ${dateCourte(contexte.date_effet)}).`);
  } else lignes.push(fr
    ? `J'ai comparé mes fiches de paie avec mes services Humanforce et les taux Fair Work (Hospitality Industry (General) Award 2020, ${contexte.classification}, casual, taux au ${dateCourte(contexte.date_effet)}).`
    : `I compared my pay slips with my Humanforce shifts and the Fair Work rates (Hospitality Industry (General) Award 2020, ${contexte.classification}, casual, rates from ${dateCourte(contexte.date_effet)}).`);
  lignes.push('');
  for (const s of syn.semaines) {
    lignes.push(`- ${titreSemaine(s, langue)}${fr ? ' : ' : ': '}${etatSemaine(s, langue)}`);
    for (const c of s.constats) lignes.push(`  • ${phrase(c, langue)}`);
  }
  for (const r of contexte.refusees ?? []) {
    lignes.push(`- ${remplir(TEXTES[langue].fiche_du, { du: dateCourte(r.du), au: dateCourte(r.au) })}${fr ? ' : ' : ': '}${TEXTES[langue].non_verifiee}`);
    lignes.push(`  • ${raisonRefus(r, langue)}`);
  }
  if (contexte.aMain?.length) {
    lignes.push('');
    lignes.push(TEXTES[langue].main_titre_resume);
    for (const x of contexte.aMain) lignes.push(`- ${phraseAMain(x, langue)}`);
  }
  lignes.push('');
  lignes.push(...lignesTotal(syn, langue));
  lignes.push('');
  // Une semaine sans fiche n'est pas à corriger par le manager (il manque seulement la fiche côté salarié).
  const aCorriger = syn.total_cents !== 0 || syn.super_cents !== 0 || (syn.banque_cents ?? 0) !== 0
    || syn.semaines.some((s) => !['ok', 'sans_fiche'].includes(s.etat));
  lignes.push(aCorriger
    ? (fr ? 'Pouvez-vous vérifier et corriger, s\'il vous plaît ? Merci.' : 'Could you please check and correct this? Thank you.')
    : (fr ? 'Tout correspond, merci.' : 'Everything matches, thank you.'));
  lignes.push('');
  lignes.push(fr ? '(Calcul fait avec un outil d\'aide, à vérifier auprès de Fair Work.)' : '(Calculated with a help tool, to be checked with Fair Work.)');
  return lignes.join('\n');
}

// ---------- Cycle 3g : services saisis à la main, verdict, avis, données gardées ----------

const reHeure = /^\d{1,2}:\d{2}$/;

/**
 * Services du calcul saisis à la main : ajoutés (type 'ajoute') ou heures Humanforce corrigées dans la ligne
 * (type 'corrige'). `services` : services du calcul (après preparer) ; `ajouts` et `corrections` : ceux de la page.
 */
export function servicesAMain(services, { ajouts = [], corrections = new Map(), hf = null } = {}) {
  const ajoutes = new Set(ajouts.filter((a) => a.date && reHeure.test(a.debut ?? '')).map((a) => `${a.date} ${a.debut}`));
  // Correction périmée (sa ligne Humanforce n'est plus dans la liste collée) : ignorée (relecture 3g).
  const lignesHf = hf ? new Set(hf.map(cleService)) : null;
  const corriges = new Set([...corrections].filter(([cle]) => !lignesHf || lignesHf.has(cle)).map(([cle, c]) => `${cle.slice(0, 10)} ${c.debut}`));
  return services
    .map((s) => ({ date: s.date, debut: s.debut, fin: s.fin, cle: cleService(s) }))
    .filter((s) => ajoutes.has(s.cle) || corriges.has(s.cle))
    .map(({ cle, ...s }) => ({ ...s, type: ajoutes.has(cle) ? 'ajoute' : 'corrige' }));
}

/** « Le 18/08/2026, de 18:00 à 23:00 : service ajouté à la main. » */
export const phraseAMain = (s, langue) => remplir(TEXTES[langue][s.type === 'ajoute' ? 'main_ajoute' : 'main_corrige'],
  { date: dateCourte(s.date), debut: s.debut, fin: s.fin });

const pluriel = (n, un, plusieurs, autres = {}) => remplir(n === 1 ? un : plusieurs, { n, ...autres });

/**
 * Verdict en une phrase, tout en haut du résultat. Calculé seulement à partir de la synthèse (mêmes montants que
 * le total) : { etat, texte }, etat ∈ 'manque' | 'trop' | 'ok' | 'a_verifier' | 'non_verifie'.
 * `contexte` : { refusees?: fiches refusées, alertes?: nombre de points « à vérifier » hors semaines (minuit…) }.
 */
export function verdict(syn, { refusees = [], alertes = 0 } = {}, langue) {
  const t = TEXTES[langue];
  const comptees = syn.semaines.filter((s) => s.comptee);
  const nonVerifiees = (syn.semaines_non_comptees ?? 0) + refusees.length;
  const suite = nonVerifiees > 0 ? ` · ${pluriel(nonVerifiees, t.verdict_non_verifiee_1, t.verdict_non_verifiees)}` : '';
  if (comptees.length === 0) {
    return { etat: 'non_verifie', texte: nonVerifiees > 0 ? pluriel(nonVerifiees, t.verdict_non_verifiee_1, t.verdict_non_verifiees) : t.verdict_rien };
  }
  // N = semaines vérifiées (celles du total) : le montant est le total net sur ces semaines, jamais un compte
  // de semaines « en manque » qui mêlerait les deux sens (relecture 3g).
  const k = comptees.length;
  const total = syn.total_cents;
  if (total > 0) return { etat: 'manque', texte: pluriel(k, t.verdict_manque_1, t.verdict_manque, { m: argent(total, langue) }) + suite };
  if (total < 0) return { etat: 'trop', texte: pluriel(k, t.verdict_trop_1, t.verdict_trop, { m: argent(-total, langue) }) + suite };
  const propre = comptees.every((s) => s.etat === 'ok') && syn.super_cents === 0 && (syn.banque_cents ?? 0) === 0 && alertes === 0;
  if (!propre) return { etat: 'a_verifier', texte: t.verdict_a_verifier + suite };
  // Juste sur ce qui est vérifié, mais une semaine reste non vérifiée : jamais « Tout est OK » seul ni en vert.
  if (nonVerifiees > 0) return { etat: 'a_verifier', texte: pluriel(k, t.verdict_ok_verifiees_1, t.verdict_ok_verifiees) + suite };
  return { etat: 'ok', texte: t.verdict_ok };
}

/** Version de la page, envoyée avec l'avis (cycle 6b) ; même numéro que le début de VERSION dans sw.js (testé). */
export const VERSION_PAGE = '1.2.1';

/**
 * Champs de l'avis réellement envoyés (cycle 6b) : SEULEMENT les trois réponses de la personne, la langue et la
 * version de la page (aucune donnée de paie, d'heures ni de fiche : la fonction ne reçoit rien d'autre).
 * facile : 'oui' | 'non' | ''.
 */
export function champsAvis({ facile = '', gene = '', idee = '' } = {}, langue) {
  const net = (x) => String(x ?? '').trim().slice(0, 2000);
  return {
    facile: facile === 'oui' || facile === 'non' ? facile : '',
    gene: net(gene),
    idee: net(idee),
    langue: langue === 'en' ? 'en' : 'fr',
    version: VERSION_PAGE,
  };
}

/** Aperçu lisible de l'avis : exactement les champs de champsAvis, rien d'autre, avec des phrases fixes. */
export function texteAvis(reponses = {}, langue) {
  const t = TEXTES[langue];
  const c = champsAvis(reponses, langue);
  const f = c.facile === 'oui' ? t.avis_oui : c.facile === 'non' ? t.avis_non : t.avis_sans_reponse;
  return [
    t.avis_entete, `${t.avis_q1} ${f}`, `${t.avis_q2} ${c.gene || t.avis_sans_reponse}`,
    `${t.avis_q3} ${c.idee || t.avis_sans_reponse}`, `${t.avis_langue} ${t.avis_langue_nom}`, `${t.avis_version} ${c.version}`,
  ].join('\n');
}

/** Clé du stockage de l'appareil pour « Garder mes fiches et mes services sur ce téléphone ». */
export const CLE_GARDE = 'controle-paie-garde';

const estDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const estTexte = (x) => typeof x === 'string' && x.length <= 2000000;
const paires = (x, ok) => Array.isArray(x) && x.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && ok(p[1]));

/**
 * Saisie gardée → texte (version 1). Seules les fiches lues (jamais l'exemple fictif, jamais un fichier illisible)
 * et ce que la personne a tapé.
 */
export function serialiserGarde(s) {
  return JSON.stringify({
    v: 1,
    fiches: s.fiches.filter((f) => f.fiche && !f.exemple).map(({ nom, fiche, niveau_lu, casual, jours, lundi }) => ({ nom, fiche, niveau_lu, casual: typeof casual === 'boolean' ? casual : null, jours, lundi })),
    humanforce: s.humanforce ?? '',
    montants: [...(s.montants ?? [])],
    jours: (s.jours ?? []).map((j) => ({ date: j.date ?? '', debut: j.debut ?? '', fin: j.fin ?? '', pause_min: j.pause_min ?? '', pause_de: j.pause_de ?? '', pause_a: j.pause_a ?? '' })),
    niveau: s.niveau ?? null,
    // Qui je suis (cycle Q4+Q5) : seulement les réponses de la personne (null = pas répondu / suivre la fiche).
    qui: { contrat: s.qui?.contrat ?? null, convention: s.qui?.convention ?? null, etat: s.qui?.etat ?? null },
    pauses: [...(s.pauses ?? [])],
    finsPause: [...(s.finsPause ?? [])],
    corrections: [...(s.corrections ?? [])],
    saisieMain: Boolean(s.saisieMain),
  });
}

/** Texte gardé → saisie ; null si absent, abîmé ou d'une autre version (rien n'est alors repris). */
export function deserialiserGarde(texte) {
  let o;
  try { o = JSON.parse(texte); } catch { return null; }
  if (!o || o.v !== 1) return null;
  const ficheOk = (f) => f && typeof f === 'object' && f.fiche && typeof f.fiche === 'object' && estDate(f.fiche.periode?.du) && estDate(f.fiche.periode?.au)
    && Number.isInteger(f.jours) && typeof f.lundi === 'boolean' && (f.niveau_lu == null || typeof f.niveau_lu === 'string') && (f.casual == null || typeof f.casual === 'boolean');
  const jourOk = (j) => j && ['date', 'debut', 'fin', 'pause_min', 'pause_de', 'pause_a'].every((k) => typeof j[k] === 'string' && j[k].length <= 200);
  const corrOk = (c) => c && ['debut', 'fin', 'pause_min'].every((k) => typeof c[k] === 'string' && c[k].length <= 200);
  const court = (x) => typeof x === 'string' && x.length <= 200;
  // Garde d'avant le cycle Q4+Q5 : sans « qui » (rien de répondu) ; une réponse inconnue rend la garde illisible.
  const qui = o.qui ?? { contrat: null, convention: null, etat: null };
  const quiOk = qui && typeof qui === 'object' && [[qui.contrat, CONTRATS], [qui.convention, CONVENTIONS], [qui.etat, ETATS]].every(([v, l]) => v === null || l.includes(v));
  if (!Array.isArray(o.fiches) || !o.fiches.every(ficheOk) || !estTexte(o.humanforce) || !paires(o.montants, court)
    || !Array.isArray(o.jours) || !o.jours.every(jourOk) || !(o.niveau === null || typeof o.niveau === 'string')
    || !paires(o.pauses, court) || !paires(o.finsPause, court) || !paires(o.corrections, corrOk) || typeof o.saisieMain !== 'boolean' || !quiOk) return null;
  return {
    // casual absent (garde d'avant le cycle Q4+Q5) : null = inconnu ; le contrat n'est alors pas pré-rempli et la
    // contradiction fiche / réponse n'est pas vue (sans effet sur l'argent : temps partiel et plein sont refusés).
    fiches: o.fiches.map((f) => ({ nom: String(f.nom ?? ''), fiche: f.fiche, niveau_lu: f.niveau_lu ?? null, casual: f.casual ?? null, jours: f.jours, lundi: f.lundi })),
    humanforce: o.humanforce,
    montants: new Map(o.montants),
    jours: o.jours,
    niveau: o.niveau,
    qui: { contrat: qui.contrat, convention: qui.convention, etat: qui.etat },
    pauses: new Map(o.pauses),
    finsPause: new Map(o.finsPause),
    corrections: new Map(o.corrections),
    saisieMain: o.saisieMain,
  };
}

// ---------- Textes fixes de la page ----------

export const TEXTES = {
  fr: {
    titre: 'Vérifier ma paie',
    confiance: 'Tes fiches et tes heures ne quittent jamais ton téléphone. Seuls partent un compte anonyme des visites, et ton avis si tu appuies sur « Envoyer mon avis ». Ton résumé, c’est toi qui choisis à qui l’envoyer.',
    maj_prete: 'Une nouvelle version de l’outil est prête.',
    maj_bouton: 'Mettre à jour',
    maj_aide: 'Ce que tu as tapé sera effacé, sauf ce qui est gardé sur ce téléphone.',
    bascule: 'English',
    bascule_aide: 'Switch to English',
    essayer: 'Essayer avec l’exemple fictif',
    etape_sur: 'Étape {n} sur 3',
    suivant: 'Suivant',
    retour: 'Retour',
    modifier: 'Modifier mes infos',
    quitter_exemple: 'Quitter l’exemple et revenir à mes données',
    jour_n: 'Jour {n} : {champ}',
    etape1: 'Tes fiches de paie',
    qui_titre: 'Qui je suis',
    qui_corriger: 'Corriger qui je suis',
    qui_resume: 'Vérifié pour : {contrat}, convention {convention}, {etat}, niveau {niveau}.',
    qui_contrat: 'Mon contrat :',
    qui_convention: 'Ma convention :',
    qui_etat: 'Mon État :',
    qui_choisir: 'choisis',
    qui_lu_fiche: 'Lu sur ta fiche : casual.',
    contrat_casual: 'casual',
    contrat_temps_partiel: 'temps partiel',
    contrat_temps_plein: 'temps plein',
    contrat_ne_sait_pas: 'je ne sais pas',
    convention_hospitality: 'Hospitality',
    convention_autre: 'une autre',
    convention_ne_sait_pas: 'je ne sais pas',
    manque_qui: 'Réponds d’abord aux trois questions en haut : ton contrat, ta convention et ton État.',
    qui_contradiction: 'Ta fiche indique « casual », mais tu as choisi un autre contrat. Corrige ta réponse, ou demande à ton employeur quel est ton vrai contrat.',
    qui_ne_sait_pas: 'Sans ton contrat et ta convention, l’outil ne peut rien vérifier : rien n’a été calculé. Ton employeur doit pouvoir te le dire ; Fair Work aussi, gratuitement : fairwork.gov.au ou 13 13 94.',
    qui_non_couvert: 'L’outil ne sait pas encore vérifier ce cas : pour l’instant, seulement les casuals de la convention Hospitality au Queensland. Rien n’a été calculé. Pour une aide gratuite : Fair Work, fairwork.gov.au ou 13 13 94.',
    niveau_question: 'Mon niveau :',
    niveau_lu: 'Niveau lu sur ta fiche : {n}',
    niveau_lus: 'Niveau lu sur chaque fiche',
    niveau_modifier: 'modifier',
    niveau_choisir: 'choisis',
    note_fiche_indique: 'Ta fiche indique le niveau {n}.',
    note_niveaux_differents: 'Tes fiches n’indiquent pas toutes le même niveau ({liste}) : chaque fiche est vérifiée avec son propre niveau.',
    note_niveau_absent: 'Ta fiche n’indique pas clairement ton niveau : choisis-le.',
    note_niveau_absent_une: 'Une de tes fiches n’indique pas clairement ton niveau : choisis-le, il sera appliqué à toutes.',
    note_niveau_choisi_tous: 'Tes fiches indiquent les niveaux {liste} ; le niveau choisi est appliqué à toutes.',
    fiche_lundi: 'Cette fiche ne va pas du lundi au dimanche ; pour l’instant, l’outil ne vérifie que ces semaines-là.',
    fiches_recouvrent: 'Deux de tes fiches couvrent les mêmes jours : retire celle qui ne va pas.',
    pauses_titre: 'L’heure de tes pauses',
    pauses_aide: 'Facultatif : indique quand chaque pause a commencé. Sans heure, l’outil la compte de la façon la moins favorable pour toi : indique-la pour un calcul exact. Il ne vérifie pas à quelle heure la pause devait être prise.',
    pause_illisible: 'L’heure de la pause du {date} n’est pas complète : écris-la comme 19:30.',
    pauses_aucune: 'Aucun service avec une pause pour l’instant.',
    pause_avant: 'Le {date}, de {debut} à {fin}, pause de {pause} min commencée à',
    pause_heure: 'Heure du début de la pause',
    pause_non_indiquee: 'Le {date} ({debut}–{fin}), heure de pause non indiquée : comptée de la façon la moins favorable pour toi. Indique-la pour un calcul exact.',
    pause_effet: 'Le {date}, pause commencée à {heure} : {liste}.',
    pause_effet_item: '{cat} comptée sur {avec} au lieu de {sans}',
    pause_sans_effet: 'Le {date}, pause commencée à {heure} : elle ne change pas le calcul.',
    pause_hors_service: 'La pause du {date} ne tombe pas pendant le service ({debut}–{fin}) : corrige son heure.',
    pauses_resultat: 'Heure des pauses',
    manque_niveau: 'Choisis ton niveau avant de continuer.',
    fiche_jours: 'Cette fiche couvre {n} jours ; pour l’instant, l’outil ne vérifie que les paies à la semaine.',
    aucune_hebdo: 'Aucune de tes fiches n’est une paie à la semaine : pour l’instant, l’outil ne peut rien vérifier.',
    niveaux_decale: 'Deux semaines payées ensemble ont des niveaux différents : l’outil ne sait pas encore les vérifier.',
    non_verifiee: 'non vérifiée',
    et: 'et',
    niveau_debutant: 'débutant',
    depot_action: 'Touche ici pour ajouter tes fiches de paie',
    depot_aide: 'Les fichiers PDF reçus de ton employeur. Tu peux aussi les glisser ici.',
    etape1_aucune: 'Aucune fiche pour l’instant.',
    fiche_du: 'Fiche du {du} au {au}',
    fichier_n: 'Fichier n° {n}',
    etape2: 'Tes services Humanforce',
    etape2_aide: 'Dans Humanforce, sélectionne la liste de tes services (le mois, les jours, les horaires), copie-la et colle-la ici.',
    etape3: 'Pour aller plus loin (facultatif)',
    etape3_aide: 'Tu peux passer cette étape : clique directement sur « Vérifier ma paie ».',
    banque: 'Ce que tu as reçu en banque',
    banque_aucune: 'Ajoute d’abord tes fiches à l’étape 1.',
    banque_avant: 'Pour la fiche du {du} au {au}, j’ai reçu',
    banque_apres: '$ en banque.',
    vraies: 'Tes vraies heures, quand le badge était faux',
    vraies_aide: 'Chaque jour ajouté remplace les heures Humanforce de ce jour-là.',
    services_titre: 'Tes services',
    services_aide: 'Repris de ta liste Humanforce, qui peut oublier ou se tromper : vérifie chaque ligne, corrige-la ou ajoute un service. Indique l’heure de ta pause, ou corrige les heures d’un jour. Sans heure de pause, l’outil la compte de la façon la moins favorable pour toi : indique-la pour un calcul exact. Il ne vérifie pas à quelle heure la pause devait être prise.',
    jours_courts: 'Lun,Mar,Mer,Jeu,Ven,Sam,Dim',
    ligne_de: 'de',
    ligne_a: 'à',
    ligne_pause: 'pause de',
    ligne_min_de: 'min de',
    ligne_sans_pause: 'sans pause',
    corriger: 'corriger les heures',
    revenir_hf: 'revenir aux heures Humanforce',
    remplace: 'remplacé par le service ajouté ce jour-là',
    pause_debut_aria: 'Début de la pause',
    pause_fin_aria: 'Fin de la pause',
    pause_fin_avant: 'La fin de la pause du {date} doit être après son début.',
    services_aucun: 'Ta liste Humanforce n’a pas pu être lue : vérifie-la à l’étape 2.',
    vraie_1: 'Le',
    vraie_2: ', j’ai vraiment travaillé de',
    vraie_3: 'à',
    vraie_4: ', avec',
    vraie_5: 'min de pause.',
    ajouter_jour: '+ Ajouter un service',
    retirer: 'Retirer',
    date: 'Date',
    debut: 'Début',
    fin: 'Fin',
    pause: 'Pause en minutes',
    montant: 'Montant reçu',
    verifier: 'Vérifier ma paie',
    calcul: 'Calcul en cours…',
    resultat: 'Résultat',
    resume: 'Résumé à montrer au manager',
    copier: 'Copier le résumé',
    copie_ok: 'Copié !',
    copie_ko: 'La copie n’a pas marché : sélectionne le texte à la main.',
    manque_fiche: 'Ajoute au moins une fiche de paie avant de continuer.',
    manque_hf: 'Colle ta liste de services Humanforce, ou touche « Je n’ai pas Humanforce » pour saisir toi-même tes services.',
    erreur: 'Le calcul n’a pas pu se terminer. Vérifie tes fiches et ta liste Humanforce, puis réessaie.',
    montant_illisible: 'Un montant reçu en banque n’est pas lisible : écris-le comme 615.42',
    vraies_heures_incompletes: 'Pour un service, remplis la date, l’heure de début et l’heure de fin.',
    pause_debut_manquant: 'La pause du {date} a une fin mais pas de début : indique aussi le début.',
    minuit_titre: 'À vérifier',
    minuit_alerte: 'Le {date} ({debut}–{fin}), le service continue après minuit sur un autre type de jour (fin de semaine ou jour férié) : l’outil paie tout le service au taux du jour où il a commencé. À vérifier auprès de Fair Work.',
    pause_invalide: 'La pause doit être un nombre entier de minutes, par exemple 30.',
    exemple_note: 'Exemple fictif : les valeurs sont inventées.',
    erreur_pdf: 'Ce fichier n’est pas une fiche de paie que l’outil sait lire : retire-le.',
    // Cycle 5 : une phrase claire par sorte de fiche illisible (src/fiche_page_pur.js) ; jamais de résultat pour elle.
    fiche_vide: 'Ce fichier est vide : il n’y a rien à lire. Retire-le et dépose ta fiche de paie.',
    fichier_pas_pdf: 'Ce fichier n’est pas une fiche de paie en PDF (c’est peut-être une photo ou un autre document). Retire-le et dépose le fichier PDF reçu de ton employeur.',
    fiche_mot_de_passe: 'Cette fiche est protégée par un mot de passe : l’outil ne peut pas l’ouvrir. Retire-la et dépose une copie sans mot de passe.',
    fiche_abimee: 'Ce fichier est abîmé ou incomplet : l’outil ne peut pas l’ouvrir. Retire-le et dépose de nouveau la fiche reçue de ton employeur.',
    fiche_scan: 'Cette fiche est une image (photo ou scan) : l’outil ne peut pas lire son texte. Retire-la et dépose le fichier PDF d’origine reçu de ton employeur.',
    fiche_autre_format: 'Cette fiche n’a pas la présentation que l’outil connaît : il ne sait pas encore la lire. Retire-la ; aucun résultat n’est donné pour elle.',
    fiche_incomplete: 'Cette fiche ressemble à celles que l’outil connaît, mais une partie ne se lit pas bien : aucun résultat n’est donné pour elle. Retire-la.',
    erreur_humanforce: 'La liste Humanforce n’a pas été reconnue : copie toute la liste, avec le mois (par exemple « August 2026 »).',
    erreur_libelle: 'Une ligne de ta fiche de paie est inconnue de l’outil : il ne peut pas encore la contrôler.',
    erreur_doublon: 'Deux fiches pour la même semaine : retire celle en double.',
    erreur_periode: 'Une fiche ne couvre pas une semaine du lundi au dimanche : l’outil ne sait pas encore la lire.',
    erreur_taux: 'L’outil n’a pas encore les taux Fair Work pour ces dates.',
    erreur_chargement: 'La page n’a pas fini de se charger : recharge-la.',
    fiche_deja: 'Tu as déjà ajouté une fiche pour cette semaine.',
    hf_peut_oublier: 'Humanforce peut oublier ou se tromper : vérifie la liste, ajoute ou corrige les services à l’étape suivante.',
    sans_humanforce: 'Je n’ai pas Humanforce : je saisis moi-même mes services',
    etape3_aide_main: 'Ajoute chacun de tes services avec « + Ajouter un service », puis touche « Vérifier ma paie ».',
    services_aide_main: 'Tu saisis toi-même tes services : la date, l’heure de début, l’heure de fin et la pause.',
    manque_service: 'Ajoute au moins un service avant de vérifier.',
    main_ajoute: 'Le {date}, de {debut} à {fin} : service ajouté à la main.',
    main_corrige: 'Le {date}, de {debut} à {fin} : heures corrigées à la main.',
    main_titre: 'Saisis à la main',
    main_titre_resume: 'Saisis à la main (pas repris tels quels de Humanforce) :',
    verdict_manque_1: 'Il te manque {m} sur 1 semaine',
    verdict_manque: 'Il te manque {m} sur {n} semaines',
    verdict_trop_1: 'Tu as reçu {m} de trop sur 1 semaine',
    verdict_trop: 'Tu as reçu {m} de trop sur {n} semaines',
    verdict_ok: 'Tout est OK',
    verdict_ok_verifiees_1: 'Tout est OK sur la semaine vérifiée',
    verdict_ok_verifiees: 'Tout est OK sur les {n} semaines vérifiées',
    verdict_a_verifier: 'Pas d’écart sur le salaire, mais des points sont à vérifier ci-dessous',
    verdict_non_verifiee_1: '1 semaine non vérifiée',
    verdict_non_verifiees: '{n} semaines non vérifiées',
    verdict_rien: 'Aucune semaine à vérifier',
    garder: 'Garder mes fiches et mes services sur ce téléphone',
    garder_aide: 'Seulement sur cet appareil, jamais envoyé. Sur un téléphone partagé, laisse décoché : la prochaine personne pourrait voir tes fiches.',
    effacer_tout: 'Tout effacer de ce téléphone',
    garde_efface: 'Tout est effacé de ce téléphone.',
    garde_arrete: 'Plus rien n’est gardé sur ce téléphone.',
    garde_reprise: 'Tes fiches et tes services gardés sur ce téléphone ont été repris.',
    garde_impossible: 'Ce téléphone ne permet pas de garder tes données : rien n’a été gardé.',
    envoyer: 'Envoyer le résumé',
    partage_ok: 'Envoyé.',
    avis_ouvrir: 'Donner mon avis',
    avis_titre: 'Ton avis sur l’outil',
    avis_q1: 'C’était facile ?',
    avis_q2: 'Qu’est-ce qui t’a gêné ?',
    avis_q3: 'Une idée ?',
    avis_oui: 'Oui',
    avis_non: 'Non',
    avis_note: 'N’écris ici ni montant, ni heure, ni nom : seulement ton avis sur l’outil. Rien n’est envoyé tant que tu n’appuies pas sur « Envoyer mon avis ». Il part alors directement à la personne qui a fait l’outil.',
    avis_envoyer: 'Envoyer mon avis',
    avis_envoi: 'Envoi en cours…',
    avis_envoye: 'Merci, ton avis est envoyé.',
    avis_hors_ligne: 'Pas de connexion : réessaie plus tard. Ce que tu as écrit est gardé.',
    avis_echec: 'L’envoi n’a pas marché : réessaie plus tard. Ce que tu as écrit est gardé.',
    avis_langue: 'Langue :',
    avis_langue_nom: 'français',
    avis_version: 'Version de la page :',
    avis_fermer: 'Fermer',
    avis_apercu: 'Voici ce qui sera envoyé :',
    avis_entete: 'Avis sur l’outil « Vérifier ma paie »',
    avis_sans_reponse: '(pas de réponse)',
  },
  en: {
    titre: 'Check my pay',
    confiance: 'Your pay slips and hours never leave your phone. Only an anonymous visit count is sent, plus your feedback if you tap “Send my feedback”. Your summary: you choose who to send it to.',
    maj_prete: 'A new version of the tool is ready.',
    maj_bouton: 'Update',
    maj_aide: 'What you typed will be cleared, except what is kept on this phone.',
    bascule: 'Français',
    bascule_aide: 'Passer en français',
    essayer: 'Try with the made-up example',
    etape_sur: 'Step {n} of 3',
    suivant: 'Next',
    retour: 'Back',
    modifier: 'Change my details',
    quitter_exemple: 'Leave the example and go back to my details',
    jour_n: 'Day {n}: {champ}',
    etape1: 'Your pay slips',
    qui_titre: 'About me',
    qui_corriger: 'Fix my details',
    qui_resume: 'Checked for: {contrat}, {convention} award, {etat}, level {niveau}.',
    qui_contrat: 'My job type:',
    qui_convention: 'My award:',
    qui_etat: 'My state:',
    qui_choisir: 'choose',
    qui_lu_fiche: 'Read on your pay slip: casual.',
    contrat_casual: 'casual',
    contrat_temps_partiel: 'part-time',
    contrat_temps_plein: 'full-time',
    contrat_ne_sait_pas: 'I don’t know',
    convention_hospitality: 'Hospitality',
    convention_autre: 'another one',
    convention_ne_sait_pas: 'I don’t know',
    manque_qui: 'First answer the three questions at the top: your job type, your award and your state.',
    qui_contradiction: 'Your pay slip says “casual”, but you chose another job type. Fix your answer, or ask your employer what your real job type is.',
    qui_ne_sait_pas: 'Without your job type and your award, the tool cannot check anything: nothing was calculated. Your employer should be able to tell you; so can Fair Work, for free: fairwork.gov.au or 13 13 94.',
    qui_non_couvert: 'The tool cannot check this case yet: for now, only casuals under the Hospitality award in Queensland. Nothing was calculated. For free help: Fair Work, fairwork.gov.au or 13 13 94.',
    niveau_question: 'My level:',
    niveau_lu: 'Level read on your pay slip: {n}',
    niveau_lus: 'Level read on each pay slip',
    niveau_modifier: 'change',
    niveau_choisir: 'choose',
    note_fiche_indique: 'Your pay slip shows level {n}.',
    note_niveaux_differents: 'Your pay slips do not all show the same level ({liste}): each pay slip is checked with its own level.',
    note_niveau_absent: 'Your pay slip does not clearly show your level: choose it.',
    note_niveau_absent_une: 'One of your pay slips does not clearly show your level: choose it, it will be used for all of them.',
    note_niveau_choisi_tous: 'Your pay slips show levels {liste}; the level you chose is used for all of them.',
    fiche_lundi: 'This pay slip does not run from Monday to Sunday; for now, the tool only checks those weeks.',
    fiches_recouvrent: 'Two of your pay slips cover the same days: remove the wrong one.',
    pauses_titre: 'When your breaks started',
    pauses_aide: 'Optional: say when each break started. Without a time, the tool counts it in the way least favourable to you: enter it for an exact calculation. It does not check when the break should have been taken.',
    pause_illisible: 'The break time on {date} is incomplete: write it like 19:30.',
    pauses_aucune: 'No shift with a break yet.',
    pause_avant: 'On {date}, from {debut} to {fin}, {pause}-minute break started at',
    pause_heure: 'Break start time',
    pause_non_indiquee: 'On {date} ({debut}–{fin}), break time not given: counted in the way least favourable to you. Enter it for an exact calculation.',
    pause_effet: 'On {date}, break started at {heure}: {liste}.',
    pause_effet_item: '{cat} counted on {avec} instead of {sans}',
    pause_sans_effet: 'On {date}, break started at {heure}: it does not change the calculation.',
    pause_hors_service: 'The break on {date} is not within the shift ({debut}–{fin}): fix its time.',
    pauses_resultat: 'Break times',
    manque_niveau: 'Choose your level before going on.',
    fiche_jours: 'This pay slip covers {n} days; for now, the tool only checks weekly pay.',
    aucune_hebdo: 'None of your pay slips is weekly pay: for now, the tool cannot check anything.',
    niveaux_decale: 'Two weeks paid together have different levels: the tool cannot check them yet.',
    non_verifiee: 'not checked',
    et: 'and',
    niveau_debutant: 'introductory',
    depot_action: 'Tap here to add your pay slips',
    depot_aide: 'The PDF files from your employer. You can also drag them here.',
    etape1_aucune: 'No pay slip yet.',
    fiche_du: 'Pay slip from {du} to {au}',
    fichier_n: 'File no. {n}',
    etape2: 'Your Humanforce shifts',
    etape2_aide: 'In Humanforce, select your shift list (the month, the days, the times), copy it and paste it here.',
    etape3: 'To go further (optional)',
    etape3_aide: 'You can skip this step: just tap “Check my pay”.',
    banque: 'What you received in the bank',
    banque_aucune: 'Add your pay slips at step 1 first.',
    banque_avant: 'For the pay slip from {du} to {au}, I received $',
    banque_apres: 'in the bank.',
    vraies: 'Your real hours, when the clock-in was wrong',
    vraies_aide: 'Each day you add replaces the Humanforce hours for that day.',
    services_titre: 'Your shifts',
    services_aide: 'Taken from your Humanforce list, which can miss shifts or get them wrong: check each line, fix it or add a shift. Enter your break time, or fix the hours of a day. Without a break time, the tool counts it in the way least favourable to you: enter it for an exact calculation. It does not check when the break should have been taken.',
    jours_courts: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
    ligne_de: 'from',
    ligne_a: 'to',
    ligne_pause: 'break of',
    ligne_min_de: 'min from',
    ligne_sans_pause: 'no break',
    corriger: 'fix the hours',
    revenir_hf: 'back to the Humanforce hours',
    remplace: 'replaced by the shift added that day',
    pause_debut_aria: 'Break start',
    pause_fin_aria: 'Break end',
    pause_fin_avant: 'The break end on {date} must be after its start.',
    services_aucun: 'Your Humanforce list could not be read: check it at step 2.',
    vraie_1: 'On',
    vraie_2: ', I actually worked from',
    vraie_3: 'to',
    vraie_4: ', with a',
    vraie_5: 'minute break.',
    ajouter_jour: '+ Add a shift',
    retirer: 'Remove',
    date: 'Date',
    debut: 'Start',
    fin: 'End',
    pause: 'Break in minutes',
    montant: 'Amount received',
    verifier: 'Check my pay',
    calcul: 'Calculating…',
    resultat: 'Result',
    resume: 'Summary to show your manager',
    copier: 'Copy the summary',
    copie_ok: 'Copied!',
    copie_ko: 'Copying did not work: select the text by hand.',
    manque_fiche: 'Add at least one pay slip before going on.',
    manque_hf: 'Paste your Humanforce shift list, or tap “I don’t have Humanforce” to enter your shifts yourself.',
    erreur: 'The check could not finish. Look at your pay slips and your Humanforce list, then try again.',
    montant_illisible: 'An amount received in the bank cannot be read: write it like 615.42',
    vraies_heures_incompletes: 'For a shift, fill in the date, the start time and the end time.',
    pause_debut_manquant: 'The break on {date} has an end but no start: enter the start too.',
    minuit_titre: 'To check',
    minuit_alerte: 'On {date} ({debut}–{fin}), the shift continues after midnight into a different kind of day (weekend or public holiday): the tool pays the whole shift at the rate of the day it started. Check with Fair Work.',
    pause_invalide: 'The break must be a whole number of minutes, for example 30.',
    exemple_note: 'Made-up example: the values are invented.',
    erreur_pdf: 'This file is not a pay slip the tool can read: remove it.',
    fiche_vide: 'This file is empty: there is nothing to read. Remove it and add your pay slip.',
    fichier_pas_pdf: 'This file is not a PDF pay slip (it may be a photo or another document). Remove it and add the PDF file from your employer.',
    fiche_mot_de_passe: 'This pay slip is protected by a password: the tool cannot open it. Remove it and add a copy without a password.',
    fiche_abimee: 'This file is damaged or incomplete: the tool cannot open it. Remove it and add the pay slip from your employer again.',
    fiche_scan: 'This pay slip is a picture (photo or scan): the tool cannot read its text. Remove it and add the original PDF file from your employer.',
    fiche_autre_format: 'This pay slip does not have the layout the tool knows: it cannot read it yet. Remove it; no result is given for it.',
    fiche_incomplete: 'This pay slip looks like the ones the tool knows, but part of it cannot be read properly: no result is given for it. Remove it.',
    erreur_humanforce: 'The Humanforce list was not recognised: copy the whole list, with the month (for example “August 2026”).',
    erreur_libelle: 'A line of your pay slip is unknown to the tool: it cannot check it yet.',
    erreur_doublon: 'Two pay slips for the same week: remove the duplicate.',
    erreur_periode: 'A pay slip does not cover one Monday-to-Sunday week: the tool cannot read it yet.',
    erreur_taux: 'The tool does not have the Fair Work rates for these dates yet.',
    erreur_chargement: 'The page did not finish loading: reload it.',
    fiche_deja: 'You already added a pay slip for this week.',
    hf_peut_oublier: 'Humanforce can miss shifts or get them wrong: check the list, add or fix shifts at the next step.',
    sans_humanforce: 'I don’t have Humanforce: I’ll enter my shifts myself',
    etape3_aide_main: 'Add each of your shifts with “+ Add a shift”, then tap “Check my pay”.',
    services_aide_main: 'You are entering your shifts yourself: the date, start time, end time and break.',
    manque_service: 'Add at least one shift before checking.',
    main_ajoute: 'On {date}, from {debut} to {fin}: shift added by hand.',
    main_corrige: 'On {date}, from {debut} to {fin}: hours fixed by hand.',
    main_titre: 'Entered by hand',
    main_titre_resume: 'Entered by hand (not taken as-is from Humanforce):',
    verdict_manque_1: 'You are missing {m} over 1 week',
    verdict_manque: 'You are missing {m} over {n} weeks',
    verdict_trop_1: 'You received {m} too much over 1 week',
    verdict_trop: 'You received {m} too much over {n} weeks',
    verdict_ok: 'Everything is OK',
    verdict_ok_verifiees_1: 'Everything is OK on the week checked',
    verdict_ok_verifiees: 'Everything is OK on the {n} weeks checked',
    verdict_a_verifier: 'No gap in wages, but some points need checking below',
    verdict_non_verifiee_1: '1 week not checked',
    verdict_non_verifiees: '{n} weeks not checked',
    verdict_rien: 'No week to check',
    garder: 'Keep my pay slips and shifts on this phone',
    garder_aide: 'Only on this device, never sent. On a shared phone, leave it unticked: the next person could see your pay slips.',
    effacer_tout: 'Erase everything from this phone',
    garde_efface: 'Everything is erased from this phone.',
    garde_arrete: 'Nothing is kept on this phone any more.',
    garde_reprise: 'Your pay slips and shifts kept on this phone have been brought back.',
    garde_impossible: 'This phone does not allow keeping your details: nothing was kept.',
    envoyer: 'Send the summary',
    partage_ok: 'Sent.',
    avis_ouvrir: 'Give feedback',
    avis_titre: 'Your feedback on the tool',
    avis_q1: 'Was it easy?',
    avis_q2: 'What got in your way?',
    avis_q3: 'Any idea?',
    avis_oui: 'Yes',
    avis_non: 'No',
    avis_note: 'Do not write any amount, time or name here: only your opinion of the tool. Nothing is sent until you tap “Send my feedback”. It then goes straight to the person who made the tool.',
    avis_envoyer: 'Send my feedback',
    avis_envoi: 'Sending…',
    avis_envoye: 'Thank you, your feedback has been sent.',
    avis_hors_ligne: 'No connection: try again later. What you wrote is kept.',
    avis_echec: 'Sending did not work: try again later. What you wrote is kept.',
    avis_langue: 'Language:',
    avis_langue_nom: 'English',
    avis_version: 'Page version:',
    avis_fermer: 'Close',
    avis_apercu: 'This is what will be sent:',
    avis_entete: 'Feedback on the “Check my pay” tool',
    avis_sans_reponse: '(no answer)',
  },
};

/** Texte avec ses champs remplis : « Étape {n} sur 3 » → « Étape 2 sur 3 ». */
export const remplir = (modele, valeurs) => modele.replace(/\{(\w+)\}/g, (_, k) => String(valeurs[k] ?? ''));

/** Libellé du niveau dans le menu de la phrase : « Level 2 » → « 2 », « Introductory level » → « débutant ». */
export function libelleNiveau(classification, langue) {
  const m = /^Level (\d)$/.exec(classification);
  if (m) return m[1];
  if (/^Introductory/i.test(classification)) return TEXTES[langue].niveau_debutant;
  return classification;
}

/** Mention permanente, toujours dans les deux langues. */
export const MENTION = {
  fr: 'Outil d\'aide, à vérifier auprès de Fair Work.',
  en: 'Help tool, check with Fair Work.',
};
