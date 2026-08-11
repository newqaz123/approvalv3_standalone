#!/usr/bin/env bash
# Test-only stat command used to make root ownership observable without privilege.
echo "stat $*" >>"$COMMAND_LOG"
printf '%s\n' "${STAT_UID:-0}"
