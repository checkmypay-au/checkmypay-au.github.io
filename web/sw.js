// Ancien emplacement du service worker (v1, portée /web/ seulement : le site ne s'ouvrait pas hors ligne depuis « / »).
// Depuis le cycle 6b, le vrai service worker est à la racine (../sw.js). Ce fichier reste publié pour les téléphones
// qui ont encore la v1. Il ne met rien en cache, n'efface rien et ne se retire pas lui-même (relecture cycle 6b :
// sinon, sans le geste « Mettre à jour », le téléphone perdait l'ouverture hors ligne) :
// - il attend le geste « Mettre à jour » (la page v1 le propose), comme toute nouvelle version ;
// - ensuite il laisse passer les requêtes ; SANS réseau seulement, il répond avec ce qui est déjà gardé ;
// - c'est la page (une fois le service worker de la racine actif) qui retire cette inscription, et c'est le service
//   worker de la racine qui efface l'ancien cache à son activation.
self.addEventListener('message', (e) => {
  if (e.data === 'mettre-a-jour') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return; // envois : jamais touchés
  e.respondWith(fetch(e.request).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) ?? Response.error()));
});
