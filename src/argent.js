// Argent en cents entiers. Aucun flottant dans les calculs.

/** Arrondi de num/den à l'entier, demi-unité éloignée de zéro. num, den entiers, den > 0. */
export function arrondiDemiSup(num, den) {
  if (!Number.isInteger(num) || !Number.isInteger(den) || den <= 0) {
    throw new Error(`arrondiDemiSup : entiers attendus (${num}/${den})`);
  }
  const signe = num < 0 ? -1 : 1;
  const a = Math.abs(num);
  return signe * Math.floor((2 * a + den) / (2 * den));
}

/** Montant en cents de `minutes` au taux horaire `tauxCents`, arrondi au cent. */
export function montantCents(minutes, tauxCents) {
  return arrondiDemiSup(minutes * tauxCents, 60);
}

/** Taux en cents = base × pct / 100, arrondi au cent. */
export function tauxPct(baseCents, pct) {
  return arrondiDemiSup(baseCents * pct, 100);
}

/** Arrondi à l'entier, demi-unité éloignée de zéro (comme arrondiDemiSup) ; jamais -0. NaN et ±Infinity passent tels quels. */
// Attention : l'entrée est un flottant, l'arrondi hérite de son bruit. versCents(1.005) donne 100 et non 101,
// car 1.005 * 100 vaut 100.49999999999999. Sans effet sur les montants lus avec 2 décimales au plus
// (x.yz * 100 reste à moins d'un millionième de l'entier) ; testé au cycle 18.
export function arrondiSym(x) {
  const r = Math.sign(x) * Math.round(Math.abs(x));
  return r === 0 ? 0 : r;
}

export const versCents = (dollars) => arrondiSym(dollars * 100);
export const versDollars = (cents) => cents / 100;
