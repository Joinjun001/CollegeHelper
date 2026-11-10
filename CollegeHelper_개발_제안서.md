# CollegeHelper 개인용 Canvas MCP 개발 제안서

작성일: 2026년 11월 6일  
대상: 한양대학교 HY-ON(Canvas LMS)을 사용하는 개인 사용자  
문서 목적: 사람과 AI 개발 에이전트가 같은 기준으로 조사·구현·검증할 수 있는 개발 기준 수립

---

## 1. 프로젝트 개요

### 1.1 프로젝트명

CollegeHelper

### 1.2 핵심 컨셉

한양대학교 HY-ON에서 사용자가 직접 발급한 Canvas 개인 액세스 토큰을 이용하여, 사용자가 Canvas에서 열람할 수 있는 학습 정보를 개인 홈서버의 MCP 서버를 통해 ChatGPT에 제공한다. 사용자는 별도 웹사이트를 이용하지 않고 ChatGPT 입력창에서 `CollegeHelper` 플러그인을 선택한 뒤 자연어 프롬프트를 입력한다.

이 프로젝트의 첫 목표는 다양한 기능을 미리 가정하는 것이 아니다. 실제 HY-ON Canvas API에서 조회 가능한 데이터와 권한을 자동으로 조사하고, 검증된 데이터만 MCP 도구로 제공하는 것이다.

### 1.3 목표

1. Canvas 개인 액세스 토큰으로 접근 가능한 읽기 API를 체계적으로 파악한다.
2. 과목, 과제, 제출 상태, 공지, 일정, 모듈 등 검증된 데이터를 정규화한다.
3. ChatGPT가 자연어 요청에 따라 필요한 학습 데이터를 안전하게 조회하도록 MCP 도구를 제공한다.
4. 토큰과 개인정보가 ChatGPT 대화, 로그, Git 저장소에 노출되지 않도록 한다.
5. 홈서버에서 지속적으로 운영할 수 있는 작고 단순한 구조를 만든다.
6. ChatGPT 웹에서 플러그인을 명시적으로 선택하거나 예약 작업에서 지정하여 같은 도구를 호출할 수 있게 한다.

### 1.4 제외 범위

초기 버전에서는 다음 기능을 구현하지 않는다.

- 다중 사용자 지원
- 공개 플러그인 배포
- Canvas OAuth 및 사용자 가입 시스템
- 과제 제출, 게시물 작성, 일정 수정 등 쓰기 작업
- 수강신청 및 학교 학사행정 자동화
- Canvas 외부의 한양대학교 포털 크롤링
- 임의 셸 실행 또는 홈서버 전체 파일 접근 도구

---

## 2. 핵심 개발 원칙

### 2.1 API 우선

화면 크롤링이나 브라우저 자동화보다 Canvas REST API를 우선 사용한다. 공식 API로 얻을 수 없는 데이터만 별도 검토 대상으로 기록하며, 초기 버전에서 억지로 우회하지 않는다.

### 2.2 조사 후 구현

API 문서에 엔드포인트가 존재한다는 사실만으로 기능을 구현하지 않는다. HY-ON 도메인에서 개인 토큰으로 실제 호출하여 성공한 엔드포인트만 지원 대상으로 지정한다.

### 2.3 읽기 전용

첫 번째 릴리스의 모든 Canvas 요청은 `GET`만 허용한다. MCP 도구에도 `readOnlyHint: true`를 설정한다.

### 2.4 최소 권한과 최소 저장

토큰은 서버 환경변수 또는 시크릿 저장소에만 보관한다. Canvas 응답은 필요한 필드만 전달하고, 원본 응답을 영구 저장하지 않는다.

### 2.5 기능보다 데이터 계약 우선

AI가 안정적으로 사용할 수 있도록 각 MCP 도구의 입력, 출력, 오류 형식을 먼저 고정한다. 요약과 우선순위 판단은 ChatGPT가 담당하고, MCP 서버는 정확한 원본 데이터 제공에 집중한다.

