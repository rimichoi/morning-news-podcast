// 소스 레지스트리 + 정규화 + 로더 (JSONP / fetch)
//
// 방송사마다 API 방식과 스키마가 달라 SOURCES 로 추상화한다.
// - MBC(miniapi.imbc.com): CORS 미허용 → JSONP(<script>) 로드
// - SBS(apis.sbs.co.kr): CORS 허용(*) → fetch(JSON) 로드
// 각 parse()는 원본을 공통 Episode 로 정규화한다.

import { CONFIG } from './config.js';
import { toHttps, safeId, mbcDateToISO, sbsDateToISO } from './util.js';

/**
 * @typedef {Object} Episode
 * @property {string|null} id
 * @property {string} title
 * @property {string} dateISO
 * @property {string|null} audioUrl
 * @property {string} artwork
 * @property {string} sourceId
 */

/** MBC podcast API 응답 1건 → Episode */
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

/** SBS radio-api 응답 1건 → Episode */
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

export const SOURCES = [
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

export function getSource(sourceId) {
    return SOURCES.find((s) => s.id === sourceId) || null;
}

/** JSONP 로더: <script> 주입 + 전역 콜백. MBC 처럼 CORS 미허용 API용. */
export function loadJsonp(url) {
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
export async function loadJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

/** 소스 원본을 로드하여 정규화·필터링된 Episode[] 반환 */
export async function fetchEpisodes(source) {
    const url = source.buildUrl();
    const raw = source.type === 'jsonp' ? await loadJsonp(url) : await loadJson(url);
    let episodes = source.parse(raw);
    if (source.filter) {
        episodes = episodes.filter((ep) => source.filter(ep.title));
    }
    return episodes.filter((ep) => ep.audioUrl);
}
