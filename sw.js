// Service Worker для GradeMaster PWA
// Обеспечивает кэширование статических ресурсов и работу в автономном режиме (Offline)

const CACHE_NAME = 'grademaster-v2';

const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icons/icon-192.svg',
    './icons/icon-512.svg',
    './style/style.css',
    './style/navbarResponsive.css',
    './style/styleForTotal.css',
    './style/styleForGPA.css',
    './style/styleForCumulative.css',
    './style/styleForAtt.css',
    './style/styleForTempl.css',
    './style/styleForFeedback.css',
    './js/language.js',
    './js/localization.js',
    './js/main.js',
    './js/total.js',
    './js/gpa.js',
    './js/cumulative.js',
    './js/att.js',
    './js/template.js',
    './js/feedback.js',
    './main/TotalCalculator.html',
    './main/CalculatorGPA.html',
    './main/CumulativeGPA.html',
    './main/ManyTrimCalc.html',
    './main/AttendanceCalculator.html',
    './main/templated_calculator.html',
    './main/Feedback.html'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Не перехватываем POST-запросы и API эндпоинты
    if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
        return;
    }

    // Network-First для стилей, скриптов и HTML страниц (всегда свежий код и дизайн)
    if (
        request.mode === 'navigate' ||
        request.destination === 'style' ||
        request.destination === 'script' ||
        request.destination === 'document' ||
        /\.(css|js|html)$/i.test(url.pathname)
    ) {
        event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseToCache);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Cache-First для статических медиаресурсов (SVG, иконки)
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(request, responseToCache);
                });
                return networkResponse;
            });
        })
    );
});