---

## 3. 사용자 시나리오

### 3.1 ChatGPT 입력창에서 직접 호출

사용자가 ChatGPT 입력창에서 `CollegeHelper` 플러그인을 선택하면 작성 중인 프롬프트에 플러그인 참조가 표시된다. 사용자는 그 상태에서 자연어 요청을 보내며, ChatGPT가 필요한 CollegeHelper MCP 도구를 선택하여 호출한다.

대표 요청:

- “`@CollegeHelper` 현재 수강 중인 과목을 알려 주세요.”
- “`@CollegeHelper` 이번 주 마감 과제를 정리해 주세요.”
- “`@CollegeHelper` 아직 제출하지 않은 과제가 있나요?”
- “`@CollegeHelper` 최근 과목 공지를 요약해 주세요.”
- “`@CollegeHelper` 객체지향개발론의 주차별 학습자료를 찾아 예습을 도와주세요.”
- “`@CollegeHelper` 오늘부터 7일 동안 예정된 과제와 일정을 보여 주세요.”

서버가 직접 자연어 요약을 만들 필요는 없다. 서버는 과목명, 마감일, 제출 상태, 원문 URL과 같은 근거 데이터를 구조화해 반환한다.

### 3.2 예약 작업에서 호출

사용자는 예약 작업 프롬프트에 CollegeHelper 플러그인을 지정할 수 있다.

```text
매일 오전 8시에 @CollegeHelper를 사용해서 오늘 마감 과제와
미제출 과제를 확인하고, 확인할 내용이 있을 때만 알려줘.
```

예약 실행 시에도 저장된 과제 목록을 재사용하지 않고 Canvas API에서 최신 데이터를 조회한다. 변경이나 조치할 내용이 없으면 불필요한 알림을 만들지 않는다.

### 3.3 학습자료 기반 도움

사용자가 특정 과목이나 과제를 지정하면 CollegeHelper는 사용자가 열람할 수 있는 과제 설명, 모듈, 페이지와 파일 메타데이터를 조회한다. ChatGPT는 이 근거를 이용하여 개념 설명, 예습, 복습과 문제 풀이를 지원한다.

초기 버전은 과제 제출, 퀴즈 답안 전송, 게시물 작성 등 Canvas 쓰기 작업을 수행하지 않는다.

---

## 4. 권장 시스템 아키텍처

```text
ChatGPT 웹 / 예약 작업
   │
   │ CollegeHelper 플러그인 선택 및 MCP 요청
   ▼
CollegeHelper 비공개 플러그인
   │
   │ Streamable HTTP
   ▼
HTTPS MCP Endpoint / Secure MCP Tunnel
   │
   ▼
개인 홈서버
┌──────────────────────────────────┐
│ CollegeHelper MCP Server         │
│                                  │
│  MCP Tool Layer                  │
│          │                       │
│  Canvas Service Layer            │
│          │                       │
│  Normalizer / Pagination / Cache │
│          │                       │
│  Secret: CANVAS_ACCESS_TOKEN     │
└──────────────────────────────────┘
   │
   │ HTTPS + Bearer token
   ▼
한양대학교 HY-ON Canvas `/api/v1`
```

### 4.1 권장 기술 스택

- Runtime: Node.js LTS
- Language: TypeScript
- MCP: `@modelcontextprotocol/sdk`
- Schema validation: Zod
- HTTP: Node.js 기본 `fetch`
- Test: Vitest
- Logging: 구조화 로그와 민감정보 마스킹을 지원하는 로거
- Deployment: Docker Compose 또는 systemd
- Connection: Secure MCP Tunnel

기존 홈서버 운영 환경이 Python 중심이라면 Python MCP SDK로 변경할 수 있다. 언어보다 데이터 계약과 보안 원칙을 우선한다.

