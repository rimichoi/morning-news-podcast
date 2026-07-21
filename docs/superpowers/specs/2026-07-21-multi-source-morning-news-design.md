# 멀티소스 아침뉴스 플레이어 설계

- 작성일: 2026-07-21
- 상태: 승인됨

## 배경

기존 앱은 CBS 아침뉴스 다시듣기 단일 소스만 재생했다. CBS 아침뉴스가 종료되어
다른 아침뉴스 3개로 대체한다. 사용자는 상단 탭으로 3개 방송을 전환하며 청취할 수 있어야 한다.

## 대상 방송 3개

| id | 라벨 | 로딩 | 필터 |
|----|------|------|------|
| `mbc-sisun` | 시선집중 | JSONP | `ContentTitle`에 `1부` 포함 (평일 07:05 [JB TIMES]) |
| `mbc-morning` | 아침&뉴스 | JSONP | 없음(전체) |
| `sbs-gonewbeu` | 헤이 고뉴브 | fetch(JSON) | `CON_TITLE`에 `[헤이 고뉴브]` 포함 |

- 시선집중: `https://miniapi.imbc.com/podcast/itemlist?bid=1000674100000100000&page=1&pagesize=50&callback=__itemlist`
- 아침&뉴스: `https://miniapi.imbc.com/podcast/itemlist?bid=1003824100000100000&page=1&pagesize=10&callback=__itemlist`
- 헤이 고뉴브: `https://apis.sbs.co.kr/radio-api/podcast/podcast_list_json?vod_id=V2000010540&page=1&item_per_page=20&sortNew=1`

## 핵심 사실 (조사 결과)

- MBC(`miniapi.imbc.com`): `Access-Control-Allow-Origin` 헤더 없음 → `fetch()` 불가. JSONP 전용
  (Content-Type `application/javascript`, 콜백명 `__itemlist`). `<script>` 주입으로 로드.
- SBS(`apis.sbs.co.kr`): `Access-Control-Allow-Origin: *` → `fetch()` 직접 가능. 순수 JSON
  (`_=` 파라미터는 캐시버스터일 뿐 JSONP 아님).
- 시선집중 `bid` 피드는 1부만이 아니라 전체 코너(2부/3부/6분집중 등)가 섞여 내려옴 → 1부 필터 필요.
- SBS 피드에는 풀버전/스포츠/경제 코너가 섞여 있고 풀버전 제목에 `(1부) 헤이, 고뉴브`(쉼표)가
  포함되므로, 대괄호 표기 `[헤이 고뉴브]` 정밀 매칭으로 풀버전을 제외한다.

## 아키텍처

### 소스 레지스트리 + 정규화 계층

`SOURCES` 배열로 소스별 차이(로딩 방식·스키마·필터)를 추상화한다.

```
SOURCES = [
  { id, label, type:'jsonp'|'json', buildUrl(), parse(raw)->Episode[], filter?(title) }
]
```

각 소스의 `parse()`는 원본을 공통 Episode 형태로 정규화한다.

```
Episode = {
  id,        // 소스 내 고유 id (MBC: PodCastItemIdx, SBS: CLIP_ID)
  title,     // 표시 제목
  dateISO,   // ISO 문자열(정규화). new Date()로 안전 파싱 가능
  audioUrl,  // https 강제
  artwork,   // 회차/프로그램 이미지 URL
  sourceId
}
```

- MBC parse: `PodCastItemIdx`, `ContentTitle`, `BroadDate`("YYYY-MM-DD HH:mm:ss"→ISO),
  `EncloserURL`, `ITunesImageURL`.
- SBS parse: `CLIP_ID`, `CON_TITLE`, `BROAD_DATE`("YYYYMMDD"→ISO), `S3_FILE_URL`(https), `ITUNES_IMAGE`.

### 로딩

- JSONP 로더: `<script>` 주입, 전역 `__itemlist` 콜백 등록, 성공/실패/타임아웃 시 script 제거 및 콜백 정리.
  동시 요청 없이 소스별 순차/개별 로드.
- fetch 로더: SBS JSON. 기존 방식 유지.

### 상태

```
state = {
  activeSourceId,
  cache: { [sourceId]: Episode[] },   // 소스별 목록 캐시
  currentIndex, currentSpeed, lastSaveTime, isLoading
}
```

- 탭 전환 시 캐시에 있으면 재요청 없이 렌더, 없으면 로드. 새로고침 버튼은 활성 소스 강제 갱신.

## UI

- 헤더 아래 3개 탭(세그먼트 컨트롤). 활성 탭 강조.
- 탭 선택 → 해당 소스 Episode 목록 렌더. 목록 항목: 날짜/제목 + 진행률 바 + 재생 버튼.
- 하단 고정 플레이어: 진행바, 날짜/제목, 배속, 이전/다음. 자동 다음재생은 활성 소스 목록 내에서 동작.

## 진행률(이어듣기) 버그 수정

기존 2가지 원인:

1. `audioPlayer.src` 설정 직후 `currentTime`을 세팅 → 메타데이터(duration) 로드 전이라
   브라우저가 무시하거나 0으로 리셋. → 1회성 `loadedmetadata` 리스너에서 seek 하도록 변경.
2. 진행률 키가 `broadDate`만 사용 → 소스 간 날짜 충돌, 또한 SBS `"20260721"`은 `new Date()`
   파싱 실패로 키 생성 불안정. → 키를 `progress_${sourceId}_${episodeId}`로 변경. 날짜는
   parse 단계에서 ISO로 정규화하여 표시/파싱 안정화.

## 브랜딩

- 제목/헤더/manifest name을 "아침뉴스"로 변경, CBS 전용 문구 제거.
- 아이콘 파일(`cbs_icon.png`)은 일단 유지(별도 논의).
- 미디어세션 아트워크는 회차별 `artwork` 사용, title/artist는 소스 라벨/날짜 기반.

## 파일 영향

- `app.js`: 소스 레지스트리, 정규화, JSONP/fetch 로더, 탭 상태, 진행률 수정 (대폭 리팩터)
- `index.html`: 탭 마크업, 브랜딩 문구
- `styles.css`: 탭/세그먼트 스타일
- `sw.js`: 캐시 대상 URL 매칭 정리(신규 API 도메인), 캐시 버전 업
- `manifest.json`: name/short_name
- `README.md`: 소스·저작권 고지 갱신

## 테스트 / 검증

- 자동화 테스트 하니스가 없는 정적 PWA이므로, 로컬 서버 구동 후 브라우저에서 수동 검증:
  3개 탭 로드, 재생, 배속, 진행률 저장 후 재진입 시 이어듣기, 자동 다음재생, 미디어세션.
- 로더/파서/필터 로직은 순수 함수로 분리하여 콘솔 또는 간단 스크립트로 개별 확인 가능하게 한다.

## 범위 밖 (YAGNI)

- 페이지네이션/무한스크롤(각 소스 첫 페이지 10~50건이면 충분)
- 검색, 즐겨찾기, 다운로드
- 아이콘 리디자인(추후 별도)
