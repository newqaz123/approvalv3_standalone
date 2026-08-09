# Request Modal and Auth Origin Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every New Request dialog open with fresh state, guarantee logout uses the configured DNS origin behind Nginx, and restore a fully green regression baseline.

**Architecture:** Add an explicit request-mode reset boundary to the long-lived `SubmitterModal`, while leaving solution/resubmit initialization separate. Extend the deployment environment doctor with canonical-origin validation for Auth.js v5 and keep client logout callbacks relative so the trusted configured origin controls redirects.

**Tech Stack:** React 19, Next.js 15 App Router, Auth.js v5, Node `.mjs` deployment manager, Node test runner via `tsx`.

## Global Constraints

- Every New Request dialog open starts fresh, including after cancellation and successful submission.
- Reset title, description, template, files, file descriptions, upload errors, custom hierarchy state, and custom approvers.
- Do not reset solution or resubmission data with the request-mode effect.
- Production canonical origin is configured consistently in `AUTH_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL`.
- Production requires `AUTH_TRUST_HOST=true` behind the reverse proxy.
- Logout callback remains the relative path `/sign-in`; no application source may hard-code `http://localhost:3000` for logout.
- No VPS operation is part of this plan.

---

## File Structure

**Create**

- `tests/regression/request-modal-reset.test.ts` — request-mode fresh-open contract.
- `tests/regression/auth-origin.test.ts` — logout and environment-origin wiring.

**Modify**

- `src/components/requests/submitter-modal.tsx` — explicit request reset on open.
- `src/components/navigation/navbar.tsx` — preserve relative callback and await logout if needed for error handling.
- `tools/lib/env.mjs` — Auth.js required keys and origin consistency report.
- `tools/manage.mjs` — display actionable origin problems.
- `tests/tools/env.test.mjs` — canonical-origin validation.
- `.env.example`, `README.md`, `DEPLOY.md`, `docs/DEPLOY.md` — production DNS and proxy variables.
- `tests/regression/engineering-sub-tasks.test.ts` — repair the stale quote assertion blocking the suite.

---

### Task 1: Restore the Green Regression Baseline

**Files:**

- Modify: `tests/regression/engineering-sub-tasks.test.ts:618`

**Interfaces:**

- Consumes: current JSX rendering in `src/components/requests/sub-task-form-dialog.tsx`.
- Produces: zero baseline regression failures before new behavior is added.

