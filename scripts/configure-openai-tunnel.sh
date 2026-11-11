#!/usr/bin/env bash
set -euo pipefail

client_root="${TUNNEL_CLIENT_ROOT:-${HOME:?HOME 환경변수가 필요합니다}/apps/tunnel-client}"
client_binary="${client_root}/current/tunnel-client"
secret_directory="${client_root}/secrets"
key_file="${secret_directory}/runtime.key"
profile_name="college-helper"

if [[ ! -x "${client_binary}" ]]; then
  printf 'tunnel-client 실행 파일을 찾을 수 없습니다: %s\n' "${client_binary}" >&2
  exit 1
fi

printf 'OpenAI Platform에서 생성한 tunnel_id를 입력하세요: '
IFS= read -r tunnel_id
if [[ ! "${tunnel_id}" =~ ^tunnel_[A-Za-z0-9_-]+$ ]]; then
  printf 'tunnel_id 형식이 올바르지 않습니다.\n' >&2
  exit 1
fi

printf 'Tunnels Read + Use 권한이 있는 Runtime API key를 입력하세요(화면에 표시되지 않음): '
IFS= read -r -s runtime_key
printf '\n'
if [[ -z "${runtime_key}" ]]; then
  printf 'Runtime API key가 비어 있습니다.\n' >&2
  exit 1
fi

umask 077
mkdir -p "${secret_directory}"
temporary_key="$(mktemp "${secret_directory}/runtime.key.XXXXXX")"
trap 'rm -f "${temporary_key}"' EXIT
printf '%s' "${runtime_key}" > "${temporary_key}"
chmod 600 "${temporary_key}"
mv "${temporary_key}" "${key_file}"
trap - EXIT
unset runtime_key

"${client_binary}" init \
  --sample sample_mcp_remote_no_auth \
  --profile "${profile_name}" \
  --tunnel-id "${tunnel_id}" \
  --mcp-server-url "http://127.0.0.1:3100/mcp" \
  --control-plane-api-key-ref "file:${key_file}" \
  --health-listen-addr "127.0.0.1:8181"

printf '\n터널 프로필이 생성되었습니다. 다음 명령으로 점검하세요.\n'
printf '%q doctor --profile %q --explain\n' "${client_binary}" "${profile_name}"
