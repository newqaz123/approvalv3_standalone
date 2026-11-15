# PDF Approval Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show real department and position names, truthful step numbering, and clearly separated approval attempts in exported PDFs.

**Architecture:** Enrich the existing reports query and approval mapping, preserving export authorization and eligibility. Extend PDF approval-row metadata and group rows within each phase at rendering time; preserve existing callers with optional metadata fields.

**Tech Stack:** TypeScript, Prisma, existing HTML/Puppeteer PDF renderer, node:test via tsx.

**Spec:** docs/superpowers/specs/2026-11-15-pdf-approval-columns-design.md

## Global Constraints
- No migrations, workflow changes, or unrelated editor/package fixes.
- Retain superseded history, comments, and statuses; do not invent decision dates.
- Columns: Step | Approver | Position | Department | Status | Decision date | Comments.
- Missing position/department/date displays `—`; unknown decision maker displays `Not recorded`.
- Never use account role or hard-coded Engineering as department.

## Review Focus
- Legacy rows without an instance remain visible under Legacy history (Task 2).
- Actual approvers with missing assignments must not inherit another person's department (Task 1).
- Group scope must take precedence over an approver who has since transferred (Task 1).
- Repeated step orders across attempts must not interleave history (Task 2).
- Organization names and comments containing HTML must remain escaped (Task 2).

### Task 1: Enrich approval report data

**Files:** Modify `src/server-actions/reports.ts`, `src/lib/pdf.ts`, and `tests/regression/export-builder-wiring.test.ts`.

**Interfaces:** Extend each `RequestPDFData.approvalPhases[].approvals[]` row with optional `positionName: string`, `instanceId: string`, `attempt: number`, and `supersededAt: Date | string | null`. Keep existing order, stage, requiredLevel fields compatible; the new renderer will no longer treat requiredLevel as organizational rank.

- [ ] Add failing server-action harness tests capturing generated PDF data. Assert scope unit name wins over current assignment; actual approver assignment is used when scope is absent; required-person assignment is used only when actual approver is absent; unresolved group approver is `Not recorded`; missing department/position stays absent rather than taking role or requester data. Test initial, solution, and final phases.
- [ ] Run `npx tsx --test tests/regression/export-builder-wiring.test.ts`; confirm new assertions fail for the intended mapping errors.
- [ ] Extend getExportableRequest selections with instance attempt/supersession, requiredPositionRef.name, candidateGroup.scopeUnitId, and actual/required approver active organization assignments with unit.name. Resolve distinct scope-unit IDs through one organization_units query (scopeUnitId has no Prisma relation); pass a `Map<string, string>` into `buildApprovalPhases(request: ExportableRequest, scopeUnitNames: Map<string, string>): RequestPDFData['approvalPhases']`.
- [ ] Populate metadata and approved department/position fallbacks for all phases. Use actual approval order for step text. Preserve eligibility predicates, statuses, comments, and stored dates.
- [ ] Run targeted tests and type-check; distinguish existing Tiptap errors from new errors.

### Task 2: Render attempt-grouped approval tables

**Files:** Modify `src/lib/pdf.ts`; extend `tests/regression/pdf-rendering.test.ts` and, only if affected, existing PDF layout fixtures.

**Interfaces:** Consume Task 1 optional metadata; keep the existing exported HTML rendering entry point and phase array shape.

- [ ] Add failing rendered-HTML tests asserting the seven approved headings, `Step 2` from order 2, position name rather than numeric rank, no role fallback in department, preserved rejection date, and `—` for missing values.
- [ ] Add fixtures with two interleaved instances sharing step orders and legacy rows. Assert separate `Attempt 1 — Superseded`, `Attempt 2 — Current`, and `Legacy history` groups; instance groups sorted by attempt, rows sorted by order with stable ties; all decisions/comments retained. Assert malicious department/position/comment text is escaped. Test all three phase sections.
- [ ] Run `npx tsx --test tests/regression/pdf-rendering.test.ts`; confirm intended failures.
- [ ] Group by persisted instance ID within each phase, with one separate legacy bucket. Render a subgroup label and table per attempt using approved headings. Use order for Step, positionName for Position, and only approverDepartment for Department. Do not infer missing attempt metadata or reinterpret status.
- [ ] Run `npx tsx --test tests/regression/*pdf*.test.ts tests/regression/export-builder-wiring.test.ts` and inspect representative generated HTML for table width and long names.

### Task 3: Verify and review

**Files:** No unrelated production edits.

- [ ] Run `npm run check`. If the known rich-text/Tiptap type blocker persists, report it and run `npm run test:manage` and `npx tsx --test tests/regression/*.test.ts` separately.
- [ ] Review the complete diff against the spec: permissions unchanged, no history dropped, department lookup not N+1, explicit unknowns, no role leakage.
- [ ] Run `graphify update .` and inspect git status to preserve pre-existing package changes.
- [ ] Report test counts and any remaining blockers. Do not claim browser/PDF visual verification unless actually performed.
- [ ] Commit only the scoped implementation/tests/design/plan if requested; do not include pre-existing package edits.
