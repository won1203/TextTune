# TextTune (텍스튠) — MVP 스캐폴드 v2

텍스트 기반 음악 생성 웹서비스(PRD 기준)를 빠르게 검증하기 위한 풀스택 스캐폴드입니다. 로그인 → 프롬프트 입력 → 비동기 생성 → 재생/다운로드 → 보관함 플로우가 동작하며, Hugging Face Stable Audio Open 1.0 모델 연동을 위한 API 호출 로직이 포함되어 있습니다.

## 구성

- `api/src/server.js` — Express API (인증, 작업 큐, Hugging Face 호출, 스트리밍/다운로드)
- `api/src/audio/huggingface.js` — Hugging Face Inference API 호출 래퍼
- `api/src/audio/synth.js` — 로컬 개발/백업용 간단 WAV 생성기(Mock)
- `api/public/*.html` — 최소 UI (랜딩, 생성, 트랙, 보관함)
- `api/public/js/app.js` — 공통 JS 헬퍼(세션 유지, API 호출)
- `api/storage/` — 생성된 오디오 파일 저장 디렉터리 (런타임에 생성)

## 실행 방법

```bash
cd api
npm install
npm start
```

- 브라우저에서 `http://localhost:4000` 접속
- 서버 중단: 실행 중인 터미널에서 `Ctrl+C`

## 환경 변수 (`api/.env` 예시)

```env
PORT=4000
JWT_SECRET=dev-secret-change-me
ALLOW_ORIGIN=http://localhost:4000
MAX_DURATION_SECONDS=12

# Hugging Face Stable Audio ����

HF_API_TOKEN=hf_xxx                  # �ʼ�: Hugging Face Personal Access Token

HF_SPACE_ID=CryptoThaler/melody       # ����: Gradio Space ID (ex. ���̸�/����)

HF_MODEL_ID=stabilityai/stable-audio-open-1.0  # ����: �⺻�� stable-audio-open-1.0

# HF_INFERENCE_ENDPOINT=https://xxxx.us-east-1.aws.endpoints.huggingface.cloud   # ���� Endpoint ��� ��

# HF_API_URL=https://router.huggingface.co/hf-inference/models/{model}                           # �⺻��, {model} �÷��̽�Ȧ�� ��� ����

`



- HF_API_TOKEN�� �����Ǿ� ������ Hugging Face Stable Audio Open 1.0�� ȣ���� ������� �����մϴ�.

- HF_SPACE_ID�� �����ϸ� Gradio Space�� API ���� ȣ���� �� �ֽ��ϴ�. (Space �÷��̽��� �α��� ��ư�� ���ϴ� ��� ������ ������ �� �� �ֽ��ϴ�.)

- ��ū�� ������ ������ mock �ռ���(synthesizeWav)�� �����մϴ�.



## 플로우(UI)

1. 랜딩 페이지(`index.html`)에서 소개/CTA → “생성하기” 클릭
2. 생성 페이지(`generate.html`)에서 프롬프트 입력 → `생성` 버튼 → `/v1/generations` 호출
3. 작업 큐(백엔드)에서 Stable Audio 호출 → 오디오 파일 저장 → 상태 업데이트
4. 완료 시 `track.html`로 이동 → 스트리밍/다운로드/다시 생성 가능
5. `library.html`에서 최근 생성 트랙 리스트, 인라인 재생/삭제

## API 요약

- `POST /v1/auth/login` — 이메일 기반 임시 로그인 (자동 게스트 세션에 사용)
- `GET /v1/me` — 세션 확인
- `POST /v1/generations` — 생성 요청 `{ prompt, duration?, samplerate?, seed?, quality? }`
- `GET /v1/generations/:id` — 작업 상태 `queued|running|succeeded|failed`
- `GET /v1/library` / `DELETE /v1/library/:id`
- `GET /v1/tracks/:id` — 메타데이터 (프롬프트/확장 프롬프트/파라미터)
- `GET /v1/stream/:id` — Range 스트리밍 (MP3/WAV 등 포맷 자동 처리)
- `GET /v1/download/:id` — 첨부 다운로드 (파일 확장자 자동 반영)