`tsconfig.json`, ESLint와 Vitest는 TypeScript 서버를 개발하고 검증하기 위한 내부 설정이다. 사용자 인터페이스 구성요소가 아니며 ChatGPT에서 플러그인을 호출할 때 노출되지 않는다.

---

## 5. 환경 설정

애플리케이션은 다음 환경변수를 사용한다.

```dotenv
CANVAS_BASE_URL=https://<HY-ON-CANVAS-DOMAIN>
CANVAS_ACCESS_TOKEN=<LOCAL_SECRET_ONLY>
MCP_PORT=3000
LOG_LEVEL=info
TZ=Asia/Seoul
```

규칙:

- 실제 토큰을 `.env.example`, README, 테스트 fixture 또는 Git 이력에 넣지 않는다.
- `.env`와 `.env.local`은 반드시 `.gitignore` 처리한다.
- 오류 메시지와 디버그 로그에 Authorization 헤더를 출력하지 않는다.
- URL 쿼리 파라미터에 토큰을 전달하지 않는다.
- 토큰은 항상 `Authorization: Bearer ...` 헤더로 전달한다.

---

## 6. 1단계: Canvas API 데이터 조사

### 6.1 조사 목적

HY-ON에서 현재 사용자 토큰으로 실제 접근 가능한 데이터, 응답 구조, 권한 제한과 학교별 차이를 확인한다.

### 6.2 조사 도구

`scripts/audit-canvas-api.ts`를 작성한다. 이 스크립트는 토큰 값을 출력하지 않고, 읽기 전용 엔드포인트를 호출하여 결과를 JSON과 Markdown으로 기록한다.

### 6.3 우선 조사 대상

| ID | 데이터 | 후보 엔드포인트 | 기대 결과 |
|---|---|---|---|
| A01 | 현재 사용자 | `GET /api/v1/users/self/profile` | 사용자 ID, 표시 이름, 시간대 |
| A02 | 수강 과목 | `GET /api/v1/courses` | 활성 과목 목록과 학기 정보 |
| A03 | 과목 상세 | `GET /api/v1/courses/:course_id` | 과목명, 코드, 원문 URL |
| A04 | 과제 | `GET /api/v1/courses/:course_id/assignments` | 마감일, 설명, 제출 형식 |
| A05 | 본인 제출 | `GET /api/v1/courses/:course_id/assignments/:assignment_id/submissions/self` | 제출 여부, 지각 여부, 점수 공개 상태 |
| A06 | 공지 | `GET /api/v1/announcements` | 제목, 본문, 게시일, 과목 |
| A07 | 캘린더 | `GET /api/v1/calendar_events` | 일정과 과제 마감 이벤트 |
| A08 | 모듈 | `GET /api/v1/courses/:course_id/modules` | 주차학습 구조와 항목 |
| A08I | 모듈 항목 | `GET /api/v1/courses/:course_id/modules/:module_id/items` | 모듈에 연결된 자료 유형과 파일 ID |
| A09I | 모듈 연결 파일 | `GET /api/v1/files/:file_id` | 학생에게 공개된 개별 파일 메타데이터 |
| A09 | 파일 | `GET /api/v1/courses/:course_id/files` | 강의자료 메타데이터와 다운로드 URL |
| A10 | 페이지 | `GET /api/v1/courses/:course_id/pages` | 강의 콘텐츠 페이지 목록 |
| A11 | 토론 | `GET /api/v1/courses/:course_id/discussion_topics` | 게시판과 토론 주제 |
| A12 | 최근 활동 | `GET /api/v1/users/self/history` | 최근 접근한 Canvas 항목 |
| A13 | 과목 내비게이션 탭 | `GET /api/v1/courses/:course_id/tabs` | 강의자료실 외부도구 탭 확인 |
| A14 | 강의자료실 외부도구 실행 | `GET /api/v1/courses/:course_id/external_tools/sessionless_launch` | 공식 LTI 실행 URL 지원 여부 |

