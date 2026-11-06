# CollegeHelper

한양대학교 HY-ON(Canvas LMS)에서 개인 액세스 토큰으로 조회 가능한 읽기 API를 안전하게 조사하고, 이후 검증된 데이터만 MCP 도구로 제공하는 개인용 대학 생활 도우미 프로젝트입니다.

현재 구현 범위는 **Phase 0(프로젝트 초기화)** 과 **Phase 1(API 감사 도구)** 입니다. MCP 도구와 Canvas 쓰기 요청은 아직 포함하지 않습니다.

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

## 다음 단계

감사 보고서에서 `supported`로 확인된 데이터만 Phase 2의 Canvas 서비스 계층과 Phase 3의 MCP 도구로 구현합니다. 자세한 기준은 [개발 제안서](./GPAI_개인용_Canvas_MCP_개발_제안서.md)를 따릅니다.
