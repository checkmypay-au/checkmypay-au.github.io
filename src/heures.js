// Heures d'un service vues de trois côtés : réelle (salarié), badgée (Actual), validée (Authorised).
// Arrondi de l'employeur (pratique réglable dans profil.arrondi_employeur, PAS une règle de l'award)
// et constats en minutes, sans conclusion ni montant.
import { enMinutes, jourSemaine, lundiDe } from './temps.js';
import { categorieDuJour, categorieFerie, joursFeries } from './regles_pur.js';

const enHhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Durée nette d'un service ; un service qui finit après minuit appartient au jour de début. */
export function dureeNette(debut, fin, pause) {
  const d = enMinutes(debut);
  let f = enMinutes(fin);
  if (f <= d) f += 24 * 60;
  return f - d - Number(pause || 0);
}

/**
 * Arrondi d'une heure selon le réglage { pas_min, mode }. Réglage absent → heure inchangée.
 * « plus_proche » : au multiple de pas_min le plus proche (égalité exacte → vers le haut).
 */
export function arrondir(hhmm, reglage) {
  if (!reglage) return hhmm;
  const { pas_min: pas, mode } = reglage;
  if (!(Number.isInteger(pas) && pas > 0)) throw new Error(`Arrondi : pas_min invalide (${pas})`);
  if (mode !== 'plus_proche') throw new Error(`Arrondi : mode inconnu « ${mode} »`);
  return enHhmm((Math.round(enMinutes(hhmm) / pas) * pas) % (24 * 60));
}

/**
 * Cumul du temps gagné et perdu à cause de l'arrondi, sur les bornes dont l'heure badgée est connue.
 * Gagné = minutes payées en plus par rapport au badge (début arrondi plus tôt, fin arrondie plus tard).
 */
export function cumulArrondi(releve, reglage) {
  let gagne = 0;
  let perdu = 0;
  let bornes = 0;
  for (const s of releve) {
    for (const [borne, sens] of [['debut', -1], ['fin', 1]]) {
      const badge = s[`badge_${borne}`];
      if (!badge) continue;
      bornes += 1;
      const d = sens * (enMinutes(arrondir(badge, reglage)) - enMinutes(badge));
      if (d > 0) gagne += d;
      else perdu -= d;
    }
  }
  return { bornes, gagne_min: gagne, perdu_min: perdu, solde_min: gagne - perdu, reglage: reglage ?? null };
}

/** Constats par service : réel non confirmé, validé plus court que le réel, validé ≠ arrondi du badge. */
export function constatsHeures(releve, reglage) {
  const constats = [];
  for (const s of releve) {
    const valide = s.valide_debut && s.valide_fin;
    if (valide && s.source_reel === 'planning') {
      constats.push({ type: 'reel_non_confirme', date: s.date });
    } else if (valide && s.source_reel === 'salarie') {
      const minutesReel = dureeNette(s.reel_debut, s.reel_fin, s.pause_min);
      const minutesValide = dureeNette(s.valide_debut, s.valide_fin, s.pause_min);
      if (minutesReel > minutesValide) {
        constats.push({
          type: 'valide_inferieur_reel', date: s.date,
          minutes_reel: minutesReel, minutes_valide: minutesValide, ecart_min: minutesReel - minutesValide,
        });
      }
    }
    if (!reglage) continue;
    for (const borne of ['debut', 'fin']) {
      const badge = s[`badge_${borne}`];
      const v = s[`valide_${borne}`];
      if (!badge || !v) continue;
      const a = arrondir(badge, reglage);
      if (a !== v) {
        constats.push({
          type: 'valide_different_arrondi', date: s.date, borne,
          badge, arrondi: a, valide: v, ecart_min: enMinutes(v) - enMinutes(a),
        });
      }
    }
  }
  return constats;
}

/**
 * Par semaine qui a une fiche, et dont TOUS les services du relevé ont une heure validée :
 * minutes payées sur la fiche − minutes validées, par catégorie de jour. Constat seul, sans cause.
 * `reglesAu(date)` donne le jeu de règles ; `etat` choisit les jours fériés.
 * Semaine non comparable (férié partiel, heures sup., minimum d'engagement : la fiche y paie
 * autre chose que des minutes de jour) → constat « ecart_fiche_valide_non_calcule » avec la raison.
 */
export function ecartsFicheValide(releve, fiches, correspondance, { reglesAu, etat }) {
  const constats = [];
  for (const f of fiches) {
    const { du, au } = f.periode;
    const services = releve.filter((s) => s.date >= du && s.date <= au);
    if (services.length === 0 || services.some((s) => !(s.valide_debut && s.valide_fin))) continue;
    const regles = reglesAu(du);
    const categoriesJour = new Set(Object.keys(regles.categories_jour));
    const feries = joursFeries(regles, etat);
    const minutes = services.map((s) => dureeNette(s.valide_debut, s.valide_fin, s.pause_min));
    const hs = regles.heures_sup;
    const me = regles.minimum_engagement?.minutes;
    const raison = services.some((s) => feries.some((x) => x.date === s.date && x.debut))
      ? 'ferie_partiel'
      : hs && (minutes.some((m) => m > hs.seuil_jour_min) || minutes.reduce((a, m) => a + m, 0) > hs.seuil_semaine_min)
        ? 'heures_sup'
        : me && minutes.some((m) => m < me)
          ? 'minimum_engagement'
          : null;
    if (raison) {
      constats.push({ type: 'ecart_fiche_valide_non_calcule', semaine: lundiDe(du), raison });
      continue;
    }

    const valide = {};
    services.forEach((s, i) => {
      const cat = feries.some((x) => x.date === s.date)
        ? categorieFerie(regles)
        : categorieDuJour(regles, jourSemaine(s.date));
      valide[cat] = (valide[cat] ?? 0) + minutes[i];
    });
    const fiche = {};
    for (const l of f.lignes) {
      const cat = correspondance[l.description];
      if (!categoriesJour.has(cat)) continue;
      fiche[cat] = (fiche[cat] ?? 0) + Math.round(l.heures * 60);
    }
    for (const cat of [...categoriesJour]) {
      const mf = fiche[cat] ?? 0;
      const mv = valide[cat] ?? 0;
      if (mf !== mv) {
        constats.push({
          type: 'ecart_fiche_valide', semaine: lundiDe(du), categorie: cat,
          minutes_fiche: mf, minutes_valide: mv, ecart_min: mf - mv,
        });
      }
    }
  }
  return constats;
}

/** Tous les constats d'heures d'un dossier, plus le cumul de l'arrondi. */
export function analyserHeures({ releve, fiches, correspondance, profil }, reglesAu) {
  const reglage = profil.arrondi_employeur ?? null;
  return {
    constats: [
      ...constatsHeures(releve, reglage),
      ...ecartsFicheValide(releve, fiches, correspondance, { reglesAu, etat: profil.etat }),
    ],
    arrondi: cumulArrondi(releve, reglage),
  };
}
