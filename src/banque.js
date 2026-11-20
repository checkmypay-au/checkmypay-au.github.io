// Montant reçu en banque, fiche par fiche, comparé au net de la fiche.
// Fichier <dossier>/banque.csv (facultatif) : en-tête exact « periode_du,montant_recu », une ligne par fiche,
// montant avec un point décimal. Une fiche sans ligne n'est pas contrôlée.
// Erreurs de lecture : nombre de colonnes ≠ 2 (une seule colonne : rappel du format attendu et du point décimal),
// date manquante, date mal formée ou impossible (ex. 2026-02-30), montant manquant ou invalide, deux lignes pour la même période.
// Virgules en fin de ligne : les colonnes vides de fin sont retirées (tant qu'il en reste plus de 2) et le reste
// contrôlé. Libellé « virgule en fin de ligne » (1) ou « k virgules en fin de ligne » (k ≥ 2). Reste correct →
// « <libellé> (à retirer) » ; reste fautif → message de la faute, suivi de « , et <libellé> ».
// Une fiche sans net, mais avec une ligne de banque, donne le constat banque_net_absent (pas d'erreur) ;
// un net présent mais qui n'est pas un nombre fini donne banque_net_illisible (le moteur ne le convertit pas).
// Convention de signe : montant = net − reçu (positif = il manque de l'argent).
import { versCents, versDollars } from './argent.js';
import { lundiDe } from './temps.js';

const ENTETE = 'periode_du,montant_recu';

/** Faute d'une ligne (sans le préfixe « Banque ligne N : »), ou null si la ligne est correcte. */
function fauteLigne(v) {
  if (v.length === 1) return '1 colonne au lieu de 2 (attendu « periode_du,montant_recu », montant avec un point décimal)';
  if (v.length !== 2) return `${v.length} colonnes au lieu de 2 (montant avec un point décimal, sans virgule)`;
  const [du, montant] = v;
  if (du === '') return 'date manquante (attendu AAAA-MM-JJ)';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(du)) return `date « ${du} » (attendu AAAA-MM-JJ)`;
  // Date bien formée mais inexistante : l'aller-retour par Date ne redonne pas la même chaîne.
  const d = new Date(`${du}T00:00:00Z`);
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== du) return `date « ${du} » impossible`;
  if (montant === '') return 'montant manquant';
  if (!/^\d+(\.\d{1,2})?$/.test(montant)) {
    return `montant « ${montant} » invalide (positif, point décimal, 2 décimales au plus)`;
  }
  return null;
}

export function analyserBanque(texte) {
  const lignes = texte.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lignes.length === 0 || lignes[0].trim() !== ENTETE) {
    throw new Error(`Banque : en-tête attendu « ${ENTETE} », trouvé « ${lignes[0] ?? ''} »`);
  }
  const vues = new Set();
  return lignes.slice(1).map((l, i) => {
    const v = l.split(',').map((c) => c.trim());
    const n = i + 2;
    let k = 0;
    while (v.length - k > 2 && v[v.length - 1 - k] === '') k++;
    const coeur = v.slice(0, v.length - k);
    const libelle = k === 1 ? 'virgule en fin de ligne' : `${k} virgules en fin de ligne`;
    const faute = fauteLigne(coeur);
    if (faute) throw new Error(`Banque ligne ${n} : ${faute}${k ? `, et ${libelle}` : ''}`);
    if (k) throw new Error(`Banque ligne ${n} : ${libelle} (à retirer)`);
    const [du, montant] = coeur;
    if (vues.has(du)) throw new Error(`Banque ligne ${n} : deux lignes pour la période du ${du}`);
    vues.add(du);
    return { periode_du: du, montant_recu: Number(montant) };
  });
}

export function controlerBanque(fiches, banque) {
  const parDu = new Map(banque.map((b) => [b.periode_du, b]));
  const constats = [];
  for (const f of fiches) {
    const b = parDu.get(f.periode.du);
    if (!b) continue;
    const semaine = lundiDe(f.periode.du);
    if (f.net === undefined || f.net === null) {
      constats.push({
        type: 'banque_net_absent', semaine, semaines: [semaine], fiche: f.fichier_source,
        recu: b.montant_recu, heures: null, montant: null,
      });
      continue;
    }
    if (!Number.isFinite(f.net)) {
      constats.push({
        type: 'banque_net_illisible', semaine, semaines: [semaine], fiche: f.fichier_source,
        net_lu: String(f.net), recu: b.montant_recu, heures: null, montant: null,
      });
      continue;
    }
    const ecart = versCents(f.net) - versCents(b.montant_recu);
    if (ecart !== 0) {
      constats.push({
        type: 'banque_differente_net', semaine, semaines: [semaine], fiche: f.fichier_source,
        net: f.net, recu: b.montant_recu, heures: null, montant: versDollars(ecart),
      });
    }
  }
  const dusFiches = new Set(fiches.map((f) => f.periode.du));
  for (const b of banque) {
    if (dusFiches.has(b.periode_du)) continue;
    const semaine = lundiDe(b.periode_du);
    constats.push({ type: 'banque_sans_fiche', semaine, semaines: [semaine], recu: b.montant_recu, heures: null, montant: null });
  }
  return constats;
}
