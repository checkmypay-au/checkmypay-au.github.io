// Lecture d'une fiche de paie PDF, partie PURE (aucun accès disque, importable par le navigateur).
// Le format (mise en page) est un gabarit branché : formats/paie/<id>.json, passé en argument.
// pdfjs est fourni par l'appelant (build « legacy » sous Node, build navigateur dans la page) :
// ce module n'importe pas pdfjs et ne fait aucun appel réseau. Couche Node : lire_pdf.js.
import { versCents } from './argent.js';

/** « 1234.56 » / « -1.50 » → nombre ; tout autre texte → erreur. */
export function nombre(s) {
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) throw new Error(`Nombre illisible : « ${s} »`);
  return Number(s);
}
const estNombre = (s) => /^-?\d+(?:\.\d+)?$/.test(s);

/** Date courte du gabarit (ex. motif JJMmmAA) → AAAA-MM-JJ. */
export function dateCourte(s, fmt) {
  const m = new RegExp(fmt.motif).exec(s);
  if (!m) throw new Error(`Date illisible : « ${s} »`);
  const mois = fmt.mois[m.groups.m];
  if (!mois) throw new Error(`Mois inconnu : « ${m.groups.m} »`);
  const a = fmt.siecle + Number(m.groups.a);
  return `${a}-${String(mois).padStart(2, '0')}-${m.groups.j}`;
}

