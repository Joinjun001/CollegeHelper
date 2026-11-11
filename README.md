# CollegeHelper

한양대학교 HY-ON(Canvas LMS)에서 개인 액세스 토큰으로 조회 가능한 읽기 API를 안전하게 조사하고, 이후 검증된 데이터만 MCP 도구로 제공하는 개인용 대학 생활 도우미 프로젝트입니다.

현재 구현 범위는 **Phase 0~4(API 감사, Canvas 서비스 계층, 읽기 전용 MCP 서버, 강의자료실 원본 PDF 캐시)** 입니다. 감사에서 정상 작동이 확인된 API만 도구로 제공합니다.

## 목표 사용 방식

CollegeHelper는 별도의 웹사이트나 브라우저 확장 프로그램이 아닙니다. ChatGPT 입력창에서 플러그인을 선택한 뒤 자연어로 요청하는 비공개 MCP 플러그인입니다.

```text
ChatGPT 입력창에서 CollegeHelper 선택
                ↓
        자연어 프롬프트 입력
                ↓
  ChatGPT가 CollegeHelper MCP 도구 호출
                ↓
 홈서버가 HY-ON Canvas API 실시간 조회
                ↓
 ChatGPT가 조회 근거를 바탕으로 답변
```

대표 프롬프트:

- `@CollegeHelper 오늘 마감 과제와 아직 제출하지 않은 과제를 알려줘.`
- `@CollegeHelper 객체지향개발론의 오늘 수업 자료를 찾아서 예습을 도와줘.`
- `@CollegeHelper 최근 공지 중에서 내가 확인해야 할 내용만 정리해줘.`
- `@CollegeHelper 앞으로 7일간의 과제와 일정을 우선순위대로 정리해줘.`

예약 작업에서도 CollegeHelper를 명시하여 같은 MCP 도구를 호출합니다.

```text
매일 오전 8시에 @CollegeHelper를 사용해서 오늘 마감 과제와
미제출 과제를 확인하고, 확인할 내용이 있을 때만 알려줘.
```

Canvas 토큰은 ChatGPT나 브라우저에 전달하지 않습니다. 토큰은 홈서버에만 저장하며, ChatGPT에는 질문에 필요한 정규화된 학습 데이터와 Canvas 원문 링크만 반환합니다.

상세 제품 요구사항은 [ChatGPT 플러그인 사용 흐름](./docs/CHATGPT_PLUGIN_UX.md)을 참고하세요.

## 보안 원칙

- 토큰은 `CANVAS_ACCESS_TOKEN` 환경변수에서만 읽습니다.
- 토큰, Authorization 헤더, 응답 본문은 로그와 보고서에 기록하지 않습니다.
- Canvas 요청은 `GET`으로 고정되어 있습니다.
- 페이지네이션과 리다이렉트는 설정한 Canvas 호스트의 `/api/v1/` 경로만 허용합니다.
- 생성 보고서는 필드명, 항목 수, 상태만 포함하며 Git에서 제외됩니다.

## 준비

Node.js 22 이상이 필요합니다.

```bash
npm install
cp .env.example .env
```

`.env`에 HY-ON의 Canvas 루트 주소와 개인 액세스 토큰을 직접 저장합니다. 토큰을 채팅, 이슈, 커밋 또는 테스트 fixture에 붙여 넣지 마세요.

홈서버에서는 토큰이 화면이나 셸 기록에 남지 않도록 보안 입력 스크립트를 사용합니다.

```bash
./scripts/configure-env.sh
```

스크립트는 토큰을 숨김 입력으로 받고 권한이 `600`인 `.env`를 생성합니다. 기존 `.env`가 있으면 자동으로 덮어쓰지 않습니다.

```dotenv
CANVAS_BASE_URL=https://<HY-ON-CANVAS-DOMAIN>
CANVAS_ACCESS_TOKEN=<LOCAL_SECRET_ONLY>
```

## 검증

```bash
npm run check
npm run build
```

MCP 서버를 개발 모드로 실행하면 기본적으로 로컬 인터페이스의 `http://127.0.0.1:3000/mcp`에서 대기합니다.

```bash
npm run dev
```

상태 확인 주소는 `http://127.0.0.1:3000/healthz`입니다.

## 제공하는 MCP 도구

- `list_courses`: 현재 수강 과목 조회
- `get_today_tasks`: 특정 날짜의 과제와 제출 여부 조회
- `get_upcoming_tasks`: 최대 31일 범위의 예정 과제 조회
- `get_announcements`: 최근 과목 공지 조회
- `get_course_modules`: 과목별 학습 모듈 조회
- `get_course_module_items`: 모듈별 과제·외부 학습자료 항목과 Canvas 실행 링크 조회
- `get_assignment_context`: 과제 설명, 마감일, 제출 상태 조회
- `list_course_learning_resources`: HY-ON 강의자료실의 자료 목록과 캐시 상태 조회
- `get_learning_resource_text`: 원본 PDF를 자동 수집·텍스트화하고 필요한 구간 조회

