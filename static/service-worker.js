// static/service-worker.js

const CACHE_NAME = "artha-cache-v5";
const OFFLINE_URL = "/static/offline.html";

const ASSETS_TO_CACHE = [
  // Offline fallback page (must be a static asset)
    OFFLINE_URL,

    // PWA
    "/static/manifest.json",
    "/static/favicon.svg",

    // Icons (match your manifest)
    "/static/icons/icon-192.png",
    "/static/icons/icon-512.png",
    "/static/icons/icon-192-maskable.png",
    "/static/icons/icon-512-maskable.png",

    // CSS
    "/static/css/style.css",
    "/static/css/toast.css",

    // Vendor (LOCAL)
    "/static/vendor/chart.umd.min.js",
    "/static/vendor/chartjs-plugin-datalabels.min.js",
    "/static/vendor/sortable.min.js",

    // JS modules
    "/static/js/init.js",
    "/static/js/flash.js",
    "/static/js/notes.js",
    "/static/js/transactions.js",
    "/static/js/calculator.js",
    "/static/js/theme.js",
    "/static/js/chart.js",
    "/static/js/widgets.js",
    "/static/js/toast.js",
    ];

    self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
    });

    self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
        Promise.all(
            keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : null))
        )
        )
    );
    self.clients.claim();
    });

    self.addEventListener("fetch", (event) => {
    // Don’t touch non-GET requests (POST/PUT/etc). Let the network handle them.
    if (event.request.method !== "GET") return;

    // Navigations: network first, fallback to offline page
    if (event.request.mode === "navigate") {
        event.respondWith(
        fetch(event.request).catch(() => caches.match(OFFLINE_URL))
        );
        return;
    }

    // Static assets: cache first, fallback to network
    event.respondWith(
        caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
});