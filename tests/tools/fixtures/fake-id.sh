#!/usr/bin/env bash
# Test fixture: fake the effective UID without depending on the host account.
[ "$#" = 1 ] && [ "$1" = -u ] || exit 2
printf '%s\n' "${FAKE_UID:-0}"