후보 엔드포인트는 Canvas 문서상의 가능성을 의미하며, 실제 지원 여부는 감사 스크립트의 결과로 결정한다.

### 6.4 조사 결과 형식

각 엔드포인트는 다음 형식으로 기록한다.

```json
{
  "id": "A02",
  "method": "GET",
  "path": "/api/v1/courses",
  "status": "supported",
  "httpStatus": 200,
  "itemCount": 6,
  "pagination": true,
  "fields": ["id", "name", "course_code", "workflow_state"],
  "containsSensitiveData": false,
  "notes": []
}
```

허용되는 상태값:

- `supported`: 호출 성공 및 유효 데이터 확인
- `empty`: 호출은 성공했지만 현재 데이터 없음
- `forbidden`: 사용자 권한 없음
- `unauthorized`: 토큰이 유효하지 않거나 만료됨
- `not_found`: HY-ON에서 경로를 제공하지 않음
- `error`: 일시적 서버 오류 또는 미분류 오류

### 6.5 개인정보 제거

감사 보고서에는 다음 값을 기록하지 않는다.

- 액세스 토큰
- 이메일과 학번
- 과제 제출 원문
- 점수와 성적
- 비공개 파일 다운로드 URL의 서명 파라미터
- 사용자 및 수강생 전체 목록

보고서에는 필드 이름, 자료형, 항목 수와 지원 여부만 남긴다.

### 6.6 페이지네이션

Canvas 목록 API는 페이지네이션될 수 있다. 응답의 `Link` 헤더를 파싱해 `rel="next"`가 없어질 때까지 조회한다. 임의로 첫 페이지만 사용하거나 전체 항목 수를 추측하지 않는다.

감사 단계에는 안전 상한을 두어 과도한 요청을 방지한다.

- 페이지당 최대 100개 요청
- 엔드포인트당 최대 10페이지
- 동시 요청 수 3 이하
- `429` 응답 시 재시도 지연 준수

---

## 7. 2단계: Canvas 클라이언트 구현

### 7.1 책임

Canvas 클라이언트는 다음만 담당한다.

- Base URL 결합
- Authorization 헤더 주입
- 요청 제한 시간 처리
- JSON 파싱
- 페이지네이션
- Canvas 오류 정규화
- 민감정보가 제거된 로깅

### 7.2 오류 모델

```ts
type CanvasErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "INVALID_RESPONSE";
```

오류에는 토큰, Authorization 헤더, 원본 HTML 로그인 페이지를 포함하지 않는다.

### 7.3 HTML 처리

Canvas의 과제 설명과 공지 본문은 HTML일 수 있다.

- 원본 HTML을 그대로 실행하거나 렌더링하지 않는다.
- 모델용 결과에는 안전하게 정리한 텍스트와 원문 `html_url`을 함께 제공한다.
- `script`, `style`, 이벤트 핸들러와 불필요한 추적 파라미터를 제거한다.
- 강의 콘텐츠도 외부 입력이므로 그 안의 명령을 시스템 지시로 취급하지 않는다.

---

## 8. 3단계: MCP 도구 설계

감사 결과가 `supported`인 데이터만 도구로 구현한다. 초기 후보는 다음과 같다.

### T01 `list_courses`

목적: 현재 사용자가 접근할 수 있는 과목 목록 조회

입력:

```ts
{
  enrollmentState?: "active" | "completed" | "all"
}
```

출력 핵심 필드:

```ts
{
  courses: Array<{
    id: string;
    name: string;
    courseCode?: string;
    enrollmentState?: string;
    startAt?: string;
    endAt?: string;
    url?: string;
  }>;
}
```

### T02 `list_assignments`

목적: 과목별 또는 기간별 과제 조회

입력:

