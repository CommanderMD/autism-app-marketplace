/* Act 1 service worker (Phase 5 offline).
 *
 * Scope is the whole origin (registered from the Act 1 shell as /sw.js) but it
 * only ever answers for the Act 1 app: its shell assets, lessons, sprites and
 * scenes, the i18n files, the launch-gate page that was already opened, and
 * the two GET answers the shell needs at boot (settings, progress). Every
 * other request - the marketplace, every other API call, every POST - goes
 * straight to the network untouched.
 *
 * Strategies
 *   precached files (ASSETS)        cache-first, filled on install
 *   gate page + settings/progress   network-first, last good answer kept
 *                                   per URL (ACT1_RUNTIME)
 *   everything else                 not intercepted
 *
 * What is stored: files from this origin, plus for the runtime group the
 * gate's HTML (which carries only the child's opaque id in a meta tag) and
 * the settings/progress JSON (ids, booleans, numbers). No name is in any of
 * these, and sign-out clears every cache (public/js/session.js posts
 * 'clear'). Rule A4.
 *
 * VERSION changes on every deploy that touches a precached file; the old cache
 * is deleted on activate.
 */

const VERSION = 'act1-v5.0.0';
const PRECACHE = `${VERSION}-precache`;
const RUNTIME = `${VERSION}-runtime`;

const ASSETS = [
  // shared
  '/js/api.js', '/js/ui.js', '/js/i18n.js',
  '/i18n/en.json', '/i18n/es.json',
  // shell
  '/apps/act1/css/app.css', '/apps/act1/css/denied.css',
  '/apps/act1/js/shell.js', '/apps/act1/js/reward-player.js', '/apps/act1/js/settings-panel.js',
  '/apps/act1/js/svg-dom.js', '/apps/act1/js/companion.js', '/apps/act1/js/offline-queue.js',
  // engine
  '/apps/act1/engine/lesson.js', '/apps/act1/engine/state.js', '/apps/act1/engine/reward.js', '/apps/act1/engine/svg.js',
  // lessons
  '/apps/act1/lessons/01-shapes.js', '/apps/act1/lessons/02-numbers.js', '/apps/act1/lessons/03-nouns.js',
  '/apps/act1/lessons/04-verbs.js', '/apps/act1/lessons/05-colors.js', '/apps/act1/lessons/06-emotions.js',
  '/apps/act1/lessons/07-opposites.js', '/apps/act1/lessons/08-sequencing.js', '/apps/act1/lessons/09-prepositions.js',
  '/apps/act1/lessons/10-math.js',
  // companions and scenes
  '/img/act1/robot-01-idle.png', '/img/act1/robot-02-blink.png', '/img/act1/robot-03-speak.png',
  '/img/act1/robot-04-point.png', '/img/act1/robot-05-listen.png', '/img/act1/robot-06-nod.png',
  '/img/act1/robot-07-happy.png', '/img/act1/robot-08-cheer.png', '/img/act1/robot-09-wave.png',
  '/img/act1/owl-01-idle.png', '/img/act1/owl-02-happy.png',
  '/img/act1/otter-01-idle.png', '/img/act1/otter-02-happy.png',
  '/img/act1/scene-solar.svg', '/img/act1/scene-jungle.svg', '/img/act1/scene-speedway.svg',
];

const PRECACHED = new Set(ASSETS);
const GATE_RE = /^\/apps\/[a-z0-9-]+\/play$/;
const RUNTIME_API_RE = /^\/api\/children\/[^/]+\/(settings|progress)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== PRECACHE && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Messages from the shell:
//   { type: 'warm', urls: [...] }  the first visit happens before this worker
//                                  controls the page, so the shell asks for the
//                                  gate page and its two boot GETs to be fetched
//                                  (with the session cookie) into the runtime
//                                  cache now, not on the next visit. Only URLs
//                                  the runtime group would intercept are accepted.
//   { type: 'clear' }              sign-out: empty every cache this worker owns.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'clear') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  } else if (data.type === 'warm' && Array.isArray(data.urls)) {
    event.waitUntil(warm(data.urls));
  }
});

async function warm(urls) {
  const cache = await caches.open(RUNTIME);
  for (const raw of urls.slice(0, 5)) {
    let url;
    try { url = new URL(raw, self.location.origin); } catch { continue; }
    if (url.origin !== self.location.origin) continue;
    if (!GATE_RE.test(url.pathname) && !RUNTIME_API_RE.test(url.pathname)) continue;
    try {
      const res = await fetch(url.href, { credentials: 'include' });
      if (res.ok) await cache.put(url.href, res);
    } catch { /* offline already: nothing to warm */ }
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (PRECACHED.has(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (GATE_RE.test(url.pathname) || RUNTIME_API_RE.test(url.pathname)) {
    event.respondWith(networkFirst(req));
  }
  // anything else: not intercepted
});

async function cacheFirst(req) {
  const cache = await caches.open(PRECACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// Network first; on failure the last good answer for this exact URL. Only
// 200s are kept, so a 401/403 (signed out, grant revoked) replaces nothing
// and is shown as-is - and a revoked grant's cached page is evicted.
async function networkFirst(req) {
  const cache = await caches.open(RUNTIME);
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
    } else if (res.status === 401 || res.status === 403 || res.status === 404) {
      await cache.delete(req);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}
