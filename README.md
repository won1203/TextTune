# TexTune

텍스트 프롬프트를 받아 Hugging Face Space에서 음악을 생성하고, 로컬에 저장한 뒤 웹 UI로 감상·관리할 수 있는 풀스택 MVP입니다. Express 기반 백엔드와 정적 HTML/CSS/JS 프런트엔드로 구성되며, JWT 쿠키 인증과 간단한 인메모리 작업 큐를 사용합니다.

## 주요 특징
- 텍스트 기반 음악 생성: `/v1/generations`로 생성 Job을 등록하고 Space(`HF_SPACE_ID`)에 전달해 오디오 파일을 받아 저장.
- 사용자 인증: 개발용 이메일 로그인 + Google OAuth(PKCE). JWT가 HttpOnly 쿠키로 저장되어 전역 API 호출에 사용.
- 보관/재생: 생성된 트랙을 SQLite(`better-sqlite3`)와 파일 시스템(`storage/`)에 저장 후 스트리밍/다운로드 제공.
- 플레이리스트: 트랙을 묶어 재생/삭제 가능하며, 공용 글로벌 플레이어(모든 페이지 하단)와 연동.
- 프롬프트 번역(옵션): 한글 프롬프트를 Google Translation API로 영어로 변환 후 Space에 전달.

## 시스템 구성
- 백엔드: `src/server.js`에서 Express 앱 초기화 → 인증/큐/라이브러리/플레이리스트 API 제공 → `public/` 정적 파일 서빙.
  - 큐: 단일 프로세스 인메모리 큐, 동시 처리 1건(`MAX_CONCURRENCY=1`). Space 호출 전후 진행률을 추정 업데이트.
  - 생성 엔진 어댑터: `src/audio/spaces.js`가 `@gradio/client`로 Space 호출, 오디오 데이터(data URI/URL/file) 추출 후 디스크 저장.
  - 데이터 저장: `storage/texttune.db`(SQLite) + `storage/{userId}/{trackId}.{ext}` 오디오 파일.
  - 인증: `/v1/auth/login`(이메일), `/v1/auth/google/*`(OAuth) → JWT 서명 후 쿠키에 저장, `/v1/me`로 세션 확인/이름 변경.
- 프런트엔드: 정적 페이지(`public/*.html`, `public/css`, `public/js/app.js`).
  - `index.html`: 랜딩/제품 소개.
  - `generate.html`: 프롬프트 입력·진행률 표시·완료 후 라이브러리 이동.
  - `library.html`: 생성 트랙 목록, 삭제/다운로드/플레이리스트 추가, 글로벌 플레이어 재생.
  - `track.html`: 단일 트랙 상세/다운로드/같은 프롬프트 재생성.
  - `playlist.html`: 플레이리스트 생성·목록·재생(일부 문자 인코딩 이슈 있음).
  - `public/js/app.js`: 공용 API 헬퍼, 인증/로그아웃 모달, 플레이리스트 모달, 글로벌 오디오 플레이어 상태 유지.

## 디렉터리 맵
```
.
├─ src/
│  ├─ server.js              # Express 엔트리포인트/라우팅/큐
│  ├─ audio/spaces.js        # Hugging Face Space 호출 및 오디오 추출
│  ├─ translate/google.js    # 프롬프트 번역(Google Translation API)
│  ├─ db/                    # better-sqlite3 스키마 및 레포지토리
│  └─ utils/http.js          # fetch 존재 여부 확인
├─ public/
│  ├─ index.html             # 홈 랜딩
│  ├─ generate.html          # 생성 UI
│  ├─ library.html           # 보관함/재생/플레이리스트 진입
│  ├─ playlist.html          # 플레이리스트 UI
│  ├─ track.html             # 단일 트랙 상세
│  ├─ css/*.css              # 페이지별 스타일
│  └─ js/app.js              # 공용 스크립트/글로벌 플레이어
├─ storage/                  # 생성된 오디오 파일 + SQLite DB(texttune.db)
├─ package.json              # 스크립트/의존성
└─ .env                      # 환경 변수(예시 값, 배포 시 비워서 설정)
```

## 요구사항
- Node.js 18+ (전역 `fetch` 필요), npm
- 네이티브 의존성: `better-sqlite3` 빌드가 가능한 환경
- Hugging Face Space 접근 권한 및 토큰(필요 시)
- Google OAuth/Translation 사용 시 각 API 키