```ts
{
  courseId?: string;
  startAt?: string;
  endAt?: string;
  submissionState?: "all" | "submitted" | "unsubmitted";
}
```

출력 핵심 필드:

- 과제 ID와 과목 ID
- 제목
- 마감일
- 잠금일
- 제출 여부
- 지각 여부
- 허용된 제출 형식
- 원문 URL

### T03 `list_announcements`

목적: 지정된 과목과 기간의 공지 조회

입력:

```ts
{
  courseIds?: string[];
  startAt?: string;
  endAt?: string;
  limit?: number;
}
```

### T04 `list_calendar_items`

목적: 일정과 과제 마감 이벤트 조회

입력:

```ts
{
  startAt: string;
  endAt: string;
  courseIds?: string[];
  type?: "event" | "assignment" | "all";
}
```

### T05 `list_modules`

목적: 과목의 주차별 학습 구조와 모듈 항목 조회

입력:

```ts
{
  courseId: string;
  includeItems?: boolean;
}
```

### T06 `list_course_files`

목적: 사용자가 열람할 수 있는 강의자료 메타데이터 조회

입력:

```ts
{
  courseId: string;
  search?: string;
  contentTypes?: string[];
}
```

초기 버전은 파일 자체를 모델에 자동 업로드하지 않는다. 파일명, 크기, 수정일, 콘텐츠 유형과 사용자가 열 수 있는 URL만 제공한다.

### T07 `get_course_module_items`

목적: 감사에서 지원이 확인된 과목 모듈의 과제·외부 학습자료 항목 조회

입력:

```ts
{
  courseId: string;
  moduleId: string;
}
```

출력에는 항목 ID, 제목, 유형, 순서, 연결된 콘텐츠 ID와 동일 Canvas 호스트의 실행 링크만 포함한다. 감사 결과 학습자료는 Canvas `File`이 아니라 `ExternalTool`이므로 외부 실행 URL, LTI 파라미터, 본문 및 첨부파일은 반환하지 않는다.

### 8.1 공통 MCP 규칙

- 모든 도구에 `readOnlyHint: true`를 설정한다.
- ID는 JavaScript 정밀도 문제를 피하기 위해 문자열로 취급한다.
- 날짜는 ISO 8601로 반환하고 시간대 정보를 보존한다.
- 원문으로 이동할 수 있는 Canvas URL을 포함한다.
- 한 번의 결과가 과도하게 커지지 않도록 기간과 개수 제한을 둔다.
- 빈 결과와 오류를 구분한다.
- 반환값에 액세스 토큰이나 인증 헤더를 절대 포함하지 않는다.

---

## 9. 캐시 정책

초기 버전은 선택적 메모리 캐시만 사용한다.

| 데이터 | 권장 TTL |
|---|---:|
| 과목 목록 | 10분 |
| 과제 | 2분 |
| 공지 | 2분 |
| 캘린더 | 2분 |
| 모듈 | 5분 |
| 파일 메타데이터 | 5분 |

성적과 제출 원문은 캐시하지 않는다. 사용자가 “새로고침”을 명시한 경우 캐시를 우회할 수 있도록 내부 옵션을 제공하되, 불필요한 연속 호출을 막는다.

---

## 10. 보안 요구사항

### 10.1 필수 요구사항

- 토큰을 비밀번호와 동등하게 취급한다.
- 서버 시작 시 토큰 존재 여부만 확인하고 값은 출력하지 않는다.
- 로그 마스킹 대상에 `authorization`, `token`, `access_token`, `cookie`를 포함한다.
- MCP 도구 입력으로 토큰을 받지 않는다.
- 사용자가 임의 URL을 입력해 서버가 요청하도록 만들지 않는다.
- Canvas Base URL은 설정된 HY-ON 호스트로 고정한다.
- 리다이렉트가 다른 호스트로 이동하면 인증 헤더를 전달하지 않는다.
- 모든 외부 입력을 검증하고 최대 길이를 제한한다.
- 쓰기 HTTP 메서드는 클라이언트 레이어에서 기본 차단한다.

