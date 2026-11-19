#!/usr/bin/env bash
# Test fixture: fake `curl` for deployment-flow behavior tests.
printf 'curl %s\n' "$*" >>"$COMMAND_LOG"
output='' format=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|--output) output="$2"; shift ;;
    -w|--write-out) format="$2"; shift ;;
  esac
  shift
done
if [ "$output" != /dev/null ]; then
  if [ "${CURL_BODY+x}" = x ]; then
    printf '%s\n' "$CURL_BODY"
  else
    printf '{"status":"ok","database":"connected"}\n'
  fi
fi
printf '%b' "${format//'%{http_code}'/${CURL_HTTP_CODE:-200}}"
exit "${CURL_EXIT_CODE:-0}"
