// Règles : partie PURE (aucun accès disque, importable telle quelle par le navigateur).
// Le chargement des fichiers depuis le disque est dans regles.js (couche Node).
import { tauxPct } from './argent.js';

export class RegleManquante extends Error {
  constructor(message) {
    super(`Règle manquante : ${message}`);
    this.name = 'RegleManquante';
  }
}

/**
 * Version en vigueur à `dateIso` parmi des jeux datés { 'AAAA-MM-JJ': regles } (la plus récente ≤ date).
 * `chemin` ne sert qu'au message d'erreur.
 */
export function regleEnVigueur(jeux, chemin, dateIso) {
  const versions = Object.keys(jeux)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= dateIso)
    .sort();
  if (versions.length === 0) {
    throw new RegleManquante(`aucun jeu « ${chemin} » en vigueur au ${dateIso}`);
  }
  return jeux[versions.at(-1)];
}

/** Catégorie du jour qui porte le drapeau « ferie ». */
export function categorieFerie(regles) {
  const entree = Object.entries(regles.categories_jour).find(([, c]) => c.ferie);
  return entree ? entree[0] : null;
}

/** Catégorie ordinaire d'un jour de semaine (1–7). */
export function categorieDuJour(regles, jour) {
  const entree = Object.entries(regles.categories_jour).find(
    ([, c]) => Array.isArray(c.jours_semaine) && c.jours_semaine.includes(jour),
  );
  if (!entree) throw new RegleManquante(`aucune catégorie pour le jour de semaine ${jour}`);
  return entree[0];
}

/**
 * Paliers d'heures sup. sur une catégorie de jour : [{ categorie, pct, minutes_par_jour? }].
 * Une entrée simple { categorie, pct } vaut un palier unique sans limite.
 * Tous les paliers sauf le dernier ont une limite « minutes_par_jour » ; le dernier n'en a pas.
 */
export function heuresSupPour(regles, categorieJour) {
  const hs = regles.heures_sup?.taux_par_categorie_jour?.[categorieJour];
  if (!hs) throw new RegleManquante(`taux d'heures sup. pour « ${categorieJour} »`);
  const paliers = hs.paliers ?? [hs];
  if (paliers.length === 0) throw new RegleManquante(`paliers d'heures sup. vides pour « ${categorieJour} »`);
  paliers.forEach((p, i) => {
    const dernier = i === paliers.length - 1;
    const limite = p.minutes_par_jour;
    if (!p.categorie || typeof p.pct !== 'number') {
      throw new RegleManquante(`palier ${i + 1} d'heures sup. incomplet pour « ${categorieJour} »`);
    }
    if (dernier ? limite !== undefined : !(Number.isInteger(limite) && limite > 0)) {
      throw new RegleManquante(`limite « minutes_par_jour » du palier ${i + 1} pour « ${categorieJour} »`);
    }
  });
  return paliers;
}

/** Description de toutes les catégories connues : { cat: { type: 'temps'|'prime', tauxCents } }. */
export function catalogue(regles) {
  const base = regles.taux_base_cents;
  const cat = {};
  for (const [nom, c] of Object.entries(regles.categories_jour)) {
    cat[nom] = { type: 'temps', tauxCents: tauxPct(base, c.pct) };
  }
  for (const hs of Object.values(regles.heures_sup?.taux_par_categorie_jour ?? {})) {
    for (const p of hs.paliers ?? [hs]) {
      cat[p.categorie] = { type: 'temps', tauxCents: tauxPct(base, p.pct), heuresSup: true };
    }
  }
  for (const m of regles.majorations ?? []) {
    cat[m.categorie] = { type: 'majoration', tauxCents: m.cents_par_heure };
  }
  if (regles.pause_manquee) {
    const p = regles.pause_manquee;
    cat[p.categorie] = { type: 'prime', tauxCents: tauxPct(base, p.pct_base) };
  }
  return cat;
}

export function tauxCategorie(regles, categorie) {
  const c = catalogue(regles)[categorie];
  if (!c) throw new RegleManquante(`taux de la catégorie « ${categorie} »`);
  return c.tauxCents;
}

export function joursFeries(regles, etat) {
  const liste = regles.jours_feries?.[etat];
  if (!liste) throw new RegleManquante(`jours fériés pour « ${etat} »`);
  return liste;
}

