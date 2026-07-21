// 렌더링 · 플레이어 바 · 버퍼링/에러 표시 · 테마

import {
    state,
    getEpisodes,
    getProgress,
    getProgressPercent,
    isActiveSourcePlaying
} from './store.js';
import { SOURCES, getSource } from './sources.js';
import { UI } from './dom.js';
import { ICONS, CONFIG } from './config.js';
import { escapeHtml, formatDate, formatTime } from './util.js';

// --- 목록/탭 ---

export function renderTabs() {
    UI.tabs.innerHTML = '';
    SOURCES.forEach((source) => {
        const btn = document.createElement('button');
        btn.className = 'tab' + (source.id === state.activeSourceId ? ' active' : '');
        btn.dataset.sourceId = source.id;
        btn.textContent = source.label;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', String(source.id === state.activeSourceId));
        UI.tabs.appendChild(btn);
    });
}

export function renderPodcasts() {
    UI.podcastList.innerHTML = '';

    getEpisodes().forEach((episode, index) => {
        const li = document.createElement('li');
        li.className = 'podcast-item';
        li.dataset.index = String(index);

        const progressPercent = getProgressPercent(episode);
        const progress = getProgress(episode);

        let progressHTML = '';
        if (progressPercent > 0 && progress) {
            progressHTML = `
                <div class="episode-progress-bar">
                    <div class="episode-progress-fill" style="width: ${progressPercent}%"></div>
                </div>
                <div class="episode-progress-text">${formatTime(progress.currentTime)} / ${formatTime(progress.duration)}</div>
            `;
        }

        li.innerHTML = `
            <div class="podcast-info">
                <div class="podcast-date">${escapeHtml(formatDate(episode.dateISO))}</div>
                <div class="podcast-title">${escapeHtml(episode.title)}</div>
                ${progressHTML}
            </div>
            <button class="play-button" data-action="play" data-index="${index}" aria-label="재생">
                ${ICONS.PLAY}
            </button>
        `;

        UI.podcastList.appendChild(li);
    });

    updateRowStates();
}

/** 목록 행 + 하단 재생/일시정지 버튼을 현재 재생 상태에 맞춰 동기화 */
export function updateRowStates() {
    const items = UI.podcastList.children;
    const activePlaying = isActiveSourcePlaying();
    const playing = !UI.audioPlayer.paused;

    for (let i = 0; i < items.length; i++) {
        const li = items[i];
        const btn = li.querySelector('.play-button');
        const isThis = activePlaying && i === state.playingIndex;
        const showPause = isThis && playing;

        li.classList.toggle('playing', isThis);
        if (btn) {
            btn.innerHTML = showPause ? ICONS.PAUSE : ICONS.PLAY;
            btn.classList.toggle('playing', showPause);
            btn.setAttribute('aria-label', showPause ? '일시정지' : '재생');
        }
    }

    // 하단 바 중앙 재생/일시정지 버튼 (버퍼링 중이 아닐 때만 아이콘 반영)
    if (UI.playPauseBtn && !UI.playPauseBtn.classList.contains('buffering')) {
        UI.playPauseBtn.innerHTML = playing ? ICONS.PAUSE : ICONS.PLAY;
        UI.playPauseBtn.setAttribute('aria-label', playing ? '일시정지' : '재생');
    }
}

// --- 플레이어 바 ---

export function showPlayerControls(episode) {
    UI.playerControls.classList.add('active');
    updatePlayerBar(episode);
    document.body.style.paddingBottom = `${UI.playerControls.offsetHeight + 20}px`;
}

export function updatePlayerBar(episode) {
    const source = getSource(episode.sourceId);
    UI.currentProgram.textContent = source ? source.label : '아침뉴스';
    UI.currentDate.textContent = formatDate(episode.dateISO);
}

/** 버퍼링(로딩) 상태 표시 — 중앙 버튼에 스피너 */
export function setBuffering(isBuffering) {
    if (!UI.playPauseBtn) return;
    UI.playPauseBtn.classList.toggle('buffering', isBuffering);
    if (!isBuffering) {
        // 스피너 해제 후 현재 재생상태 아이콘 복원
        updateRowStates();
    }
}

/** 진행바/썸 위치 갱신 (0~1 비율). 드래그 중이 아닐 때만 시간 표시도 갱신 */
export function updateProgressUI(ratio, currentTime, duration) {
    const pct = Math.min(100, Math.max(0, ratio * 100));
    UI.progressFill.style.width = `${pct}%`;
    if (UI.progressThumb) UI.progressThumb.style.left = `${pct}%`;
    if (currentTime != null && duration != null) {
        UI.timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }
}

// --- 에러 ---

export function showError(message, retryFn) {
    UI.errorMessage.textContent = message;
    UI.error.style.display = 'flex';
    if (retryFn) {
        UI.errorRetry.style.display = 'inline-block';
        UI.errorRetry.onclick = retryFn;
    } else {
        UI.errorRetry.style.display = 'none';
        UI.errorRetry.onclick = null;
    }
}

export function clearError() {
    UI.error.style.display = 'none';
}

// --- 테마(다크모드) ---

/** 저장된 선택 > 시스템 설정 순으로 테마 적용 */
export function initTheme() {
    const saved = localStorage.getItem(CONFIG.THEME_KEY);
    if (saved === 'dark' || saved === 'light') {
        applyTheme(saved);
    } else {
        // 저장값 없으면 시스템 추종 (data-theme 미설정 → CSS의 prefers-color-scheme가 담당)
        document.documentElement.removeAttribute('data-theme');
        updateThemeButton(currentTheme());
    }
}

export function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(CONFIG.THEME_KEY, next);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeButton(theme);
}

/** 현재 유효 테마 (명시 설정 없으면 시스템 값) */
function currentTheme() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr) return attr;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateThemeButton(theme) {
    if (!UI.themeBtn) return;
    UI.themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
    UI.themeBtn.setAttribute('aria-label', theme === 'dark' ? '라이트 모드' : '다크 모드');
}

export function updateSpeedLabel() {
    UI.speedBtn.textContent = state.currentSpeed + 'x';
}
