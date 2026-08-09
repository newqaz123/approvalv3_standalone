# Department Levels 1–10 and Safe Formatted Descriptions

**Date:** 2026-08-09  
**Status:** Approved design  
**Scope:** Local repository only; no VPS access, deployment, or production data changes

## Purpose

Implement the two deferred phases from the release-stabilization design:

1. Expand configurable department approval levels from five to ten.
2. Add safe, lightweight formatting to request and solution descriptions: bold text and preserved line breaks.

The work must preserve existing approval behavior, remain compatible with existing plain-text descriptions, and avoid introducing arbitrary HTML or a full rich-text editor.

## Confirmed User Scope

Supported description syntax is deliberately limited to:

- `**bold text**`
- preserved newline characters
- ordinary plain text

The feature does not support links, italics, images, arbitrary HTML, raw HTML entities as markup, or nested/full Markdown semantics. Existing plain-text descriptions remain valid without data migration.

## Phase 2: Department Approval Levels 1–10

### Shared policy

Create one shared hierarchy-level policy module exporting:

- `MAX_APPROVAL_LEVEL = 10`
- the supported level range/list
- reusable Zod/input validation for integer levels from 1 through 10
- validation for department `levelNames` maps

The policy is consumed by UI and server code, but server validation remains authoritative.

### Department configuration

Update the admin Department dialog so it can add, edit, remove, and persist up to ten named levels. Preserve existing sparse/empty configurations and current renumber-on-remove behavior unless an existing value would otherwise be silently discarded. The Add Level control must stop at ten and visibly communicate the limit where appropriate.

`createDepartment` and `updateDepartment` must validate `levelNames` server-side. Reject malformed keys, non-integer/out-of-range keys, excessive entries, and invalid values rather than trusting the client. No Prisma schema migration is expected because `levelNames` is already JSON-compatible.

### User and external approver assignments

Audit every mutation path that assigns an internal user level or external department-approver level. Apply the shared 1–10 validation to:

- admin user create/edit flows
- hierarchy drag/drop updates
- department-approver assignment/update flows
- any other server action accepting an approval level

Existing invalid persisted values must not be amplified; read paths should clamp or report them safely according to existing error conventions, while new writes are rejected.

### Hierarchy and approval-chain reads

Hierarchy data must include configured empty levels. The displayed range is the supported range needed by the department: at least the existing minimum display depth, plus the highest configured level name or assigned member/approver level, capped at ten. Level labels use configured names when present and fall back to `Level N`.

Approval-chain generation must continue to skip levels without active approvers and auto-approve top-level submitters, but must safely support levels 6–10. The shared policy must prevent any new approval record from being created outside 1–10.

### Phase 2 verification

Add focused tests for:

- Department dialog accepting levels 1–10 and stopping at 10.
- Department server actions rejecting malformed or level-11 configuration.
- Internal and external assignment validation at boundaries 1 and 10, and rejection at 0/11/non-integers.
- Hierarchy output including configured empty levels through level 10.
- Approval-chain generation for a level-1 submitter and level-10 top-level submitter.
- Existing level-1–5 behavior remaining unchanged.

## Phase 3: Safe Formatted Descriptions

### Canonical representation

Keep the existing database string fields. Store the user-entered restricted Markdown source exactly as text; do not add a migration or store generated HTML.

Create a dependency-free parser/tokenizer with a small explicit output model, for example:

- text token
- bold token
- line-break token

Parsing rules:

- A non-empty, properly paired `**...**` span becomes bold.
- Newline characters become line-break tokens.
- Unmatched or malformed markers remain literal text.
- Raw HTML and markup-looking input is always treated as text; it must never become executable or interpreted HTML.
- Existing plain text produces the same visible content as today.

All renderers consume the parsed model or an explicitly escaped equivalent. No renderer may use unsanitized `dangerouslySetInnerHTML`.

### Editing experience

Add a lightweight textarea toolbar with a Bold button to the request and solution description editors used by:

- New Request / request form flows
- solution submission flow
- request and solution resubmission flows where the same description fields are edited

The Bold action wraps the current selection in `**`; when there is no selection it inserts a usable empty pair and places the caret between them. The underlying control remains a textarea, so ordinary typing and newline behavior remain unchanged. Existing validation limits continue to apply to the stored source string.

### Display and output contexts

Replace plain-text-only description rendering at the existing request/solution display boundaries with shared safe rendering:

- request and solution detail views
- approval/review modals
- mobile views where descriptions are displayed
- notifications and email output
- PDF generation
- audit/export builders and other generated reports

The React renderer uses real text, `<strong>`, and `<br>` elements. Email/HTML output escapes text before adding only renderer-owned `<strong>` and line-break markup. Plain-text output preserves newlines and removes formatting delimiters from the visible text. PDF/export output uses the parsed tokens with context-appropriate escaping/styling; it must not execute or inject HTML.

Long-description truncation must operate on visible text or a clearly documented source-length rule so `**` markers do not produce broken partial bold spans in previews.

### Phase 3 verification

Add focused pure-parser tests for:

- plain text
- multiple bold spans
- multiline text
- unmatched markers
- empty markers
- HTML/script-looking input
- combinations at the beginning/end of strings

Add renderer/source-contract tests for:

- no raw HTML execution
- React output preserving `<strong>` and `<br>` semantics
- email/PDF/export escaping
- request and solution editors exposing the Bold control
- existing plain-text descriptions remaining unchanged

Add browser coverage for selecting text, clicking Bold, entering a newline, saving/submitting, reopening, and verifying the rendered result.

## Error Handling and Compatibility

- Invalid level writes return the existing server-action error shape and do not partially persist.
- Invalid formatting is displayed literally rather than rejected or executed.
- Existing descriptions require no migration and remain readable.
- Formatting changes must not alter attachment, approval, or request visibility behavior.
- No new production migration is expected for either phase.

## Out of Scope

- Full CommonMark/GFM support.
- Rich-text contenteditable editors.
- Arbitrary HTML storage or rendering.
- Object storage or attachment changes.
- VPS operations, deployment, or production database migration.
- Unrelated approval-workflow redesign.
