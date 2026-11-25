// Hors ligne (cycle 4, déplacé à la RACINE au cycle 6b) : à la racine, ce service worker tient tout le site, y compris
// la page d'accueil « / » (avant, depuis web/sw.js, il ne tenait que /web/ : le site ne s'ouvrait pas sans réseau).
// Il met en cache UNIQUEMENT les fichiers du site, tous sur la même origine, dès la première visite.
// Rien d'autre n'est mis en cache : ni fiche, ni liste Humanforce, ni réponse d'un autre site, et JAMAIS un envoi
// (seules les requêtes GET des fichiers listés passent par le cache ; l'envoi de l'avis est un POST, il est ignoré).
// Mise à jour propre : VERSION change dès qu'un fichier de la liste change (empreinte vérifiée par les tests,
// recalculée par tests/outils/version_hors_ligne.mjs). La nouvelle version attend ; la page propose « Mettre à
// jour » et ne recharge qu'après ce geste ; l'ancien cache est alors effacé (y compris celui de l'ancien web/sw.js).
const VERSION = '1.2-537b39dc55cb';
const CACHE = `checkmypay-${VERSION}`;
const PREFIXES = ['checkmypay-', 'controle-paie-']; // controle-paie- : caches de l'ancien web/sw.js (v1)

// Chemins relatifs à ce fichier (racine du site). Liste vérifiée par les tests : tout ce que le site charge y est.
const FICHIERS = [
  'index.html',
  'web/verifier.html',
  'web/verifier.css',
  'web/verifier.js',
  'web/avis_config.js',
  'web/vendor/goatcounter_count.v4.js',
  'web/manifest.webmanifest',
  'web/icone.svg',
  'web/reglages_collegues.json',
  'web/exemples/exemple_page.json',
  'web/exemples/fiche_fictive.js',
  'web/exemples/humanforce_fictif.txt',
  'web/pdfjs/pdf.mjs',
  'web/pdfjs/pdf.worker.mjs',
  'donnees_publiques/taux_MA000009_2026-07-01.json',
  'formats/humanforce/liste_a.json',
  'formats/paie/format_a.json',
  'regles/au/ma000009/2026-07-01.json',
  'regles/rapprochement.json',
  'src/affichage.js',
  'src/argent.js',
  'src/banque.js',
  'src/classer.js',
  'src/collegues_pur.js',
  'src/fiche_pdf_pur.js',
  'src/fiche_page_pur.js',
  'src/heures.js',
  'src/humanforce_pur.js',
  'src/moteur_pur.js',
  'src/rapprocher.js',
  'src/regles_pur.js',
  'src/temps.js',
  'src/valoriser.js',
];
const RACINE = new URL('./', self.location.href).href;
const ACCUEIL = new URL('index.html', RACINE).href;
const ADRESSES = new Set(FICHIERS.map((f) => new URL(f, RACINE).href));

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' })))));
  // Pas de skipWaiting ici : une nouvelle version attend le geste « Mettre à jour » (jamais de mélange de versions).
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (PREFIXES.some((p) => k.startsWith(p)) && k !== CACHE) await caches.delete(k);
    await self.clients.claim(); // première visite : la page ouverte marche hors ligne sans recharger
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'mettre-a-jour') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return; // envois (avis) : jamais touchés, jamais gardés
  const url = new URL(e.request.url);
  url.search = ''; // « verifier.html?lang=fr » est la même page
  url.hash = '';
  const cle = url.href === RACINE ? ACCUEIL : url.href; // « / » = index.html
  if (!ADRESSES.has(cle)) return; // tout le reste : comme sans ce fichier
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    return (await c.match(cle)) ?? fetch(e.request);
  })());
});
