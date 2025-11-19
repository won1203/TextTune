# TextTune

TextTune은 텍스트 프롬프트 기반으로 음악을 생성하는 풀스택 실험 프로젝트입니다. Express API와 순수 HTML/JS 프런트엔드로 구성되어 있으며, Hugging Face Space(`TheStageAI/Elastic-musicgen-large` 등)와 직접 통신해 음원을 받아옵니다.

## 구성
- `api/src/server.js` : 인증/작업 큐/라이브러리 스트리밍을 담당하는 Express 서버
- `api/src/audio/spaces.js` : Gradio Space 호출과 응답 오디오 파일 처리 어댑터
- `api/public/*.html` : 프롬프트 입력·진행률 확인·라이브러리 뷰 등 최소한의 정적 UI
- `api/public/js/app.js` : 로그인/세션 유지, API 호출 헬퍼, 진행률 폴링 로직
- `api/storage/` : 생성된 음원을 임시로 저장하는 로컬 디렉터리

## 실행 방법
```bash
cd api
npm install
npm start
```
서버는 기본적으로 `http://localhost:4000` 에서 동작하며, 실행 중에는 터미널에서 `Ctrl + C`로 중지합니다.

## 환경 변수(`api/.env`)
```env
PORT=4000
JWT_SECRET=dev-secret-change-me
ALLOW_ORIGIN=http://localhost:4000
MAX_DURATION_SECONDS=30
DEFAULT_DURATION_SECONDS=30
HF_API_TOKEN=hf_xxx
HF_SPACE_ID=TheStageAI/Elastic-musicgen-large
```
- `MAX_DURATION_SECONDS` : 요청 가능한 최대 음원 길이(기본 30초)
- `DEFAULT_DURATION_SECONDS` : 길이를 전달하지 않았을 때 서버가 사용하는 기본 길이
- `HF_SPACE_ID` : 호출할 Hugging Face Space ID. 비공개/로그인 필요 Space면 권한을 확인하세요.
- `HF_API_TOKEN` : Space 접근 또는 ZeroGPU 할당량 확장을 위한 개인 토큰(필요 시 설정)
- `GOOGLE_TRANSLATE_API_KEY` : 한글 프롬프트를 영어로 자동 번역하려면 Google Cloud Translation API 키를 설정하세요. 필요 시 `GOOGLE_TRANSLATE_SOURCE_LANG`/`GOOGLE_TRANSLATE_TARGET_LANG`로 언어를 조정할 수 있습니다.

## 동작 흐름
1. 사용자가 게스트 이메일로 로그인하여 세션 쿠키를 발급받습니다.
2. `generate.html`에서 프롬프트를 입력하면 `/v1/generations`로 Job이 생성됩니다.
3. 백엔드 큐가 Hugging Face Space에 요청을 전달하고, 반환된 오디오를 로컬 파일로 저장합니다.
4. UI는 `/v1/generations/:id`를 폴링해 진행률을 확인하며, 완료 시 `track.html`로 이동합니다.
5. 저장된 트랙은 `/v1/library`, `/v1/stream/:id`, `/v1/download/:id` 로 조회·재생·다운로드할 수 있습니다.

## API 요약
- `POST /v1/auth/login` : 게스트 이메일 기반 로그인
- `GET /v1/me` : 현재 세션 정보
- `POST /v1/generations` : `{ prompt, samplerate?, seed?, quality? }`로 생성 Job 등록(기본 길이 30초)
- `GET /v1/generations/:id` : Job 상태/진행률/결과 트랙 참조
- `GET /v1/library` & `DELETE /v1/library/:id` : 사용자 라이브러리 조회/삭제
- `GET /v1/tracks/:id`, `/v1/stream/:id`, `/v1/download/:id` : 단일 트랙 메타/스트리밍/다운로드

## Hugging Face Space 연동
- `@gradio/client`를 사용해 Space 메타 정보를 불러오고, 프롬프트·길이·시드 입력 컴포넌트에 값을 매핑합니다.
- Space가 `data:` URL이나 `file=...` 경로로 오디오를 반환하면 서버가 즉시 다운로드해 로컬 파일로 저장합니다.
- ZeroGPU 한도 초과나 로그인 요구로 실패하면 Space 쪽 에러 메시지를 Job에 그대로 전달합니다.

## 문제 해결 팁
- `HF_SPACE_ID` 또는 토큰이 잘못되면 `Could not resolve app config` 오류가 발생합니다. Space URL에서 `...hf.space/config`가 열리는지 먼저 확인하세요.
- Space가 WebSocket 프로토콜만 노출하는 경우 현재 클라이언트 버전으로는 동작하지 않으니 SSE를 지원하는 Space를 선택해 주세요.
- Job이 `failed`이면 백엔드 로그에 남는 Space 응답을 확인하여 프롬프트 길이 제한, 토큰 만료 등을 점검합니다.

## 향후 개선 아이디어
1. Postgres 등 영구 저장소 연동으로 사용자/Job/트랙 메타데이터를 보존
2. S3·Cloudflare R2 같은 오브젝트 스토리지 업로드 및 서명 URL 제공
3. OAuth/결제 연동으로 사용자별 Space 토큰 관리와 사용량 한도 부여
4. 별도 워커 프로세스 도입으로 Space 호출을 분리하고 확장성 확보
5. Next.js 등의 현대적인 프런트엔드로 UI/UX 개선 및 실시간 진행률 스트리밍 적용

즐거운 음악 생성 실험에 도움이 되길 바랍니다!