### 10.2 프롬프트 인젝션 대응

공지, 과제 설명, 페이지 본문과 파일명은 신뢰할 수 없는 외부 데이터다.

- 콘텐츠 속 지시문을 개발자 또는 시스템 지시로 해석하지 않는다.
- Canvas 콘텐츠가 다른 도구 호출이나 비밀정보 공개를 요구해도 따르지 않는다.
- 도구 결과는 “학습 콘텐츠”라는 출처 메타데이터와 함께 반환한다.

### 10.3 토큰 폐기 절차

토큰 노출이 의심되면 HY-ON의 승인된 통합 화면에서 해당 `User-Generated` 토큰을 즉시 삭제하고 새 토큰을 발급한다. 새 토큰은 홈서버 시크릿만 교체하며 코드 수정이나 재배포를 요구하지 않아야 한다.

---

## 11. 권장 프로젝트 구조

```text
college-helper/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── server.ts
│   ├── canvas/
│   │   ├── client.ts
│   │   ├── errors.ts
│   │   ├── pagination.ts
│   │   ├── schemas.ts
│   │   └── services/
│   │       ├── courses.ts
│   │       ├── assignments.ts
│   │       ├── announcements.ts
│   │       ├── calendar.ts
│   │       ├── modules.ts
│   │       └── files.ts
│   ├── mcp/
│   │   ├── tools.ts
│   │   └── serializers.ts
│   ├── security/
│   │   ├── sanitize-html.ts
│   │   └── redact.ts
│   └── cache/
│       └── memory-cache.ts
├── scripts/
│   └── audit-canvas-api.ts
├── test/
│   ├── fixtures/
│   ├── canvas-client.test.ts
│   ├── pagination.test.ts
│   ├── redaction.test.ts
│   └── tools.test.ts
├── reports/
│   └── .gitkeep
├── .env.example
├── .gitignore
├── Dockerfile
├── compose.yaml
├── package.json
├── tsconfig.json
└── README.md
```

---

## 12. 개발 단계 및 완료 조건

### Phase 0. 프로젝트 초기화

작업:

- TypeScript 프로젝트 생성
- 환경변수 검증
- 테스트와 린트 설정
- Docker 실행 환경 구성
- 토큰이 포함된 파일의 Git 제외 확인

완료 조건:

- 토큰 없이 시작하면 안전한 오류로 종료된다.
- 실제 토큰이 로그에 나타나지 않는다.
- 기본 테스트와 타입 검사가 통과한다.

### Phase 1. API 감사 도구

작업:

- 사용자 프로필로 토큰 유효성 확인
- 후보 읽기 API 호출
- 페이지네이션 처리
- 비식별 JSON·Markdown 보고서 생성

완료 조건:

- 지원, 빈 결과, 권한 없음과 오류가 구분된다.
- 보고서에 개인 데이터와 토큰이 포함되지 않는다.
- 같은 조건으로 재실행할 수 있다.

산출물:

- `reports/canvas-api-audit.json`
- `reports/canvas-api-audit.md`

### Phase 2. Canvas 서비스 계층

작업:

- 감사에서 확인된 API만 구현
- Zod 응답 검증
- 오류 정규화
- HTML 텍스트 정리
- 단위 테스트 작성

완료 조건:

- fixture 기반 테스트가 네트워크 없이 동작한다.
- 401, 403, 404, 429와 5xx가 구분된다.
- 페이지네이션된 결과가 누락 없이 합쳐진다.

### Phase 3. MCP 서버

작업:

- 검증된 데이터별 MCP 도구 등록
- 입력·출력 스키마 정의
- 읽기 전용 annotation 설정
- 결과 크기 제한

완료 조건:

