const CACHE_NAME = 'morning-news-v8';
const urlsToCache = [
    './index.html',
    './manifest.json',
    './cbs_icon.png',
    './styles.css',
    './app.js'
];

// 목록 API 호스트 (네트워크 우선, 실패 시 캐시)
const API_HOSTS = ['miniapi.imbc.com', 'apis.sbs.co.kr'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
    );
});

function networkFirst(request) {
    return fetch(request)
        .then((response) => {
            // 유효한 기본/CORS 응답만 캐시 (opaque/부분응답 제외)
            if (response && response.status === 200 &&
                (response.type === 'basic' || response.type === 'cors')) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
        })
        .catch(() => caches.match(request));
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const isSameOrigin = url.origin === self.location.origin;

    // 목록 API: 네트워크 우선 + 캐시 폴백
    if (API_HOSTS.includes(url.hostname)) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // 앱 리소스(동일 출처): 네트워크 우선 + 캐시 폴백
    if (isSameOrigin) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // 그 외(오디오 mp3, 외부 이미지 등)는 가로채지 않고 브라우저에 위임.
    // 오디오 range 요청(206)을 SW가 다루면 스트리밍이 깨질 수 있으므로 통과시킨다.
});

// 오래된 캐시 정리 및 즉시 제어권 획득
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});
