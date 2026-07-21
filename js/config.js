// 앱 전역 상수

export const CONFIG = {
    SPEEDS: [1.0, 1.25, 1.5, 2.0],
    PROGRESS_SAVE_INTERVAL: 5000,
    MIN_RESUME_TIME: 3,
    JSONP_CALLBACK: '__itemlist',
    JSONP_TIMEOUT: 15000,
    SKIP_SECONDS: 15,
    DEFAULT_SPEED: 1.25,
    SPEED_KEY: 'app_speed',
    THEME_KEY: 'app_theme'
};

export const ICONS = {
    PLAY: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
    PAUSE: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'
};
