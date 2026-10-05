/* Test Maker service worker.
   Deliberately conservative so the app behaves exactly as it does without it:
   - It ONLY touches same-origin GET requests (your own files on GitHub Pages).
   - Firebase, Google sign-in, Google Drive, pdf.js (cdnjs) and analytics are cross-origin,
     so they are never intercepted and go straight to the network as before.
   - The page itself is network-first, so users always get your latest version when online;
     the cached copy is used only when offline or the network fails.
   Bump CACHE only if you change the precache list. */
const CACHE = 'testmaker-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest',
               './icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('testmaker-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // never touch third-party traffic

  if (req.mode === 'navigate') {                            // the app page: network first
    e.respondWith(
      fetch(req.url, { cache: 'no-cache' })
        .then(res => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); }
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  e.respondWith(                                            // own static files: cache, refresh in background
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
