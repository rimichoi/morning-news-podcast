// 엔트리: 초기화 · 목록 로드/소스 전환 · 이벤트 연결

import { initUI, UI } from './dom.js';
import { state } from './store.js';
import { getSource, fetchEpisodes } from './sources.js';
import { CONFIG } from './config.js';
import {
    renderTabs,
    renderPodcasts,
    showError,
    clearError,
    initTheme,
    toggleTheme,
    updateSpeedLabel
} from './ui.js';
import {
    initPlayer,
    playPodcast,
    playPrevious,
    playNext,
    skipBy,
    togglePlayback,
    toggleSpeed
} from './player.js';

/**
 * 활성 소스 목록 로드. 탭을 빠르게 전환해도 각 소스는 자신의 캐시에 저장하고,
 * UI 갱신은 완료 시점에 여전히 그 소스가 활성 탭일 때만 반영한다.
 */
async function loadPodcasts(forceReload = false) {
    const source = getSource(state.activeSourceId);
    if (!source) return;

    if (!forceReload && state.cache[source.id]) {
        renderPodcasts();
        return;
    }

    if (state.inFlight[source.id]) return;
    state.inFlight[source.id] = true;

    const isActive = () => state.activeSourceId === source.id;

    UI.loading.classList.add('active');
    clearError();
    UI.podcastList.style.opacity = '0.5';

    try {
        const episodes = await fetchEpisodes(source);
        state.cache[source.id] = episodes; // 활성 여부와 무관하게 캐시에 저장

        if (!isActive()) return; // 그 사이 다른 탭으로 이동 → 캐시만 채우고 UI는 유지

        if (episodes.length === 0) {
            UI.podcastList.innerHTML = '';
            showError('재생 가능한 방송이 없습니다.', () => loadPodcasts(true));
        } else {
            renderPodcasts();
        }
    } catch (error) {
        console.error('Load podcasts error:', error);
        if (isActive()) {
            const msg = !navigator.onLine
                ? '인터넷 연결을 확인해주세요. (오프라인)'
                : `방송을 불러오는데 실패했습니다: ${error.message}`;
            showError(msg, () => loadPodcasts(true));
        }
    } finally {
        state.inFlight[source.id] = false;
        if (isActive()) {
            UI.loading.classList.remove('active');
            UI.podcastList.style.opacity = '1';
        }
    }
}

function switchSource(sourceId) {
    if (sourceId === state.activeSourceId || !getSource(sourceId)) return;
    // 탭만 전환. 재생은 playingSourceId/playingIndex 기준으로 계속 유지된다.
    state.activeSourceId = sourceId;
    renderTabs();
    clearError();
    loadPodcasts().catch((err) => console.error('Switch source error:', err));
}

function loadPersistedSpeed() {
    const saved = parseFloat(localStorage.getItem(CONFIG.SPEED_KEY));
    if (!isNaN(saved) && CONFIG.SPEEDS.includes(saved)) {
        state.currentSpeed = saved;
    }
    updateSpeedLabel();
}

function setupEventListeners() {
    UI.tabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab');
        if (btn?.dataset.sourceId) switchSource(btn.dataset.sourceId);
    });

    UI.podcastList.addEventListener('click', (e) => {
        const btn = e.target.closest('.play-button');
        if (!btn) return;
        const index = parseInt(btn.dataset.index, 10);
        if (!isNaN(index)) playPodcast(index).catch((err) => console.error('Play error:', err));
    });

    UI.refreshBtn.addEventListener('click', () => {
        loadPodcasts(true).catch((err) => console.error('Refresh error:', err));
    });
    UI.themeBtn.addEventListener('click', toggleTheme);
    UI.speedBtn.addEventListener('click', toggleSpeed);

    UI.prevBtn.addEventListener('click', () => playPrevious().catch(logErr));
    UI.back15Btn.addEventListener('click', () => skipBy(-CONFIG.SKIP_SECONDS));
    UI.playPauseBtn.addEventListener('click', () => {
        if (state.playingSourceId != null) togglePlayback().catch(logErr);
    });
    UI.fwd15Btn.addEventListener('click', () => skipBy(CONFIG.SKIP_SECONDS));
    UI.nextBtn.addEventListener('click', () => playNext().catch(logErr));
}

function logErr(err) {
    console.error(err);
}

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
        await navigator.serviceWorker.register('./sw.js');
        console.log('Service Worker registered');
    } catch (error) {
        console.warn('Service Worker registration failed:', error);
    }
}

async function init() {
    try {
        initUI();
        initTheme();
        loadPersistedSpeed();
        renderTabs();
        setupEventListeners();
        initPlayer();
        await loadPodcasts();
        await registerServiceWorker();
    } catch (error) {
        console.error('Initialization error:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init().catch((e) => console.error(e)));
} else {
    init().catch((e) => console.error(e));
}
