// Orchestration PURE : services + fiches → rapport d'écarts. Aucun accès disque :
// les règles arrivent par `reglesAu(date)` et les paramètres de rapprochement par `params`.
// Le pays est un jeu de règles branché (profil.regles). Couche Node : moteur.js.
import { joursFeries, RegleManquante } from './regles_pur.js';
import { classerService, appliquerHeuresSup, appliquerMinimumEngagement } from './classer.js';
import { lignesDues } from './valoriser.js';
import { rapprocher } from './rapprocher.js';
import { analyserHeures } from './heures.js';
import { controlerBanque } from './banque.js';
import { versCents } from './argent.js';
import { ajouterJours, jourSemaine, lundiDe } from './temps.js';

export function verifierProfil(profil) {
  if (!profil?.regles || !profil?.etat) throw new RegleManquante('profil.regles et profil.etat sont requis');
}

function lignesPayees(fiche, correspondance) {
  const lignes = {};
  for (const l of fiche.lignes) {
    const c = correspondance[l.description];
    if (!c) throw new Error(`Libellé de fiche non reconnu : « ${l.description} » (${fiche.fichier_source})`);
    lignes[c] ??= { minutes: 0, cents: 0 };
    lignes[c].minutes += Math.round(l.heures * 60);
    lignes[c].cents += versCents(l.montant);
  }
  return lignes;
}

export function analyserAvec({ services, releve, fiches, correspondance, profil, banque }, { reglesAu, params }) {
  verifierProfil(profil);

  const parSemaine = new Map();
  const semaine = (id) => {
    if (!parSemaine.has(id)) parSemaine.set(id, { semaine: id, services: [], fiche: null, regles: null });
    return parSemaine.get(id);
  };

  for (const s of services) {
    const regles = reglesAu(s.date);
    const classe = classerService(s, regles, joursFeries(regles, profil.etat));
    const sem = semaine(classe.semaine);
    if (sem.regles && sem.regles.date_effet !== regles.date_effet) {
      throw new Error(`Semaine du ${sem.semaine} : changement de règles en cours de semaine (non géré au cycle 1)`);
    }
    sem.regles = regles;
    sem.services.push(classe);
  }

  for (const f of fiches) {
    const { du, au } = f.periode;
    if (jourSemaine(du) !== 1 || ajouterJours(du, 6) !== au) {
      throw new Error(`Fiche ${f.fichier_source} : période non hebdomadaire lundi–dimanche (non géré au cycle 1)`);
    }
    const sem = semaine(lundiDe(du));
    if (sem.fiche) throw new Error(`Deux fiches pour la semaine du ${sem.semaine}`);
    sem.fiche = f;
    sem.regles ??= reglesAu(du);
  }

  const semaines = [...parSemaine.values()].sort((a, b) => a.semaine.localeCompare(b.semaine));
  for (const s of semaines) {
    appliquerHeuresSup(s.services, s.regles);
    appliquerMinimumEngagement(s.services, s.regles);
    s.du = lignesDues(s.services, s.regles);
    s.paye = s.fiche ? lignesPayees(s.fiche, correspondance) : {};
  }

  const rapport = rapprocher(semaines, { profil, params, correspondance });
  // Relevé au nouveau format : constats d'heures (réel / badgé / validé), à part des écarts d'argent.
  if (releve) rapport.heures = analyserHeures({ releve, fiches, correspondance, profil }, reglesAu);
  // Montant reçu en banque comparé au net de chaque fiche (fichier banque.csv facultatif).
  if (banque) rapport.constats.push(...controlerBanque(fiches, banque));
  return rapport;
}
