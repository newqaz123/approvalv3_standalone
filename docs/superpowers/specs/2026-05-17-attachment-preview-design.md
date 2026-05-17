# Attachment Preview Design

## Goal

Allow users to preview request attachments without leaving the request detail flow. The feature should make previewing obvious for users who click file names while keeping an explicit Preview button for users who prefer clear actions.

## Scope

The first version supports lightweight previews only. It must not require LibreOffice, server-side Office conversion, or other heavy runtime dependencies.

Supported preview types:

- PDF files
- Image files
- Plain text files
- `.docx` files as extracted document text
- `.xlsx` files as spreadsheet tables

Unsupported files, including `.pptx`, open the preview modal with a clear unsupported state and a Download action.

## User Experience

Attachment rows appear in the existing grouped attachment sections:

- Initial Request Attachments
- Engineering Solution Attachments

Each row provides three ways forward:

- Click the file name to open preview.
- Click Preview to open preview.
- Click Download to download the original file.

The preview modal shows the file name, file metadata, preview content, and a Download button. If preview content cannot be loaded or the file type is unsupported, the modal explains that preview is unavailable and keeps Download available.

## Architecture

Add a shared client component for previewing files from a URL and file metadata. The component is responsible for:

- Determining the preview kind from MIME type and file extension.
- Rendering image, PDF, text, DOCX text, XLSX table, and unsupported states.
- Fetching text, DOCX, and XLSX content from the existing file URL.
- Providing loading and error states.

The existing request detail modal owns which file is currently selected and passes its URL to the preview component. The current download behavior remains available.

## Data Flow

The request detail modal already receives `fileAttachments` for both request and solution files and builds public URLs from `filePath`. The preview feature reuses those URLs.

When a user clicks a file name or Preview:

1. The selected file metadata and URL are stored in component state.
2. The preview modal opens.
3. The preview component chooses the renderer.
4. Browser-native previews render directly for PDF and images.
5. Text, DOCX, and XLSX files are fetched and parsed in the client.
6. Errors fall back to a preview-unavailable state.

## File Type Handling

PDF uses an embedded object or iframe.

Images use an `img` element with responsive sizing.

Plain text is fetched and displayed in a read-only preformatted area.

DOCX uses a lightweight parser to extract readable document text. The preview does not attempt to preserve full Word layout.

XLSX uses a lightweight parser to show workbook data as tables. The preview does not attempt to reproduce full Excel formatting, charts, or formula editing.

PPTX is intentionally unsupported in this version because useful preview requires heavier conversion.

## Error Handling

If the URL is missing, fetching fails, parsing fails, or the type is unsupported, the modal remains open and shows a clear message with Download.

Download remains the reliable fallback for every attachment type.

## Testing

Add focused tests around the shared preview logic:

- File type detection for MIME types and extensions.
- Supported type routing for PDF, image, text, DOCX, and XLSX.
- Unsupported type routing for PPTX and unknown files.

Add component tests where the current test setup supports them, especially for showing the unsupported state and exposing Download.

## Out Of Scope

- Pixel-perfect Word preview
- Full Excel formatting, formulas UI, charts, or multiple advanced workbook features
- PPTX preview
- Server-side Office conversion
- Changing upload, storage, authorization, or download behavior