모든 도구는 LMS에 대해 읽기 전용입니다. 성적, 점수, 이메일, 로그인 ID와 액세스 토큰은 결과에 포함하지 않습니다. Canvas가 반환한 설명, 공지 및 강의자료 원문은 `untrustedContent: true`로 표시합니다.

## 강의자료 자동 학습

HY-ON의 `강의자료실`은 Canvas 기본 Files API가 아니라 외부 학습도구입니다. 비식별 감사로 다음 읽기 경로가 확인되었습니다.

1. Canvas 공식 `tabs` 및 `sessionless_launch` GET API로 강의자료실에 진입
2. HY-ON 외부도구의 자료 목록 GET 응답 조회
3. 자료 열람 시 HY-CMS가 제공하는 `original.pdf` GET 응답 수집
4. 홈서버에서 `pdftotext`로 텍스트를 추출하여 Docker 볼륨에 영구 캐시

처음 원문을 요청할 때만 PDF를 받아 처리합니다. 이후 채팅이나 서버 컨테이너 재시작에서는 캐시된 텍스트를 사용하므로 같은 파일을 다시 업로드할 필요가 없습니다. 반환량은 한 번에 최대 20,000자로 제한되며 `offset`으로 다음 구간을 이어서 읽습니다.

강의자료 캐시는 Git 저장소가 아닌 `learning-resource-cache` Docker 볼륨에만 저장됩니다. 원본 PDF는 텍스트 추출 직후 삭제하며, LMS 진도 변경 요청은 차단합니다. Canvas API 요청은 계속 GET만 사용하고, LTI 진입 과정에서 사이트가 수행하는 로그인 핸드셰이크 외에는 비-GET 요청을 허용하지 않습니다.

## 읽기 전용 API 감사

실제 API 호출은 사용자가 로컬 `.env`를 준비한 뒤 직접 실행합니다.

```bash
npm run audit
```

결과는 다음 비식별 보고서로 생성됩니다.

- `reports/canvas-api-audit.json`
- `reports/canvas-api-audit.md`

감사는 최대 3개 활성 과목, 엔드포인트당 최대 10페이지를 순차적으로 조회합니다. 각각 `AUDIT_MAX_COURSES`, `AUDIT_MAX_PAGES`로 더 낮게 조정할 수 있습니다.

## Docker

로컬 `.env`를 만든 뒤 MCP 서버를 실행합니다. 호스트에는 루프백 포트만 공개됩니다.

```bash
docker compose up -d --build college-helper
curl http://127.0.0.1:3100/healthz
npm run smoke:mcp
```

일회성 API 감사는 별도 프로필로 실행합니다.

```bash
docker compose --profile audit run --rm --user "$(id -u):$(id -g)" canvas-audit
```

강의자료실처럼 JavaScript로 목록을 불러오는 외부도구는 감사 전용 Playwright 컨테이너에서 네트워크 응답 본문이나 HAR를 저장하지 않고 비식별 경로만 확인합니다.

```bash
AUDIT_COURSE_ID=<COURSE_ID> docker compose --profile browser-audit run --rm learning-resource-browser-audit
```

## TypeScript 설정의 역할

`tsconfig.json`, ESLint, Vitest는 CollegeHelper를 TypeScript로 안전하게 개발하고 검증하기 위한 내부 도구입니다. ChatGPT에서 플러그인을 호출할 때 사용자가 직접 다룰 파일은 아닙니다. 배포 환경에서는 빌드된 JavaScript와 MCP 서버만 실행됩니다.

## 다음 단계

현재 홈서버 MCP는 OpenAI Secure MCP Tunnel을 통해 비공개 CollegeHelper 플러그인에 연결됩니다. Canvas 기본 Files API가 아닌 HY-ON 외부 학습도구 자료는 별도의 브라우저 워커가 원본 PDF를 읽기 전용으로 가져와 처리합니다.

CollegeHelper는 공개 인바운드 주소 대신 OpenAI Secure MCP Tunnel을 사용합니다. Platform에서 `tunnel_id`와 `Tunnels Read + Use` 권한의 Runtime API key를 만든 뒤 홈서버에서 다음 스크립트를 실행합니다.

```bash
./scripts/configure-openai-tunnel.sh
```

키는 `/home/injun/apps/tunnel-client/secrets/runtime.key`에 권한 `600`으로 저장되고 명령 인자나 Git 저장소에는 들어가지 않습니다.

설정 후에는 사용자 서비스로 터널을 실행할 수 있습니다.

```bash
mkdir -p ~/.config/systemd/user
cp deploy/college-helper-tunnel.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now college-helper-tunnel.service
```

SSH 세션이 없는 동안과 재부팅 후에도 사용자 서비스를 유지하려면 서버 관리자가
한 번만 `sudo loginctl enable-linger "$USER"`를 실행해야 합니다.

작동하지 않는 임시 MCP 주소를 저장소에 넣지 않습니다. 자세한 기준은 [개발 제안서](./CollegeHelper_개발_제안서.md)를 따릅니다.
