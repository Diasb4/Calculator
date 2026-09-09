// Service Worker для GradeMaster PWA
// Обеспечивает кэширование статических ресурсов и работу в автономном режиме (Offline)

const CACHE_NAME = 'grademaster-v1';

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

    // Стратегия: Cache First с обновлением из сети для статических файлов GradeMaster
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                // Фоновое обновление кэша (Stale-while-revalidate)
                fetch(request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, networkResponse.clone());
                        });
                    }
                }).catch(() => {
                    // Игнорируем сетевые сбои в оффлайн режиме
                });
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
            }).catch(() => {
                // Если запрос навигации и сети нет, возвращаем fallback из кэша
                if (request.mode === 'navigate') {
                    return caches.match('./index.html') || caches.match('/index.html');
                }
            });
        })
    );
});
