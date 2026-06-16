# Deployment Manager Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make update, backup, and restore safer for existing VPS installations without losing data.

**Architecture:** Keep the existing Bash scripts as the operational layer and the Node manager as the interactive layer. Add small, testable pure helpers in `tools/manage.mjs` for branch/status messaging and backup display, while Bash scripts handle Docker/Postgres operations directly.

**Tech Stack:** Node.js test runner, Bash, Docker Compose, PostgreSQL `pg_dump`/`psql`.

---

### Task 1: Manager Safety Prompts

**Files:**
- Modify: `tools/manage.mjs`
- Test: `tests/tools/manage.test.mjs`

- [ ] **Step 1: Write failing tests**

Add tests for backup metadata parsing and git update labeling:

```js
test('formatBackupChoice hides zero-byte backups and shows user rows', async () => {
  const { formatBackupChoice } = await import('../../tools/manage.mjs')
  const result = formatBackupChoice({
    path: 'backups/db_20260615_155300.sql',
    sizeBytes: 69632,
    userRows: 6,
  })
  assert.equal(result, 'backups/db_20260615_155300.sql (68 KB, users: 6)')
})
```

- [ ] **Step 2: Run red test**

Run: `npm run test:manage`

Expected: fail because `formatBackupChoice` does not exist.

- [ ] **Step 3: Implement helper and menu wording**

Export helper functions for formatting backup choices and update source labels. Change update option text to “Git update from current branch”.

- [ ] **Step 4: Run green test**

Run: `npm run test:manage`

Expected: pass.

### Task 2: Deploy Branch Safety

**Files:**
- Modify: `scripts/deploy.sh`
- Test: `tests/tools/manage.test.mjs`

- [ ] **Step 1: Write failing text test**

Add a test that reads `scripts/deploy.sh` and asserts it pulls `${CURRENT_BRANCH}` instead of hardcoded `main`.

- [ ] **Step 2: Run red test**

Run: `npm run test:manage`

Expected: fail because deploy still contains `git pull origin main`.

- [ ] **Step 3: Implement deploy branch detection**

Detect current branch with `git rev-parse --abbrev-ref HEAD`, print current branch/commit, and run `git pull --ff-only origin "$CURRENT_BRANCH"`. If branch is unavailable, skip git pull with a warning.

- [ ] **Step 4: Run green test**

Run: `npm run test:manage`

Expected: pass.

### Task 3: Backup and Restore Data Safety

**Files:**
- Modify: `scripts/backup.sh`
- Modify: `scripts/restore.sh`
- Test: `tests/tools/manage.test.mjs`

- [ ] **Step 1: Write failing text tests**

Add tests that verify `backup.sh` uses retention count `10`, warns on zero users, and `restore.sh` drops/recreates schema before importing.

- [ ] **Step 2: Run red test**

Run: `npm run test:manage`

Expected: fail because current scripts do not include these safeguards.

- [ ] **Step 3: Implement script changes**

Update backup retention to 10, print users row count after backup, warn if users count is 0, and skip zero-byte backups from retention deletion. Update restore to support named `approval-db`, clean schema before full SQL import, and print restored users count.

- [ ] **Step 4: Run green test**

Run: `npm run test:manage`

Expected: pass.

### Task 4: Verification and Commit

**Files:**
- Validate all changed scripts and tests.

- [ ] **Step 1: Run shell syntax check**

Run: `bash -n scripts/deploy.sh scripts/backup.sh scripts/restore.sh scripts/health-check.sh`

Expected: no output and exit 0.

- [ ] **Step 2: Run manager tests**

Run: `npm run test:manage`

Expected: all tests pass.

- [ ] **Step 3: Commit and push**

Run:

```bash
git add docs/superpowers/plans/2026-06-16-deployment-manager-safety.md tools/manage.mjs tests/tools/manage.test.mjs scripts/deploy.sh scripts/backup.sh scripts/restore.sh
git commit -m "fix: harden deployment manager data safety"
git push origin feature/hybrid-deployment-cli
```