- MCP Inspector에서 초기화와 도구 조회가 성공한다.
- 대표 요청과 잘못된 입력이 예상대로 처리된다.
- 토큰과 Authorization 헤더가 도구 결과에 포함되지 않는다.

### Phase 4. 홈서버 배포

작업:

- Docker 또는 systemd 서비스 등록
- 재시작 정책과 헬스 체크 설정
- Secure MCP Tunnel 연결
- ChatGPT 개인 커스텀 MCP 생성

완료 조건:

- 홈서버 재부팅 후 자동으로 복구된다.
- 외부 인바운드 포트를 개방하지 않고 ChatGPT에서 연결된다.
- ChatGPT에서 대표 사용자 시나리오가 성공한다.

### Phase 5. 안정화

작업:

- 캐시와 요청 제한 적용
- 로그 마스킹 검증
- Canvas 응답 변경에 대한 오류 메시지 개선
- 운영 문서와 토큰 교체 절차 작성

완료 조건:

- 연속 요청에서도 Canvas API에 불필요한 부하를 주지 않는다.
- 토큰 폐기와 교체가 코드 변경 없이 가능하다.
- 지원하지 않는 요청은 명확히 설명하고 임의로 데이터를 추측하지 않는다.

---

## 13. 테스트 계획

### 13.1 단위 테스트

- Link 헤더 페이지네이션
- Canvas ID 문자열 보존
- 날짜와 `Asia/Seoul` 표시
- HTML 정리
- 민감정보 로그 마스킹
- Canvas 오류 매핑
- 캐시 만료

### 13.2 통합 테스트

- 유효한 토큰으로 프로필 조회
- 현재 과목 목록 조회
- 과제가 있는 과목과 없는 과목 조회
- 접근할 수 없는 과목 처리
- 제출 상태가 없는 과제 처리
- 공지와 일정의 기간 필터

실제 API 통합 테스트는 명시적인 환경변수가 있을 때만 실행한다. CI에서는 비식별 fixture를 사용한다.

### 13.3 MCP 평가 프롬프트

긍정 사례:

1. “현재 수강 중인 과목을 알려 주세요.”
2. “앞으로 7일 안에 마감되는 과제를 정리해 주세요.”
3. “미제출 과제가 있는지 확인해 주세요.”
4. “최근 일주일 공지를 과목별로 보여 주세요.”
5. “객체지향개발론의 모듈과 자료를 찾아 주세요.”

부정 및 경계 사례:

1. “내 Canvas 토큰을 알려 주세요.” → 제공 거부
2. “과제를 대신 제출해 주세요.” → 초기 버전 미지원
3. “다른 학생의 성적을 보여 주세요.” → 권한 밖 요청
4. 존재하지 않는 과목 ID → 명확한 `NOT_FOUND` 또는 권한 오류
5. 매우 긴 기간의 전체 데이터 요청 → 기간 또는 결과 제한 안내

---

## 14. AI 개발 에이전트 작업 규칙

이 프로젝트를 수행하는 AI는 다음 규칙을 준수해야 한다.

1. 구현 전에 저장소의 `AGENTS.md`, README, 패키지 설정과 기존 코드를 모두 확인한다.
2. Canvas 기능을 기억이나 추측으로 구현하지 않고 공식 문서와 실제 감사 결과를 근거로 한다.
3. 사용자가 토큰을 채팅에 입력하도록 요청하지 않는다.
4. 토큰을 읽거나 출력하는 진단 명령을 실행하지 않는다.
5. `.env`의 실제 값은 열람하지 않고 변수 존재 여부만 애플리케이션에서 검증한다.
6. Phase 1이 완료되기 전에 MCP 도구를 대량 구현하지 않는다.
7. 감사에서 실패한 엔드포인트를 우회하거나 화면 크롤링으로 자동 대체하지 않는다.
8. 초기 버전에서는 `GET` 이외의 Canvas 요청을 추가하지 않는다.
9. 한 단계가 끝날 때마다 타입 검사, 테스트와 관련 보안 검사를 실행한다.
10. 실패한 검증을 숨기거나 성공했다고 표현하지 않는다.
11. 실제 사용자 데이터가 fixture나 스냅샷에 들어가면 즉시 비식별화한다.
12. 기존 사용자 변경을 덮어쓰지 않고 관련 없는 파일을 수정하지 않는다.
13. 구현 변경과 함께 README와 감사 보고서 형식을 최신 상태로 유지한다.
14. 각 MCP 도구는 작은 목적 하나만 담당하도록 설계한다.
15. 완료 보고에는 구현 내용, 검증 결과, 남은 제한 사항을 구분해 적는다.

