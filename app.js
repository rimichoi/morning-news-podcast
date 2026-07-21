'use strict';

/**
 * @typedef {Object} Episode
 * @property {string} id - 소스 내 고유 id
 * @property {string} title - 표시 제목
 * @property {string} dateISO - 방송일 ISO 문자열 (new Date()로 안전 파싱 가능)
 * @property {string} audioUrl - 오디오 파일 URL (https)
 * @property {string} artwork - 회차/프로그램 이미지 URL
 * @property {string} sourceId - 소스 id
 */

/**
 * @typedef {Object} Progress
 * @property {number} currentTime - 현재 재생 시간
 * @property {number} duration - 전체 재생 시간
 * @property {number} timestamp - 저장된 시간
 */

// --- Source Registry -------------------------------------------------------

/**
 * 소스별 로딩 방식(JSONP/fetch)·스키마·필터 차이를 추상화한다.
 * parse(raw)는 원본을 정규화된 Episode[] 로 변환한다.
 * @typedef {Object} Source
 * @property {string} id
 * @property {string} label
 * @property {'jsonp'|'json'} type
 * @property {function(): string} buildUrl
 * @property {function(any): Episode[]} parse
 * @property {function(string): boolean} [filter] - title 기준 노출 필터
 */

/** id 필드를 안전하게 문자열화. 값이 없으면 null (진행률 키 오염 방지). */
function safeId(value) {
    return value == null || value === '' ? null : String(value);
}

/** MBC podcast API 응답 1건을 Episode로 정규화 */
function normalizeMbcItem(item, sourceId) {
    return {
        id: safeId(item.PodCastItemIdx),
        title: item.ContentTitle || '',
        dateISO: mbcDateToISO(item.BroadDate),
        audioUrl: toHttps(item.EncloserURL),
        artwork: toHttps(item.ITunesImageURL) || '',
        sourceId
    };
}

/** SBS radio-api 응답 1건을 Episode로 정규화 */
function normalizeSbsItem(item, sourceId) {
    return {
        id: safeId(item.CLIP_ID || item._id),
        title: item.CON_TITLE || '',
        dateISO: sbsDateToISO(item.BROAD_DATE),
        audioUrl: toHttps(item.S3_FILE_URL || item.UPLOAD_URL || item.FILE_URL),
        artwork: toHttps(item.ITUNES_IMAGE) || '',
        sourceId
    };
}

/** "YYYY-MM-DD HH:mm:ss" -> ISO. 실패 시 원본 반환 */
function mbcDateToISO(str) {
    if (!str) return '';
    // "2026-07-21 08:30:00" → "2026-07-21T08:30:00"
    const iso = str.trim().replace(' ', 'T');
    const d = new Date(iso);
    return isNaN(d.getTime()) ? str : iso;
}

/** "YYYYMMDD" -> ISO 자정. 실패 시 원본 반환 */
function sbsDateToISO(str) {
    if (!str || !/^\d{8}$/.test(str)) return str || '';
    const y = str.slice(0, 4);
    const m = str.slice(4, 6);
    const day = str.slice(6, 8);
    return `${y}-${m}-${day}T00:00:00`;
}

