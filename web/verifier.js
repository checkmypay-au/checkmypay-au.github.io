// Version collègues, cycle 3b : la page en 3 étapes (une à la fois), réglages en phrases, anglais / français.
// Réutilise le moteur PUR du cycle 2 ; tout est lu sur la même origine (127.0.0.1) : aucun appel extérieur,
// les fiches et la liste Humanforce ne quittent jamais l'appareil.
// Aucun mot technique à l'écran : ni nom de fichier, ni code, ni message interne (seulement des phrases de TEXTES).
import * as pdfjs from './pdfjs/pdf.mjs';
import { lireFichePage, estPdf } from '../src/fiche_page_pur.js';
import { lireHumanforceAvec } from '../src/humanforce_pur.js';
import {
  TEXTES, MENTION, LANGUES, appliquerVraiesHeures, synthese, codeErreur, remplir, libelleNiveau,
  preparer, calculerPage, niveauxDuCalcul, cartesRefusees,
  raisonRefus, cleService, effetsPauses, phrasePause, servicesDeLaListe, dureePause, finPauseProposee, jourEtDate,
  alertesMinuit, phraseMinuit, servicesAMain, phraseAMain, verdict, texteAvis, champsAvis, serialiserGarde, deserialiserGarde, CLE_GARDE,
  titreSemaine, etatSemaine, phrase, lignesTotal, resumeManager, dateCourte,
  CONTRATS, CONVENTIONS, ETATS, contratDesFiches, codeQui, ficheDitCasual,
} from '../src/collegues_pur.js';
import { octetsFicheFictive, NOM_FICHE_FICTIVE } from './exemples/fiche_fictive.js';
import { ADRESSE_AVIS, CLE_AVIS, SUJET_AVIS } from './avis_config.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.mjs', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const lire = async (chemin, type = 'json') => {
  const r = await fetch(new URL(chemin, import.meta.url));
  if (!r.ok) throw Object.assign(new Error(`Lecture impossible : ${chemin} (HTTP ${r.status})`), { code: 'erreur_chargement' });
  return type === 'json' ? r.json() : r.text();
};

// ---------- État ----------

const etat = {
  langue: 'en',
  vue: 1, // 1, 2, 3 ou 'resultat'
  fiches: [], // { nom, fiche, exemple? } ou { nom, code }
  resultat: null, // { syn, contexte, exemple }
  erreur: null, // { code } — toujours une clé de TEXTES
  occupe: false,
  modeExemple: false, // vrai tant que les champs contiennent l'exemple fictif
  sauvegarde: null, // saisie de la personne, mise de côté pendant l'exemple (jamais mêlée à lui)
  saisieMain: false, // « Je n'ai pas Humanforce » : les services sont tous saisis dans la liste
  gardeMsg: null, // clé de TEXTES du dernier message de « Garder sur ce téléphone »
};

// Toute tentative de charger une ressource interdite par la politique de sécurité est notée dans la page.
const violations = [];
document.addEventListener('securitypolicyviolation', (e) => {
  violations.push(e.blockedURI || '(inconnu)');
  $('violations').textContent = JSON.stringify(violations);
});

const donnees = Promise.all([
  lire('../regles/au/ma000009/2026-07-01.json'),
  lire('../regles/rapprochement.json'),
  lire('../donnees_publiques/taux_MA000009_2026-07-01.json'),
  lire('../formats/paie/format_a.json'),
  lire('../formats/humanforce/liste_a.json'),
  lire('./reglages_collegues.json'),
]).then(([regles, params, taux, gabaritPaie, gabaritHf, reglages]) => ({ regles, params, taux, gabaritPaie, gabaritHf, reglages }));
donnees.catch((e) => { etat.erreur = erreurDe(e); rendreMessage(); }); // visible dès l'ouverture

/** Erreur → { code } : une clé de TEXTES, jamais le message interne (qui reste en console pour le dépannage). */
function erreurDe(e) {
  const code = (e?.code && TEXTES.fr[e.code]) ? e.code : codeErreur(e?.message);
  if (!code) console.warn(e);
  return { code: code ?? 'erreur', valeurs: e?.valeurs ?? null };
}

// ---------- Langue ----------

