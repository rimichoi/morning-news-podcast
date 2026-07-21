// 앱 상태 + 파생 getter + 진행률(이어듣기) 저장/복원

import { SOURCES } from './sources.js';
import { CONFIG } from './config.js';
import { UI } from './dom.js';

export const state = {
    // 사용자가 보고 있는 탭(브라우징)
    activeSourceId: SOURCES[0].id,
    /** @type {Object<string, import('./sources.js').Episode[]>} 소스별 목록 캐시 */
    cache: {},
    // 실제 재생 중인 회차(브라우징 탭과 독립 추적)
    playingSourceId: null,
    playingIndex: -1,
    currentSpeed: CONFIG.DEFAULT_SPEED,
    lastSaveTime: 0,
    /** @type {Object<string, boolean>} 소스별 로딩 진행 여부 (탭 빠른 전환 race 방지) */
    inFlight: {},
    // rapid 전환 시 이전 loadedmetadata seek가 새 회차에 적용되는 것을 방지
    loadToken: 0,
    // seek 바 드래그 중 여부 (timeupdate가 UI를 덮어쓰지 않도록)
    scrubbing: false
};

/** 현재 활성(브라우징) 소스의 Episode 목록 */
export function getEpisodes() {
    return state.cache[state.activeSourceId] || [];
}

/** 재생 중인 소스의 Episode 목록 */
export function getPlayingList() {
    return state.playingSourceId ? state.cache[state.playingSourceId] || [] : [];
}

/** 재생 중인 Episode */
export function getPlayingEpisode() {
    const list = getPlayingList();
    return state.playingIndex >= 0 && state.playingIndex < list.length
        ? list[state.playingIndex]
        : null;
}

/** 활성 탭이 재생 중인 소스인지 */
export function isActiveSourcePlaying() {
    return state.playingSourceId === state.activeSourceId;
}

// --- 진행률(이어듣기) ---

/** 진행률 저장 키. 소스 id + 회차 id 로 소스 간 충돌 방지. */
function getProgressKey(episode) {
    if (!episode?.sourceId || !episode?.id) return null;
    return `progress_${episode.sourceId}_${episode.id}`;
}

export function saveProgress(episode, currentTime, duration) {
    const key = getProgressKey(episode);
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify({ currentTime, duration, timestamp: Date.now() }));
    } catch (error) {
        console.error('Save progress error:', error);
    }
}

export function getProgress(episode) {
    const key = getProgressKey(episode);
    if (!key) return null;
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('Get progress error:', error);
        return null;
    }
}

export function getProgressPercent(episode) {
    const progress = getProgress(episode);
    if (progress && progress.duration > 0) {
        return Math.min(100, (progress.currentTime / progress.duration) * 100);
    }
    return 0;
}

export function clearProgress(episode) {
    const key = getProgressKey(episode);
    if (!key) return;
    try {
        localStorage.removeItem(key);
    } catch (error) {
        console.error('Clear progress error:', error);
    }
}

/**
 * 현재 재생 중인 회차의 위치를 "즉시" 저장한다.
 * 5초 주기 저장과 별개로 일시정지·백그라운드 진입·앱 종료 등 정지 직전 시점에 호출하여
 * 정확히 그 지점부터 이어듣기가 되도록 한다.
 */
export function saveCurrentProgress() {
    const playing = getPlayingEpisode();
    const { currentTime, duration } = UI.audioPlayer;
    if (playing && duration && currentTime > 0) {
        saveProgress(playing, currentTime, duration);
        state.lastSaveTime = Date.now();
    }
}
