// Lecture d'une liste de services copiée depuis Humanforce, partie PURE (importable par le navigateur).
// Le gabarit de mise en page (formats/humanforce/*.json) est passé en argument. Couche Node : lire_humanforce.js.
// On ne garde que : date, début, fin, pause, minutes nettes, autorisé.
// La colonne « Auth'd By » (noms de personnes) n'est jamais capturée.
import { dureeNette } from './heures.js';

export function lireHumanforceAvec(texte, gabarit) {
  const re = {
    mois: new RegExp(gabarit.mois_annee),
    entete: new RegExp(gabarit.entete),
    jour: new RegExp(gabarit.jour),
    service: new RegExp(gabarit.service),
  };
  const services = [];
  let mois = null;
  let annee = null;
  let date = null;
  const lignes = texte.replace(/^﻿/, '').split(/\r?\n/);
  lignes.forEach((brute, i) => {
    const l = brute.trimEnd();
    if (!l.trim() || re.entete.test(l)) return;
    let m = re.mois.exec(l);
    if (m && gabarit.mois[m.groups.mois]) {
      mois = gabarit.mois[m.groups.mois];
      annee = Number(m.groups.annee);
      date = null;
      return;
    }
    m = re.jour.exec(l);
    if (m) {
      if (mois === null) throw new Error(`Humanforce ligne ${i + 1} : jour avant tout mois`);
      date = `${annee}-${String(mois).padStart(2, '0')}-${String(Number(m.groups.jour)).padStart(2, '0')}`;
      return;
    }
    m = re.service.exec(l);
    if (m) {
      if (date === null) throw new Error(`Humanforce ligne ${i + 1} : service avant tout jour`);
      const { debut, fin } = m.groups;
      const pause = Number(m.groups.pause);
      const net = Math.round(Number(m.groups.net) * 60);
      if (dureeNette(debut, fin, pause) !== net) {
        throw new Error(`Humanforce ${date} incohérent : ${debut}–${fin} moins ${pause} min ≠ ${net} min`);
      }
      services.push({ date, debut, fin, pause_min: pause, minutes_nettes: net, autorise: m.groups.autorise === 'Yes' });
      return;
    }
    // Ligne non reconnue : on ne la recopie pas (elle peut contenir un nom).
    throw new Error(`Humanforce ligne ${i + 1} : ligne non reconnue par le gabarit « ${gabarit.id} »`);
  });
  return services;
}
