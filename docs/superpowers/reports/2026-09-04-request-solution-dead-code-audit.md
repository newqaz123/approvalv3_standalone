# Request and Solution Dead-Code Audit

**Date:** 2026-09-04
**Scope:** Runtime TypeScript/TSX import reachability after canonical form consolidation

## Removed in This Change

The standalone New Request, request-detail, and Submit Solution routes; their private form components; and the transitively orphaned batch/progress helpers were removed under the approved design.

## Deferred Candidates

| Candidate | Runtime evidence | Why deferred |
| --- | --- | --- |
| `src/components/requests/request-detail-modal.tsx` | No runtime importer; references come from source-contract tests and comments. It still contains links to the retired solution route at lines 844, 856, 1370, and 1382. | Large independent legacy detail implementation with its own action/export dependencies. |
| `src/components/requests/request-detail-desktop.tsx` | Runtime-imported only by the unused example component. | Belongs to the separate legacy detail-view cluster. |
| `src/components/requests/request-detail-desktop-v2.tsx` | No runtime importer found. | Separate presentation experiment, unrelated to authoring-flow removal. |
| `src/components/requests/request-detail-desktop-example.tsx` | No runtime importer found; imports `request-detail-desktop.tsx`. | Explicit example/prototype file. |
| `src/components/solutions/solution-detail.tsx` | No runtime importer found; current references are regression source reads. | Read-only solution presentation needs a separate coverage review before deletion. |

### Remaining Retired-Route References

The final retired-route reference scan (`rg -n '/engineering/solutions/' src tests`) reports only the four `request-detail-modal.tsx` links above plus one remaining non-runtime match: `tests/regression/canonical-request-solution-forms.test.ts:79`, the retirement suite's own `retiredFiles` absence assertion that keeps the deleted `/engineering/solutions/[requestId]` page from returning. The removed-file reference scan over runtime source (`src`) is clean; the only other textual matches are the same suite's `retiredFiles` absence-assertion strings (lines 49-50 and 80-84), which are the negative contract enforcing the removals documented in this report.

## Kept as Active

- `submitSolution` and `resubmitSolution`: called by `RequestModalRouter`.
- `createRequest`: called by the active New Request modal callers.
- `CustomApprovalPicker`: used by `final-approval-actions.tsx` and a test harness.
- `uploadFileAction`: used by `request/file-upload-zone.tsx` in request resubmission.
- Both staged-attachment hooks and inline-image coordination: used by `SubmitterModal`.

## Limitations

This is a static import/reference audit, not proof that every dynamically loaded or externally addressed file is unreachable. The deferred candidates must receive a separate approved cleanup with behavior and test review before deletion.
