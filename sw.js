// ─── SERVICE WORKER · Neo Tracker ─────────────────────────────────
const CACHE = 'neo-tracker-v12';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/supabase.js', '/manifest.json'];

// Install: cache core assets
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Fetch: network first, fallback to cache
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ─── PUSH NOTIFICATIONS ───────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || 'Neo Tracker', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'neo-sale',
      data: data.url || '/',
      vibrate: [200, 100, 200],
      actions: [{ action: 'view', title: 'View dashboard' }]
    })
  );
});

// Notification click → open/focus the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length) return list[0].focus();
      return clients.openWindow(e.notification.data || '/');
    })
  );
});