function langueDepart() {
  const p = new URLSearchParams(location.search).get('lang');
  if (LANGUES.includes(p)) return p;
  try {
    const m = localStorage.getItem('controle-paie-langue');
    if (LANGUES.includes(m)) return m;
  } catch { /* stockage indisponible : sans effet */ }
  return (navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

function appliquerLangue() {
  const t = TEXTES[etat.langue];
  document.documentElement.lang = etat.langue;
  document.title = t.titre;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t[el.dataset.t];
  $('bascule').setAttribute('aria-label', t.bascule_aide);
  $('bascule').lang = etat.langue === 'fr' ? 'en' : 'fr';
  rendreTout();
}

$('bascule').addEventListener('click', () => {
  etat.langue = etat.langue === 'fr' ? 'en' : 'fr';
  try { localStorage.setItem('controle-paie-langue', etat.langue); } catch { /* sans effet */ }
  appliquerLangue();
});

function rendreTout() {
  rendreNiveau();
  rendreFiches();
  rendreBanque();
  rendreJours();
  rendrePauses();
  rendreVue();
  rendreStatut();
  rendreMessage();
  rendreResultat();
  rendreGarde();
  rendreAvis();
}

// ---------- Une étape à la fois ----------

function rendreVue() {
  const t = TEXTES[etat.langue];
  const v = etat.vue;
  for (const s of document.querySelectorAll('#assistant [data-pas]')) s.hidden = String(v) !== s.dataset.pas;
  $('assistant').hidden = v === 'resultat';
  $('navigation').hidden = v === 'resultat';
  $('progression').textContent = v === 'resultat' ? '' : remplir(t.etape_sur, { n: v });
  for (const n of [1, 2, 3]) $(`barre-${n}`).classList.toggle('fait', v !== 'resultat' && n <= v);
  $('retour').hidden = v === 1 || v === 'resultat';
  $('suivant').hidden = v === 3 || v === 'resultat';
  $('verifier').hidden = v !== 3;
  $('quitter-exemple').hidden = !etat.modeExemple;
  const main = modeMain();
  $('etape3-aide').textContent = main ? t.etape3_aide_main : t.etape3_aide;
  $('services-aide').textContent = main ? t.services_aide_main : t.services_aide;
}

/** Saisie à la main sans liste Humanforce : la liste « Tes services » ne contient que les services ajoutés. */
const modeMain = () => etat.saisieMain && !$('humanforce').value.trim();

/** Change de vue ; chaque étape entre dans l'historique : le geste « retour » du téléphone revient d'une étape. */
function allerA(v, historique = true) {
  if (historique && etat.vue !== v) history.pushState({ vue: v }, '');
  etat.vue = v;
  if (v === 3) rendrePauses();
  rendreVue();
  rendreResultat();
  const titre = v === 'resultat' ? $('resultat').querySelector('h2') : document.querySelector(`[data-pas="${v}"] h2`);
  window.scrollTo(0, 0);
  titre?.focus({ preventScroll: true });
}

let dernierSuivant = -Infinity;

async function etapeSuivante() {
  if (etat.occupe || typeof etat.vue !== 'number' || etat.vue >= 3) return;
  occuper(true);
  etat.erreur = null;
  let suivante = null;
  try {
    if (etat.vue === 1) {
      refuserFicheIllisible();
      if (!etat.fiches.length) throw Object.assign(new Error('fiche'), { code: 'manque_fiche' });
      const prep = preparerPage([]);
      if (prep.chevauchement) throw Object.assign(new Error('fiche'), { code: 'fiches_recouvrent' });
      if (!prep.fiches.length) throw Object.assign(new Error('fiche'), { code: 'aucune_hebdo' });
      refuserQui((await donnees).reglages);
      if (prep.manque_niveau) throw Object.assign(new Error('niveau'), { code: 'manque_niveau' });
    }
    if (etat.vue === 2) {
      const texteHf = $('humanforce').value;
      if (!texteHf.trim()) {
        if (!etat.saisieMain) throw Object.assign(new Error('humanforce'), { code: 'manque_hf' });
      } else lireHumanforceAvec(texteHf, (await donnees).gabaritHf); // liste mal collée : dit tout de suite
    }
    suivante = Math.min(etat.vue + 1, 3);
  } catch (e) {
    etat.erreur = erreurDe(e);
  } finally {
    occuper(false);
  }
  rendreMessage();
  if (suivante) allerA(suivante);
}

$('suivant').addEventListener('click', (e) => {
  if (e.isTrusted) dernierSuivant = e.timeStamp;
  etapeSuivante();
});
$('retour').addEventListener('click', () => {
  if (etat.occupe || typeof etat.vue !== 'number' || etat.vue <= 1) return;
  etat.erreur = null;
  rendreMessage();
  allerA(etat.vue - 1); // le geste « retour » du téléphone, lui, refait le chemin parcouru (voir popstate)
});

window.addEventListener('popstate', (e) => {
  if (etat.occupe) { history.pushState({ vue: etat.vue }, ''); return; }
  const v = e.state?.vue ?? 1;
  etat.erreur = null;
  rendreMessage();
  allerA(v === 'resultat' && !etat.resultat ? 3 : v, false);
});
$('modifier').addEventListener('click', () => allerA(3));
$('qui-resume-modifier').addEventListener('click', () => allerA(1));

// Toute entrée modifiée rend le résultat périmé : il disparaît (jamais d'ancien résumé copiable).
function perime() {
  memoriser(); // « Garder sur ce téléphone » coché : la saisie gardée suit chaque changement
  if (!etat.resultat) return;
  etat.resultat = null;
  $('resultat').dataset.etat = 'vide';
  if (etat.vue === 'resultat') etat.vue = 3;
  rendreVue();
  rendreResultat();
}

function occuper(oui) {
  etat.occupe = oui;
  for (const id of ['essayer', 'quitter-exemple', 'verifier', 'suivant', 'retour', 'fichiers', 'ajouter-jour', 'modifier', 'sans-humanforce', 'garder', 'effacer-tout', 'envoyer']) $(id).disabled = oui;
  // Boutons créés à la volée (Retirer, modifier, menu du niveau) : inactifs aussi pendant un calcul.
  for (const b of document.querySelectorAll('#liste-fiches button, #vraies .retirer, #pauses button, #niveau-modifier, #niveau, #qui-contrat, #qui-convention, #qui-etat')) b.disabled = oui;
  rendreStatut();
}

function rendreStatut() {
  $('statut').textContent = etat.occupe ? TEXTES[etat.langue].calcul : '';
}

// ---------- Étape 1 : réglages en phrase, fiches ----------

let niveaux = [];
let niveauChoisi = null; // choix de la PERSONNE seulement (null : on suit le niveau lu sur chaque fiche)
let niveauEdition = false; // « modifier » touché : le menu s'affiche, pré-rempli avec le niveau lu

/** Niveaux sûrs lus sur les fiches à la semaine : [] (aucun), un seul, ou plusieurs. */
const hebdo = (f) => f.fiche && f.jours === 7 && f.lundi;
function niveauxLus() {
  return [...new Set(etat.fiches.filter((f) => hebdo(f) && f.niveau_lu).map((f) => f.niveau_lu))].sort();
}
const fichesSansNiveau = () => etat.fiches.some((f) => hebdo(f) && !f.niveau_lu);

function preparerPage(services) {
  return preparer({
    fiches: etat.fiches.filter((f) => f.fiche).map((f) => ({ fiche: f.fiche, niveau_lu: f.niveau_lu })),
    services,
    niveauChoisi,
  });
}

/**
 * Phrase du niveau :
 * - aucune fiche : rien (on ne demande pas ce que la fiche va peut-être dire) ;
 * - niveau lu, un seul : « Niveau lu sur ta fiche : 2 — modifier » ;
 * - plusieurs niveaux lus : « Niveau lu sur chaque fiche — modifier » + note ;
 * - niveau absent (ou « modifier » touché, ou déjà choisi) : « Mon niveau : [menu] ».
 */
function rendreNiveau() {
  const t = TEXTES[etat.langue];
  const lus = niveauxLus();
  const avecFiche = etat.fiches.some(hebdo);
  if (!avecFiche) niveauEdition = false;
  const manque = avecFiche && niveauChoisi === null && (lus.length === 0 || fichesSansNiveau());
  const question = niveauChoisi !== null || niveauEdition || manque;
  const sel = $('niveau');
  // Niveau manquant : le menu montre « choisis » (jamais une valeur qui n'est pas un vrai choix) ;
  // « modifier » touché : pré-rempli avec le niveau lu.
  const valeur = niveauChoisi ?? (!manque && lus.length === 1 ? lus[0] : '');
  sel.replaceChildren(...[['', t.niveau_choisir], ...niveaux.map((c) => [c, libelleNiveau(c, etat.langue)])].map(([v, txt]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = txt;
    o.selected = v === valeur;
    return o;
  }));
  sel.setAttribute('aria-label', t.niveau_question);
  $('niveau-ligne').hidden = !avecFiche && niveauChoisi === null;
  sel.hidden = !question;
  $('niveau-modifier').hidden = question;
  if (question) $('niveau-texte').textContent = t.niveau_question;
  else if (lus.length === 1) $('niveau-texte').textContent = `${remplir(t.niveau_lu, { n: libelleNiveau(lus[0], etat.langue) })} —`;
  else $('niveau-texte').textContent = `${t.niveau_lus} —`;
  let note = '';
  const liste = lus.map((c) => libelleNiveau(c, etat.langue)).join(` ${t.et} `);
  const nbHebdo = etat.fiches.filter(hebdo).length;
  if (niveauChoisi !== null && lus.length > 1) note = remplir(t.note_niveau_choisi_tous, { liste });
  else if (niveauChoisi !== null && lus.length === 1 && lus[0] !== niveauChoisi) note = remplir(t.note_fiche_indique, { n: liste });
  else if (manque) note = nbHebdo > 1 ? t.note_niveau_absent_une : t.note_niveau_absent;
  else if (lus.length > 1) note = remplir(t.note_niveaux_differents, { liste });
  $('niveau-note').textContent = note;
  $('niveau-note').hidden = !note;
  rendreQui();
}

// ---------- Qui je suis (cycle Q4+Q5) ----------
// Réponses de la PERSONNE ; null = pas encore répondu. Contrat null : on suit les fiches (casual si toutes le
// montrent), sinon « choisis ». Convention et État : jamais pré-choisis.
const qui = { contrat: null, convention: null, etat: null };
const NOMS_ETATS = {
  QLD: 'Queensland', NSW: 'New South Wales', VIC: 'Victoria', SA: 'South Australia', WA: 'Western Australia',
  TAS: 'Tasmania', ACT: 'Australian Capital Territory', NT: 'Northern Territory',
};
let correspondanceConnue = null; // libellés connus de la page (réglages), dès qu'ils sont chargés
donnees.then((d) => { correspondanceConnue = d.reglages.correspondance; rendreQui(); }, () => {});
// « casual » : TOUJOURS relu sur les lignes de la fiche avec les libellés connus de cette version (une valeur gardée
// par une version plus ancienne, null ou calculée avec une autre règle, est ignorée) ; avant le chargement des
// réglages seulement, la valeur lue au dépôt (relecture v0.26).
const casualDe = (f) => (correspondanceConnue ? ficheDitCasual(f.fiche, correspondanceConnue) : f.casual === true);
const fichesLues = () => etat.fiches.filter((f) => f.fiche).map((f) => ({ fiche: f.fiche, niveau_lu: f.niveau_lu, casual: casualDe(f) }));
const contratLu = () => contratDesFiches(etat.fiches.filter(hebdo).map((f) => ({ casual: casualDe(f) })));
const quiEffectif = () => ({ contrat: qui.contrat ?? contratLu(), convention: qui.convention, etat: qui.etat });

/** Cas que l'outil ne sait pas vérifier (ou réponse manquante) : sa phrase, et rien ne continue. */
function refuserQui(reglages) {
  const code = codeQui(quiEffectif(), fichesLues(), reglages);
  if (code) throw Object.assign(new Error('qui je suis'), { code });
}

function remplirMenu(sel, valeurs, texte, valeur) {
  const t = TEXTES[etat.langue];
  sel.replaceChildren(...[['', t.qui_choisir], ...valeurs.map((v) => [v, texte(v)])].map(([v, txt]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = txt;
    o.selected = v === (valeur ?? '');
    return o;
  }));
}

function rendreQui() {
  const t = TEXTES[etat.langue];
  const q = quiEffectif();
  remplirMenu($('qui-contrat'), CONTRATS, (v) => t[`contrat_${v}`], q.contrat);
  remplirMenu($('qui-convention'), CONVENTIONS, (v) => t[`convention_${v}`], q.convention);
  remplirMenu($('qui-etat'), ETATS, (v) => NOMS_ETATS[v], q.etat);
  $('qui-lu').hidden = !(qui.contrat === null && contratLu() === 'casual');
}

for (const [id, cle] of [['qui-contrat', 'contrat'], ['qui-convention', 'convention'], ['qui-etat', 'etat']]) {
  $(id).addEventListener('change', () => {
    qui[cle] = $(id).value || null;
    perime();
    rendreQui();
  });
}

$('niveau').addEventListener('change', () => {
  niveauChoisi = $('niveau').value || null;
  if (niveauChoisi === null) niveauEdition = false; // retour à « choisis » : on suit de nouveau les fiches
  perime();
  rendreNiveau();
});
$('niveau-modifier').addEventListener('click', () => {
  niveauEdition = true;
  rendreNiveau();
  $('niveau').focus();
});

donnees.then(({ taux }) => {
  niveaux = taux.niveaux.map((n) => n.classification);
  rendreNiveau();
}, () => {});

/** Une fiche illisible : son message à elle, et rien ne continue (jamais un résultat faux ou partiel). */
function refuserFicheIllisible() {
  const f = etat.fiches.find((x) => !x.fiche);
  if (f) throw Object.assign(new Error('fiche'), { code: TEXTES.fr[f.code] ? f.code : 'erreur_pdf' });
}

/**
 * Fichier déposé → fiche lue, ou { nom, code } avec un message clair (scan, mot de passe, abîmé, autre
 * présentation, pas un PDF, vide : voir src/fiche_page_pur.js). Un fichier qui n'est pas un PDF n'est lu
 * qu'en partie (son début suffit pour le savoir).
 */
async function lireFiche(fichier) {
  let d;
  try { d = await donnees; } catch { return { nom: fichier.name, code: 'erreur_chargement' }; } // page mal chargée, pas la fiche
  const { gabaritPaie, taux, reglages } = d;
  try {
    const debut = new Uint8Array(await fichier.slice(0, 1024).arrayBuffer());
    if (fichier.size > 0 && !estPdf(debut)) return { nom: fichier.name, code: 'fichier_pas_pdf' };
    return await lireFichePage(pdfjs, fichier.name, new Uint8Array(await fichier.arrayBuffer()), { gabaritPaie, niveaux: taux.niveaux, correspondance: reglages.correspondance });
  } catch (e) {
    console.warn(e);
    return { nom: fichier.name, code: 'fiche_abimee' };
  }
}

async function ajouterFichiers(liste) {
  if (etat.occupe) return;
  occuper(true);
  etat.erreur = null;
  try {
    const nouvelles = await Promise.all([...liste].map((f) => lireFiche(f)));
    // De vraies fiches arrivent : TOUT l'exemple fictif s'en va et la saisie de la personne revient
    // (jamais de données inventées mêlées aux vraies : liste, montants, jours, niveau compris).
    if (etat.modeExemple) restaurerSaisie();
    for (const n of nouvelles) {
      const deja = n.fiche && etat.fiches.some((f) => f.fiche?.periode.du === n.fiche.periode.du);
      if (deja) etat.erreur = { code: 'fiche_deja' };
      else etat.fiches.push(n);
    }
  } catch (e) {
    etat.erreur = erreurDe(e);
  } finally {
    occuper(false);
  }
  perime();
  rendreTout();
}

function rendreFiches() {
  const t = TEXTES[etat.langue];
  $('liste-fiches').replaceChildren(...etat.fiches.map((f, i) => {
    const li = document.createElement('li');
    const nom = document.createElement('span');
    if (f.fiche) {
      nom.textContent = remplir(t.fiche_du, { du: dateCourte(f.fiche.periode.du), au: dateCourte(f.fiche.periode.au) });
      if (f.jours !== 7) {
        nom.textContent += ` : ${raisonRefus({ jours: f.jours, raison: 'jours' }, etat.langue)}`;
        nom.className = 'avertissement';
      } else if (!f.lundi) {
        nom.textContent += ` : ${raisonRefus({ raison: 'lundi' }, etat.langue)}`;
        nom.className = 'avertissement';
      }
    } else {
      nom.textContent = `${remplir(t.fichier_n, { n: i + 1 })} : ${t[f.code]}`;
      nom.className = 'erreur';
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t.retirer;
    b.addEventListener('click', () => {
      if (etat.occupe) return;
      etat.fiches.splice(i, 1);
      etat.erreur = null;
      perime();
      rendreFiches();
      rendreBanque();
      rendreNiveau();
      rendreMessage();
      $('fichiers').focus();
    });
    li.append(nom, b);
    return li;
  }));
  $('aucune-fiche').hidden = etat.fiches.length > 0;
}

$('fichiers').addEventListener('change', (e) => {
  ajouterFichiers(e.target.files).finally(() => { e.target.value = ''; });
});
const depot = $('depot');
for (const ev of ['dragenter', 'dragover']) {
  depot.addEventListener(ev, (e) => { e.preventDefault(); depot.classList.add('survol'); });
}
for (const ev of ['dragleave', 'drop']) depot.addEventListener(ev, () => depot.classList.remove('survol'));
depot.addEventListener('drop', (e) => {
  e.preventDefault();
  // Tous les fichiers lâchés sont listés : celui qui n'est pas une fiche lisible y reçoit son message clair.
  const tous = [...(e.dataTransfer?.files ?? [])];
  if (tous.length) ajouterFichiers(tous);
});
// Fichier lâché à côté du cadre : le navigateur ne doit pas quitter la page pour l'ouvrir (saisie perdue).
for (const ev of ['dragover', 'drop']) document.addEventListener(ev, (e) => e.preventDefault());

// ---------- Étapes 2 et 3 : Humanforce, banque, vraies heures (en phrases) ----------

$('humanforce').addEventListener('input', () => { perime(); rendrePauses(); });

const montantsBanque = new Map(); // periode_du → texte tapé (gardé quand la langue ou l'étape change)

/** Phrase avec un champ dedans : [texte avant] [champ] [texte après], dans un <label> (toucher le texte = le champ). */
function phraseAvecChamp(avant, champ, apres) {
  const label = document.createElement('label');
  label.className = 'phrase-champ';
  label.append(`${avant} `, champ, ` ${apres}`);
  return label;
}

function rendreBanque() {
  const t = TEXTES[etat.langue];
  const lues = etat.fiches.filter((f) => f.fiche);
  $('banque').replaceChildren(...lues.map((f) => {
    const { du, au } = f.fiche.periode;
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.id = `banque-${du}`;
    input.placeholder = '0.00';
    input.autocomplete = 'off';
    input.value = montantsBanque.get(du) ?? '';
    input.addEventListener('input', () => { montantsBanque.set(du, input.value); perime(); });
    return phraseAvecChamp(remplir(t.banque_avant, { du: dateCourte(du), au: dateCourte(au) }), input, t.banque_apres);
  }));
  $('banque-vide').hidden = lues.length > 0;
}

// ---------- Étape 3 : une seule liste « Tes services » (cycle 3f) ----------
// Une ligne-phrase par service repris de Humanforce (#pauses) : « Lun 17/08, de 09:00 à 15:00, pause de 30 min
// de [--:--] à [--:--] — corriger les heures » ; puis les services ajoutés (#vraies), même phrase, tout modifiable.

const jours = []; // services ajoutés : { date, debut, fin, pause_min, pause_de, pause_a }
const heuresPause = new Map(); // clé d'un service Humanforce → début de pause « HH:MM » (« ? » si incomplet)
const finsPause = new Map(); // clé → fin de pause TAPÉE (vide : début + durée, la durée de la ligne est gardée)
const corrections = new Map(); // clé → { debut, fin, pause_min } : heures corrigées dans la ligne
const enEdition = new Set(); // clés des lignes ouvertes en correction

const lireHeure = (input) => (input.validity.badInput ? '?' : input.value);
const ajoutRempli = (j) => j.date || j.debut || j.fin || j.pause_min || j.pause_de || j.pause_a;

/** Services Humanforce de la liste collée, dans les semaines vérifiables ; null si la liste est illisible. */
function servicesHumanforce() {
  try {
    if (!$('humanforce').value.trim()) return etat.saisieMain ? [] : null; // saisie à la main : aucune ligne reprise
    const gabaritHf = donneesPretes?.gabaritHf;
    if (!gabaritHf) return null;
    return preparerPage(lireHumanforceAvec($('humanforce').value, gabaritHf)).services;
  } catch {
    return null;
  }
}

/** Pauses tapées, au format de servicesDeLaListe : clé → { de, a }. */
function pausesTapees() {
  const m = new Map();
  for (const [cle, de] of heuresPause) m.set(cle, { de, a: finsPause.get(cle) ?? '' });
  return m;
}

/** Durée affichée « N » d'une pause : fin − début si les deux sont tapés et lisibles, sinon la durée de la ligne. */
function dureeAffichee(de, a, pauseMin, date) {
  try {
    return dureePause(de, a, date) ?? pauseMin;
  } catch {
    return pauseMin;
  }
}

/** Champ heure d'une phrase (avec étiquette pour lecteur d'écran). */
function champHeure(valeur, aria, surSaisie) {
  const input = document.createElement('input');
  input.type = 'time';
  input.value = valeur ?? '';
  input.setAttribute('aria-label', aria);
  input.addEventListener('input', () => surSaisie(input));
  return input;
}

/**
 * Morceau « pause de N min de [début] à [fin] » : la fin se remplit avec début + durée tant qu'elle n'est pas
 * tapée ; si on la change, la durée affichée suit. `etatPause` : { de, a, pauseMin, date, poserDe, poserA }.
 */
function morceauPause(t, ep, aria, champDuree) {
  const duree = document.createElement('span');
  duree.className = 'duree-pause';
  const fin = champHeure(ep.a || finPauseProposee(ep.de, ep.pauseMin), `${t.pause_fin_aria} — ${aria}`, (input) => {
    ep.poserA(lireHeure(input));
    majDuree(true);
    perime();
  });
  const debut = champHeure(ep.de, `${t.pause_debut_aria} — ${aria}`, (input) => {
    ep.poserDe(lireHeure(input));
    if (!ep.lireA()) fin.value = finPauseProposee(ep.lireDe(), ep.lirePauseMin()); // fin proposée, pas tapée
    majDuree(true);
    perime();
  });
  debut.dataset.pause = 'debut';
  fin.dataset.pause = 'fin';
  // enregistrer : seulement sur une saisie de la personne (jamais au simple dessin de la ligne : sinon une ligne
  // ouverte pour correction serait marquée « corrigée à la main » sans que rien ne change).
  function majDuree(enregistrer = false) {
    duree.textContent = String(dureeAffichee(ep.lireDe(), ep.lireA(), ep.lirePauseMin(), ep.date));
    if (!ep.lireA()) fin.value = finPauseProposee(ep.lireDe(), ep.lirePauseMin()); // fin proposée : suit la durée
    if (champDuree) {
      // Début ET fin de pause tapés et lisibles : les minutes se calculent toutes seules et ne se tapent plus
      // (jamais deux valeurs contradictoires). Elles sont aussi enregistrées : effacer la fin garde ce calcul.
      let calculee = null;
      try { calculee = dureePause(ep.lireDe(), ep.lireA(), ep.date); } catch { calculee = null; }
      champDuree.readOnly = calculee !== null;
      if (calculee !== null && champDuree.value !== String(calculee)) {
        champDuree.value = String(calculee);
        if (enregistrer) ep.poserPauseMin?.(String(calculee));
      }
    }
  }
  // Durée tapée : la fin tapée avant est effacée (sinon deux valeurs contradictoires) et la fin est reproposée.
  function dureeChangee() {
    ep.poserA('');
    majDuree();
  }
  majDuree();
  return [` ${t.ligne_pause} `, champDuree ?? duree, ` ${t.ligne_min_de} `, debut, ` ${t.ligne_a} `, fin, champDuree ? { majDuree: dureeChangee } : null];
}

function bouton(texte, classe, action) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = classe;
  b.textContent = texte;
  b.addEventListener('click', action);
  return b;
}

function rendrePauses() {
  const t = TEXTES[etat.langue];
  const hf = servicesHumanforce();
  const remplaces = new Set(jours.filter((j) => /^\d{4}-\d{2}-\d{2}$/.test(j.date ?? '')).map((j) => j.date));
  $('pauses').replaceChildren(...(hf ?? []).map((s) => {
    const cle = cleService(s);
    const aria = jourEtDate(s.date, etat.langue);
    const li = document.createElement('div');
    li.className = 'ligne-service';
    li.dataset.service = cle;
    const p = document.createElement('p');
    p.className = 'phrase-champ';
    li.append(p);
    if (remplaces.has(s.date)) {
      li.classList.add('remplacee');
      p.append(`${aria}, ${t.ligne_de} ${s.debut} ${t.ligne_a} ${s.fin} : ${t.remplace}.`);
      return li;
    }
    const c = corrections.get(cle);
    const valeurs = { debut: c?.debut ?? s.debut, fin: c?.fin ?? s.fin, pause_min: c?.pause_min ?? String(s.pause_min) };
    const ep = {
      date: s.date,
      lireDe: () => heuresPause.get(cle) ?? '',
      lireA: () => finsPause.get(cle) ?? '',
      lirePauseMin: () => (corrections.get(cle)?.pause_min ?? String(s.pause_min)),
      poserDe: (v) => (v ? heuresPause.set(cle, v) : heuresPause.delete(cle)),
      poserA: (v) => (v ? finsPause.set(cle, v) : finsPause.delete(cle)),
    };
    ep.de = ep.lireDe();
    ep.a = ep.lireA();
    ep.pauseMin = ep.lirePauseMin();
    if (enEdition.has(cle)) {
      // Correction dans la ligne : début, fin et durée de pause modifiables ; enregistrées seulement si changées.
      const corriger = (champ) => (input) => {
        const v = champ === 'pause_min' ? input.value : lireHeure(input);
        const n = { ...valeurs, ...corrections.get(cle), [champ]: v };
        const inchange = n.debut === s.debut && n.fin === s.fin && String(n.pause_min) === String(s.pause_min);
        if (inchange) corrections.delete(cle); else corrections.set(cle, n);
        perime();
      };
      const debut = champHeure(valeurs.debut, `${t.debut} — ${aria}`, corriger('debut'));
      const fin = champHeure(valeurs.fin, `${t.fin} — ${aria}`, corriger('fin'));
      debut.dataset.champLigne = 'debut';
      fin.dataset.champLigne = 'fin';
      const pauseMin = document.createElement('input');
      pauseMin.type = 'text';
      pauseMin.inputMode = 'numeric';
      pauseMin.autocomplete = 'off';
      pauseMin.value = valeurs.pause_min;
      pauseMin.dataset.champLigne = 'pause_min';
      pauseMin.setAttribute('aria-label', `${t.pause} — ${aria}`);
      ep.poserPauseMin = (v) => corriger('pause_min')({ value: v });
      const morceau = morceauPause(t, ep, aria, pauseMin);
      pauseMin.addEventListener('input', () => { corriger('pause_min')(pauseMin); morceau.at(-1).majDuree(); });
      p.append(`${aria}, ${t.ligne_de} `, debut, ` ${t.ligne_a} `, fin, ',', ...morceau.slice(0, -1));
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.append(bouton(t.revenir_hf, 'revenir-hf', () => {
        corrections.delete(cle);
        enEdition.delete(cle);
        perime();
        rendrePauses();
        $('pauses').querySelector(`[data-service="${cle}"] .corriger`)?.focus();
      }));
      li.append(actions);
      return li;
    }
    p.append(`${aria}, ${t.ligne_de} ${valeurs.debut} ${t.ligne_a} ${valeurs.fin},`);
    if (Number(valeurs.pause_min) > 0 || ep.de) p.append(...morceauPause(t, ep, aria).slice(0, -1));
    else p.append(` ${t.ligne_sans_pause}`);
    p.append(' — ');
    p.append(bouton(t.corriger, 'corriger lien', () => {
      enEdition.add(cle);
      rendrePauses();
      $('pauses').querySelector(`[data-service="${cle}"] [data-champ-ligne="debut"]`)?.focus();
    }));
    return li;
  }));
  $('pauses-vide').hidden = hf !== null;
}

function rendreJours() {
  const t = TEXTES[etat.langue];
  $('vraies').replaceChildren(...jours.map((j, i) => {
    const div = document.createElement('div');
    div.className = 'jour-phrase ligne-service';
    const champ = (cle, type, libelle) => {
      const input = document.createElement('input');
      input.type = type;
      input.value = j[cle] ?? '';
      input.dataset.champ = cle;
      input.setAttribute('aria-label', remplir(t.jour_n, { n: i + 1, champ: libelle }));
      // Pause : champ texte (clavier numérique) qui garde ce qui est tapé ; « 30m » ou « 1,5 » → phrase d'erreur,
      // jamais 0 en silence (un champ nombre du navigateur rendrait une valeur vide).
      if (cle === 'pause_min') { input.inputMode = 'numeric'; input.autocomplete = 'off'; }
      input.addEventListener('input', () => {
        j[cle] = type === 'time' ? lireHeure(input) : input.value;
        perime();
        if (cle === 'date') rendrePauses(); // un jour ajouté remplace les services Humanforce de ce jour
        if (cle === 'pause_min') morceau.at(-1).majDuree();
      });
      return input;
    };
    const ep = {
      date: j.date,
      lireDe: () => j.pause_de ?? '',
      lireA: () => j.pause_a ?? '',
      lirePauseMin: () => j.pause_min ?? '',
      poserDe: (v) => { j.pause_de = v; },
      poserA: (v) => { j.pause_a = v; },
      poserPauseMin: (v) => { j.pause_min = v; },
    };
    ep.de = ep.lireDe();
    ep.a = ep.lireA();
    ep.pauseMin = ep.lirePauseMin();
    const champPause = champ('pause_min', 'text', t.pause);
    const morceau = morceauPause(t, ep, remplir(t.jour_n, { n: i + 1, champ: '' }).replace(/\s*:?\s*$/, ''), champPause);
    for (const x of morceau) if (x instanceof HTMLInputElement && x.dataset.pause) x.dataset.champ = x.dataset.pause === 'debut' ? 'pause_de' : 'pause_a';
    const p = document.createElement('p');
    p.className = 'phrase-champ';
    p.append(champ('date', 'date', t.date), `, ${t.ligne_de} `, champ('debut', 'time', t.debut), ` ${t.ligne_a} `,
      champ('fin', 'time', t.fin), ',', ...morceau.slice(0, -1));
    const retirer = bouton(t.retirer, 'retirer', () => { jours.splice(i, 1); perime(); rendreJours(); rendrePauses(); $('ajouter-jour').focus(); });
    div.append(p, retirer);
    return div;
  }));
}

/** « Je n'ai pas Humanforce » : on passe à la liste, avec une première ligne vide prête à remplir. */
$('sans-humanforce').addEventListener('click', () => {
  if (etat.occupe) return;
  etat.saisieMain = true;
  etat.erreur = null;
  rendreMessage();
  if (!jours.length) jours.push({ date: '', debut: '', fin: '', pause_min: '', pause_de: '', pause_a: '' });
  perime();
  rendreJours();
  rendrePauses();
  allerA(3);
  $('vraies').querySelector('.jour-phrase:last-child [data-champ="date"]')?.focus({ preventScroll: true });
});

$('ajouter-jour').addEventListener('click', () => {
  jours.push({ date: '', debut: '', fin: '', pause_min: '', pause_de: '', pause_a: '' });
  perime();
  rendreJours();
  $('vraies').querySelector('.jour-phrase:last-child [data-champ="date"]')?.focus();
});

/** Semaines comptées dans le total (une carte « paiement décalé » couvre deux semaines). */
function semainesComptees(syn) {
  return new Set(syn.semaines.filter((s) => s.comptee).flatMap((s) => [s.semaine, s.semaine_fin].filter(Boolean)));
}

let donneesPretes = null;
donnees.then((d) => { donneesPretes = d; rendrePauses(); }, () => {});

// ---------- Calcul ----------

function rendreMessage() {
  const m = $('message');
  if (!etat.erreur) { m.hidden = true; m.textContent = ''; return; }
  m.textContent = remplir(TEXTES[etat.langue][etat.erreur.code], etat.erreur.valeurs ?? {});
  m.hidden = false;
}

async function verifier() {
  if (etat.occupe) return;
  occuper(true);
  etat.erreur = null;
  etat.resultat = null;
  const sortie = $('resultat');
  sortie.dataset.etat = 'en_cours';
  try {
    const { regles, params, taux, gabaritHf, reglages } = await donnees;
    refuserFicheIllisible();
    if (!etat.fiches.length) throw Object.assign(new Error('fiche'), { code: 'manque_fiche' });
    // Problèmes des fiches (étape 1) avant ceux de la liste (étape 2) : même ordre que les étapes.
    const avant = preparerPage([]);
    if (avant.chevauchement) throw Object.assign(new Error('fiche'), { code: 'fiches_recouvrent' });
    if (!avant.fiches.length) throw Object.assign(new Error('fiche'), { code: 'aucune_hebdo' });
    refuserQui(reglages);
    if (avant.manque_niveau) throw Object.assign(new Error('niveau'), { code: 'manque_niveau' });
    const texteHf = $('humanforce').value;
    const sansHumanforce = !texteHf.trim();
    if (sansHumanforce && !etat.saisieMain) throw Object.assign(new Error('humanforce'), { code: 'manque_hf' });

    const ajouts = jours.filter(ajoutRempli);
    if (sansHumanforce && !ajouts.length) throw Object.assign(new Error('service'), { code: 'manque_service' });
    const hf = sansHumanforce ? [] : lireHumanforceAvec(texteHf, gabaritHf);
    // Heures de pause indiquées : vérifiées (pendant le service) puis passées au moteur ; vides → comme avant.
    // Calcul : src/collegues_pur.js (calculerPage), le même code que la comparaison sur vraies fiches.
    const lesQui = quiEffectif();
    const { rapport, prep, reglesAu } = calculerPage({
      fiches: fichesLues(),
      qui: lesQui,
      services: servicesDeLaListe(hf, { corrections, pauses: pausesTapees(), ajouts }),
      niveauChoisi,
      montants: montantsBanque,
    }, { regles, params, taux, reglages });
    const { services } = prep;
    window.__rapport = rapport; // lu par les tests (comparaison avec l'appli Node)
    etat.resultat = {
      syn: synthese(rapport, services),
      // Services ajoutés ou corrigés à la main : marqués dans le résultat et le résumé.
      contexte: {
        classification: niveauxDuCalcul(prep), date_effet: regles.date_effet, refusees: prep.refusees,
        aMain: servicesAMain(services, { ajouts, corrections, hf }), sansHumanforce, qui: lesQui,
      },
      exemple: etat.modeExemple,
      // Explications seulement pour les semaines vraiment vérifiées (jamais pour une semaine sans montant).
      pauses: effetsPauses(services, reglesAu, lesQui.etat, semainesComptees(synthese(rapport, services))),
      minuit: alertesMinuit(services, reglesAu, lesQui.etat, semainesComptees(synthese(rapport, services))),
    };
    sortie.dataset.etat = 'fini';
  } catch (e) {
    etat.erreur = erreurDe(e);
    sortie.dataset.etat = 'erreur';
  } finally {
    occuper(false);
  }
  rendreMessage();
  if (etat.resultat) allerA('resultat');
  else {
    if (etat.vue === 'resultat') etat.vue = 3;
    rendreVue();
    rendreResultat();
  }
}

function rendreResultat() {
  const sortie = $('resultat');
  const r = etat.resultat;
  if (!r || etat.vue !== 'resultat') { sortie.hidden = true; return; }
  const l = etat.langue;
  sortie.hidden = false;
  $('note-exemple').hidden = !r.exemple;
  const v = verdict(r.syn, { refusees: r.contexte.refusees, alertes: (r.minuit ?? []).length }, l);
  $('verdict').textContent = v.texte;
  $('verdict').dataset.etat = v.etat;
  const q = r.contexte.qui;
  const tq = TEXTES[l];
  $('qui-resume-texte').textContent = remplir(tq.qui_resume, {
    contrat: tq[`contrat_${q.contrat}`], convention: tq[`convention_${q.convention}`], etat: NOMS_ETATS[q.etat],
    niveau: r.contexte.classification.split(' / ').map((c) => libelleNiveau(c, l)).join(' / '),
  });
  $('semaines').replaceChildren(...r.syn.semaines.map((s) => {
    const li = document.createElement('li');
    li.className = `semaine ${s.etat}`;
    const titre = document.createElement('div');
    titre.className = 'titre';
    titre.textContent = titreSemaine(s, l);
    const badge = document.createElement('div');
    badge.className = 'etat';
    badge.textContent = etatSemaine(s, l);
    const ul = document.createElement('ul');
    ul.replaceChildren(...s.constats.map((c) => {
      const p = document.createElement('li');
      p.className = 'phrase';
      p.textContent = phrase(c, l);
      return p;
    }));
    li.append(titre, badge, ul);
    return li;
  }), ...cartesRefusees(r.contexte.refusees, l).map((c) => {
    // Fiche qui n'est pas à la semaine : carte « non vérifiée », la raison, aucun montant.
    const li = document.createElement('li');
    li.className = 'semaine a_verifier';
    const titre = document.createElement('div');
    titre.className = 'titre';
    titre.textContent = c.titre;
    const badge = document.createElement('div');
    badge.className = 'etat';
    badge.textContent = c.etat;
    const ul = document.createElement('ul');
    ul.replaceChildren(...c.phrases.map((x) => {
      const p = document.createElement('li');
      p.className = 'phrase';
      p.textContent = x;
      return p;
    }));
    li.append(titre, badge, ul);
    return li;
  }));
  // Effet de l'heure de pause (indiquée ou non), service par service.
  const notes = (r.pauses ?? []).map((e) => phrasePause(e, l));
  $('notes-pause').replaceChildren(...notes.map((x) => {
    const li = document.createElement('li');
    li.textContent = x;
    return li;
  }));
  $('notes-pause').hidden = notes.length === 0;
  $('titre-pauses').hidden = notes.length === 0;
  // Services qui passent minuit vers un autre type de jour : à vérifier (aucun taux inventé).
  const minuit = (r.minuit ?? []).map((a) => phraseMinuit(a, l));
  $('notes-minuit').replaceChildren(...minuit.map((x) => {
    const li = document.createElement('li');
    li.textContent = x;
    return li;
  }));
  $('notes-minuit').hidden = minuit.length === 0;
  $('titre-minuit').hidden = minuit.length === 0;
  const aMain = (r.contexte.aMain ?? []).map((x) => phraseAMain(x, l));
  $('notes-main').replaceChildren(...aMain.map((x) => {
    const li = document.createElement('li');
    li.textContent = x;
    return li;
  }));
  $('notes-main').hidden = aMain.length === 0;
  $('titre-main').hidden = aMain.length === 0;
  $('total').replaceChildren(...lignesTotal(r.syn, l).map((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    return li;
  }));
  $('resume').value = resumeManager(r.syn, r.contexte, l);
  $('copie-etat').textContent = '';
  $('envoyer').hidden = !peutPartager();
}

$('verifier').addEventListener('click', (e) => {
  // Double tap sur « Suivant » à l'étape 2 : le 2e tap tombe sur « Vérifier » (même place) ; il est ignoré.
  if (e.isTrusted && e.timeStamp - dernierSuivant < 500) return;
  verifier();
});

/** Copie d'un texte (repli : sélection dans la zone, pour copier à la main). */
async function copierTexte(zone, etatEl) {
  const t = TEXTES[etat.langue];
  try {
    await navigator.clipboard.writeText(zone.value);
    etatEl.textContent = t.copie_ok;
  } catch {
    zone.focus();
    zone.select();
    etatEl.textContent = document.execCommand('copy') ? t.copie_ok : t.copie_ko;
  }
}

$('copier').addEventListener('click', () => copierTexte($('resume'), $('copie-etat')));

// ---------- Envoyer : feuille de partage du téléphone, seulement au toucher de la personne ----------

const peutPartager = () => typeof navigator.share === 'function';

/** La personne choisit à qui (feuille de partage) ; annulé → rien ; partage impossible → copie. */
async function partager(zone, etatEl) {
  const t = TEXTES[etat.langue];
  try {
    await navigator.share({ text: zone.value });
    etatEl.textContent = t.partage_ok;
  } catch (e) {
    if (e?.name === 'AbortError') { etatEl.textContent = ''; return; }
    await copierTexte(zone, etatEl);
  }
}

$('envoyer').addEventListener('click', () => { if (!etat.occupe) partager($('resume'), $('copie-etat')); });

// ---------- Garder sur ce téléphone (stockage de l'appareil seulement, jamais envoyé) ----------

function gardeExiste() {
  try { return localStorage.getItem(CLE_GARDE) !== null; } catch { return false; }
}

/** Case cochée : la saisie de la PERSONNE est gardée (pendant l'exemple : celle mise de côté, jamais l'exemple). */
function memoriser() {
  if (!$('garder').checked) return;
  const s = etat.modeExemple ? etat.sauvegarde : saisieActuelle();
  if (!s) return;
  try {
    const texte = serialiserGarde(s);
    // Ce qui ne pourrait pas être repris au prochain démarrage n'est pas gardé (relecture 3g).
    if (!deserialiserGarde(texte)) throw new Error('garde illisible');
    localStorage.setItem(CLE_GARDE, texte);
  } catch {
    // Échec : rien ne doit rester (ni l'ancienne copie), comme le dit le message.
    try { localStorage.removeItem(CLE_GARDE); } catch { /* stockage indisponible */ }
    $('garder').checked = false;
    etat.gardeMsg = 'garde_impossible';
  }
  rendreGarde();
}

function rendreGarde() {
  $('effacer-tout').hidden = !gardeExiste();
  $('garde-etat').textContent = etat.gardeMsg ? TEXTES[etat.langue][etat.gardeMsg] : '';
}

$('garder').addEventListener('change', () => {
  if ($('garder').checked) {
    etat.gardeMsg = null;
    memoriser();
  } else {
    try { localStorage.removeItem(CLE_GARDE); } catch { /* rien n'était gardé */ }
    etat.gardeMsg = 'garde_arrete';
  }
  rendreGarde();
});

$('effacer-tout').addEventListener('click', () => {
  if (etat.occupe) return;
  try {
    localStorage.removeItem(CLE_GARDE);
    localStorage.removeItem('controle-paie-langue');
  } catch { /* stockage indisponible */ }
  $('garder').checked = false;
  etat.sauvegarde = null;
  restaurerSaisie(); // sans sauvegarde : tout revient à vide (exemple compris)
  etat.erreur = null;
  etat.gardeMsg = 'garde_efface';
  rendreTout();
  allerA(1);
});

/** Au départ : ce qui a été gardé revient (texte abîmé → rien n'est repris, « Tout effacer » reste proposé). */
function reprendreGarde() {
  let texte = null;
  try { texte = localStorage.getItem(CLE_GARDE); } catch { return; }
  if (texte === null) return;
  const s = deserialiserGarde(texte);
  if (!s) return;
  etat.sauvegarde = s;
  restaurerSaisie();
  $('garder').checked = true;
  etat.gardeMsg = 'garde_reprise';
}

// ---------- Donner mon avis (aucune donnée de paie : seulement les trois réponses, la langue, la version) ----------
// Cycle 6b (décision du responsable) : envoi direct vers le service d'avis, SEULEMENT au geste « Envoyer mon avis ».
// Sans réseau ou en cas d'échec : un message, et rien de ce qui est écrit n'est effacé.

const avis = { facile: '', envoi: false };
const reponsesAvis = () => ({ facile: avis.facile, gene: $('avis-gene').value, idee: $('avis-idee').value });

function rendreAvis() {
  $('avis-oui').setAttribute('aria-pressed', String(avis.facile === 'oui'));
  $('avis-non').setAttribute('aria-pressed', String(avis.facile === 'non'));
  $('avis-apercu').value = texteAvis(reponsesAvis(), etat.langue);
  $('avis-envoyer').disabled = avis.envoi;
  $('avis-ouvrir').setAttribute('aria-expanded', String(!$('avis').hidden));
}

/** Envoi direct (POST) : les champs de champsAvis, la clé et le sujet ; rien d'autre (le piège est vérifié ici). */
async function envoyerAvis() {
  if (avis.envoi) return;
  const t = TEXTES[etat.langue];
  // Champ piège coché : un robot, pas une personne → rien ne part (et rien n'est dit de différent).
  if ($('avis-piege').checked) { $('avis-etat').textContent = t.avis_envoye; return; }
  const corps = new FormData();
  corps.append('access_key', CLE_AVIS);
  corps.append('subject', SUJET_AVIS);
  for (const [k, v] of Object.entries(champsAvis(reponsesAvis(), etat.langue))) corps.append(k, v);
  avis.envoi = true;
  $('avis-etat').textContent = t.avis_envoi;
  rendreAvis();
  let message;
  const arret = new AbortController();
  const minuterie = setTimeout(() => arret.abort(), 20000);
  try {
    const r = await fetch(ADRESSE_AVIS, {
      method: 'POST', body: corps, headers: { Accept: 'application/json' },
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: arret.signal,
    });
    const ok = r.ok && (await r.json().catch(() => null))?.success === true;
    message = ok ? 'avis_envoye' : 'avis_echec';
  } catch {
    message = 'avis_hors_ligne'; // pas de réseau (ou trop long) : rien n'est perdu
  } finally {
    clearTimeout(minuterie);
  }
  avis.envoi = false;
  if (message === 'avis_envoye') {
    avis.facile = '';
    $('avis-gene').value = '';
    $('avis-idee').value = '';
  }
  rendreAvis();
  $('avis-etat').textContent = TEXTES[etat.langue][message];
}

$('avis-ouvrir').addEventListener('click', () => {
  $('avis').hidden = !$('avis').hidden;
  $('avis-etat').textContent = '';
  rendreAvis();
  if (!$('avis').hidden) $('avis').querySelector('h2').focus();
});
for (const [id, valeur] of [['avis-oui', 'oui'], ['avis-non', 'non']]) {
  $(id).addEventListener('click', () => { avis.facile = avis.facile === valeur ? '' : valeur; rendreAvis(); });
}
for (const id of ['avis-gene', 'avis-idee']) $(id).addEventListener('input', rendreAvis);
$('avis-envoyer').addEventListener('click', envoyerAvis);
$('avis-fermer').addEventListener('click', () => {
  $('avis').hidden = true;
  rendreAvis();
  $('avis-ouvrir').focus();
});

// ---------- Exemple fictif ----------

function saisieActuelle() {
  return {
    fiches: [...etat.fiches],
    humanforce: $('humanforce').value,
    montants: new Map(montantsBanque),
    jours: jours.map((j) => ({ ...j })),
    niveau: niveauChoisi,
    qui: { ...qui },
    pauses: new Map(heuresPause),
    finsPause: new Map(finsPause),
    corrections: new Map(corrections),
    enEdition: new Set(enEdition),
    saisieMain: etat.saisieMain,
  };
}

/** Fin de l'exemple : la saisie de la personne revient telle qu'elle était (vide si elle n'avait rien saisi). */
function restaurerSaisie() {
  const s = etat.sauvegarde ?? { fiches: [], humanforce: '', montants: new Map(), jours: [], niveau: null, pauses: new Map() };
  heuresPause.clear();
  for (const [k, v] of s.pauses ?? []) heuresPause.set(k, v);
  finsPause.clear();
  for (const [k, v] of s.finsPause ?? []) finsPause.set(k, v);
  corrections.clear();
  for (const [k, v] of s.corrections ?? []) corrections.set(k, v);
  enEdition.clear();
  for (const k of s.enEdition ?? []) enEdition.add(k);
  etat.fiches = s.fiches;
  $('humanforce').value = s.humanforce;
  montantsBanque.clear();
  for (const [k, v] of s.montants) montantsBanque.set(k, v);
  jours.length = 0;
  jours.push(...s.jours);
  niveauChoisi = s.niveau;
  Object.assign(qui, s.qui ?? { contrat: null, convention: null, etat: null });
  niveauEdition = false;
  etat.saisieMain = Boolean(s.saisieMain);
  etat.modeExemple = false;
  etat.sauvegarde = null;
  etat.resultat = null;
  $('resultat').dataset.etat = 'vide';
}

$('quitter-exemple').addEventListener('click', () => {
  if (etat.occupe || !etat.modeExemple) return;
  restaurerSaisie();
  etat.erreur = null;
  rendreTout();
  allerA(1);
});

$('essayer').addEventListener('click', async () => {
  if (etat.occupe) return;
  occuper(true);
  try {
    const [texteHf, ex] = await Promise.all([lire('./exemples/humanforce_fictif.txt', 'texte'), lire('./exemples/exemple_page.json')]);
    const fictive = await lireFiche(new File([octetsFicheFictive()], NOM_FICHE_FICTIVE, { type: 'application/pdf' }));
    if (!fictive.fiche) throw Object.assign(new Error('fiche fictive'), { code: 'erreur_pdf' });
    // La saisie de la personne est mise de côté (une seule fois), jamais effacée.
    if (!etat.modeExemple) etat.sauvegarde = saisieActuelle();
    etat.modeExemple = true;
    etat.fiches = [{ ...fictive, exemple: true }];
    $('humanforce').value = texteHf;
    montantsBanque.clear();
    montantsBanque.set(fictive.fiche.periode.du, ex.banque);
    jours.length = 0;
    // L'exemple n'utilise jamais les pauses ni les corrections de la personne (elles sont sauvegardées).
    heuresPause.clear();
    finsPause.clear();
    corrections.clear();
    enEdition.clear();
    await donnees;
    niveauChoisi = null; // l'exemple suit le niveau lu sur sa fiche fictive
    // L'exemple fictif répond pour la personne fictive (casual lu sur sa fiche) ; les réponses de la personne
    // sont sauvegardées et reviennent en quittant l'exemple.
    Object.assign(qui, { contrat: null, convention: 'hospitality', etat: 'QLD' });
    niveauEdition = false;
    etat.erreur = null;
  } catch (e) {
    etat.erreur = erreurDe(e);
    occuper(false);
    rendreTout();
    return;
  }
  occuper(false);
  rendreTout();
  await verifier();
});

// ---------- Départ ----------

$('mention-en').textContent = MENTION.en;
$('mention-fr').textContent = MENTION.fr;
etat.langue = langueDepart();
reprendreGarde();
history.replaceState({ vue: 1 }, '');
appliquerLangue();
document.body.dataset.pret = 'oui';

// ---------- Hors ligne (cycle 4) ----------
// sw.js garde les fichiers de la page sur le téléphone. Une nouvelle version attend : on la propose, et la page ne
// se recharge qu'après le geste « Mettre à jour » (jamais au milieu d'une saisie).
if ('serviceWorker' in navigator) {
  let demandee = false;
  const proposer = (sw) => {
    if (!sw || !navigator.serviceWorker.controller) return; // première visite : rien à proposer
    $('maj').hidden = false;
    $('maj-bouton').onclick = () => { demandee = true; sw.postMessage('mettre-a-jour'); };
  };
  let tenue = Boolean(navigator.serviceWorker.controller); // page déjà tenue par une version au chargement
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (demandee) { location.reload(); return; }
    if (!tenue) { tenue = true; return; } // première visite : la page vient d'être prise en charge, rien de neuf
    // Mise à jour faite dans un AUTRE onglet : ce code est l'ancien ; on propose de recharger (même bandeau).
    $('maj').hidden = false;
    $('maj-bouton').onclick = () => location.reload();
  });
  // Cycle 6b : le service worker est à la racine du site (il tient aussi « / »). L'ancienne inscription (web/sw.js,
  // portée /web/) n'est retirée qu'une fois celui de la racine ACTIF (relecture cycle 6b : jamais de téléphone sans
  // aucun service worker si l'installation est coupée en route).
  const ancienne = new URL('./', location.href).href;
  const retirerAncienne = () => navigator.serviceWorker.getRegistrations()
    .then((rs) => { for (const r of rs) if (r.scope === ancienne) r.unregister(); }, () => {});
  navigator.serviceWorker.register('../sw.js', { scope: '../' }).then((reg) => {
    if (reg.active) retirerAncienne();
    else {
      const sw = reg.installing ?? reg.waiting;
      sw?.addEventListener('statechange', () => { if (sw.state === 'activated') retirerAncienne(); });
    }
    proposer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => { if (sw.state === 'installed') proposer(sw); });
    });
    document.body.dataset.horsLigne = 'oui'; // lu par les tests
  }, (e) => console.warn(e));
}
