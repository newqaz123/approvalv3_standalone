# Request Retention and Legacy Deleted Requests

Updated: 2026-11-17

This bookmarked guide previously described the old soft-delete UI and a one-off cleanup script. Neither is part of the current request workflow. The legacy deleted-record page is preserved for compatibility; no database fields or stored records were removed by the code cleanup.

## Current workflow: archive, then review

Use **Admin → Request Retention** (`/admin/retention`). Administrator access is required.

- **Archive** hides a request from normal lists without deleting its data.
- **Unarchive** makes an archived request visible again.
- **Hard-delete** is available only for archived requests, requires confirmation, and cannot be undone.
- Review the selected requests and download the available backup before permanently deleting anything.
- The date-range action on `/requests` previews and **archives** matching requests; despite its historical internal name, it does not soft-delete them.

Archived requests use `isArchived`. Legacy soft-deleted requests use `isDeleted`; these are separate states, not interchangeable filters.

### Scheduled archival

The retention settings page controls which statuses are automatically archived, how old requests must be, and the daily archive time. The application's retention clock applies that policy. Automatic archival is not automatic permanent deletion.

There is no supported one-off TypeScript cleanup command for deleting legacy requests. Remove any old cron entry that invokes the retired `cleanup-deleted-requests.ts` script. Do not replace it with an unreviewed database delete.

## Legacy soft-deleted records

Administrators can still open `/admin/deleted-requests` directly to review requests soft-deleted before the current archive workflow. That compatibility page supports:

- listing existing soft-deleted requests;
- restoring a request (clearing `isDeleted`, `deletedAt`, and `deletedBy`);
- permanently deleting selected legacy records, including the existing date-range and age-based options.

The page is no longer linked from the Admin hub. There is no active request-detail soft-delete button or supported `deleteRequest` action.

The retained legacy hard-delete path and the current archived-request hard-delete path are distinct implementations. Do not assume the legacy path performs the current retention engine's private-file/inline-image cleanup. Check storage separately when handling historical records; do not manually remove files shared by other records.

## Safety checklist

1. Use archive/unarchive for reversible retention changes.
2. Review the request IDs and dates before confirming a destructive action.
3. Take a verified backup using the deployment manager or `scripts/backup.sh` before permanent deletion.
4. Permanent deletion may remove related approvals, activities, attachments, and notifications through database cascades. It is not a reversible archive operation.
5. Do not delete users, organization units, positions, or audit structures to clean up requests.
6. Keep private attachments under the configured `UPLOAD_DIR`; the historical `public/uploads/` directory is not the current storage root.
7. Do not run production migrations or historical data-fix scripts as a cleanup shortcut.