## 설치 및 실행
```bash
npm install
npm run init-db   # 최초 1회: storage/texttune.db 생성
npm start         # http://localhost:4000
```
기본적으로 Express가 `public/`을 정적으로 서빙하므로 별도 프런트 빌드가 없습니다.

## 핵심 플로우
1) 인증  
   - 개발용: `/v1/auth/login`에 이메일만 전달 → JWT 쿠키 발급.  
   - OAuth: `/v1/auth/google/start` → 콜백에서 사용자 upsert 후 JWT 쿠키 저장.
2) 생성 Job 등록  
   - `/v1/generations` (POST) `{ prompt, duration?, samplerate?, seed?, quality? }` → 인메모리 큐 적재.  
   - 한글 프롬프트는 `translatePromptToEnglishIfNeeded`로 번역 후 `expandPrompt` 템플릿 적용.
3) Space 호출  
   - 큐 워커가 `generateSpaceAudioTrack` 실행 → Gradio Space 엔드포인트 선택 → 오디오 데이터 추출 → `storage/{user}/{track}.{ext}` 저장.
4) 결과 저장/스트리밍  
   - `tracks`/`generation_jobs` 테이블에 상태/메타데이터 기록 → `/v1/stream/:id`, `/v1/download/:id`로 제공.
5) 프런트 소비  
   - `generate.html`에서 진행률 폴링 → 완료 시 `library.html`로 이동/감상.  
   - `library.html`/`playlist.html`/`track.html`이 API로 목록·세부 정보를 조회하고 글로벌 플레이어로 재생/다운로드/삭제/플레이리스트 추가.

## 사용자 플로우(UX)
1) 생성 시작  
   - `index.html`에서 “TexTune 시작하기” 클릭 → 로그인 모달(이메일/Google OAuth) → 쿠키로 세션 유지.  
2) 트랙 생성  
   - `generate.html`에서 프롬프트 작성(랜덤 제안 버튼 포함) → `/v1/generations` 요청 → 진행률 바 실시간 업데이트 → 완료 시 “감상하기” 버튼으로 보관함 이동.  
3) 보관함/재생  
   - `library.html`에서 생성된 트랙 목록 확인, 재생 클릭 시 하단 글로벌 플레이어가 열리고 스트리밍/다운로드/삭제/플레이리스트 추가 가능.  
4) 플레이리스트  
   - `playlist.html`에서 새 플레이리스트 생성 → 카드 선택 시 트랙 목록/전체 재생/개별 재생 가능.  
5) 트랙 상세  
   - `track.html?id={trackId}`로 직접 접근하거나 보관함에서 이동해 단일 오디오 플레이어, 메타데이터, 동일 프롬프트 재생성 버튼 제공.  
6) 글로벌 플레이어  
   - 모든 페이지 하단에 고정. 셔플/반복/볼륨/다운로드 제공, 로컬 스토리지로 상태를 기억해 페이지 이동 후에도 이어서 재생.

## 주요 API 요약
- 인증: `POST /v1/auth/login`, `POST /v1/auth/logout`, `GET /v1/me`, `PATCH /v1/me`, `GET /v1/auth/google/*`
- 생성: `POST /v1/generations`, `GET /v1/generations/:id`
- 라이브러리: `GET /v1/library`, `DELETE /v1/library/:id`
- 트랙: `GET /v1/tracks/:id`, `GET /v1/stream/:id`, `GET /v1/download/:id`
- 플레이리스트: `GET/POST /v1/playlists`, `GET /v1/playlists/:id`, `POST /v1/playlists/:id/tracks`, `DELETE /v1/playlists/:playlistId`, `DELETE /v1/playlists/:playlistId/tracks/:trackId`

## 운영/제한 사항
- 단일 프로세스 인메모리 큐라서 멀티 인스턴스/수평 확장 시 외부 큐(예: Redis)로 대체가 필요합니다.
- 파일 경로는 `storage/` 하드코딩 기반이므로 컨테이너 재시작 시 데이터를 유지하려면 볼륨 마운트가 필수입니다.
- 글로벌 플레이어/플레이리스트 UI 일부에 인코딩 깨짐이 존재할 수 있으니 배포 전에 폰트/문자셋 검증을 권장합니다.
- Node 런타임에 `fetch`가 없으면 `translate/google.js`/`spaces.js`가 실패하므로 Node 18+를 사용하거나 폴리필을 추가하세요.
