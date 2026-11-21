// Sube este número cada vez que cambies archivos de la app,
// así el navegador sabe que debe reemplazar la caché vieja.
const CACHE_NAME = 'ecostan-store-v4';

const ARCHIVOS_PARA_CACHE = [
  '/',
  '/index.html',
  '/home.html',
  '/estilos.css',
  '/app.js',
  '/banners-config.js',
  '/manifest.json',
  '/logo.png',

  // core
  '/core/supabaseClient.js',
  '/core/authService.js',
  '/core/utils.js',
  '/core/navigation.js',
  '/core/notifications.js',
  '/core/views.js',

  // módulos (cada uno con su HTML, CSS y JS)
  '/modules/auth/login.html',
  '/modules/auth/auth.js',
  '/modules/collections/collections.html',
  '/modules/collections/collections.css',
  '/modules/collections/collections.js',
  '/modules/map_routing/map.html',
  '/modules/map_routing/map.css',
  '/modules/map_routing/map.js',
  '/modules/rewards/rewards.html',
  '/modules/rewards/rewards.css',
  '/modules/rewards/rewards.js',
  '/modules/education/education.html',
  '/modules/education/education.css',
  '/modules/education/education.js',
  '/modules/banners/banners.html',
  '/modules/banners/banners.css',
  '/modules/banners/banners.js'
];

/* ==========================================
   INSTALACIÓN: precarga los archivos propios
========================================== */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Si un archivo falla al cachear, no tumba la instalación
      // completa de los demás (antes cache.addAll fallaba todo o nada).
      return Promise.all(
        ARCHIVOS_PARA_CACHE.map((url) =>
          cache.add(url).catch((err) => console.warn('No se pudo cachear', url, err))
        )
      );
    }).then(() => self.skipWaiting()) // activa esta versión nueva de inmediato
  );
});

/* ==========================================
   ACTIVACIÓN: borra cachés viejas y toma el control
========================================== */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres
          .filter((nombre) => nombre !== CACHE_NAME)
          .map((nombre) => caches.delete(nombre))
      )
    ).then(() => self.clients.claim()) // controla las pestañas ya abiertas, sin esperar a que las cierren
  );
});

/* ==========================================
   FETCH: solo cachea GET de tu propio dominio.
   Todo lo demás (Supabase, Leaflet, CDNs, POST, etc.)
   pasa derecho a la red, sin que el service worker lo toque.
   Estrategia "red primero": si hay conexión siempre se usa la versión más
   reciente de tus archivos (así no dependes de acordarte de subir CACHE_NAME
   en cada cambio); la caché solo se usa cuando no hay conexión.
========================================== */
self.addEventListener('fetch', (e) => {
  const { request } = e;

  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  e.respondWith(
    fetch(request)
      .then((respuesta) => {
        if (respuesta && respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copia));
        }
        return respuesta;
      })
      .catch(() => caches.match(request))
  );
});