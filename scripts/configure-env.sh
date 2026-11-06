#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${project_root}/.env"

if [[ -e "${env_file}" ]]; then
  printf '설정을 중단했습니다: %s 파일이 이미 존재합니다.\n' "${env_file}" >&2
  printf '기존 설정을 보존하려면 파일을 그대로 두세요. 다시 설정하려면 먼저 안전하게 백업하거나 이름을 변경하세요.\n' >&2
  exit 1
fi

umask 077

read -r -p 'HY-ON Canvas 기본 주소 (https://...): ' canvas_base_url
case "${canvas_base_url}" in
  https://*) ;;
  *)
    printf '오류: CANVAS_BASE_URL은 https://로 시작해야 합니다.\n' >&2
    exit 1
    ;;
esac

read -r -s -p 'Canvas 액세스 토큰 (화면에 표시되지 않음): ' canvas_access_token
printf '\n'

if [[ -z "${canvas_access_token}" ]]; then
  printf '오류: 액세스 토큰이 비어 있습니다.\n' >&2
  exit 1
fi

temporary_file="$(mktemp "${project_root}/.env.tmp.XXXXXX")"
cleanup() {
  unset canvas_access_token canvas_base_url
  if [[ -e "${temporary_file}" ]]; then
    rm -f -- "${temporary_file}"
  fi
}
trap cleanup EXIT

printf '%s\n' \
  "CANVAS_BASE_URL=${canvas_base_url}" \
  "CANVAS_ACCESS_TOKEN=${canvas_access_token}" \
  'CANVAS_REQUEST_TIMEOUT_MS=15000' \
  'AUDIT_MAX_PAGES=10' \
  'AUDIT_MAX_COURSES=3' \
  'REPORTS_DIR=reports' \
  'MCP_HOST=127.0.0.1' \
  'MCP_PORT=3000' \
  'TZ=Asia/Seoul' > "${temporary_file}"

chmod 600 "${temporary_file}"
mv -- "${temporary_file}" "${env_file}"
unset canvas_access_token canvas_base_url
trap - EXIT

printf 'Canvas 설정을 %s에 저장했습니다. 값은 출력하지 않았습니다.\n' "${env_file}"
printf '다음 명령으로 읽기 전용 감사를 실행하세요: npm run audit\n'
