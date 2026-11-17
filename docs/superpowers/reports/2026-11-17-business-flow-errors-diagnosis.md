# Business-flow error diagnosis — 2026-11-17

## Conclusion

**The observed fetch errors are caused by hard navigation cancelling in-flight background requests, not by the APIs returning errors or the approval workflow failing.** The business test forces a full document reload immediately after login, including reloads of the page it has just reached. The browser cancels pending requests; the current navigation components log those cancellations as failures.

**The server `uncaughtException` is real, not just an unfortunate log label.** A passive Node monitor captured `ECONNRESET` from `abortIncoming` immediately after those requests were cancelled. The same process remained alive and completed 290 further successful HTTP requests. This establishes the trigger in the tested development runtime; it does not establish production immunity.

**The dialog warnings are a separate accessibility-configuration issue:** several loaded business modals leave Radix expecting a description that is not provided. A description is not universally mandatory; complex dialogs may intentionally omit `aria-describedby`.

No approval/data failure was observed in these tests. No application fixes have been applied.

## Controlled evidence

All diagnostic runs used the existing T04B scenario in a visible Chromium browser, 700 ms slow motion, one worker, no retries, fresh disposable PostgreSQL, and local-only mail capture. All original scenario assertions were retained. Only the runner's private app copy received diagnostic observers and the explicitly described navigation variants; checkout application/test files were not modified.

| Run | Browser console-error entries | Cancelled API requests | Server abort-error log lines | Monitored uncaught exceptions | Dialog warning entries | Business result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Original navigation, instrumented reproduction | 55 | 54 | 3 | 0 | 20 | Passed, 10/10 phases |
| Original navigation + `networkidle` before `goto` | 45 | 42 | 6 | 1 | 20 | Passed, 10/10 phases |
| Normal menu navigation; no reload if already at target | **0** | **0** | **0** | **0** | 20 | Passed, 10/10 phases |

The initially watched run had 51 console-error entries. All 51 occurred during `page.goto`, and its saved network records contain 49 aborted department/pending-count requests. The remaining two console errors came from notification server-action fetches.

Counts are repeated log entries, not counts of distinct bugs. The menu-navigation control still recorded one ordinary server connection abort without an error log; the result is **zero console/server error logs**, not a claim that every network connection completed.

Every diagnostic run also passed its persisted-data gates: **20 database checks passed, 18 unrelated-scenario checks skipped; 3 mail checks passed, 2 skipped**. There were no failed checks. The other 49 business scenarios were not executed.

## 1. Browser fetch failures: confirmed lifecycle/automation interaction

The existing helper:

1. Signs in and waits only until the URL changes (`waitUntil: 'commit'`).
2. Immediately calls `gotoApp`, which always invokes `page.goto(listPath)`.
3. Replaces the authenticated document even if the browser is already at that URL.

Meanwhile Navbar, MobileNav, and NotificationBell start background requests for department/solution-work eligibility, pending counts, and notifications. Both responsive navigation components can be mounted even when one is hidden by CSS. Development effect behavior can amplify duplicate requests.

The failed API requests report **`net::ERR_ABORTED`**, not HTTP 401/403/500. Neither the diagnostic browser response observer nor the original completed HTTP response records showed an HTTP error response. Navbar/MobileNav catch these fetch rejections and log them without identifying document-navigation cancellation. Their effects clear timers/listeners where applicable but do not cancel or ignore all obsolete in-flight fetches.

Normal menu navigation retains the authenticated layout. Replacing only the forced navigation with four actual menu clicks and seven same-route no-ops eliminated all 55 reproduced browser console errors, with unchanged business assertions and application source.

### Why the idle-wait experiment did not solve it

Waiting for `networkidle` alone was insufficient. For example, the first authenticated route was observed at `14:33:58.695Z`; the idle wait returned at `14:33:58.697Z`, before that route's hydration/background requests started. The following hard navigation then cancelled those requests around `14:34:03.132Z`.

This is evidence against an arbitrary idle-wait/sleep as a robust repair. It is not evidence that the APIs were unhealthy.

### Relevant source

- [Business browser helper](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/tests/business-e2e/business-flow-helpers.ts): `gotoApp` around line 411, `signIn` around line 440, `openRequestByTitle` around line 506, `signedInSegment` around line 1069.
- [Navbar](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/components/navigation/navbar.tsx): pending-count and department effects, lines 54–123.
- [MobileNav](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/components/mobile/mobile-nav.tsx): eligibility and pending-count effects, lines 65–118.
- [NotificationBell](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/components/notifications/notification-bell.tsx): background server-action requests and failure toast, lines 32–65.
- [Department API](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/app/api/user/department/route.ts) and [pending-count API](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/app/api/actions/pending-count/route.ts).

The error-emitting components, navigation helper, middleware, and these API routes are unchanged from baseline HEAD `293a5ec`. No evidence links this failure mechanism to the dead-code cleanup.

## 2. Server abort exception: confirmed request cancellation; production impact untested

At `14:34:16.471Z`, the browser cancelled pending-count, department, and notification/server-action requests during a forced reload of `/requests/my-actions`.

At `14:34:16.484Z`, the Node observer captured:

