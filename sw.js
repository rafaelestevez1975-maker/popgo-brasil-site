const CACHE = 'popgo-v3';
const STATIC = [
  '/',
  '/index.html',
  '/franquia.html',
  '/assets/popgo-logo.jpg',
  '/assets/maquina-frente.png',
  '/assets/sabores.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/admin') || e.request.url.includes('/.netlify/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
    )
  );
});

// ── PUSH NOTIFICATIONS ──────────────────────────────────────────────────────
self.addEventListener('push', e => {
  const defaults = {
    title: '🍿 Novo Lead PopGo!',
    body: 'Um novo candidato acabou de se cadastrar.',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    url: '/admin.html'
  };
  let d = defaults;
  try { d = { ...defaults, ...JSON.parse(e.data.text()) }; } catch (_) {}

  e.waitUntil(
    self.registration.showNotification(d.title, {
      body: d.body,
      icon: d.icon,
      badge: d.badge,
      image: d.image || undefined,
      vibrate: [200, 100, 200, 100, 200],
      tag: 'popgo-lead',          // agrupa notificações do mesmo tipo
      renotify: true,             // vibra mesmo se já havia uma notificação igual
      requireInteraction: true,   // fica na tela até o usuário tocar (Android)
      data: { url: d.url },
      actions: [
        { action: 'open',    title: '👁 Ver lead' },
        { action: 'dismiss', title: 'Fechar' }
      ]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const url = (e.notification.data || {}).url || '/admin.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('/admin') && 'focus' in c) return c.focus();
      }
      return clients.openWindow(url);
    })
  );
});