/** Morceaux de texte {x, y, str} → lignes [{ y, items: [{x, str}] }] du haut vers le bas. */
export function grouperLignes(morceaux, tolerance) {
  const tries = morceaux
    .filter((m) => m.str.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lignes = [];
  for (const m of tries) {
    const derniere = lignes.at(-1);
    if (derniere && Math.abs(derniere.y - m.y) <= tolerance) derniere.items.push(m);
    else lignes.push({ y: m.y, items: [m] });
  }
  for (const l of lignes) l.items.sort((a, b) => a.x - b.x);
  return lignes;
}

const texteLigne = (l) => l.items.map((i) => i.str.trim()).join(' ');

export function choisirGabarit(texte, gabarits) {
  const ok = gabarits.filter((g) => g.signature.every((s) => texte.includes(s)));
  if (ok.length !== 1) {
    throw new Error(`Format de fiche non reconnu : ${ok.length} gabarit(s) correspondent (${ok.map((g) => g.id).join(', ') || 'aucun'})`);
  }
  return ok[0];
}

function chercher(lignes, motif, nom) {
  const re = new RegExp(motif);
  for (const l of lignes) {
    const m = re.exec(texteLigne(l));
    if (m) return m.groups;
  }
  throw new Error(`Champ d'en-tête introuvable : ${nom}`);
}

function indexLigne(lignes, texte, sep, depuis = 0) {
  for (let i = depuis; i < lignes.length; i++) {
    if (lignes[i].items.some((it) => nettoyer(it.str, sep) === texte)) return i;
  }
  return -1;
}

// Retire le séparateur de colonnes collé en tête d'un morceau (« | Libellé » → « Libellé »).
function nettoyer(str, sep) {
  const s = str.trim();
  return sep && s.startsWith(sep) ? s.slice(sep.length).trim() : s;
}

/** Coupe une suite de textes en { description, nombres } ; les nombres sont en fin. */
function decouper(textes) {
  const nombres = [];
  const mots = [];
  for (const t of textes) {
    if (estNombre(t) && mots.length > 0) nombres.push(nombre(t));
    else if (nombres.length === 0) mots.push(t);
    else throw new Error(`Texte inattendu après des nombres : « ${textes.join(' ')} »`);
  }
  return { description: mots.join(' '), nombres };
}

/** Lignes de texte d'une fiche → objet fiche (même structure que fiches/*.json). */
export function interpreter(lignes, gabarit, nomFichier) {
  const g = gabarit;
  const sep = g.separateur_colonnes;

  // En-tête.
  const per = chercher(lignes, g.entete.periode, 'période');
  const num = chercher(lignes, g.entete.numero, 'numéro de période');
  const pay = chercher(lignes, g.entete.date_paiement, 'date de paiement');
  const taux = chercher(lignes, g.entete.taux_base, 'taux de base');

  // Résumé.
  const iRes = lignes.findIndex((l) => texteLigne(l).startsWith(g.resume.libelle_ligne + ' '));
  if (iRes < 0) throw new Error(`Ligne de résumé « ${g.resume.libelle_ligne} » introuvable`);
  const valeursRes = texteLigne(lignes[iRes]).slice(g.resume.libelle_ligne.length).trim().split(/\s+/).map(nombre);
  if (valeursRes.length !== g.resume.colonnes.length) {
    throw new Error(`Résumé : ${valeursRes.length} valeurs, ${g.resume.colonnes.length} attendues`);
  }
  const resume = Object.fromEntries(g.resume.colonnes.map((c, i) => [c, valeursRes[i]]));

  // Tableau paiements / retenues.
  const iTitre = indexLigne(lignes, g.tableau.titre, sep);
  const iFin = indexLigne(lignes, g.tableau.fin, sep, iTitre + 1);
  if (iTitre < 0 || iFin < 0) throw new Error('Tableau des paiements introuvable');
  const entete = lignes[iTitre + 1];
  const xSep = Math.min(...entete.items.filter((it) => it.str.trim().startsWith(sep)).map((it) => it.x));
  if (!Number.isFinite(xSep)) throw new Error(`Séparateur de colonnes « ${sep} » introuvable dans l'en-tête du tableau`);

  const paiements = [];
  const retenues = [];
  let avantImpot = false;
  for (let i = iTitre + 2; i < iFin; i++) {
    const gauche = lignes[i].items.filter((it) => it.x < xSep).map((it) => it.str.trim());
    const droite = lignes[i].items
      .filter((it) => it.x >= xSep)
      .map((it) => nettoyer(it.str, sep))
      .filter(Boolean);
    if (gauche.length) {
      const { description, nombres } = decouper(gauche);
      if (!description || nombres.length !== g.tableau.champs_paiement.length) {
        throw new Error(`Ligne de paiement non reconnue : « ${gauche.join(' ')} »`);
      }
      paiements.push({ description, ...Object.fromEntries(g.tableau.champs_paiement.map((c, k) => [c, nombres[k]])) });
    }
    if (droite.length) {
      const { description, nombres } = decouper(droite);
      if (nombres.length === 0) {
        if (description === g.tableau.sous_section_avant_impot) avantImpot = true;
        else if (avantImpot) throw new Error(`Retenue avant impôt « ${description} » : non géré au cycle 2`);
        else {
          const fiscaleSans = g.retenues.libelles_fiscaux.includes(description);
          retenues.push({ description, montant: null, type: fiscaleSans ? g.retenues.type_fiscal : g.retenues.type_autre, note: 'ligne sans montant' });
        }
        continue;
      }
      if (avantImpot) throw new Error(`Retenue avant impôt « ${description} » : non géré au cycle 2`);
      if (nombres.length > 2) throw new Error(`Ligne de retenue non reconnue : « ${droite.join(' ')} »`);
      const fiscale = g.retenues.libelles_fiscaux.includes(description);
      retenues.push({ description, montant: nombres[0], type: fiscale ? g.retenues.type_fiscal : g.retenues.type_autre });
    }
  }

  // Contrôle des retenues contre le résumé.
  if (versCents(resume.retenues_avant_impot) !== 0) {
    throw new Error('Retenues avant impôt non nulles au résumé : non géré au cycle 2');
  }
  const sommeApres = retenues
    .filter((r) => r.type === g.retenues.type_autre)
    .reduce((t, r) => t + versCents(r.montant ?? 0), 0);
  if (sommeApres !== versCents(resume.retenues_apres_impot)) {
    throw new Error(`Retenues après impôt (${sommeApres / 100}) ≠ résumé (${resume.retenues_apres_impot})`);
  }

  // Cohérence des totaux de la fiche (cents entiers). Garde-fou des lignes sans montant.
  const brutC = versCents(resume.brut);
  const sommePaie = paiements.reduce((t, p) => t + versCents(p.montant), 0);
  if (sommePaie !== brutC) {
    throw new Error(`Incohérence des totaux : somme des lignes de paie (${sommePaie / 100}) ≠ Gross (${resume.brut})`);
  }
  if (brutC - versCents(resume.retenues_avant_impot) !== versCents(resume.brut_imposable)) {
    throw new Error(`Incohérence des totaux : Gross − Pre Tax Ded ≠ Gross Taxable (${resume.brut_imposable})`);
  }
  if (versCents(resume.brut_imposable) - versCents(resume.retenues_apres_impot) - versCents(resume.impot) !== versCents(resume.net)) {
    throw new Error(`Incohérence des totaux : Gross Taxable − Post Tax Ded − Tax ≠ Net Pay (${resume.net})`);
  }
  const sommeImpot = retenues
    .filter((r) => r.type === g.retenues.type_fiscal)
    .reduce((t, r) => t + versCents(r.montant ?? 0), 0);
  if (sommeImpot !== versCents(resume.impot)) {
    throw new Error(`Incohérence des totaux : lignes Tax (${sommeImpot / 100}) ≠ Tax du résumé (${resume.impot})`);
  }

  // Super (bloc avantages).
  const iAv = indexLigne(lignes, g.avantages.titre, sep);
  const iAvFin = indexLigne(lignes, g.avantages.fin, sep, iAv + 1);
  if (iAv < 0 || iAvFin < 0) throw new Error('Bloc des avantages introuvable');
  const supers = [];
  for (let i = iAv + 1; i < iAvFin; i++) {
    const droite = lignes[i].items
      .filter((it) => it.x >= xSep)
      .map((it) => nettoyer(it.str, sep))
      .filter(Boolean);
    if (!droite.length) continue;
    const { description, nombres } = decouper(droite);
    if (g.avantages.libelles_super.includes(description)) {
      if (!nombres.length) throw new Error(`Super « ${description} » sans montant`);
      supers.push({ description, montant: nombres[0] });
    }
  }
  if (supers.length !== 1) throw new Error(`Super : ${supers.length} ligne(s) trouvée(s), 1 attendue`);

  return {
    fichier_source: nomFichier,
    periode: {
      du: dateCourte(per.du, g.format_date),
      au: dateCourte(per.au, g.format_date),
      numero: Number(num.numero),
      date_paiement: dateCourte(pay.date, g.format_date),
    },
    taux_base: nombre(taux.taux),
    lignes: paiements,
    retenues,
    brut: resume.brut,
    net: resume.net,
    super: supers[0],
  };
}

/** Options pdfjs communes (Node et navigateur) : pas d'eval, pas de polices, aucun téléchargement. */
export const OPTIONS_PDFJS = {
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  verbosity: 0,
};

/** Morceaux de texte {x, y, str} d'un PDF (toutes pages), à partir de ses octets et du module pdfjs fourni. */
export async function extraireMorceauxDe(pdfjs, data) {
  const tache = pdfjs.getDocument({ data, ...OPTIONS_PDFJS });
  try {
    const doc = await tache.promise;
    const morceaux = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const contenu = await page.getTextContent();
      for (const it of contenu.items) {
        // Pages successives empilées vers le bas pour garder un ordre unique.
        morceaux.push({ x: it.transform[4], y: it.transform[5] - (p - 1) * 10000, str: it.str });
      }
    }
    return morceaux;
  } finally {
    await tache.destroy();
  }
}

/** Morceaux de texte → fiche (choix du gabarit, regroupement en lignes, interprétation). */
export function ficheDepuisMorceaux(morceaux, gabarits, nomFichier) {
  const texte = morceaux.map((m) => m.str).join('\n');
  const gabarit = choisirGabarit(texte, gabarits);
  const lignes = grouperLignes(morceaux, gabarit.tolerance_ordonnee);
  return interpreter(lignes, gabarit, nomFichier);
}
