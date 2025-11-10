# TextTune

TexTune은 **텍스트 프롬프트 기반 음악 생성**을 빠르게 검증할 수 있는 풀스택 샘플 프로젝트입니다. 간단한 이메일(게스트) 로그인 → 프롬프트 입력 → 비동기 생성 → 감상/다운로드 → 보관함 저장까지 한 번에 체험할 수 있습니다. 백엔드는 Node.js/Express, 프런트는 순수 HTML/JS 구성이며, 음악 생성은 Hugging Face Space(`CryptoThaler/melody`)를 호출하는 방식으로 이루어집니다.

## 구성

- `api/src/server.js` – Express API (인증, 작업 큐, Space 호출, 보관함/스트리밍)
- `api/src/audio/spaces.js` – Gradio Space 호출/파일 저장 어댑터
- `api/src/audio/synth.js` – Space를 쓰지 못할 때 사용하는 간단한 WAV Mock 렌더러
- `api/public/*.html` – 최소한의 UI (랜딩·생성·보관함·감상 페이지)
- `api/public/js/app.js` – 공통 프런트엔드 스크립트 (세션 유지, API 호출)
- `api/storage/` – 생성된 오디오 파일이 저장되는 로컬 디렉터리

## 실행 방법

```bash
cd api
npm install
npm start
```

- 서버는 기본적으로 `http://localhost:4000`에서 동작합니다.
- 종료 시에는 실행 중인 터미널에서 `Ctrl + C`를 누르세요.

## 환경 변수 (`api/.env`)

```env
PORT=4000
JWT_SECRET=dev-secret-change-me
ALLOW_ORIGIN=http://localhost:4000
MAX_DURATION_SECONDS=12

# Hugging Face Space 설정
HF_API_TOKEN=hf_xxx                  # 선택: Space 인증/ZeroGPU 확장용 토큰
HF_SPACE_ID=CryptoThaler/melody      # 필수: 사용할 Gradio Space ID
```

- `HF_SPACE_ID`를 지정하면 해당 Space를 직접 호출합니다. Space UI가 로그인 안내만 제공하는 경우에는 API 호출이 막혀 있으니 먼저 확인하세요.
- `HF_API_TOKEN`은 Space가 로그인/ZeroGPU 증설을 요구할 때 사용합니다. 토큰이 없어도 공개 Space라면 기본적인 호출은 가능하지만, 무료 ZeroGPU 한도(무료 4분/일, PRO 25분/일)에 막힐 수 있습니다.
- 두 값이 모두 비어 있으면 Space 대신 내부 mock 렌더러(`synthesizeWav`)가 실행됩니다.

## 동작 플로우

1. 사용자가 이메일(자동 게스트)로 로그인합니다.
2. `generate.html`에서 프롬프트를 입력하고 `/v1/generations` API를 호출합니다.
3. 서버는 작업 큐에 Job을 적재하고, 별도 백그라운드 루틴에서 Hugging Face Space를 호출해 오디오를 생성/저장합니다.
4. 폴링(`GET /v1/generations/:id`)으로 진행률을 확인하다가 완료되면 감상 페이지로 이동합니다.
5. 생성된 트랙은 `/library.html`에서 날짜별로 묶어 확인할 수 있고, 스트리밍·다운로드·삭제 기능을 제공합니다.

## API 요약

- `POST /v1/auth/login` – 간단한 이메일 기반 로그인(게스트 자동 발급)
- `GET /v1/me` – 현재 세션 정보
- `POST /v1/generations` – 음악 생성 요청 `{ prompt, duration?, samplerate?, seed?, quality? }`
- `GET /v1/generations/:id` – Job 상태 `queued|running|succeeded|failed` 및 결과
- `GET /v1/library` / `DELETE /v1/library/:id` – 보관함 조회/삭제
- `GET /v1/tracks/:id` – 단일 트랙 메타데이터
- `GET /v1/stream/:id` – Range 지원 스트리밍
- `GET /v1/download/:id` – 오디오 파일 다운로드

## Hugging Face Space 연동

- 서버는 `@gradio/client`로 Space 메타데이터를 읽어, “프롬프트/Duration/Seed/샘플레이트” 등의 입력 컴포넌트를 찾아 값을 자동 주입합니다.
- Space가 오디오를 `data:` URL 혹은 `file=...` 경로로 반환하면 API가 다시 다운로드해 로컬에 저장하고, 스트리밍·다운로드 API와 연결합니다.
- ZeroGPU 무료 한도를 넘으면 Space가 오류 메시지를 보내며, 이때는 `SpaceQuotaError`로 잡혀 `/v1/generations/:id` 응답에 친절한 에러 문구와 코드(`space_quota`)가 포함됩니다.
- 더 안정적인 사용을 원하면 PRO 구독 또는 자체 하드웨어가 할당된 Space를 운영해야 합니다.

## 로컬 Mock 렌더러

Space 설정이 비어 있거나 호출에 실패하면 `synthesizeWav`가 단순한 사운드를 생성해 개발 편의성을 높여 줍니다. 실제 서비스 배포 시에는 반드시 유효한 Space를 지정하세요.

## 트러블슈팅

- `api is not defined` – `js/app.js` 로딩 실패입니다. HTML에서 `<script src="js/app.js"></script>` 경로가 맞는지 확인 후 강력 새로고침(Ctrl+F5)하세요.
- Hugging Face 401/Quota 오류 – `HF_API_TOKEN` 누락, 토큰 권한 부족, 혹은 ZeroGPU 일일 한도를 초과했습니다. 토큰을 갱신하거나 PRO 구독을 고려하세요.
- Job이 `failed` – Space 응답을 콘솔에서 확인하세요. 프롬프트 길이 제한, Space 내부 오류, 네트워크 문제 등이 원인일 수 있습니다.

## 향후 개선 아이디어

1. **Persistent Storage 도입** – Postgres/Prisma 등으로 `users/jobs/tracks` 데이터를 DB에 저장하고, 작업 이력을 유지합니다.
2. **외부 스토리지 연동** – S3/R2 등의 오브젝트 스토리지에 오디오를 업로드하고 서명 URL을 제공합니다.
3. **실제 인증/결제 연동** – 이메일/소셜 로그인 및 사용자별 Space 토큰 연결 기능을 제공합니다.
4. **Space 프록시 워커** – 다수의 Space 호출을 큐/워커 구조(예: Redis)로 분리해 안정성을 높입니다.
5. **프런트엔드 고도화** – Next.js, React 등의 프레임워크로 UI를 개선하고 SSE/WebSocket 기반 진행률 업데이트를 적용합니다.

필요한 기능이나 통합 작업이 있다면 이 README를 참고해 빠르게 확장할 수 있습니다. 즐거운 음악 생성 실험 되세요!
