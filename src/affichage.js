// Présentation du rapport (le moteur ne change pas, tests figés) :
// - les constats dont le montant vaut exactement 0 (ou -0) sont masqués ; un montant null n'est jamais masqué ;
// - tout champ numérique dont le nom contient le mot « heures » (heures, heures_deficit, heures_dues,
//   ecart_heures…) est arrondi à 2 décimales, partout dans le rapport. Les minutes et montants ne bougent pas.
//   Arrondi symétrique (demi-unité éloignée de zéro : 0.125 → 0.13, -0.125 → -0.13), jamais -0 (-0.001 → 0) ;
//   NaN et ±Infinity restent tels quels, une valeur texte n'est pas touchée.

import { arrondiSym } from './argent.js';

const CLE_HEURES = /(^|_)heures(_|$)/;

const arrondi2 = (h) => arrondiSym(h * 100) / 100;

/** Copie profonde ; les champs numériques « heures » sont arrondis à 2 décimales. */
function copieArrondie(x) {
  if (Array.isArray(x)) return x.map(copieArrondie);
  if (x === null || typeof x !== 'object') return x;
  const r = {};
  for (const [k, v] of Object.entries(x)) {
    r[k] = typeof v === 'number' && CLE_HEURES.test(k) ? arrondi2(v) : copieArrondie(v);
  }
  return r;
}

/** Copie du rapport sans les constats à 0, avec leur nombre, heures arrondies ; l'entrée n'est pas modifiée. */
export function rapportAffiche(rapport) {
  const copie = copieArrondie(rapport);
  const constats = copie.constats.filter((c) => c.montant !== 0);
  return { ...copie, constats, constats_montant_nul_masques: rapport.constats.length - constats.length };
}