const SOURCES = [
    {
        id: 'mbc-sisun',
        label: '시선집중',
        type: 'jsonp',
        buildUrl: () =>
            'https://miniapi.imbc.com/podcast/itemlist?bid=1000674100000100000&page=1&pagesize=50&callback=__itemlist',
        parse: (raw) => (raw?.Itemlist || []).map((i) => normalizeMbcItem(i, 'mbc-sisun')),
        // 평일 07:05 "1부 [JB TIMES]" 회차만. 피드에는 2부/3부/6분집중 등이 섞여 있음.
        filter: (title) => /1부/.test(title)
    },
    {
        id: 'mbc-morning',
        label: '아침&뉴스',
        type: 'jsonp',
        buildUrl: () =>
            'https://miniapi.imbc.com/podcast/itemlist?bid=1003824100000100000&page=1&pagesize=10&callback=__itemlist',
        parse: (raw) => (raw?.Itemlist || []).map((i) => normalizeMbcItem(i, 'mbc-morning'))
    },
    {
        id: 'sbs-gonewbeu',
        label: '헤이 고뉴브',
        type: 'json',
        buildUrl: () =>
            // 전체 40건을 받아 '헤이 고뉴브' 코너만 필터링하면 약 10건이 나온다.
            'https://apis.sbs.co.kr/radio-api/podcast/podcast_list_json?vod_id=V2000010540&page=1&item_per_page=40&sortNew=1&keyword=',
        parse: (raw) => (raw?.data || []).map((i) => normalizeSbsItem(i, 'sbs-gonewbeu')),
        // 풀버전/스포츠/경제 코너 제외, 대괄호 표기 헤이 고뉴브만.
        filter: (title) => /\[헤이 고뉴브\]/.test(title)
    }
];

function getSource(sourceId) {
    return SOURCES.find((s) => s.id === sourceId) || null;
}

// --- Constants & Configuration ---------------------------------------------

const CONFIG = {
    SPEEDS: [1.0, 1.25, 1.5, 2.0],
    PROGRESS_SAVE_INTERVAL: 5000,
    MIN_RESUME_TIME: 3,
    JSONP_CALLBACK: '__itemlist',
    JSONP_TIMEOUT: 15000
};

const ICONS = {
    PLAY: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
    PAUSE: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'
};

// --- Application State ------------------------------------------------------

const state = {
    // 사용자가 보고 있는 탭(브라우징)
    activeSourceId: SOURCES[0].id,
    /** @type {Object<string, Episode[]>} 소스별 목록 캐시 */
    cache: {},
    // 실제 재생 중인 회차(브라우징 탭과 독립적으로 추적).
    // 탭을 바꿔도 재생·진행률 저장·이전/다음은 이 값을 기준으로 동작한다.
    playingSourceId: null,
    playingIndex: -1,
    currentSpeed: 1.25,
    lastSaveTime: 0,
    /** @type {Object<string, boolean>} 소스별 로딩 진행 여부 (탭 빠른 전환 race 방지) */
    inFlight: {},
    // 빠르게 회차를 전환할 때 이전 loadedmetadata seek가 새 소스에 적용되는 것을 방지
    loadToken: 0
};

/** 현재 활성(브라우징) 소스의 Episode 목록 */
function getEpisodes() {
    return state.cache[state.activeSourceId] || [];
}

/** 재생 중인 소스의 Episode 목록 */
function getPlayingList() {
    return state.playingSourceId ? state.cache[state.playingSourceId] || [] : [];
}

/** 재생 중인 Episode */
function getPlayingEpisode() {
    const list = getPlayingList();
    return state.playingIndex >= 0 && state.playingIndex < list.length
        ? list[state.playingIndex]
        : null;
}

// --- DOM Elements Cache -----------------------------------------------------

let UI = null;

function initUI() {
    UI = {
        loading: document.getElementById('loading'),
        error: document.getElementById('error'),
        tabs: document.getElementById('tabs'),
        podcastList: document.getElementById('podcastList'),
        audioPlayer: document.getElementById('audioPlayer'),
        playerControls: document.getElementById('playerControls'),
        progressFill: document.getElementById('progressFill'),
        progressBar: document.getElementById('progressBar'),
        timeDisplay: document.getElementById('timeDisplay'),
        currentDate: document.getElementById('currentDate'),
        speedBtn: document.getElementById('speedBtn'),
        refreshBtn: document.getElementById('refreshBtn'),
        prevBtn: document.getElementById('prevBtn'),
        nextBtn: document.getElementById('nextBtn')
    };
}

// --- Loaders ---------------------------------------------------------------

