#!/usr/bin/env bash
# Test fixture: fake `git` for deployment-flow behavior tests.
echo "git $*" >>"$COMMAND_LOG"
case "$*" in
  *'rev-parse --is-inside-work-tree'*) echo true ;;
  *'status --porcelain'*) printf '%s\n' "${DIRTY_TREE_OUTPUT:-}" ;;
  *'stash list -1'*) echo 'stash@{0} approval-deploy-test' ;;
  *'rev-parse --abbrev-ref HEAD'*) echo "${FAKE_GIT_BRANCH:-main}" ;;
  *'rev-parse HEAD'*) echo sha256:commit ;;
  *'rev-parse origin/main'*) echo sha256:commit ;;
esac
exit 0
