// 재생 제어: 재생/토글/이전·다음/스킵/배속/seek 드래그/미디어세션/오디오 이벤트

import {
    state,
    getPlayingList,
    getPlayingEpisode,
    getProgress,
    clearProgress,
    saveCurrentProgress
} from './store.js';
import { getSource } from './sources.js';
import { UI } from './dom.js';
import { CONFIG } from './config.js';
import { clamp, guessImageMime, formatDate } from './util.js';
import {
    renderPodcasts,
    updateRowStates,
    showPlayerControls,
    showError,
    setBuffering,
    updateProgressUI
} from './ui.js';

/** 목록에서 클릭 시 호출. index는 활성(브라우징) 소스 목록 기준. */
export async function playPodcast(index) {
    if (index < 0 || index >= (state.cache[state.activeSourceId] || []).length) {
        console.warn('Invalid episode index:', index);
        return;
    }
    await playEpisodeAt(state.activeSourceId, index);
}

/**
 * 특정 소스의 index 회차를 재생. 이전/다음·자동 다음재생도 재생 소스를 기준으로 이 함수를 호출한다.
 */
export async function playEpisodeAt(sourceId, index) {
    const list = state.cache[sourceId] || [];
    if (index < 0 || index >= list.length) return;

    // 같은 회차를 다시 누르면 재생/일시정지 토글
    if (sourceId === state.playingSourceId && index === state.playingIndex) {
        await togglePlayback();
        return;
    }

    const episode = list[index];
    if (!episode.audioUrl) {
        showError('오디오 URL이 없습니다.');
        return;
    }

    // 다른 회차로 넘어가기 전에 지금까지 듣던 회차 위치를 저장(이어듣기 정확도)
    saveCurrentProgress();

    state.playingSourceId = sourceId;
    state.playingIndex = index;
    updateRowStates();

    // 하단 바를 즉시 표시(프로그램/일자) + 진행 상태 초기화 + 버퍼링 스피너
    showPlayerControls(episode);
    updateProgressUI(0, 0, 0);
    setBuffering(true);

    // 이어듣기: src 설정 직후 currentTime 세팅은 메타데이터 로드 전이라 무시됨.
    // loadedmetadata 시점에 1회성 seek, 그 사이 회차가 바뀌면(loadToken) 적용하지 않는다.
    const token = ++state.loadToken;
    const savedProgress = getProgress(episode);
    const resumeTime =
        savedProgress && savedProgress.currentTime > CONFIG.MIN_RESUME_TIME
            ? savedProgress.currentTime
            : 0;

    if (resumeTime > 0) {
        UI.audioPlayer.addEventListener(
            'loadedmetadata',
            () => {
                if (token !== state.loadToken) return;
                if (UI.audioPlayer.duration && resumeTime < UI.audioPlayer.duration - 1) {
                    UI.audioPlayer.currentTime = resumeTime;
                }
            },
            { once: true }
        );
    }

    UI.audioPlayer.src = episode.audioUrl;
    updateMediaMetadata(episode);

    try {
        await UI.audioPlayer.play();
        UI.audioPlayer.playbackRate = state.currentSpeed;
    } catch (error) {
        // 빠른 전환으로 play()가 새 load에 의해 중단되는 것은 정상 동작 → 조용히 무시
        if (error.name === 'AbortError') return;
        console.error('Play error:', error);
        setBuffering(false);
        showError(`재생할 수 없습니다: ${error.message}`, () => playEpisodeAt(sourceId, index));
        updateRowStates();
    }
}

export async function togglePlayback() {
    try {
        if (UI.audioPlayer.paused) {
            await UI.audioPlayer.play();
        } else {
            UI.audioPlayer.pause();
        }
        updateRowStates();
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Toggle playback error:', error);
        showError(`재생 오류: ${error.message}`);
    }
}

export async function playPrevious() {
    // 재생 중인 소스 목록 기준. 목록은 최신순이라 이전(=더 과거) 회차 = index + 1
    if (state.playingSourceId == null) return;
    const target = state.playingIndex + 1;
    if (target >= 0 && target < getPlayingList().length) {
        await playEpisodeAt(state.playingSourceId, target);
    }
}

export async function playNext() {
    // 다음(=더 최신) 회차 = index - 1
    if (state.playingSourceId == null) return;
    const target = state.playingIndex - 1;
    if (target >= 0 && target < getPlayingList().length) {
        await playEpisodeAt(state.playingSourceId, target);
    }
}

/** 현재 위치에서 delta초 만큼 스킵 (음수=되감기) */
export function skipBy(delta) {
    const { duration } = UI.audioPlayer;
    if (!duration) return;
    UI.audioPlayer.currentTime = clamp(UI.audioPlayer.currentTime + delta, 0, duration);
    saveCurrentProgress();
    updateProgressUI(UI.audioPlayer.currentTime / duration, UI.audioPlayer.currentTime, duration);
}

export function toggleSpeed() {
    let idx = CONFIG.SPEEDS.indexOf(state.currentSpeed);
    idx = (idx + 1) % CONFIG.SPEEDS.length;
    state.currentSpeed = CONFIG.SPEEDS[idx];
    UI.audioPlayer.playbackRate = state.currentSpeed;
    UI.speedBtn.textContent = state.currentSpeed + 'x';
    try {
        localStorage.setItem(CONFIG.SPEED_KEY, String(state.currentSpeed));
    } catch (e) {
        /* localStorage 사용 불가 시 무시 */
    }
}