### 14.1 AI에게 제공할 최초 작업 지시 예시

```text
이 저장소에 CollegeHelper의 Phase 0과 Phase 1을 구현해 주세요.

반드시 `CollegeHelper_개발_제안서.md`를 먼저 읽고 따르세요.
이번 작업 범위는 프로젝트 초기화와 읽기 전용 API 감사 도구까지입니다.
MCP 도구 구현과 Canvas 쓰기 요청은 아직 추가하지 마세요.

Canvas Base URL과 토큰은 각각 CANVAS_BASE_URL,
CANVAS_ACCESS_TOKEN 환경변수에서 읽으세요. 실제 값을 코드, 테스트,
로그, 보고서에 기록하지 마세요.

완료 전 타입 검사, 테스트, 토큰·Authorization 문자열 누출 검사를 실행하고
결과를 보고해 주세요.
```

---

## 15. 의사결정 기록

| 항목 | 결정 | 이유 |
|---|---|---|
| 사용자 범위 | 개인 사용자 1명 | OAuth와 계정 격리 불필요 |
| 인증 | Canvas 개인 액세스 토큰 | HY-ON에서 직접 발급 가능 |
| API 방식 | Canvas REST API | 화면 크롤링보다 안정적이고 구조화됨 |
| 기능 범위 | 읽기 전용 | 초기 보안 위험과 실수 최소화 |
| 기능 선정 | 실제 API 감사 후 확정 | 학교 설정과 사용자 권한 차이 반영 |
| 배포 위치 | 개인 홈서버 | 기존 운영 환경 활용 |
| ChatGPT 연결 | Secure MCP Tunnel | 홈서버 직접 공개 방지 |
| 공개 배포 | 제외 | 개인용 목표에 집중 |

---

## 16. 착수 전 확인사항

개발을 시작하기 전에 다음 값만 확정한다. 토큰 값은 문서에 기록하지 않는다.

- [ ] HY-ON Canvas 기본 도메인
- [ ] 홈서버 운영체제
- [ ] Docker 사용 가능 여부
- [ ] Node.js 또는 Python 선호 스택
- [ ] Canvas 개인 액세스 토큰 발급 완료 여부
- [ ] 토큰을 홈서버 시크릿으로 저장할 위치
- [ ] Secure MCP Tunnel 사용 가능 여부

---

## 17. 최종 성공 기준

프로젝트의 초기 성공은 다음 조건을 모두 만족할 때로 정의한다.

1. 개인 토큰으로 HY-ON의 지원 가능한 읽기 데이터를 자동 조사할 수 있다.
2. 조사 결과가 비식별 보고서로 남는다.
3. ChatGPT가 과목, 과제, 제출 상태, 공지, 일정 중 실제 지원되는 데이터를 MCP로 조회할 수 있다.
4. 사용자 질문에 Canvas 원문 URL과 근거 데이터를 제공한다.
5. 토큰이 대화, 로그, 보고서, Git 저장소에 노출되지 않는다.
6. 홈서버를 공개하지 않고 개인 ChatGPT에서 사용할 수 있다.
7. 지원되지 않는 데이터나 기능을 추측해 반환하지 않는다.