- [ ] **Step 1: Reproduce the existing failure**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
```

Expected: FAIL because the test expects raw quotes while JSX contains `&quot;`.

- [ ] **Step 2: Correct the exact source assertion**

Replace:

```ts
assert.match(component, /Add "\{subContractorSearch\.trim\(\)\}"/)
```

with:

```ts
assert.match(component, /Add &quot;\{subContractorSearch\.trim\(\)\}&quot;/)
```

Do not change production markup; the HTML entity is valid JSX and avoids lint/parser problems.

- [ ] **Step 3: Run the focused and full baseline suites**

Run:

```bash
npx tsx --test tests/regression/engineering-sub-tasks.test.ts
npx tsx --test tests/regression/*.test.ts
```

Expected: all 93 current regression tests pass before adding new tests.

- [ ] **Step 4: Commit**

```bash
git add tests/regression/engineering-sub-tasks.test.ts
git commit -m "test: align subcontractor quote assertion"
```

---

### Task 2: Reset New Request State on Every Open

**Files:**

- Modify: `src/components/requests/submitter-modal.tsx`
- Create: `tests/regression/request-modal-reset.test.ts`

**Interfaces:**

- Produces: `resetRequestDraft()` internal callback called only when `mode === 'request' && open`.
- Consumes: existing request-mode state setters.

- [ ] **Step 1: Write a failing reset wiring test**

```ts
import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

it('resets every New Request field whenever request mode opens', () => {
  const source = readFileSync('src/components/requests/submitter-modal.tsx', 'utf8')
  assert.match(source, /const resetRequestDraft = useCallback/)
  assert.match(source, /if \(mode !== 'request' \|\| !open\) return/)
  for (const reset of [
    "setTitle('')",
    "setDescription('')",
    "setSelectedTemplate('')",
    'setFiles([])',
    'setFileDescriptions({})',
    'setFileUploadError(null)',
    'setUseCustomHierarchy(false)',
    'setCustomApprovers([])',
  ]) {
    assert.match(source, new RegExp(reset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*resetRequestDraft\(\)[\s\S]*\}, \[mode, open, resetRequestDraft\]\)/)
})
```

- [ ] **Step 2: Run the test and confirm reset boundary is absent**

Run: `npx tsx --test tests/regression/request-modal-reset.test.ts`  
Expected: FAIL because request fields are initialized only at mount.

- [ ] **Step 3: Add the request-only reset callback**

```tsx
const resetRequestDraft = useCallback(() => {
  setTitle('')
  setDescription('')
  setSelectedTemplate('')
  setFiles([])
  setFileDescriptions({})
  setFileUploadError(null)
  setUseCustomHierarchy(false)
  setCustomApprovers([])
  setDeletedFileIds([])
}, [])

useEffect(() => {
  if (mode !== 'request' || !open) return
  resetRequestDraft()
}, [mode, open, resetRequestDraft])
```

Import `useCallback`. Do not add solution fields to this callback.

- [ ] **Step 4: Ensure template fetch cannot restore stale selection**

Keep the template-fetch effect, but never set `selectedTemplate` from the previous open. The template-population effect runs only after a user selects a non-empty template.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx tsx --test tests/regression/request-modal-reset.test.ts && npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/requests/submitter-modal.tsx tests/regression/request-modal-reset.test.ts
git commit -m "fix: reset new request dialog on open"
```

---

### Task 3: Validate the Canonical Auth.js Origin

**Files:**

- Modify: `tools/lib/env.mjs`
- Modify: `tools/manage.mjs`
- Modify: `tests/tools/env.test.mjs`

**Interfaces:**

- Produces: `normalizeOrigin(value)`, `createOriginReport(current)`, and `createEnvReport(...).originIssues`.
- Consumes: existing environment parser and manager report.

- [ ] **Step 1: Write failing origin-report tests**

```js
import {
  createOriginReport,
  createEnvReport,
  parseEnvText,
} from '../../tools/lib/env.mjs'

test('createOriginReport accepts one HTTPS production origin', () => {
  const report = createOriginReport({
    AUTH_URL: 'https://approval.example.com/',
    NEXTAUTH_URL: 'https://approval.example.com',
    NEXT_PUBLIC_APP_URL: 'https://approval.example.com',
    AUTH_TRUST_HOST: 'true',
  })
  assert.deepEqual(report.issues, [])
  assert.equal(report.origin, 'https://approval.example.com')
})

test('createOriginReport rejects localhost and conflicting production origins', () => {
  const report = createOriginReport({
    AUTH_URL: 'http://localhost:3000',
    NEXTAUTH_URL: 'https://approval.example.com',
    NEXT_PUBLIC_APP_URL: 'https://other.example.com',
    AUTH_TRUST_HOST: 'false',
  })
  assert.equal(report.issues.some((issue) => issue.includes('localhost')), true)
  assert.equal(report.issues.some((issue) => issue.includes('same origin')), true)
  assert.equal(report.issues.some((issue) => issue.includes('AUTH_TRUST_HOST=true')), true)
})
```

- [ ] **Step 2: Run env tests and confirm missing helper**

Run: `npm run test:manage`  
Expected: FAIL because `createOriginReport` is not exported.

- [ ] **Step 3: Add Auth.js keys and origin normalization**

Add `AUTH_URL` and `AUTH_TRUST_HOST` to `REQUIRED_PRODUCTION_KEYS`. Implement:

```js
export function normalizeOrigin(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

export function createOriginReport(current) {
  const entries = ['AUTH_URL', 'NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL']
    .map((key) => [key, normalizeOrigin(current[key])])
  const issues = []
  for (const [key, origin] of entries) {
    if (!origin) issues.push(`${key} must be a valid absolute URL`)
    else if (/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)) issues.push(`${key} must not use localhost in production`)
  }
  const distinct = new Set(entries.map(([, origin]) => origin).filter(Boolean))
  if (distinct.size > 1) issues.push('AUTH_URL, NEXTAUTH_URL, and NEXT_PUBLIC_APP_URL must use the same origin')
  if (current.AUTH_TRUST_HOST !== 'true') issues.push('AUTH_TRUST_HOST=true is required behind the production reverse proxy')
  return { origin: distinct.size === 1 ? [...distinct][0] : null, issues }
}
```

Include `originIssues: createOriginReport(current).issues` in `createEnvReport`.

- [ ] **Step 4: Display actionable issues in the manager**

Extend `logEnvironmentReport`:

```js
if (report.originIssues.length > 0) {
  log('Application origin issues:')
  for (const issue of report.originIssues) log(`  - ${issue}`)
}
```

`envDoctor` must not report “all template keys” as healthy when `originIssues` is non-empty.

- [ ] **Step 5: Run manager tests**

Run: `npm run test:manage`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/lib/env.mjs tools/manage.mjs tests/tools/env.test.mjs
git commit -m "fix: validate production auth origin"
```

---

### Task 4: Lock Logout to the Configured DNS Contract

**Files:**

- Modify: `src/components/navigation/navbar.tsx`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `DEPLOY.md`
- Modify: `docs/DEPLOY.md`
- Create: `tests/regression/auth-origin.test.ts`

**Interfaces:**

- Consumes: origin validation from Task 3.
- Produces: relative logout callback with documented Auth.js v5 environment contract.

- [ ] **Step 1: Write a failing environment and source test**

```ts
import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

it('uses configured production origins and a relative logout callback', () => {
  const navbar = readFileSync('src/components/navigation/navbar.tsx', 'utf8')
  const env = readFileSync('.env.example', 'utf8')
  const deploy = readFileSync('DEPLOY.md', 'utf8')
  assert.match(navbar, /signOut\(\{ callbackUrl: '\/sign-in' \}\)/)
  assert.doesNotMatch(navbar, /localhost:3000/)
  assert.match(env, /AUTH_URL="https:\/\/approval\.example\.com"/)
  assert.match(env, /NEXTAUTH_URL="https:\/\/approval\.example\.com"/)
  assert.match(env, /NEXT_PUBLIC_APP_URL="https:\/\/approval\.example\.com"/)
  assert.match(env, /AUTH_TRUST_HOST="true"/)
  assert.match(deploy, /proxy_set_header X-Forwarded-Proto \$scheme;/)
})
```

- [ ] **Step 2: Run the test and confirm the template still uses localhost**

Run: `npx tsx --test tests/regression/auth-origin.test.ts`  
Expected: FAIL on `.env.example` and documentation.

- [ ] **Step 3: Update the environment template**

Use production-safe placeholders:

```dotenv
AUTH_URL="https://approval.example.com"
NEXTAUTH_URL="https://approval.example.com"
NEXT_PUBLIC_APP_URL="https://approval.example.com"
AUTH_TRUST_HOST="true"
```

Document local overrides in `.env.local` using `http://localhost:3000`; do not make localhost the production template default.

- [ ] **Step 4: Document proxy headers and logout troubleshooting**

Add:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Explain that all three URL variables must match the public HTTPS origin and that `AUTH_TRUST_HOST=true` permits Auth.js to trust forwarded host/protocol from the controlled Nginx proxy.

- [ ] **Step 5: Keep the navbar callback relative**

No absolute environment URL belongs in the client callback. Retain `signOut({ callbackUrl: '/sign-in' })`; optionally await it in an async handler so client errors can be logged without inventing a fallback origin.

- [ ] **Step 6: Run focused tests and build**

Run: `npx tsx --test tests/regression/auth-origin.test.ts && npm run test:manage && npm run build`  
Expected: PASS; build must not emit an Auth.js localhost redirect configuration warning.

- [ ] **Step 7: Commit**

```bash
git add src/components/navigation/navbar.tsx .env.example README.md DEPLOY.md docs/DEPLOY.md tests/regression/auth-origin.test.ts
git commit -m "fix: use configured origin for logout"
```

---

### Task 5: Full Stabilization Verification and Graph Refresh

**Files:**

- Verify all files changed by Tasks 1–4.
- Update: `graphify-out/`.

**Interfaces:**

- Consumes: all previous tasks.
- Produces: green request-modal/auth-origin stabilization release slice.

- [ ] **Step 1: Run focused tests**

```bash
npx tsx --test \
  tests/regression/engineering-sub-tasks.test.ts \
  tests/regression/request-modal-reset.test.ts \
  tests/regression/auth-origin.test.ts
npm run test:manage
```

Expected: all pass.

- [ ] **Step 2: Run repository verification**

```bash
npm run check
npm run build
git diff --check
```

Expected: zero failures.

- [ ] **Step 3: Perform local browser checks**

1. Open New Request, enter title/description, choose a template, and attach a file.
2. Cancel, reopen, and verify all fields are empty/default.
3. Submit a request, reopen, and verify all fields are empty/default.
4. Set the application URL variables to a non-localhost test origin or use a hosts-file staging name.
5. Sign out and verify the browser ends at `<configured-origin>/sign-in`, never localhost.

- [ ] **Step 4: Refresh Graphify**

Run: `graphify update .`  
Expected: graph updated without corruption warnings.

- [ ] **Step 5: Commit graph changes if tracked**

```bash
git add graphify-out
git commit -m "chore: refresh request auth graph"
```

Skip only when there are no tracked graph changes.