## Hugging Face 연동 개요

- `HF_API_TOKEN`이 존재하면 `generateStableAudioTrack()`가 호출됩니다.
- 요청 바디에는 `inputs`(프롬프트), `parameters.seconds_total`/`audio_end_seconds`/`sample_rate`/`seed` 등을 전달합니다.
- 응답으로 받은 오디오 버퍼를 확장자에 맞춰 저장하고, 트랙 메타데이터에 반영합니다.
- 기본 호출 엔드포인트는 `https://router.huggingface.co/hf-inference/models/{model}` 입니다. 필요하면 `HF_API_URL` 환경변수로 변경할 수 있습니다. (`{model}` 플레이스홀더 사용 가능. Router에서 곧바로 404/403 등을 확인해 접근 권한 문제를 빠르게 파악할 수 있습니다.)
- 모델이 초기 로딩 중이면 `options.wait_for_model = true`로 대기 후 결과를 수신합니다.
- 실패 시 작업 상태를 `failed`로 기록하고 에러 로그를 출력합니다.

## 현재 제약 & 참고

- 데이터 저장은 인메모리(Map) + 로컬 파일 시스템입니다. 서버 재시작 시 기록이 초기화됩니다.
- 인증은 개발 편의용(자동 게스트 로그인)으로 구현되어 있습니다. 실제 서비스에서는 OIDC/OAuth 등으로 교체하세요.
- Hugging Face 호출 시 인퍼런스 지연 시간은 모델 로딩 상태에 따라 10~30초 이상일 수 있습니다.
- MP3/FLAC 등 어떤 포맷이 내려올지 모델/엔드포인트 설정에 따라 달라집니다. 현재는 Content-Type 헤더를 기준으로 확장자를 설정합니다.

## 다음 단계 제안

1. **데이터베이스 도입** — Postgres/Prisma 등으로 `users/jobs/tracks` 테이블 구성, 작업 이력 보존
2. **스토리지 이전** — S3/R2 등에 오디오 업로드 후 서명 URL 제공
3. **실제 인증 도입** — 이메일/소셜 로그인, 세션/토큰 관리 개선
4. **추론 워커 분리** — Node API ↔ Python Stable Audio 추론 워커 간 큐(예: Redis) 구성, 스케일 아웃
5. **프런트엔드 고도화** — Next.js 등으로 전환, SSE/WebSocket 기반 실시간 진행률, 프롬프트 템플릿 UI 확장

## 트러블슈팅

- `api is not defined` — `js/app.js` 로딩 실패. HTML에서 `<script src="js/app.js"></script>` 확인 후 강력 새로고침(Ctrl+F5)
- Hugging Face 401 — `HF_API_TOKEN` 누락 또는 권한 부족. 토큰을 발급 후 `.env`에 설정
- 작업 실패 — 콘솔 로그(`Render job failed ...`)를 확인. 모델 로딩, 프롬프트 제한, 토큰 쿼터 등의 원인이 있을 수 있습니다.

필요한 기능이나 통합 작업이 더 있다면 알려주세요. 계속 확장해 나갈 수 있도록 구조를 단순하게 유지했습니다.


## Hugging Face Spaces 연동

- HF_SPACE_ID를 지정하면 @gradio/client가 Space 컴포넌트/엔드포인트 정보를 자동으로 읽어 적용합니다.
- 입력 컴포넌트의 라벨(ex. prompt/duration/seed/sample rate)을 추론해 값을 넣는데, Space를 바꿀 경우 기본 입력과 슬라이더 구성이 있는지 체크하세요.
- Space 응답이 data: URL 나 file=... 링크로 내려오면, API가 자동으로 다시 다운로드하여 파일로 저장합니다.
- 현재 기본값으로 사용하는 CryptoThaler/melody Space는 공개 predict 함수를 제공해 음악 응답을 돌려줍니다. 다른 Space를 사용할 땐, 보기에서 로그인만 요구하는 지 여부를 반드시 확인하세요. (예: AxolotlTurdz/facebook-musicgen-small 은 Sign in 안내만 제공)

