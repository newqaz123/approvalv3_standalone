# Canonical business-flow verification — 2026-09-05

Feature branch: `feature/canonical-request-solution-forms`, HEAD `a43803f5ca0c53c79ba21153a26ba7f80fd8612e`.

Server: http://localhost:3201 (Portly `ApprovalAppV3-CanonicalForms/dev`). Final health check returned `status: ok`, `database: connected`. Main server on port 3001 was not changed. Tracked worktree remained clean; all test code and artifacts are under ignored `.superpowers/`.

## Outcome

The same request was driven through the complete business workflow across three recorded slow runs, with resumptions after correcting test selectors. This is not a claim that a single uninterrupted full-flow run passed. The last continuation passed (1 test, 1.4 minutes).

Request: `e75fdc63-c724-4168-ac1e-84beb82aa8ac` — `Canonical business flow 2026-09-05T00:27:51.078Z`.

Open: http://localhost:3201/requests?requestId=e75fdc63-c724-4168-ac1e-84beb82aa8ac

Verified with browser actions and database snapshots:

1. Creation → ImprovementRequest.
2. Rejection → status remains ImprovementRequest; rejection recorded.
3. Requester edits and resubmits → pending approval recreated.
4. Request approval → SentToEngineer.
5. Engineering row opens the request-review modal; its Submit Solution button opens authoring.
6. View Original Request opens the expected request URL in a new tab (`target=_blank`, `rel=noopener noreferrer`).
7. Solution submission → DesignCostEstimationApproval; popup retained the correct URL and request modal, including after reload.
8. Solution approval → SendBackToRequester.
9. Final initiation → FinalApproval.
10. Final approval → Completed; reopened modal shows Final Approval Completed and All Approvals Complete.

Final database evidence contains one approved initial request step, one approved solution step, and one approved final request step, each at level 6.

## Evidence

Screenshots, traces, and videos were not committed. This archive keeps the headed spec, fixture script, and written report only.

Each original run directory contained `database-evidence.json`, `browser-diagnostics.json`, screenshots, `trace.zip`, and `videos/`:

- `results/business-flow-canonical-re-02783-lution-and-final-completion/`: screenshots 01–05, creation through request approval.
- `results-continuation/business-flow-canonical-re-02783-lution-and-final-completion/`: screenshots 05b–10, engineering and original-request popup before/after submission.
- `results-final/business-flow-canonical-re-02783-lution-and-final-completion/`: screenshots 11–14, solution approval through completed reopening.

`report/index.html` contains the final continuation's Playwright report. `business-flow.spec.ts` and `playwright.config.ts` retain the slow test (900 ms between browser actions, 6 seconds at screenshot checkpoints, 5 seconds before approval confirmations).

## Observations and limits

- No uncaught browser page errors were recorded in the three slow segments.
- Console diagnostics were not clean: notification/pending-count fetch errors occurred, plus a hydration mismatch warning in the engineering continuation. These did not prevent the workflow, but their causes were not established or fixed.
- The final server-log inspection included `JWTSessionError: no matching decryption secret` from a request outside the successfully completed isolated test flow. Its origin was not established. The server remained healthy.
- Test-harness corrections covered tracing ownership, editable title readiness, button-vs-tab semantics, the intermediate engineer review screen, and the distinct Approve Solution label. No application source was modified.
- Earlier exploratory runs left three additional uniquely titled canonical fixture requests (`2a411650-5610-4308-97ac-e95f491eb7c4`, `4b2923cc-0349-48ae-9202-8821ea7c5844`, `731a900d-a592-4fe3-a736-1122ad919521`). No test records were deleted.
- This flow used no file attachments; attachment behavior, WR receipt, subtasks, and custom approval chains were not exercised.
