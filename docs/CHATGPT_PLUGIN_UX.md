# CollegeHelper ChatGPT 플러그인 사용 흐름

## 제품 형태

CollegeHelper는 별도 웹페이지를 제공하는 서비스가 아니라 ChatGPT 입력창에서 선택하여 사용하는 개인용 비공개 플러그인입니다. ChatGPT가 사용자 인터페이스와 자연어 추론을 담당하고, CollegeHelper MCP 서버는 HY-ON Canvas의 최신 근거 데이터를 안전하게 제공합니다.

## 직접 사용 흐름

1. 사용자가 ChatGPT 입력창에서 플러그인 메뉴를 엽니다.
2. `CollegeHelper`를 선택합니다.
3. 입력창에 CollegeHelper 플러그인 참조가 표시됩니다.
4. 사용자가 자연어 프롬프트를 입력해 전송합니다.
5. ChatGPT가 요청에 필요한 CollegeHelper MCP 도구를 선택합니다.
6. 홈서버가 HY-ON Canvas API를 실시간으로 조회합니다.
7. CollegeHelper는 필요한 필드와 Canvas 원문 URL만 정규화해 반환합니다.
8. ChatGPT가 결과를 요약하고 일정 정리, 예습 또는 문제 풀이를 지원합니다.

## 예약 사용 흐름

예약 작업 프롬프트에도 CollegeHelper 플러그인 참조를 포함합니다.

```text
매일 오전 8시에 @CollegeHelper를 사용해서 오늘 마감 과제와
미제출 과제를 확인하고, 확인할 내용이 있을 때만 알려줘.
```

예약 작업은 실행 시점마다 최신 LMS 데이터를 조회해야 합니다. 변경이나 조치가 없으면 조용히 종료하고, 새 과제·임박한 마감·미제출 상태처럼 의미 있는 내용이 있을 때만 알립니다.

## 초기 MCP 도구 계약

| 도구 | 사용자 목적 |
|---|---|
| `get_today_tasks` | 오늘 마감되는 과제와 제출 상태 확인 |
| `get_upcoming_tasks` | 지정 기간의 과제와 일정 확인 |
| `get_announcements` | 최근 공지 조회 |
| `get_course_materials` | 모듈, 페이지와 강의자료 검색 |
| `get_assignment_context` | 과제 설명과 관련 학습자료 조회 |

도구 이름은 구현 과정에서 Canvas 감사 결과에 맞춰 조정할 수 있습니다. 실제 HY-ON 토큰으로 `supported`가 확인된 데이터만 노출합니다.

## 플러그인 연결

최종 비공개 플러그인 패키지는 다음 요소를 포함합니다.

- `plugin.json`: CollegeHelper 이름, 설명, 아이콘과 기본 프롬프트
- `mcp.json`: 홈서버의 검증된 Streamable HTTP MCP 엔드포인트
- 필요 시 `skills/`: 대학 생활 관련 도구 선택과 응답 원칙

홈서버 MCP 엔드포인트가 배포되고 검증되기 전에는 임시 URL로 `mcp.json`을 만들지 않습니다.

## 보안 경계

- Canvas 액세스 토큰은 홈서버 환경변수나 시크릿 저장소에만 둡니다.
- 토큰을 ChatGPT 프롬프트, 플러그인 패키지 또는 GitHub 저장소에 넣지 않습니다.
- 브라우저와 ChatGPT에는 질문에 필요한 정규화된 데이터만 반환합니다.
- 초기 버전의 Canvas 요청은 `GET`만 허용합니다.
- 과제 제출, 퀴즈 답안 전송, 게시물 작성은 초기 범위에서 제외합니다.

## 개발 파일과 사용자 경험의 구분

`tsconfig.json`, ESLint, Vitest, Dockerfile은 MCP 서버를 개발·검증·배포하기 위한 내부 파일입니다. 사용자는 ChatGPT에서 CollegeHelper를 선택하고 프롬프트를 입력할 뿐이며 이 파일을 직접 다루지 않습니다.