```text
Error: aborted
    at abortIncoming (node:_http_server:838:17)
    at socketOnClose (node:_http_server:832:3)
    at Socket.emit (node:events:531:35)
    at TCP.<anonymous> (node:net:347:12)
    at TCP.callbackTrampoline (node:internal/async_hooks:130:17)
code: ECONNRESET
origin: uncaughtException
```

The HTTP observer recorded cancelled incoming requests and responses closed before completion at the same timestamp. The application runtime already had five uncaught-exception handlers; the diagnostic observer used **`uncaughtExceptionMonitor` only** and did not add an error handler, suppress logs, or prevent termination. The same PID served 290 subsequent successful responses and completed T04B.

Environment: **Next.js 15.5.23, React 19.2.4, Playwright 1.58.2**, using the native runner's `next dev` server and existing authentication middleware.

The stack and middleware/request-abort behavior match the class of upstream failures described in [Next.js issue #84649](https://github.com/vercel/next.js/issues/84649), closed as a duplicate of [#49587](https://github.com/vercel/next.js/issues/49587)—not closed as a demonstrated fix. This corroborates the mechanism; it does not prove every detail of that issue applies here.

**Risk:** not an observed approval transaction failure, and no process crash occurred here. Nevertheless, normal browser reloads/disconnects can also cancel requests. A production-mode abort-resilience check remains necessary before asserting the issue is development-only or harmless. Do not remove authentication middleware or globally swallow exceptions as a shortcut.

## 3. Dialog warnings: description configuration needs review

Twenty repeated Radix warnings remained in all three runs, independently of the navigation strategy. Examples of loaded dialogs with `DialogContent` but no `DialogDescription` include:

- [Approver modal](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/components/requests/approver-modal.tsx), around line 575.
- [Solution modal](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/components/requests/solution-modal.tsx), around line 631.
- [Completed request modal](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/components/requests/completed-request-modal.tsx), around line 222.
- [Completed solution modal](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/components/requests/completed-solution-modal.tsx), around line 221.
- [Submit-final modal](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/components/requests/submit-final-approval-modal.tsx), around line 465.

The router's loading dialog already has a description; adding another one there would not address these loaded-modal warnings. This is a screen-reader semantics/configuration review, not evidence of wrong approval state or an automatic WCAG failure. The [WAI-ARIA dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) makes descriptions optional and advises omitting `aria-describedby` for complex structured content. Each affected modal should either provide a meaningful concise description or deliberately omit that relationship where appropriate, while retaining an accessible title. Do not simply suppress warnings globally.

## 4. Font/npm guard messages: expected isolation behavior

The native runner intentionally blocks non-loopback outbound connections. Google Fonts requests fail under that policy and Next uses a fallback font. An npm-registry request was also blocked. These do not explain the business fetch failures and do not establish a production font problem. No dependency upgrade or network-policy weakening was attempted.

## Follow-up priorities — not implemented

1. Make the business walkthrough use real in-app navigation and avoid redundant full reloads; retain all assertions and visibility/security coverage.
2. Make background-fetch lifecycle/error handling distinguish obsolete navigation requests from genuine failures without suppressing real API errors or changing permissions.
3. Correct description configuration in affected dialogs: meaningful summaries where useful, or deliberate omission for complex structured content; preserve accessible titles.
4. Run a focused production-mode disconnect/abort resilience check before deployment confidence. Upgrade decisions, if any, require a separate verified fix path.

## Verification and limits

- Three diagnostic T04B runs passed all 10 actor phases, plus persisted-data/mail evidence gates.
- Fresh `npm run check` passed: **3,610 regression passes, 2 skips, 0 failures**, and **78/78 management tests**.
- Checkout source digests for application/tests/Prisma/package/config files matched before and after every diagnostic run. The original Playwright config was untouched during diagnosis.
- All disposable native resources were removed with zero recorded cleanup failures; final ownership/port checks are recorded in the diagnostic artifact folder.
- `graphify update .` succeeded, AST-only. Existing SQL-parser/semantic-label warnings remain unrelated.
- No production data, production migrations, deployment, dependency changes, commits, or application fixes.
- This is a diagnosis of the recorded development-run errors, not a claim that the whole application or production runtime is error-free.

## Reproducible evidence

- [Experiment results and source-integrity metadata](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/scratch/business-error-diagnosis/experiment-results.json)
- [Original watched-run navigation correlation](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/scratch/business-error-diagnosis/original-navigation-correlation.json)
- [Diagnostic scripts and logs folder](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/scratch/business-error-diagnosis/)
- [Original-navigation reproduction evidence](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/test-results/diagnosis-T04B-original-2026-11-17T14-30-23-239Z/2026-11-17T14-30-23-589Z-full/)
- [Idle-wait experiment evidence](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/test-results/diagnosis-T04B-settled-2026-11-17T14-33-21-707Z/2026-11-17T14-33-21-960Z-full/)
- [Normal-menu comparison evidence](file:///Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/test-results/diagnosis-T04B-soft-2026-11-17T14-40-52-869Z/2026-11-17T14-40-53-207Z-full/)

Each evidence folder contains retained videos, traces, browser/network observations, server lifecycle observations, runner summary, database evidence, and mail evidence. Open video/image binaries in an appropriate player/viewer; ZIP traces can be inspected using `npx playwright show-trace <trace-file>`.