// --- MediaSession ---

function updateMediaMetadata(episode) {
    if (!('mediaSession' in navigator)) return;
    const source = getSource(episode.sourceId);
    const artwork = episode.artwork
        ? [{ src: episode.artwork, sizes: '512x512', type: guessImageMime(episode.artwork) }]
        : [{ src: 'icon.png', sizes: '512x512', type: 'image/png' }];

    navigator.mediaSession.metadata = new MediaMetadata({
        title: source ? source.label : '아침뉴스',
        artist: formatDate(episode.dateISO),
        album: episode.title || '아침뉴스',
        artwork
    });
}

function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const set = (action, handler) => {
        try {
            navigator.mediaSession.setActionHandler(action, handler);
        } catch (e) {
            /* 미지원 액션 무시 */
        }
    };
    set('play', () => UI.audioPlayer.play().catch((e) => console.error(e)));
    set('pause', () => UI.audioPlayer.pause());
    set('previoustrack', () => playPrevious().catch((e) => console.error(e)));
    set('nexttrack', () => playNext().catch((e) => console.error(e)));
    set('seekbackward', () => skipBy(-CONFIG.SKIP_SECONDS));
    set('seekforward', () => skipBy(CONFIG.SKIP_SECONDS));
    set('seekto', (d) => {
        if (d.seekTime != null && UI.audioPlayer.duration) {
            UI.audioPlayer.currentTime = d.seekTime;
        }
    });
}

// --- 오디오 이벤트 ---

function handleAudioTimeUpdate() {
    const { duration, currentTime, playbackRate } = UI.audioPlayer;
    if (!duration) return;

    if (!state.scrubbing) {
        updateProgressUI(currentTime / duration, currentTime, duration);
    }

    if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
        try {
            navigator.mediaSession.setPositionState({ duration, playbackRate, position: currentTime });
        } catch (e) {
            /* 일부 브라우저에서 예외 가능 */
        }
    }

    const now = Date.now();
    const playing = getPlayingEpisode();
    if (playing && now - state.lastSaveTime > CONFIG.PROGRESS_SAVE_INTERVAL) {
        state.lastSaveTime = now;
        saveCurrentProgress();
    }
}

async function handleAudioEnded() {
    try {
        const finished = getPlayingEpisode();
        if (finished) {
            clearProgress(finished);
        }
        // 자동 다음재생(재생 소스의 더 최신 회차). 없으면 정지.
        const nextIndex = state.playingIndex - 1;
        if (state.playingSourceId != null && nextIndex >= 0 && nextIndex < getPlayingList().length) {
            await playEpisodeAt(state.playingSourceId, nextIndex);
        } else {
            updateRowStates();
        }
        renderPodcasts();
    } catch (error) {
        console.error('Audio ended error:', error);
    }
}

function handleAudioError() {
    // 네트워크/디코드 오류 등. 재시도 버튼과 함께 안내.
    const playing = getPlayingEpisode();
    setBuffering(false);
    if (playing) {
        showError('재생 중 오류가 발생했습니다. 다시 시도해 주세요.', () =>
            playEpisodeAt(playing.sourceId, state.playingIndex)
        );
    }
}

// --- seek 바 드래그 ---

function ratioFromPointer(clientX) {
    const rect = UI.progressBar.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1);
}

function setupSeekBar() {
    const bar = UI.progressBar;

    const onMove = (e) => {
        if (!state.scrubbing) return;
        const ratio = ratioFromPointer(e.clientX);
        const dur = UI.audioPlayer.duration || 0;
        updateProgressUI(ratio, ratio * dur, dur);
    };

    const onUp = (e) => {
        if (!state.scrubbing) return;
        state.scrubbing = false;
        const dur = UI.audioPlayer.duration;
        if (dur) {
            UI.audioPlayer.currentTime = ratioFromPointer(e.clientX) * dur;
            saveCurrentProgress();
        }
    };

    bar.addEventListener('pointerdown', (e) => {
        if (!UI.audioPlayer.duration) return;
        state.scrubbing = true;
        bar.setPointerCapture(e.pointerId);
        onMove(e);
    });
    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerup', onUp);
    bar.addEventListener('pointercancel', () => {
        state.scrubbing = false;
    });
}

/** 오디오 엘리먼트 이벤트 · 미디어세션 · seek 바 · 저장 시점 이벤트를 한 번에 연결 */
export function initPlayer() {
    const audio = UI.audioPlayer;

    audio.addEventListener('timeupdate', handleAudioTimeUpdate);
    audio.addEventListener('play', updateRowStates);
    audio.addEventListener('pause', () => {
        saveCurrentProgress();
        updateRowStates();
    });
    audio.addEventListener('ended', () => {
        handleAudioEnded().catch((e) => console.error('Handle audio ended error:', e));
    });
    audio.addEventListener('error', handleAudioError);

    // 버퍼링 인디케이터
    audio.addEventListener('waiting', () => setBuffering(true));
    audio.addEventListener('stalled', () => setBuffering(true));
    audio.addEventListener('playing', () => setBuffering(false));
    audio.addEventListener('canplay', () => setBuffering(false));

    setupSeekBar();
    setupMediaSession();

    // 정지 직전 시점에 즉시 저장
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) saveCurrentProgress();
    });
    window.addEventListener('pagehide', saveCurrentProgress);
}
