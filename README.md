# CollegeHelper

한양대학교 HY-ON(Canvas LMS)에서 개인 액세스 토큰으로 조회 가능한 읽기 API를 안전하게 조사하고, 이후 검증된 데이터만 MCP 도구로 제공하는 개인용 대학 생활 도우미 프로젝트입니다.

현재 구현 범위는 **Phase 0(프로젝트 초기화)** 과 **Phase 1(API 감사 도구)** 입니다. MCP 도구와 Canvas 쓰기 요청은 아직 포함하지 않습니다.

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

로컬 `.env`를 만든 뒤 다음 명령으로 일회성 감사를 실행할 수 있습니다.

```bash
docker compose run --rm canvas-audit
```

## TypeScript 설정의 역할

`tsconfig.json`, ESLint, Vitest는 CollegeHelper를 TypeScript로 안전하게 개발하고 검증하기 위한 내부 도구입니다. ChatGPT에서 플러그인을 호출할 때 사용자가 직접 다룰 파일은 아닙니다. 배포 환경에서는 빌드된 JavaScript와 MCP 서버만 실행됩니다.

## 다음 단계

감사 보고서에서 `supported`로 확인된 데이터만 Phase 2의 Canvas 서비스 계층과 Phase 3의 MCP 도구로 구현합니다. 이후 Streamable HTTP MCP 서버를 홈서버에 배포하고, 실제 HTTPS 엔드포인트가 확정되면 `plugin.json`과 `mcp.json`을 포함한 비공개 CollegeHelper 플러그인 패키지를 생성합니다.

작동하지 않는 임시 MCP 주소를 저장소에 넣지 않습니다. 자세한 기준은 [개발 제안서](./CollegeHelper_개발_제안서.md)를 따릅니다.