/** JSONP 로더: <script> 주입 + 전역 콜백. MBC 처럼 CORS 미허용 API용. */
function loadJsonp(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        let done = false;

        const cleanup = () => {
            delete window[CONFIG.JSONP_CALLBACK];
            script.remove();
            clearTimeout(timer);
        };

        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            cleanup();
            reject(new Error('요청 시간이 초과되었습니다.'));
        }, CONFIG.JSONP_TIMEOUT);

        window[CONFIG.JSONP_CALLBACK] = (data) => {
            if (done) return;
            done = true;
            cleanup();
            resolve(data);
        };

        script.onerror = () => {
            if (done) return;
            done = true;
            cleanup();
            reject(new Error('스크립트를 불러오지 못했습니다.'));
        };

        script.src = url;
        document.head.appendChild(script);
    });
}

/** fetch(JSON) 로더: SBS 처럼 CORS 허용 API용. */
async function loadJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

/** 소스 원본을 로드하여 정규화·필터링된 Episode[] 반환 */
async function fetchEpisodes(source) {
    const url = source.buildUrl();
    const raw = source.type === 'jsonp' ? await loadJsonp(url) : await loadJson(url);
    let episodes = source.parse(raw);
    if (source.filter) {
        episodes = episodes.filter((ep) => source.filter(ep.title));
    }
    return episodes.filter((ep) => ep.audioUrl);
}

// --- Core Logic ------------------------------------------------------------

/**
 * 활성 소스 목록 로드.
 * 탭을 빠르게 전환해도 각 소스는 자신의 캐시에 저장하고, UI 갱신은 로드 완료 시점에
 * 여전히 그 소스가 활성 탭일 때만 반영한다(다른 탭으로 넘어갔으면 조용히 캐시만 채움).
 * @param {boolean} [forceReload] 캐시 무시하고 강제 갱신
 */
async function loadPodcasts(forceReload = false) {
    const source = getSource(state.activeSourceId);
    if (!source) return;

    // 캐시가 있으면 즉시 렌더 (강제 갱신 아닐 때)
    if (!forceReload && state.cache[source.id]) {
        renderPodcasts();
        return;
    }

    // 같은 소스의 중복 로드만 방지 (다른 소스는 동시에 로드 가능)
    if (state.inFlight[source.id]) return;
    state.inFlight[source.id] = true;

    const isActive = () => state.activeSourceId === source.id;

    UI.loading.classList.add('active');
    UI.error.style.display = 'none';
    UI.podcastList.style.opacity = '0.5';

    try {
        const episodes = await fetchEpisodes(source);
        state.cache[source.id] = episodes; // 활성 여부와 무관하게 캐시에 저장

        if (!isActive()) return; // 그 사이 다른 탭으로 이동 → 캐시만 채우고 UI는 건드리지 않음

        if (episodes.length === 0) {
            UI.podcastList.innerHTML = '';
            showError('재생 가능한 방송이 없습니다.');
        } else {
            renderPodcasts();
        }
    } catch (error) {
        console.error('Load podcasts error:', error);
        if (isActive()) {
            if (!navigator.onLine) {
                showError('인터넷 연결을 확인해주세요. (오프라인)');
            } else {
                showError(`방송을 불러오는데 실패했습니다: ${error.message}`);
            }
        }
    } finally {
        state.inFlight[source.id] = false;
        if (isActive()) {
            UI.loading.classList.remove('active');
            UI.podcastList.style.opacity = '1';
        }
    }
}

