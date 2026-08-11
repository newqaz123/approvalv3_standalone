#!/usr/bin/env bash
# Test fixture: fake `curl` for deployment-flow behavior tests.
echo "curl $*" >>"$COMMAND_LOG"
if [ -n "$CURL_EXIT_CODE" ]; then exit "$CURL_EXIT_CODE"; fi
printf '{"status":"ok"}\n'
exit 0
