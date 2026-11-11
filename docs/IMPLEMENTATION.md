# CollegeHelper 구현 및 실행 가이드

이 문서는 CollegeHelper의 기술 구성, MCP 도구, 로컬 설정과 홈서버 배포 방법을 정리합니다. 프로젝트의 배경과 실제 사용 모습은 [메인 README](../README.md)에서 확인할 수 있습니다.

## 구현 범위

현재 구현은 다음 단계를 포함합니다.

- Canvas API 비식별 감사
- 과목·과제·제출 상태·공지·모듈 조회
- 읽기 전용 MCP 서버와 Streamable HTTP 엔드포인트
- Canvas 외부 LTI 강의자료실 목록 조회
- 원본 PDF 수집, 텍스트 추출과 영구 캐시
- OpenAI Secure MCP Tunnel을 통한 비공개 플러그인 연결

감사에서 정상 작동이 확인된 API만 MCP 도구로 제공합니다.

## 기술 스택

| 영역 | 기술 |
|---|---|
| Runtime | Node.js 22 |
| Language | TypeScript 6 |
| Protocol | Model Context Protocol, Streamable HTTP |
| Validation | Zod |
| Browser worker | Playwright, Chromium |
| Document extraction | Poppler `pdftotext` |
| Test | Vitest, ESLint, TypeScript type checking |
| Deployment | Docker Compose, systemd user service |
| Connection | OpenAI Secure MCP Tunnel |

## MCP 도구

| 도구 | 입력 요약 | 반환 데이터 |
|---|---|---|
| `list_courses` | 없음 | 현재 수강 과목과 원문 링크 |
| `get_today_tasks` | 날짜, 제출 상태 | 해당 날짜 과제와 본인 제출 상태 |
| `get_upcoming_tasks` | 시작일, 최대 31일, 제출 상태 | 기간 내 예정 과제 |
| `get_announcements` | 최근 일수 | 현재 과목의 최근 공지 |
| `get_course_modules` | 과목 ID | 학습 모듈과 공개 상태 |
| `get_course_module_items` | 과목 ID, 모듈 ID | 모듈의 과제·외부 학습자료 항목 |
| `get_assignment_context` | 과목 ID, 과제 ID | 과제 설명, 마감일과 제출 상태 |
| `list_course_learning_resources` | 과목 ID | LTI 강의자료 목록과 캐시 상태 |
| `get_learning_resource_text` | 과목 ID, 자료 ID, 오프셋 | PDF에서 추출한 텍스트 구간 |

모든 도구에는 `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`가 지정되어 있습니다. Canvas 설명, 공지와 강의자료 본문은 신뢰되지 않은 외부 콘텐츠로 취급합니다.

## 로컬 준비

Node.js 22 이상이 필요합니다.

```bash
npm install
cp .env.example .env
```

토큰이 화면이나 셸 기록에 남지 않도록 설정 스크립트를 사용합니다.

```bash
./scripts/configure-env.sh
```

스크립트는 토큰을 숨김 입력으로 받고 권한 `600`인 `.env`를 생성합니다. 기존 파일이 있으면 자동으로 덮어쓰지 않습니다.

```dotenv
CANVAS_BASE_URL=https://<CANVAS_DOMAIN>
CANVAS_ACCESS_TOKEN=<LOCAL_SECRET_ONLY>
```

실제 토큰을 채팅, 이슈, 커밋, 테스트 fixture 또는 감사 보고서에 넣지 마세요.

## 개발 및 검증

```bash
npm run check
npm run build
npm run dev
```

- MCP endpoint: `http://127.0.0.1:3000/mcp`
- Health check: `http://127.0.0.1:3000/healthz`

`npm run check`는 타입 검사, ESLint와 전체 Vitest 테스트를 순서대로 실행합니다.

## 읽기 전용 API 감사

실제 HY-ON 환경에서 지원되는 데이터만 확인하기 위해 비식별 감사를 실행합니다.

```bash
npm run audit
```

결과는 다음 파일로 생성됩니다.

- `reports/canvas-api-audit.json`
- `reports/canvas-api-audit.md`

보고서에는 엔드포인트 상태, 필드 이름과 항목 수만 기록합니다. 토큰, 이메일, 학번, 실제 본문, 성적과 서명된 다운로드 URL은 기록하지 않습니다.

## 강의자료 처리 흐름

HY-ON의 강의자료실은 Canvas 기본 Files API가 아니라 LTI 외부 학습도구입니다.

1. Canvas `tabs`와 `sessionless_launch` GET API로 자료실 진입 정보를 얻습니다.
2. 격리된 Playwright 워커가 자료 목록을 읽습니다.
3. 자료 요청 시 HY-CMS의 `original.pdf`를 임시로 수집합니다.
4. `pdftotext`로 텍스트를 추출합니다.
5. 원본 PDF를 삭제하고 텍스트만 Docker 볼륨에 저장합니다.
6. 다음 채팅과 컨테이너 재시작에서는 캐시된 텍스트를 반환합니다.

