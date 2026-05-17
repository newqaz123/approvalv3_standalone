# Completed Approval Export Design

## Goal

Improve the completed approval export so users can produce one compact, professional PDF package for the next system. The package must keep the existing approval information, let users choose which evidence attachments to include, allow package order changes, convert supported attachments to PDF, and merge everything into one exported PDF.

## Scope

This feature has two parts:

- Redesign the generated completed approval PDF into a compact evidence packet.
- Add a Select + Rearrange Export Builder for completed approvals.

The first export-builder version supports mergeable attachments for:

- PDF files, merged directly.
- Image files, converted to PDF pages.
- DOCX files, converted to a printable text/layout PDF representation.
- XLSX files, converted to printable table PDF pages.

Unsupported file types remain visible in the builder as not mergeable and keep Download/Preview actions where the current app supports them. PPT/PPTX and other Office formats are out of scope for merge conversion in this version.

No custom cover page or summary-page editor is included. The original request description remains unchanged.

## Current Context

The current completed final modal is `src/components/requests/completed-final-modal.tsx`. Its `Export Report` action is wired in `src/components/requests/request-modal-router.tsx` and currently calls `exportRequestAsPDF(requestId)` directly.

The PDF generation path is:

- `src/server-actions/reports.ts` fetches request, solution, approvals, activities, and attachment metadata.
- `src/lib/pdf.ts` renders an HTML report and converts it to PDF with Puppeteer.

Attachment preview and access are already centralized through:

- `src/lib/file-preview.ts`
- `src/components/requests/file-preview-dialog.tsx`
- `src/app/api/files/download/route.ts`

The new feature should reuse this file metadata and access model rather than changing upload or storage behavior.

## User Experience

When a user opens a completed approval and clicks `Export Report`, the app opens an Export Builder modal instead of immediately downloading a PDF.

The Export Builder contains:

- A package list with `Approval Evidence Report` included by default.
- Request attachments and solution attachments grouped by source.
- Select/deselect controls for mergeable attachments.
- Clear status labels: `Ready`, `Convert image`, `Convert DOCX`, `Convert XLSX`, or `Not mergeable`.
- Preview/Download actions for attachments using existing behavior.
- A reorder area where selected package items can be rearranged.
- A final export action that downloads one merged PDF.

The approval evidence report is selected by default and can be rearranged. This supports users who need to place an existing first-page form before the generated approval report.

## Compact Evidence Packet PDF

The generated approval evidence report keeps the current information but changes layout and density.

The redesigned report includes:

- Header with request title, reference/request ID if available, status, generated date, and generated-by user.
- Compact request metadata block: requester, requester email, department, created date, completed date.
- Engineering solution block: title, description, approved cost, currency, timeline, submitted by, submitted date, and concept design when present.
- Original request description.
- Attachment index grouped by request attachments and solution attachments.
- Approval chain grouped by phase, shown as compact rows/cards rather than wide horizontal pipelines.
- Approval comments and timestamps.
- Activity timeline in a dense audit-log table.

The design target is readable on A4, compact enough for downstream use, and more polished than the current report. It should avoid large empty areas, wide overflow layouts, and decorative elements that increase page count without carrying evidence.

## Export Package Data Flow

The client sends an export package request containing:

- `requestId`
- Ordered package items
- For each item: `type` (`approval-report`, `request-attachment`, `solution-attachment`) and stable attachment ID when applicable.

The server validates:

- User is authenticated.
- Request exists and is in `FinalApproval` or `Completed`.
- All request approvals are approved, preserving current export rules.
- Requested attachment IDs belong to the request or its current solution.
- Each selected attachment is mergeable before conversion.

The server then:

1. Generates the compact approval evidence report PDF.
2. Loads selected attachment files from existing storage paths.
3. Converts images, DOCX, and XLSX attachments into PDF buffers.
4. Merges all selected buffers in user-specified order.
5. Returns a single PDF download payload and filename.

## Conversion Rules

PDF attachments are copied into the merged package without content conversion.

Image attachments are rendered as one or more A4 PDF pages with proportional scaling and file-name header/footer metadata.

DOCX attachments are converted using the same lightweight text extraction approach already accepted for preview, then rendered as readable printable PDF pages. This version does not preserve full Word layout, images, headers, footers, comments, or tracked changes.

XLSX attachments are converted to printable tables using workbook/sheet parsing. This version prioritizes readable cell values over exact Excel visual formatting, formulas UI, charts, merged-cell fidelity, or print-area settings.

If a selected attachment cannot be loaded or converted, the export fails with a specific error identifying the file. The app does not silently omit selected evidence.

## Architecture

Add a focused export-builder client component instead of expanding `completed-final-modal.tsx` further.

Proposed frontend units:

- `CompletedApprovalExportBuilder`: modal/dialog that owns selected items, order, loading state, and export action.
- `ExportPackageItemRow`: row for selectable/reorderable package items.
- `buildDefaultExportPackageItems`: pure helper that turns modal request/solution attachment data into default package item state.

Proposed backend units:

- `exportRequestPackageAsPDF(requestId, items)`: server action for validated package export.
- `buildRequestPDFData`: extracted helper from existing report export data mapping.
- `generateRequestEvidencePDF`: compact version of the current approval report PDF generator.
- `mergePdfBuffers`: PDF merge helper.
- `convertAttachmentToPdf`: conversion dispatcher for PDF, image, DOCX, and XLSX.

The existing `exportRequestAsPDF(requestId)` can remain as a compatibility wrapper that exports only the approval evidence report, or it can call the new package exporter with a single `approval-report` item.

## Error Handling

The builder shows validation and export errors inline and via the existing toast pattern.

Expected error cases:

- User is not authenticated.
- Request is not found.
- Request is not completed/exportable.
- Approvals are incomplete.
- Attachment is missing from disk.
- Attachment is not mergeable.
- Attachment conversion fails.
- PDF merge fails.
- Rate limit is exceeded.

Errors should identify the affected file when applicable. The user should be able to adjust selected items and retry without closing the modal.

## Testing

Add unit/regression coverage for:

- Default package item construction from request and solution attachments.
- Mergeability detection for PDF, image, DOCX, XLSX, PPTX, and unknown types.
- Export item validation rejecting attachments outside the request.
- PDF merge order preserving user order.
- Compatibility path for approval-report-only export.

Add focused component coverage where the existing test setup supports it:

- Builder opens from completed approval export action.
- Selecting/deselecting items updates package list.
- Reordering changes exported item order.
- Unsupported file types display as not mergeable.

Run existing regression tests and at least one export-focused test command before completion.

## Out Of Scope

- Custom cover page or summary-page editor.
- Editing original request descriptions during export.
- Raw HTML entry for descriptions or export content.
- PPT/PPTX conversion.
- Full Office layout fidelity.
- Changing upload limits, upload authorization, storage paths, or download authorization.
- Persisting user-specific export package templates.
