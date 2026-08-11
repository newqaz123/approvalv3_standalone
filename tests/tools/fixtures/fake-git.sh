#!/usr/bin/env bash
# Test fixture: fake `git` for deployment-flow behavior tests.
echo "git $*" >>"$COMMAND_LOG"
exit 0
