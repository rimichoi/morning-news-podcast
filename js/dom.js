// DOM 엘리먼트 캐시. initUI()를 DOM 준비 후 한 번 호출하면 UI가 채워진다.

export const UI = {};

export function initUI() {
    Object.assign(UI, {
        loading: document.getElementById('loading'),
        error: document.getElementById('error'),
        errorMessage: document.getElementById('errorMessage'),
        errorRetry: document.getElementById('errorRetry'),
        tabs: document.getElementById('tabs'),
        podcastList: document.getElementById('podcastList'),
        audioPlayer: document.getElementById('audioPlayer'),
        playerControls: document.getElementById('playerControls'),
        progressFill: document.getElementById('progressFill'),
        progressBar: document.getElementById('progressBar'),
        progressThumb: document.getElementById('progressThumb'),
        timeDisplay: document.getElementById('timeDisplay'),
        currentProgram: document.getElementById('currentProgram'),
        currentDate: document.getElementById('currentDate'),
        speedBtn: document.getElementById('speedBtn'),
        themeBtn: document.getElementById('themeBtn'),
        refreshBtn: document.getElementById('refreshBtn'),
        prevBtn: document.getElementById('prevBtn'),
        back15Btn: document.getElementById('back15Btn'),
        playPauseBtn: document.getElementById('playPauseBtn'),
        fwd15Btn: document.getElementById('fwd15Btn'),
        nextBtn: document.getElementById('nextBtn')
    });
}
