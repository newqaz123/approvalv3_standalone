# Thai / English production coverage

The route matrix is [`tests/support/i18n/production-surfaces.ts`](../../tests/support/i18n/production-surfaces.ts). Its `pattern` is the normalized App Router path (including dynamic segments); its `path` is the concrete route used in Chromium. The regression discovers tracked `src/app/**/page.tsx`, removes route-group directories, and compares exact sets. `/` is a redirect, not a screen. `/test-harness/**` and `/sequential-stages-preview` are excluded. API responses, developer logs, and browser/external-service copy are not production UI.

| Production area | Seeded role / account | Browser evidence |
| --- | --- | --- |
| `/`, Sign In and Sign Up | Anonymous | `language-settings`: both redirect destinations, public selector persistence, anonymous/account precedence, form draft and failures, Sign In intro and both forms |
| Profile, Approval Chain, Change Password | Requester (`alice`), independent account (`bob`) | `language-settings`: bilingual headings, first server document without JS, protected navigation, profile validation, rejected password change |
| Requests, My Actions, Engineering | `alice`, approvers (`casey`, `quinn`, `riley`, `pat`, `dana`, `morgan`), solution worker (`bob`) | `language-workflow`: each role's page heading; Request, Solution and Final flows, competing decisions, restart/history, denial, stable filters, links, badges and user text |
| Dashboard, Workflow, Analytics, Budget Monitor | `alice`; unassigned `admin` for Workflow | `language-insights`: drawers, charts, legends, assignment/amount data, loading/empty UI, and saved filters |
| All twelve Admin pages including template `new` and `[id]` | `admin`; `alice` for denial | `language-admin`: same URL in both locales; a concrete temporary template, configured stages, and real Admin panels |
| In-app notifications (not a route) | `alice`; `bob` is a distinct recipient | `language-notifications`: same row across a switch, legacy fallback, relative time, deep link, unread/a11y name and persisted read states |

## Nested UI (separate from the route inventory)

| Surface | Evidence |
| --- | --- |
| Global not-found, error, locale write failure/retry | `language-settings`: unknown route, opt-in error on the existing language workflow harness, and intercepted failed account changes; no developer diagnostic in app UI |
| Keyboard and mobile menu | `language-settings`: Arrow keys, Enter and Escape, 44px touch target, in-viewport focus restoration at 390px and desktop. `language-admin`: 390px user card actions. `language-workflow`: mobile cards versus desktop rows |
| Draft, upload, action/pending dialogs, and deep links | `language-workflow`: gated form reconciliation, live Request and Solution forms, approval/rejection/resubmission, crop and failed image removal, and `requestId` routing; original pending-state harness is a separate control |
| Dashboard drawer, Analytics loading/empty, Budget empty | `language-insights`: drawer title and empty copy, held Analytics request, zero-data status, and Budget empty filter |
| Admin user validation, delete guard, Organization tree, Positions, route editor, stage validation, Audit | `language-admin`: cancel does not delete; live conflict, configured names, keyboard tree interaction, queued rename through collapse, role denial and draft state |

## Intentional English / unchanged data

- `Status` as a heading may translate. Actual values such as `Final Approval`, `FinalApproval`, `SentToEngineer`, `Completed`, `Pending`, `Approved` and `Published` retain each surface's original spelling. The filter, desktop/mobile worklist, chart, Budget and Admin tests pin representatives. `REQUEST`, `SOLUTION`, `FINAL` and `EXCEEDS_LIMIT` are retained workflow identifiers, not translated prose.
- The Sign In and desktop brand **Approval System**, **ImproveFlow**, **Request**, **Solution**, **Final**, **Engineering** where used as a product/workflow term, **WR**, formats such as **XLSX/PDF/CSV**, and **SMTP** remain identifiable. The selector reads `ภาษา / Language`, `ไทย`, `English` in both modes. The catalog test lists all shared values and product-only Thai entries explicitly; other Thai entries must contain Thai text and match interpolation tokens.
- `PERMANENTLY DELETE` is the exact safety confirmation token, not translatable UI chrome. Protocol values, MIME types, examples such as email addresses, units and stable identifiers stay literal.
- User-entered titles, descriptions, comments/reasons, configured names and imported content are never rewritten. Legacy notification and Audit details render verbatim. Only in-app relative notification time localizes; dates, timezone, currency and output formats remain unchanged.

## Compatibility fixtures and negative controls

All comparisons use one guarded disposable fixture app and the same account and data on both sides. Browser locale changes are persisted, not simulated by changing input strings. No production mail receiver or data source is used.

