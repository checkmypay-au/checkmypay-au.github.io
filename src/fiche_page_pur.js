// Lecture d'une fiche déposée sur la page collègues (cycle 5) : PUR, sans disque ni réseau ; pdfjs est fourni par
// l'appelant (build navigateur dans la page, build Node dans les tests). Toute fiche qui ne se lit pas donne un
// CODE de message clair (clé de TEXTES), jamais un résultat partiel ni inventé :
// - fiche_vide          : fichier de 0 octet, ou fiche sans texte ni image ;
// - fichier_pas_pdf     : le fichier n'est pas un PDF (photo, document, tableur…) ;
// - fiche_mot_de_passe  : PDF protégé par un mot de passe ;
// - fiche_abimee        : PDF abîmé ou coupé, que pdfjs ne peut pas ouvrir ;
// - fiche_scan          : PDF qui n'est qu'une image (photo ou scan), sans texte ;
// - fiche_autre_format  : texte lisible, mais pas la présentation connue (aucun gabarit ne correspond) ;
// - fiche_incomplete    : présentation reconnue, mais une partie manque ou se lit mal (dates, totaux…).
import { extraireMorceauxDe, ficheDepuisMorceaux, choisirGabarit } from './fiche_pdf_pur.js';
import { classificationDe, niveauDeFiche, dureeJours, ficheDitCasual } from './collegues_pur.js';
import { jourSemaine } from './temps.js';

export const CODES_FICHE = ['fiche_vide', 'fichier_pas_pdf', 'fiche_mot_de_passe', 'fiche_abimee', 'fiche_scan', 'fiche_autre_format', 'fiche_incomplete'];

/** Vrai si les premiers octets contiennent l'en-tête « %PDF- » (les lecteurs l'acceptent dans le 1er kilo-octet). */
export function estPdf(octets) {
  const debut = octets.subarray(0, 1024);
  for (let i = 0; i + 5 <= debut.length; i++) {
    if (debut[i] === 0x25 && debut[i + 1] === 0x50 && debut[i + 2] === 0x44 && debut[i + 3] === 0x46 && debut[i + 4] === 0x2d) return true;
  }
  return false;
}

/** Erreur pdfjs à l'ouverture → code. */
export function codeErreurPdfjs(e) {
  return e?.name === 'PasswordException' ? 'fiche_mot_de_passe' : 'fiche_abimee';
}

/** La fiche contient-elle au moins une image (scan, photo) ? Ouvre une copie des octets (pdfjs garde l'original). */
async function contientImage(pdfjs, octets) {
  const tache = pdfjs.getDocument({ data: octets, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try {
    const doc = await tache.promise;
    const IMAGES = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject,
      pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintImageMaskXObjectRepeat, pdfjs.OPS.paintSolidColorImageMask].filter((x) => x !== undefined));
    for (let p = 1; p <= doc.numPages; p++) {
      const ops = await (await doc.getPage(p)).getOperatorList();
      if (ops.fnArray.some((f) => IMAGES.has(f))) return true;
    }
    return false;
  } finally {
    await tache.destroy();
  }
}

/**
 * Octets d'une fiche → { nom, fiche, niveau_lu, casual, jours, lundi } si elle se lit, sinon { nom, code } (CODES_FICHE).
 * `gabaritPaie` : formats/paie/format_a.json ; `niveaux` : taux.niveaux (Fair Work) ; `correspondance` : libellés connus
 * de la page (web/reglages_collegues.json), pour lire « casual ».
 */
export async function lireFichePage(pdfjs, nom, octets, { gabaritPaie, niveaux, correspondance = {} }) {
  if (!octets?.length) return { nom, code: 'fiche_vide' };
  if (!estPdf(octets)) return { nom, code: 'fichier_pas_pdf' };
  const copie = octets.slice(); // pdfjs peut transférer (vider) le tableau qu'on lui donne
  let morceaux;
  try {
    morceaux = await extraireMorceauxDe(pdfjs, octets);
  } catch (e) {
    return { nom, code: codeErreurPdfjs(e) };
  }
  if (!morceaux.some((m) => m.str.trim())) {
    let image = false;
    try { image = await contientImage(pdfjs, copie); } catch { return { nom, code: 'fiche_abimee' }; }
    return { nom, code: image ? 'fiche_scan' : 'fiche_vide' };
  }
  try {
    choisirGabarit(morceaux.map((m) => m.str).join('\n'), [gabaritPaie]);
  } catch {
    return { nom, code: 'fiche_autre_format' };
  }
  try {
    const fiche = ficheDepuisMorceaux(morceaux, [gabaritPaie], nom);
    // Niveau : seulement s'il est SÛR (Classification et taux de base d'accord) ; rythme : jours de la période.
    const classification = classificationDe(morceaux, gabaritPaie);
    const niveau_lu = niveauDeFiche(classification, fiche.taux_base, niveaux);
    // Casual : une ligne de salaire au libellé connu contenant « Casual » (cycle Q4+Q5, décision du responsable).
    const casual = ficheDitCasual(fiche, correspondance);
    const jours = dureeJours(fiche.periode);
    // Dates mal lues (fin avant début, date impossible) : jamais « couvre NaN jours ».
    if (!Number.isInteger(jours) || jours < 1) return { nom, code: 'fiche_incomplete' };
    return { nom, fiche, niveau_lu, casual, jours, lundi: jourSemaine(fiche.periode.du) === 1 };
  } catch {
    return { nom, code: 'fiche_incomplete' };
  }
}
