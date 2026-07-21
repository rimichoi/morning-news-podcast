// 순수 헬퍼 함수 (URL/날짜/문자열 포맷)

/** http URL을 https로 변환 (Mixed Content 방지). 없으면 null */
export function toHttps(url) {
    if (!url) return null;
    return url.startsWith('http:') ? url.replace('http:', 'https:') : url;
}

/** id 필드를 안전하게 문자열화. 값이 없으면 null (진행률 키 오염 방지) */
export function safeId(value) {
    return value == null || value === '' ? null : String(value);
}

/** HTML 이스케이프 (innerHTML 주입 안전) */
export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

/** 이미지 URL 확장자로 MIME 타입 추정 (MediaSession artwork용) */
export function guessImageMime(url) {
    const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    return 'image/jpeg';
}

/** "YYYY-MM-DD HH:mm:ss" -> ISO. 실패 시 원본 반환 */
export function mbcDateToISO(str) {
    if (!str) return '';
    const iso = str.trim().replace(' ', 'T');
    const d = new Date(iso);
    return isNaN(d.getTime()) ? str : iso;
}

/** "YYYYMMDD" -> ISO 자정. 실패 시 원본 반환 */
export function sbsDateToISO(str) {
    if (!str || !/^\d{8}$/.test(str)) return str || '';
    return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}T00:00:00`;
}

/** ISO/날짜 문자열 -> "YYYY.MM.DD(요일)". 파싱 실패 시 원본 반환 */
export function formatDate(dateStr) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr || '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${year}.${month}.${day}(${days[date.getDay()]})`;
}

/** 초 -> "M:SS" */
export function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** value를 [min, max] 범위로 제한 */
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
