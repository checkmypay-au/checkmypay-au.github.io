// Hors ligne (cycle 4) : met en cache UNIQUEMENT les fichiers de la page, tous sur la même origine (127.0.0.1).
// Rien d'autre n'est mis en cache : ni fiche, ni liste Humanforce, ni réponse d'un autre site (il n'y en a pas).
// Mise à jour propre : VERSION change dès qu'un fichier de la liste change (empreinte vérifiée par les tests,
// recalculée par tests/outils/version_hors_ligne.mjs). La nouvelle version attend ; la page propose « Mettre à
// jour » et ne recharge qu'après ce geste ; l'ancien cache est alors effacé.
const VERSION = '0.26-b4b9e26e31bf';
const CACHE = `controle-paie-${VERSION}`;
const PREFIXE = 'controle-paie-';

// Chemins relatifs à ce fichier (web/sw.js). Liste vérifiée par les tests : tout ce que la page charge y est.
const FICHIERS = [
  'verifier.html',
  'verifier.css',
  'verifier.js',
  'manifest.webmanifest',
  'icone.svg',
  'reglages_collegues.json',
  'exemples/exemple_page.json',
  'exemples/fiche_fictive.js',
  'exemples/humanforce_fictif.txt',
  'pdfjs/pdf.mjs',
  'pdfjs/pdf.worker.mjs',
  '../donnees_publiques/taux_MA000009_2026-07-01.json',
  '../formats/humanforce/liste_a.json',
  '../formats/paie/format_a.json',
  '../regles/au/ma000009/2026-07-01.json',
  '../regles/rapprochement.json',
  '../src/affichage.js',
  '../src/argent.js',
  '../src/banque.js',
  '../src/classer.js',
  '../src/collegues_pur.js',
  '../src/fiche_pdf_pur.js',
  '../src/fiche_page_pur.js',
  '../src/heures.js',
  '../src/humanforce_pur.js',
  '../src/moteur_pur.js',
  '../src/rapprocher.js',
  '../src/regles_pur.js',
  '../src/temps.js',
  '../src/valoriser.js',
];
const ADRESSES = new Set(FICHIERS.map((f) => new URL(f, self.location.href).href));

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' })))));
  // Pas de skipWaiting ici : une nouvelle version attend le geste « Mettre à jour » (jamais de mélange de versions).
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIXE) && k !== CACHE) await caches.delete(k);
    await self.clients.claim(); // première visite : la page ouverte marche hors ligne sans recharger
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'mettre-a-jour') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  url.search = ''; // « verifier.html?lang=fr » est la même page
  if (e.request.method !== 'GET' || !ADRESSES.has(url.href)) return; // tout le reste : comme sans ce fichier
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    return (await c.match(url.href)) ?? fetch(e.request);
  })());
});
