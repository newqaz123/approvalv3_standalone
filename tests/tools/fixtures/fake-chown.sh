#!/usr/bin/env bash
# Test-only ownership command; production uses the system chown via PATH.
echo "chown $*" >>"$COMMAND_LOG"
exit "${CHOWN_EXIT:-0}"