| Output | Comparator | Negative control |
| --- | --- | --- |
| Requests XLSX and Budget Monitor XLSX | Parse each workbook, compare sheet name, ordered raw cells (including number/string types and empty cells); pin output name and fixture title/Status | Replace `Title` / `Budget Code` with Thai in the parsed header; equality rejects it |
| Per-request and date-range Audit CSV / JSON | CSV parsed row/column sequence **and** exact CSV text; JSON full parsed data, stable filename, exact raw Audit reason and Status | Replace the first CSV header or change a JSON Status value; equality rejects each mutation |
| Completed approval packet PDF and Retention ZIP | Parse page sizes, decoded page operators and ToUnicode maps; ZIP compares entry paths and decoded report, not container timestamps. Read the real report with the same visible generated-footer minute | Change the persisted Request description and regenerate **both** the standalone packet and Retention ZIP; both parsed report bodies must differ. Changing a ZIP entry name also detects a changed archive structure |
| Workflow mail from production actions | Run the authenticated Request → rejection → rework → PIC assignment → Solution → Final → completion workflow twice, with identical fixture content and persisted account language set to English or Thai. Compare loopback SMTP envelopes, raw subjects, transfer-decoded plain/HTML and per-part MIME headers. Assert each actual Request URL and rendered English creation time before normalizing just the generated ID/time values; ignore SMTP top-level transport metadata and arrival order | Changing the submitted rejection reason in one replay makes both captured bodies differ |
| Direct workflow renderer, Admin SMTP probe and storage alert | Separate real sender checks through the same loopback capture. Compare envelope, raw subject and MIME bodies; the plain-only probe has no HTML, and its top-level MIME metadata is not compared | Change the direct sender's input body; unchanged subject, changed plain and HTML parts are detected |

## Runbook

Run only in this worktree against the seeded, disposable `app_cleanstart_dev` app at `http://localhost:32143`. Set `E2E_UI_HARNESS=1` on that isolated server for harness tests; the harness guard is not a substitute for target isolation. For a production-mode browser run (`next build` + `next start`), also set `E2E_LANGUAGE_WORKFLOW_FAILURE=1` on the disposable test server so the existing `?failure=1` URL triggers the error. Never set either harness flag in a deployment. Development mode needs only `E2E_UI_HARNESS=1`. Keep the browser profile and test worker single-worker, and restore preferences/temporary rows before running English controls. For loopback capture the `email_settings` table must be fixture-owned and empty at start. The mail tests refuse an SMTP host in the test process, install an authoritative DB row pointing only to their owned `127.0.0.1:35247` capture, and restore that row after the test. The production workflow sends only while its loopback setting is in place.

```sh
export DATABASE_URL=postgresql://th_en_local@127.0.0.1:55473/app_cleanstart_dev
export TEST_BASE_URL=http://localhost:32143 E2E_UI_HARNESS=1
npm run check
npx tsx --test tests/regression/{i18n-coverage,request-export,export-package,export-builder-wiring,pdf-package,pdf-rendering,email-notification-transport}.test.ts
npm run test:e2e -- tests/e2e/language-settings.spec.ts tests/e2e/language-workflow.spec.ts tests/e2e/language-insights.spec.ts tests/e2e/language-admin.spec.ts tests/e2e/language-notifications.spec.ts
npm run test:e2e -- tests/e2e/approval-action-pending-state.spec.ts tests/e2e/rejected-request-access.spec.ts tests/e2e/engineering-resolution-trend-ui.spec.ts
```

The following **originals** deliberately require their own disposable `http://localhost:3100` server and database. Their guards are unchanged. Never point them at another process to satisfy the port check:

```sh
TEST_BASE_URL=http://localhost:3100 npm run test:e2e -- tests/e2e/clean-start-{approval-flow,sharing-visibility,organization-tree,rename-blur-icons,team-deactivation,tree-hierarchy,unit-deactivation}.spec.ts
```

On `:32143`, the four English approval controls, cross-unit sharing, and scoped Organization checks (including queued rename and successful publish for a temporary unit) are the available substitutes. The five Organization originals also exercise depth/connector and reserved-control geometry, tooltip/focus and coarse-pointer interactions, deferred rename ordering/cancellation on collapse, broader team assignment moves and removal, position/rank conflicts, and complete root route/customization journeys. Do not count those original cases as passed from the route matrix. Dedicated business-native workflow mail capture and separate attachment/formatted/inline-image release suites require their own fixture contracts and are not the same as this bilingual compatibility gate.
