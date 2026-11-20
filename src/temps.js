// Outils de temps : minutes entières, dates ISO (AAAA-MM-JJ), semaines lundi–dimanche.

export function enMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Heure invalide : « ${hhmm} »`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function enDate(dateIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) throw new Error(`Date invalide : « ${dateIso} »`);
  return new Date(`${dateIso}T00:00:00Z`);
}

/** 1 = lundi … 7 = dimanche. */
export function jourSemaine(dateIso) {
  const j = enDate(dateIso).getUTCDay();
  return j === 0 ? 7 : j;
}

export function ajouterJours(dateIso, n) {
  const d = enDate(dateIso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function lundiDe(dateIso) {
  return ajouterJours(dateIso, -(jourSemaine(dateIso) - 1));
}

/** Longueur du chevauchement de [a1, a2) et [b1, b2). */
export function chevauchement(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

export const enHeures = (minutes) => minutes / 60;