function renderTabs() {
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

function switchSource(sourceId) {
    if (sourceId === state.activeSourceId || !getSource(sourceId)) return;

    // 탭만 전환한다. 재생은 playingSourceId/playingIndex 기준으로 계속 유지되고,
    // 목록 하이라이트는 renderPodcasts가 재생 소스와 활성 탭이 같을 때만 표시한다.
    state.activeSourceId = sourceId;

    renderTabs();
    UI.error.style.display = 'none';
    loadPodcasts().catch((err) => console.error('Switch source error:', err));
}

/** 활성 탭이 재생 중인 소스인지 */
function isActiveSourcePlaying() {
    return state.playingSourceId === state.activeSourceId;
}

function renderPodcasts() {
    UI.podcastList.innerHTML = '';
    const episodes = getEpisodes();

    episodes.forEach((episode, index) => {
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

/** 렌더된 목록 행들의 재생 하이라이트·버튼 아이콘을 현재 재생 상태에 맞춰 동기화 */
function updateRowStates() {
    const items = UI.podcastList.children;
    const activePlaying = isActiveSourcePlaying();

    for (let i = 0; i < items.length; i++) {
        const li = items[i];
        const btn = li.querySelector('.play-button');
        const isThis = activePlaying && i === state.playingIndex;
        const showPause = isThis && !UI.audioPlayer.paused;

        li.classList.toggle('playing', isThis);
        if (btn) {
            btn.innerHTML = showPause ? ICONS.PAUSE : ICONS.PLAY;
            btn.classList.toggle('playing', showPause);
            btn.setAttribute('aria-label', showPause ? '일시정지' : '재생');
        }
    }
}

/** 목록에서 클릭 시 호출. index는 활성(브라우징) 소스 목록 기준. */
async function playPodcast(index) {
    if (!isValidIndex(index)) {
        console.warn('Invalid episode index:', index);
        return;
    }
    await playEpisodeAt(state.activeSourceId, index);
}

/**
 * 특정 소스의 index 회차를 재생. 이전/다음·자동 다음재생도 재생 소스를 기준으로 이 함수를 호출한다.
 * @param {string} sourceId
 * @param {number} index
 */
async function playEpisodeAt(sourceId, index) {
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

    // 이어듣기: src 설정 직후 currentTime을 세팅하면 메타데이터 로드 전이라 무시된다.
    // loadedmetadata 시점에 1회성으로 seek 하고, 그 사이 회차가 바뀌면(loadToken) 적용하지 않는다.
    const token = ++state.loadToken;
    const savedProgress = getProgress(episode);
    const resumeTime =
        savedProgress && savedProgress.currentTime > CONFIG.MIN_RESUME_TIME
            ? savedProgress.currentTime
            : 0;

    if (resumeTime > 0) {
        const seekOnce = () => {
            if (token !== state.loadToken) return; // 그 사이 다른 회차로 전환됨
            if (UI.audioPlayer.duration && resumeTime < UI.audioPlayer.duration - 1) {
                UI.audioPlayer.currentTime = resumeTime;
            }
        };
        UI.audioPlayer.addEventListener('loadedmetadata', seekOnce, { once: true });
    }

    UI.audioPlayer.src = episode.audioUrl;

    try {
        await UI.audioPlayer.play();
        UI.audioPlayer.playbackRate = state.currentSpeed;
        showPlayerControls(episode);
    } catch (error) {
        // 빠른 전환으로 play()가 새 load에 의해 중단되는 것은 정상 동작이므로 조용히 무시
        if (error.name === 'AbortError') return;
        console.error('Play error:', error);
        showError(`재생할 수 없습니다: ${error.message}`);
        updateRowStates();
    }
}

function showPlayerControls(episode) {
    UI.playerControls.classList.add('active');
    UI.currentDate.textContent = formatDate(episode.dateISO);
    document.body.style.paddingBottom = `${UI.playerControls.offsetHeight + 20}px`;
    updateMediaSession(episode);
}

function updateMediaSession(episode) {
    if (!('mediaSession' in navigator)) return;

    const source = getSource(episode.sourceId);
    const artwork = episode.artwork
        ? [{ src: episode.artwork, sizes: '512x512', type: guessImageMime(episode.artwork) }]
        : [{ src: 'cbs_icon.png', sizes: '512x512', type: 'image/png' }];

    navigator.mediaSession.metadata = new MediaMetadata({
        title: source ? source.label : '아침뉴스',
        artist: formatDate(episode.dateISO),
        album: episode.title || '아침뉴스',
        artwork
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
        playPrevious().catch((err) => console.error('Media session previous error:', err));
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
        playNext().catch((err) => console.error('Media session next error:', err));
    });

    navigator.mediaSession.setActionHandler('play', () => {
        UI.audioPlayer.play().catch((err) => console.error('Media session play error:', err));
    });

    navigator.mediaSession.setActionHandler('pause', () => {
        UI.audioPlayer.pause();
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime && UI.audioPlayer.duration) {
            UI.audioPlayer.currentTime = details.seekTime;
        }
    });
}

function toHttps(url) {
    if (!url) return null;
    return url.startsWith('http:') ? url.replace('http:', 'https:') : url;
}

/** 이미지 URL 확장자로 MIME 타입 추정 (MediaSession artwork용) */
function guessImageMime(url) {
    const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    return 'image/jpeg';
}

function isValidIndex(index) {
    return index >= 0 && index < getEpisodes().length;
}

async function togglePlayback() {
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

function toggleSpeed() {
    let idx = CONFIG.SPEEDS.indexOf(state.currentSpeed);
    idx = (idx + 1) % CONFIG.SPEEDS.length;
    state.currentSpeed = CONFIG.SPEEDS[idx];

    UI.speedBtn.textContent = state.currentSpeed + 'x';
    UI.audioPlayer.playbackRate = state.currentSpeed;
}

async function playPrevious() {
    // 재생 중인 소스 목록 기준. 목록은 최신순(내림차순)이라 이전(=더 과거) 회차 = index + 1
    if (state.playingSourceId == null) return;
    const target = state.playingIndex + 1;
    if (target >= 0 && target < getPlayingList().length) {
        await playEpisodeAt(state.playingSourceId, target);
    }
}

async function playNext() {
    // 다음(=더 최신) 회차 = index - 1
    if (state.playingSourceId == null) return;
    const target = state.playingIndex - 1;
    if (target >= 0 && target < getPlayingList().length) {
        await playEpisodeAt(state.playingSourceId, target);
    }
}

// --- Progress Tracking -----------------------------------------------------

/** 진행률 저장 키. 소스 id + 회차 id 로 소스 간 충돌 방지. */
function getProgressKey(episode) {
    if (!episode?.sourceId || !episode?.id) {
        return null;
    }
    return `progress_${episode.sourceId}_${episode.id}`;
}

function saveProgress(episode, currentTime, duration) {
    const key = getProgressKey(episode);
    if (!key) return;

    try {
        const data = { currentTime, duration, timestamp: Date.now() };
        localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
        console.error('Save progress error:', error);
    }
}

/**
 * 현재 재생 중인 회차의 위치를 "즉시" 저장한다.
 * 5초 주기 저장과 별개로 일시정지·백그라운드 진입·앱 종료 등 정지 직전 시점에 호출하여
 * 정확히 그 지점부터 이어듣기가 되도록 한다.
 */
function saveCurrentProgress() {
    const playing = getPlayingEpisode();
    const { currentTime, duration } = UI.audioPlayer;
    if (playing && duration && currentTime > 0) {
        saveProgress(playing, currentTime, duration);
        state.lastSaveTime = Date.now();
    }
}

function getProgress(episode) {
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

function getProgressPercent(episode) {
    const progress = getProgress(episode);
    if (progress && progress.duration > 0) {
        return Math.min(100, (progress.currentTime / progress.duration) * 100);
    }
    return 0;
}

function clearProgress(episode) {
    const key = getProgressKey(episode);
    if (!key) return;

    try {
        localStorage.removeItem(key);
    } catch (error) {
        console.error('Clear progress error:', error);
    }
}

// --- Helpers ---------------------------------------------------------------

function showError(message) {
    UI.error.textContent = message;
    UI.error.style.display = 'block';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr || '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${year}.${month}.${day}(${days[date.getDay()]})`;
}

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

// --- Event Handlers --------------------------------------------------------

function handleTabClick(e) {
    const btn = e.target.closest('.tab');
    if (btn && btn.dataset.sourceId) {
        switchSource(btn.dataset.sourceId);
    }
}

function handlePodcastClick(e) {
    const btn = e.target.closest('.play-button');
    if (btn) {
        const index = parseInt(btn.dataset.index, 10);
        if (!isNaN(index)) {
            playPodcast(index).catch((err) => console.error('Play podcast error:', err));
        }
    }
}

function handleAudioTimeUpdate() {
    if (!UI.audioPlayer.duration) return;

    const progress = (UI.audioPlayer.currentTime / UI.audioPlayer.duration) * 100;
    UI.progressFill.style.width = `${progress}%`;

    UI.timeDisplay.textContent =
        `${formatTime(UI.audioPlayer.currentTime)} / ${formatTime(UI.audioPlayer.duration)}`;

    if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
        try {
            navigator.mediaSession.setPositionState({
                duration: UI.audioPlayer.duration,
                playbackRate: UI.audioPlayer.playbackRate,
                position: UI.audioPlayer.currentTime
            });
        } catch (error) {
            console.error('Media session position state error:', error);
        }
    }

    const now = Date.now();
    const playing = getPlayingEpisode();
    if (playing && now - state.lastSaveTime > CONFIG.PROGRESS_SAVE_INTERVAL) {
        saveProgress(playing, UI.audioPlayer.currentTime, UI.audioPlayer.duration);
        state.lastSaveTime = now;
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

        // 목록의 진행률 바 갱신
        renderPodcasts();
    } catch (error) {
        console.error('Audio ended error:', error);
    }
}

function handleProgressBarClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickedValue = x / rect.width;

    if (UI.audioPlayer.duration) {
        UI.audioPlayer.currentTime = clickedValue * UI.audioPlayer.duration;
    }
}

function setupEventListeners() {
    UI.tabs.addEventListener('click', handleTabClick);
    UI.podcastList.addEventListener('click', handlePodcastClick);

    UI.speedBtn.addEventListener('click', toggleSpeed);
    UI.refreshBtn.addEventListener('click', () => {
        loadPodcasts(true).catch((err) => console.error('Refresh error:', err));
    });
    UI.prevBtn.addEventListener('click', () => {
        playPrevious().catch((err) => console.error('Play previous error:', err));
    });
    UI.nextBtn.addEventListener('click', () => {
        playNext().catch((err) => console.error('Play next error:', err));
    });

    UI.audioPlayer.addEventListener('timeupdate', handleAudioTimeUpdate);
    // 미디어세션/잠금화면 등 외부 조작으로 재생 상태가 바뀌어도 목록 UI를 동기화
    UI.audioPlayer.addEventListener('play', updateRowStates);
    // 일시정지 순간 위치를 즉시 저장 + 목록 UI 동기화
    UI.audioPlayer.addEventListener('pause', () => {
        saveCurrentProgress();
        updateRowStates();
    });
    UI.audioPlayer.addEventListener('ended', () => {
        handleAudioEnded().catch((err) => console.error('Handle audio ended error:', err));
    });

    UI.progressBar.addEventListener('click', handleProgressBarClick);

    // 백그라운드 진입(다른 앱/탭 전환) 시점에 즉시 저장 — 모바일에서 가장 신뢰할 수 있는 신호
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) saveCurrentProgress();
    });
    // 앱/탭 종료 직전 저장 (pagehide가 beforeunload보다 모바일에서 신뢰도 높음)
    window.addEventListener('pagehide', saveCurrentProgress);
}

async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('./sw.js');
            console.log('Service Worker registered');
        } catch (error) {
            console.warn('Service Worker registration failed:', error);
        }
    }
}

// --- Initialization --------------------------------------------------------

async function init() {
    try {
        initUI();
        renderTabs();
        setupEventListeners();
        await loadPodcasts();
        await registerServiceWorker();
    } catch (error) {
        console.error('Initialization error:', error);
        if (UI) {
            showError('앱 초기화 중 오류가 발생했습니다.');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => console.error('App start error:', err));
});