한 번에 반환하는 텍스트는 최대 20,000자이며 `offset`을 이용해 긴 문서를 이어서 읽습니다. 자세한 컴포넌트와 신뢰 경계는 [아키텍처 문서](./ARCHITECTURE.md)를 참고하세요.

## Docker 실행

로컬 `.env`를 준비한 뒤 서비스를 실행합니다.

```bash
docker compose up -d --build college-helper
curl http://127.0.0.1:3100/healthz
npm run smoke:mcp
```

`college-helper`와 `learning-resource-worker` 컨테이너는 읽기 전용 파일시스템과 `no-new-privileges`를 사용합니다. 강의자료 텍스트는 Git 저장소가 아닌 `learning-resource-cache` 볼륨에 저장됩니다.

일회성 Canvas 감사는 별도 프로필로 실행합니다.

```bash
docker compose --profile audit run --rm --user "$(id -u):$(id -g)" canvas-audit
```

외부 학습도구 브라우저 감사도 운영 워커와 분리되어 있습니다.

```bash
AUDIT_COURSE_ID=<SYNTHETIC_EXAMPLE_ID> \
  docker compose --profile browser-audit run --rm learning-resource-browser-audit
```

감사 워커는 HAR, 네트워크 응답 본문과 인증 쿠키를 저장하지 않습니다.

## Secure MCP Tunnel

OpenAI Platform에서 `tunnel_id`와 Tunnels Read + Use 권한의 Runtime API key를 준비한 뒤 다음 스크립트를 실행합니다.

```bash
./scripts/configure-openai-tunnel.sh
```

키는 사용자 홈 디렉터리 아래 로컬 시크릿 파일에 권한 `600`으로 저장되며 명령 인자와 Git 저장소에 포함되지 않습니다. `TUNNEL_CLIENT_ROOT`로 터널 클라이언트 경로를 변경할 수 있습니다.

설정 후 사용자 서비스로 실행합니다.

```bash
mkdir -p ~/.config/systemd/user
cp deploy/college-helper-tunnel.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now college-helper-tunnel.service
```

SSH 연결이 없어도 서비스를 유지하려면 서버 관리자가 한 번만 다음 명령을 실행해야 합니다.

```bash
sudo loginctl enable-linger "$USER"
```

## 구현 과정에서 해결한 문제

### 문서상 API와 실제 사용 가능한 API의 차이

Canvas 공식 문서의 엔드포인트를 곧바로 구현하지 않았습니다. 개인 토큰으로 비식별 감사를 수행하고 실제 HY-ON에서 `supported`로 확인된 데이터만 도구로 노출했습니다.

### Canvas Files API에 없는 강의자료

강의자료실이 별도 LTI 도구라는 사실을 확인한 뒤 공식 sessionless launch로 진입했습니다. 브라우저 감사에서는 자료 목록과 PDF 읽기 경로만 확인하고 응답 본문이나 세션 정보를 저장하지 않았습니다.

### 채팅 사이에서 사라지는 학습 맥락

PDF를 매번 다시 처리하지 않도록 추출 텍스트를 Docker 볼륨에 캐시했습니다. 원본 PDF는 남기지 않으며 캐시 응답에는 길이와 오프셋을 포함해 긴 자료도 나누어 읽을 수 있습니다.

### LMS 상태 변경 방지

Canvas API 요청을 GET으로 고정했습니다. LTI 사이트가 요구하는 로그인 핸드셰이크 외의 비-GET 요청은 Playwright 워커에서 차단하여 진도와 완료 상태가 변경되지 않도록 했습니다.

## 현재 제한 사항

- 개인 사용자 한 명을 위한 비공개 플러그인입니다.
- Canvas 쓰기, 과제 제출, 게시물 작성과 일정 수정은 지원하지 않습니다.
- 성적과 점수를 조회하거나 반환하지 않습니다.
- 현재 강의자료 원문 처리는 PDF에 집중되어 있습니다.
- 학교의 LTI 구성이나 HTML 구조가 바뀌면 자료실 어댑터를 다시 검증해야 합니다.

## 로드맵

- [x] Canvas API 비식별 감사
- [x] 과목·과제·제출 상태·공지·모듈 조회
- [x] ChatGPT 비공개 MCP 플러그인 연결
- [x] LTI 강의자료 목록 및 PDF 원문 추출
- [x] 재시작에도 유지되는 텍스트 캐시
- [ ] 변경된 강의자료의 캐시 갱신 정책
- [ ] 예약 작업 기반 일일 학습 브리핑 고도화
- [ ] PDF 외 문서 형식 지원 검토

보안 정책과 공개 저장소 점검 기준은 [보안 설계](./SECURITY.md)를 참고하세요.