/**
 * Copie des règles dont les montants viennent du fichier de taux Fair Work (donnees_publiques/) :
 * taux de base du niveau `classification`, majorations soirée et nuit. Les pourcentages des règles
 * doivent être ceux de Fair Work, sinon erreur : rien n'est corrigé en silence.
 * Contrôlés : jours (semaine, samedi, dimanche, férié), heures sup. lundi–vendredi (exactement 2 paliers
 * 150 % puis 200 %), heures sup. samedi et dimanche (« Weekends »), toute majoration connue de Fair Work.
 * Non fourni par le fichier Fair Work, gardé tel quel depuis les règles : pause_manquee (pourcentage du taux de base).
 */
export function avecTauxFwc(regles, taux, classification) {
  if (taux.instrument !== regles.instrument) {
    throw new RegleManquante(`taux Fair Work de ${taux.instrument}, règles de ${regles.instrument}`);
  }
  if (taux.date_effet !== regles.date_effet) {
    throw new RegleManquante(`taux Fair Work au ${taux.date_effet}, règles au ${regles.date_effet}`);
  }
  const n = taux.niveaux.find((x) => x.classification === classification);
  if (!n) throw new RegleManquante(`niveau « ${classification} » absent des taux Fair Work`);
  if (!(Number.isInteger(n.taux_base_cents) && n.taux_base_cents > 0)) {
    throw new RegleManquante(`taux de base Fair Work du niveau « ${classification} » invalide`);
  }
  const verifier = (nom, pctRegles, pctFwc) => {
    if (typeof pctFwc !== 'number' || pctRegles !== pctFwc) {
      throw new RegleManquante(`pourcentage « ${nom} » : règles ${pctRegles} %, Fair Work ${pctFwc} %`);
    }
  };
  const jours = { ordinaire_semaine: 'semaine', samedi: 'samedi', dimanche: 'dimanche', jour_ferie: 'jour_ferie' };
  for (const [cat, cleFwc] of Object.entries(jours)) verifier(cat, regles.categories_jour[cat]?.pct, n.casual?.[cleFwc]?.pct);
  const semaine = heuresSupPour(regles, 'ordinaire_semaine');
  if (semaine.length !== 2) throw new RegleManquante(`heures sup. lundi–vendredi : ${semaine.length} palier(s), 2 attendus`);
  verifier('heures sup. lundi–vendredi, 1er palier', semaine[0].pct, n.casual_heures_sup?.heures_sup_150?.pct);
  verifier('heures sup. lundi–vendredi, 2e palier', semaine[1].pct, n.casual_heures_sup?.heures_sup_200?.pct);
  for (const jour of ['samedi', 'dimanche']) {
    const paliers = heuresSupPour(regles, jour);
    if (paliers.length !== 1) throw new RegleManquante(`heures sup. ${jour} : ${paliers.length} paliers, 1 attendu`);
    verifier(`heures sup. ${jour}`, paliers[0].pct, n.casual_heures_sup?.heures_sup_weekend?.pct);
  }
  const primes = {};
  for (const [nom, p] of Object.entries(taux.primes_horaires ?? {})) {
    if (!(Number.isInteger(p.cents_par_heure) && p.cents_par_heure > 0)) {
      throw new RegleManquante(`prime Fair Work « ${nom} » invalide`);
    }
    primes[nom] = p.cents_par_heure;
  }
  const majorations = (regles.majorations ?? []).map((m) => {
    if (!(m.categorie in primes)) throw new RegleManquante(`majoration « ${m.categorie} » absente des taux Fair Work`);
    return { ...m, cents_par_heure: primes[m.categorie] };
  });
  return {
    ...regles,
    classification: `${classification}, casual`,
    taux_base_cents: n.taux_base_cents,
    majorations,
  };
}

/** 1er juillet suivant `dateEffet` (AAAA-MM-JJ) : les taux Fair Work changent chaque 1er juillet. */
export function finDeValidite(dateEffet) {
  const a = Number(dateEffet.slice(0, 4)) + (dateEffet.slice(5) >= '07-01' ? 1 : 0);
  return `${a}-07-01`;
}

/**
 * `reglesAu(date)` pour la page : règles avec les montants Fair Work, valables de `date_effet`
 * au 30 juin suivant. Hors de cette période → erreur explicite (jamais les taux d'une autre année).
 */
export function reglesFwcAu(regles, taux, classification) {
  const r = avecTauxFwc(regles, taux, classification);
  const fin = finDeValidite(r.date_effet);
  return (dateIso) => {
    if (dateIso >= fin) {
      throw new RegleManquante(`taux Fair Work du ${r.date_effet} non valables au ${dateIso} (nouvelle version requise à partir du ${fin})`);
    }
    return regleEnVigueur({ [r.date_effet]: r }, r.instrument, dateIso);
  };
}
