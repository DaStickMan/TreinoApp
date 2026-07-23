// Service Worker — cache offline do app + notificações.
// IMPORTANTE: bump CACHE_VERSION sempre que mudar arquivos do app.
const CACHE_VERSION = 'treino-v8';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/db.js',
  './js/rotacao.js',
  './js/teste.js',
  './js/exportar.js',
  './js/app.js',
  './data/plano.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// Instala: pré-carrega os arquivos essenciais no cache.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Ativa: remove caches de versões antigas.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first para GET do próprio app.
// Requisições externas (ex.: links de vídeo) passam direto pela rede.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // deixa a rede lidar

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Guarda no cache o que for buscado com sucesso.
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Offline e sem cache: para navegação, cai no index.
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'Offline' });
        });
    })
  );
});

// ---------- Notificações ----------

// Recebe mensagem da página para exibir notificação mesmo em background.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'TIMER_END') return;

  self.registration.showNotification(data.title || 'Treino', {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'timer-end',
    vibrate: [300, 100, 300],
    silent: false,
    requireInteraction: true,
  });
});

// Clique na notificação: abre ou foca o app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      // Se já tiver uma janela aberta, foca ela
      for (const client of windowClients) {
        if (client.url.includes('/') && 'focus' in client) {
          return client.focus();
        }
      }
      // Senão, abre uma nova
      if (clients.openWindow) {
        return clients.openWindow('./');
      }
    })
  );
});
