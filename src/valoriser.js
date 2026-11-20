// Valorisation : minutes par semaine et par catégorie → montants dus (arrondi par ligne).
import { montantCents } from './argent.js';
import { tauxCategorie } from './regles_pur.js';

/** Somme les segments des services d'une semaine : { cat: minutes }. */
export function minutesParCategorie(services) {
  const total = {};
  for (const s of services) {
    for (const [cat, n] of Object.entries(s.segments)) total[cat] = (total[cat] ?? 0) + n;
  }
  return total;
}

/** Lignes dues d'une semaine : { cat: { minutes, tauxCents, cents } }. */
export function lignesDues(services, regles) {
  const lignes = {};
  for (const [cat, minutes] of Object.entries(minutesParCategorie(services))) {
    const tauxCents = tauxCategorie(regles, cat);
    lignes[cat] = { minutes, tauxCents, cents: montantCents(minutes, tauxCents) };
  }
  return lignes;
}
