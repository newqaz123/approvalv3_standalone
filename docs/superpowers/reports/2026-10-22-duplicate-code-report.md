# Duplicate-code report — 2026-10-22 task

**Production-source duplication: 6.51% of scanned lines** (5,313 matched lines out of 81,582; 144 matching pairs across 336 scanned files).

This is a report only: no production code was removed or refactored. A “clone” here means a matching block reported by the tool, not necessarily an entire duplicate file. Some blocks overlap, so these counts are not a promise of how many lines a cleanup would save. The `src` scan includes the explicitly identified test-only UI harness below.

## 1. Production-source findings

### How this was measured

Tool: **jscpd 5.4.3**. The following command was run from the worktree root:

```sh
npx jscpd src --min-lines 12 --min-tokens 80 --reporters json --output scratch/jscpd
```

The minimum match is 12 lines and 80 code tokens (small code pieces such as names and operators). This detects substantial exact blocks, not every similar-looking function. Raw output: `scratch/jscpd/jscpd-report.json` (ignored by Git). The npm download cache was confined to `scratch/npm-cache`; no project dependency or lockfile was changed.

Raw `statistics.total`:

```json
{
  "clones": 144,
  "duplicatedLines": 5313,
  "duplicatedTokens": 25884,
  "lines": 81582,
  "newClones": 0,
  "newDuplicatedLines": 0,
  "percentage": 6.512465985143781,
  "percentageTokens": 6.274026924699072,
  "sources": 336,
  "tokens": 412558
}
```

By file type: TSX (screen components) 4,648 duplicated lines / 46,114 lines = 10.07936852149022%; TypeScript 665 / 34,446 = 1.930557974801138%; CSS 0 / 1,022 = 0%.

### Complete matching-pair inventory

Areas are ordered by their largest matching block; pairs within each area are largest first. Both locations are included even for repetition inside one file. Each row is one of the 144 reported pairs; line counts below are the tool’s values.

#### 1. Request and approval dialogs — 98 pairs, largest 209 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 209 | `src/components/requests/final-approval-resubmit-modal.tsx:235-443` | `src/components/requests/submit-final-approval-modal.tsx:226-434` | Use one approver picker so search, selection and disabled behavior stay consistent. |
| 173 | `src/components/requests/final-approval-modal.tsx:159-331` | `src/components/requests/solution-modal.tsx:160-332` | Share the file-icon and status-display helpers across dialogs. |
| 157 | `src/components/requests/completed-final-modal.tsx:318-474` | `src/components/requests/submit-final-approval-modal.tsx:490-646` | Share the request and solution attachment display sections. |
| 121 | `src/components/requests/final-approval-modal.tsx:211-331` | `src/components/requests/status-modal.tsx:204-324` | Share the file-icon and status-display helpers across dialogs. |
| 116 | `src/components/requests/completed-request-modal.tsx:331-446` | `src/components/requests/completed-solution-modal.tsx:454-569` | Share the approval-flow display, including avatars, labels and dates. |
| 114 | `src/components/requests/completed-solution-modal.tsx:114-227` | `src/components/requests/submit-final-approval-modal.tsx:128-241` | Share the file-icon and status-display helpers across dialogs. |
| 112 | `src/components/requests/completed-request-modal.tsx:99-210` | `src/components/requests/completed-solution-modal.tsx:118-229` | Share the file-icon and status-display helpers across dialogs. |
| 99 | `src/components/requests/completed-final-modal.tsx:125-223` | `src/components/requests/completed-request-modal.tsx:112-210` | Share the activity timeline display across dialogs. |
| 88 | `src/components/requests/completed-final-modal.tsx:509-596` | `src/components/requests/completed-request-modal.tsx:359-446` | Share the approval-flow display, including avatars, labels and dates. |
| 85 | `src/components/requests/final-approval-modal.tsx:931-1015` | `src/components/requests/solution-modal.tsx:924-1008` | Share the approval-flow display, including avatars, labels and dates. |
| 83 | `src/components/requests/final-approval-modal.tsx:933-1015` | `src/components/requests/status-modal.tsx:717-799` | Share the approval-flow display, including avatars, labels and dates. |
| 81 | `src/components/requests/approver-modal.tsx:221-301` | `src/components/requests/final-approval-resubmit-modal.tsx:173-253` | Share the activity timeline display across dialogs. |
| 78 | `src/components/requests/approver-modal.tsx:221-298` | `src/components/requests/completed-final-modal.tsx:144-221` | Share the activity timeline display across dialogs. |
| 77 | `src/components/requests/solution-modal.tsx:840-916` | `src/components/requests/status-modal.tsx:641-717` | Share the approval-flow display, including avatars, labels and dates. |
| 74 | `src/components/requests/approver-modal.tsx:681-754` | `src/components/requests/final-approval-modal.tsx:729-802` | Share the request and solution attachment display sections. |
| 74 | `src/components/requests/approver-modal.tsx:917-990` | `src/components/requests/final-approval-modal.tsx:942-1015` | Share the approval-flow display, including avatars, labels and dates. |
| 68 | `src/components/requests/completed-final-modal.tsx:515-582` | `src/components/requests/submit-final-approval-modal.tsx:665-732` | Share the approval-flow display, including avatars, labels and dates. |
| 61 | `src/components/requests/completed-final-modal.tsx:318-378` | `src/components/requests/final-approval-resubmit-modal.tsx:521-581` | Share the request and solution attachment display sections. |
| 54 | `src/components/requests/completed-final-modal.tsx:365-418` | `src/components/requests/completed-solution-modal.tsx:349-402` | Share the request and solution attachment display sections. |
| 54 | `src/components/requests/request-modal-router.tsx:802-855` | `src/components/requests/request-modal-router.tsx:1086-1139` | Use one approver picker so search, selection and disabled behavior stay consistent. |
| 53 | `src/components/requests/completed-final-modal.tsx:530-582` | `src/components/requests/final-approval-resubmit-modal.tsx:693-745` | Share the approval-flow display, including avatars, labels and dates. |
| 51 | `src/components/requests/completed-solution-modal.tsx:445-495` | `src/components/requests/solution-modal.tsx:883-933` | Share the approval-flow display, including avatars, labels and dates. |
| 48 | `src/components/requests/final-approval-resubmit-modal.tsx:44-91` | `src/components/requests/submit-final-approval-modal.tsx:47-94` | Share the common dialog data types rather than copying their fields. |
| 48 | `src/components/requests/submitter-modal.tsx:1309-1356` | `src/components/requests/submitter-modal.tsx:1411-1458` | Share the repeated attachment-item rendering and cleanup controls. |
| 47 | `src/components/requests/approver-modal.tsx:562-608` | `src/components/requests/solution-modal.tsx:661-707` | Share the dialog shell or action controls while keeping workflow handlers separate. |
| 46 | `src/components/requests/approver-modal.tsx:944-989` | `src/components/requests/completed-final-modal.tsx:537-582` | Share the approval-flow display, including avatars, labels and dates. |
| 43 | `src/components/requests/final-approval-modal.tsx:50-92` | `src/components/requests/solution-modal.tsx:53-95` | Share the common dialog data types rather than copying their fields. |
| 41 | `src/components/requests/approver-modal.tsx:567-607` | `src/components/requests/final-approval-modal.tsx:632-671` | Share the dialog shell or action controls while keeping workflow handlers separate. |
| 41 | `src/components/requests/completed-request-modal.tsx:31-71` | `src/components/requests/completed-solution-modal.tsx:37-77` | Share the common dialog data types rather than copying their fields. |
| 39 | `src/components/requests/request-modal-router.tsx:351-389` | `src/components/requests/request-modal-router.tsx:391-429` | Share file lookup and download handling without changing per-file authorization. |
| 38 | `src/components/requests/approver-modal.tsx:48-85` | `src/components/requests/completed-final-modal.tsx:38-75` | Share the common dialog data types rather than copying their fields. |
| 38 | `src/components/requests/approver-modal.tsx:48-85` | `src/components/requests/final-approval-modal.tsx:51-88` | Share the common dialog data types rather than copying their fields. |
| 38 | `src/components/requests/completed-final-modal.tsx:38-75` | `src/components/requests/completed-request-modal.tsx:34-71` | Share the common dialog data types rather than copying their fields. |
| 38 | `src/components/requests/completed-final-modal.tsx:422-459` | `src/components/requests/final-approval-modal.tsx:852-889` | Share the request and solution attachment display sections. |
| 38 | `src/components/requests/completed-request-modal.tsx:99-136` | `src/components/requests/final-approval-resubmit-modal.tsx:133-170` | Share the file-icon and status-display helpers across dialogs. |
| 38 | `src/components/requests/completed-solution-modal.tsx:407-444` | `src/components/requests/solution-modal.tsx:845-882` | Share the request and solution attachment display sections. |
| 38 | `src/components/requests/final-approval-modal.tsx:162-199` | `src/components/requests/status-modal.tsx:150-187` | Share the file-icon and status-display helpers across dialogs. |
| 38 | `src/components/requests/final-approval-modal.tsx:518-555` | `src/components/requests/status-modal.tsx:403-440` | Share this repeated request/solution display section, keeping status-specific controls separate. |
| 38 | `src/components/requests/final-approval-modal.tsx:628-665` | `src/components/requests/status-modal.tsx:488-525` | Share the dialog shell or action controls while keeping workflow handlers separate. |
| 37 | `src/components/requests/completed-final-modal.tsx:329-365` | `src/components/requests/completed-solution-modal.tsx:312-348` | Share the request and solution attachment display sections. |
| 36 | `src/components/requests/final-approval-resubmit-modal.tsx:47-82` | `src/components/requests/status-modal.tsx:44-79` | Share the common dialog data types rather than copying their fields. |
| 36 | `src/components/requests/final-approval-resubmit-modal.tsx:758-793` | `src/components/requests/submit-final-approval-modal.tsx:745-780` | Use one approver picker so search, selection and disabled behavior stay consistent. |
| 35 | `src/components/requests/approver-modal.tsx:1009-1043` | `src/components/requests/final-approval-modal.tsx:1032-1066` | Share the activity timeline display across dialogs. |
| 34 | `src/components/requests/approver-modal.tsx:885-918` | `src/components/requests/final-approval-modal.tsx:909-942` | Share the approval-flow display, including avatars, labels and dates. |
| 34 | `src/components/requests/final-approval-modal.tsx:1-34` | `src/components/requests/solution-modal.tsx:1-34` | Repeated imports alone need no cleanup; review shared helpers only if behavior changes. |
| 34 | `src/components/requests/final-approval-resubmit-modal.tsx:794-827` | `src/components/requests/submit-final-approval-modal.tsx:781-814` | Use one approver picker so search, selection and disabled behavior stay consistent. |
| 33 | `src/components/requests/submitter-modal.tsx:1357-1389` | `src/components/requests/submitter-modal.tsx:1459-1491` | Share the repeated attachment-item rendering and cleanup controls. |
| 32 | `src/components/requests/approver-modal.tsx:885-916` | `src/components/requests/completed-final-modal.tsx:491-522` | Share the approval-flow display, including avatars, labels and dates. |
| 32 | `src/components/requests/approver-modal.tsx:885-916` | `src/components/requests/completed-request-modal.tsx:341-372` | Share the approval-flow display, including avatars, labels and dates. |
| 31 | `src/components/requests/final-approval-modal.tsx:36-66` | `src/components/requests/status-modal.tsx:29-59` | Share the common dialog data types rather than copying their fields. |
| 30 | `src/components/requests/completed-final-modal.tsx:402-431` | `src/components/requests/final-approval-resubmit-modal.tsx:592-621` | Share the request and solution attachment display sections. |
| 29 | `src/components/requests/approver-modal.tsx:726-754` | `src/components/requests/solution-modal.tsx:767-795` | Share the request and solution attachment display sections. |
| 29 | `src/components/requests/approver-modal.tsx:1010-1038` | `src/components/requests/solution-modal.tsx:1013-1041` | Share the activity timeline display across dialogs. |
| 28 | `src/components/requests/final-approval-resubmit-modal.tsx:91-118` | `src/components/requests/submit-final-approval-modal.tsx:94-121` | Share the common dialog data types rather than copying their fields. |
| 27 | `src/components/requests/approver-modal.tsx:144-170` | `src/components/requests/completed-final-modal.tsx:112-138` | Share the file-icon and status-display helpers across dialogs. |
| 27 | `src/components/requests/approver-modal.tsx:144-170` | `src/components/requests/completed-request-modal.tsx:99-125` | Share the file-icon and status-display helpers across dialogs. |
| 27 | `src/components/requests/approver-modal.tsx:1017-1043` | `src/components/requests/status-modal.tsx:806-832` | Share the activity timeline display across dialogs. |
| 27 | `src/components/requests/final-approval-resubmit-modal.tsx:321-347` | `src/components/requests/submitter-modal.tsx:240-266` | Use one approver picker so search, selection and disabled behavior stay consistent. |
| 26 | `src/components/requests/final-approval-resubmit-modal.tsx:66-91` | `src/components/requests/solution-modal.tsx:75-100` | Share the common dialog data types rather than copying their fields. |
| 25 | `src/components/requests/approver-modal.tsx:721-745` | `src/components/requests/status-modal.tsx:563-587` | Share the request and solution attachment display sections. |
| 25 | `src/components/requests/completed-solution-modal.tsx:289-313` | `src/components/requests/solution-modal.tsx:733-757` | Share the request-description and solution-summary display sections. |
| 25 | `src/components/requests/final-approval-modal.tsx:68-92` | `src/components/requests/final-approval-resubmit-modal.tsx:62-86` | Share the common dialog data types rather than copying their fields. |
| 25 | `src/components/requests/final-approval-modal.tsx:588-612` | `src/components/requests/status-modal.tsx:450-474` | Share the dialog shell or action controls while keeping workflow handlers separate. |
| 25 | `src/components/requests/final-approval-modal.tsx:696-720` | `src/components/requests/final-approval-resubmit-modal.tsx:508-532` | Share the request-description and solution-summary display sections. |
| 25 | `src/components/requests/final-approval-resubmit-modal.tsx:726-750` | `src/components/requests/submit-final-approval-modal.tsx:713-737` | Share the approval-flow display, including avatars, labels and dates. |
| 24 | `src/components/requests/completed-final-modal.tsx:451-474` | `src/components/requests/completed-solution-modal.tsx:436-459` | Share the request and solution attachment display sections. |
| 23 | `src/components/requests/completed-solution-modal.tsx:440-462` | `src/components/requests/final-approval-resubmit-modal.tsx:632-654` | Share the request and solution attachment display sections. |
| 23 | `src/components/requests/completed-solution-modal.tsx:440-462` | `src/components/requests/submit-final-approval-modal.tsx:627-649` | Share the request and solution attachment display sections. |
| 23 | `src/components/requests/final-approval-modal.tsx:698-720` | `src/components/requests/submit-final-approval-modal.tsx:479-501` | Share the request-description and solution-summary display sections. |
| 22 | `src/components/requests/completed-final-modal.tsx:82-103` | `src/components/requests/completed-solution-modal.tsx:84-105` | Share the common dialog data types rather than copying their fields. |
| 22 | `src/components/requests/completed-final-modal.tsx:82-103` | `src/components/requests/final-approval-resubmit-modal.tsx:97-118` | Share the common dialog data types rather than copying their fields. |
| 22 | `src/components/requests/final-approval-resubmit-modal.tsx:411-432` | `src/components/requests/submitter-modal.tsx:327-348` | Share this repeated request/solution display section, keeping status-specific controls separate. |
| 21 | `src/components/requests/final-approval-modal.tsx:709-729` | `src/components/requests/solution-modal.tsx:746-766` | Share the request-description and solution-summary display sections. |
| 21 | `src/components/requests/final-approval-resubmit-modal.tsx:657-677` | `src/components/requests/status-modal.tsx:704-724` | Share the approval-flow display, including avatars, labels and dates. |
| 21 | `src/components/requests/final-approval-resubmit-modal.tsx:657-677` | `src/components/requests/submit-final-approval-modal.tsx:652-672` | Share the approval-flow display, including avatars, labels and dates. |
| 20 | `src/components/requests/approver-modal.tsx:864-883` | `src/components/requests/completed-solution-modal.tsx:443-462` | Share the request and solution attachment display sections. |
| 20 | `src/components/requests/final-approval-modal.tsx:101-120` | `src/components/requests/solution-modal.tsx:105-124` | Share the common dialog data types rather than copying their fields. |
| 19 | `src/components/requests/approver-modal.tsx:283-301` | `src/components/requests/submit-final-approval-modal.tsx:226-244` | Share the activity timeline display across dialogs. |
| 19 | `src/components/requests/approver-modal.tsx:722-740` | `src/components/requests/completed-request-modal.tsx:266-284` | Share the request-description and solution-summary display sections. |
| 19 | `src/components/requests/approver-modal.tsx:729-747` | `src/components/requests/completed-solution-modal.tsx:333-351` | Share the request and solution attachment display sections. |
| 19 | `src/components/requests/completed-request-modal.tsx:266-284` | `src/components/requests/solution-modal.tsx:763-781` | Share the request-description and solution-summary display sections. |
| 19 | `src/components/requests/completed-solution-modal.tsx:295-313` | `src/components/requests/final-approval-modal.tsx:702-720` | Share the request-description and solution-summary display sections. |
| 19 | `src/components/requests/final-approval-resubmit-modal.tsx:829-847` | `src/components/requests/submit-final-approval-modal.tsx:816-834` | Share the dialog footer with its last-modified date. |
| 17 | `src/components/requests/completed-final-modal.tsx:268-284` | `src/components/requests/completed-request-modal.tsx:231-247` | Share this repeated request/solution display section, keeping status-specific controls separate. |
| 17 | `src/components/requests/final-approval-resubmit-modal.tsx:455-471` | `src/components/requests/submit-final-approval-modal.tsx:448-464` | Use one approver picker so search, selection and disabled behavior stay consistent. |
| 16 | `src/components/requests/approver-modal.tsx:903-918` | `src/components/requests/solution-modal.tsx:920-935` | Share the approval-flow display, including avatars, labels and dates. |
| 16 | `src/components/requests/completed-final-modal.tsx:382-397` | `src/components/requests/final-approval-modal.tsx:810-825` | Share the request and solution attachment display sections. |
| 16 | `src/components/requests/completed-final-modal.tsx:382-397` | `src/components/requests/solution-modal.tsx:803-818` | Share the request and solution attachment display sections. |
| 16 | `src/components/requests/completed-final-modal.tsx:382-397` | `src/components/requests/status-modal.tsx:604-619` | Share the request and solution attachment display sections. |
| 16 | `src/components/requests/completed-final-modal.tsx:435-450` | `src/components/requests/completed-solution-modal.tsx:420-435` | Share the request and solution attachment display sections. |
| 16 | `src/components/requests/completed-solution-modal.tsx:574-589` | `src/components/requests/solution-modal.tsx:1035-1050` | Share the dialog footer with its last-modified date. |
| 16 | `src/components/requests/final-approval-resubmit-modal.tsx:578-593` | `src/components/requests/final-approval-resubmit-modal.tsx:618-633` | Share the request and solution attachment display sections. |
| 15 | `src/components/requests/approver-modal.tsx:885-899` | `src/components/requests/final-approval-resubmit-modal.tsx:656-670` | Share the approval-flow display, including avatars, labels and dates. |
| 15 | `src/components/requests/approver-modal.tsx:885-899` | `src/components/requests/submit-final-approval-modal.tsx:651-665` | Share the approval-flow display, including avatars, labels and dates. |
| 14 | `src/components/requests/approver-modal.tsx:748-761` | `src/components/requests/completed-final-modal.tsx:368-381` | Share the request and solution attachment display sections. |
| 14 | `src/components/requests/final-approval-resubmit-modal.tsx:309-322` | `src/components/requests/submitter-modal.tsx:227-240` | Use one approver picker so search, selection and disabled behavior stay consistent. |
| 13 | `src/components/requests/completed-final-modal.tsx:317-329` | `src/components/requests/completed-solution-modal.tsx:301-313` | Share the request-description and solution-summary display sections. |
| 13 | `src/components/requests/completed-final-modal.tsx:336-348` | `src/components/requests/solution-modal.tsx:756-768` | Share the request-description and solution-summary display sections. |

#### 2. Dashboard data loading — 4 pairs, largest 125 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 125 | `src/server-actions/dashboard.ts:380-504` | `src/server-actions/dashboard.ts:557-681` | Share the request fields and result conversion; keep each visibility filter separate. |
| 59 | `src/server-actions/dashboard.ts:106-164` | `src/server-actions/dashboard.ts:410-468` | Share the request fields and result conversion; keep each visibility filter separate. |
| 37 | `src/server-actions/dashboard.ts:130-166` | `src/server-actions/dashboard.ts:261-297` | Share the request fields and result conversion; keep each visibility filter separate. |
| 21 | `src/server-actions/dashboard.ts:507-527` | `src/server-actions/dashboard.ts:681-701` | Share the request fields and result conversion; keep each visibility filter separate. |

#### 3. Delete-by-date dialogs — 3 pairs, largest 43 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 43 | `src/components/admin/delete-by-date-range-modal.tsx:157-199` | `src/components/requests/bulk-delete-by-date-range.tsx:180-222` | Share the preview and confirmation UI while keeping authorized operations separate. |
| 23 | `src/components/admin/delete-by-date-range-modal.tsx:58-80` | `src/components/requests/bulk-delete-by-date-range.tsx:67-89` | Share the preview and confirmation UI while keeping authorized operations separate. |
| 13 | `src/components/admin/delete-by-date-range-modal.tsx:24-36` | `src/components/requests/bulk-delete-by-date-range.tsx:22-34` | Share the preview and confirmation UI while keeping authorized operations separate. |

#### 4. Attachment upload helpers — 2 pairs, largest 41 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 41 | `src/hooks/use-staged-request-attachments.ts:250-290` | `src/hooks/use-staged-solution-attachments.ts:86-126` | Share upload transport and lifecycle handling without mixing request and solution ownership. |
| 16 | `src/hooks/use-staged-request-attachments.ts:678-693` | `src/hooks/use-staged-solution-attachments.ts:194-209` | Share upload transport and lifecycle handling without mixing request and solution ownership. |

#### 5. API endpoints — 3 pairs, largest 35 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 35 | `src/app/api/audit/export/date-range/route.ts:98-132` | `src/app/api/audit/export/request/[requestId]/route.ts:59-93` | Share the common input or output shape; keep authorization at each endpoint. |
| 18 | `src/app/api/attachments/stage/route.ts:339-356` | `src/app/api/attachments/stage/route.ts:689-705` | Share the common input or output shape; keep authorization at each endpoint. |
| 16 | `src/app/api/admin/retention/backup/route.ts:11-26` | `src/app/api/admin/retention/hard-delete/route.ts:5-19` | Share the common input or output shape; keep authorization at each endpoint. |

#### 6. Shared table display — 2 pairs, largest 32 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 32 | `src/components/admin/template-table.tsx:275-306` | `src/components/admin/user-table.tsx:239-270` | Reuse a table shell while keeping each table’s columns and row controls separate. |
| 22 | `src/components/admin/template-table.tsx:275-296` | `src/components/dashboard/dashboard-table.tsx:304-326` | Reuse a table shell while keeping each table’s columns and row controls separate. |

#### 7. Desktop request details — 3 pairs, largest 29 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 29 | `src/components/requests/request-detail-desktop-v2.tsx:87-115` | `src/components/requests/request-detail-desktop.tsx:77-105` | Share the common detail sections, keeping layout differences explicit. |
| 29 | `src/components/requests/request-detail-desktop-v2.tsx:130-158` | `src/components/requests/request-detail-desktop.tsx:112-140` | Share the common detail sections, keeping layout differences explicit. |
| 20 | `src/components/requests/request-detail-desktop-v2.tsx:298-317` | `src/components/requests/request-detail-desktop.tsx:280-299` | Share the common detail sections, keeping layout differences explicit. |

#### 8. Budget screens — 2 pairs, largest 28 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 28 | `src/components/budget/budget-code-create-dialog.tsx:86-113` | `src/components/budget/budget-code-edit-dialog.tsx:82-109` | Share budget fields or repeated filter controls. |
| 13 | `src/components/budget/budget-monitor-page.tsx:268-280` | `src/components/budget/budget-monitor-page.tsx:382-394` | Share budget fields or repeated filter controls. |

#### 9. Request and dashboard filters — 5 pairs, largest 27 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 27 | `src/components/dashboard/table-filters.tsx:33-59` | `src/components/requests/request-filters.tsx:40-66` | Share filter controls and labels while keeping page-specific options explicit. |
| 27 | `src/components/dashboard/table-filters.tsx:75-101` | `src/components/requests/request-filters.tsx:76-102` | Share filter controls and labels while keeping page-specific options explicit. |
| 24 | `src/components/dashboard/table-filters.tsx:198-221` | `src/components/requests/request-filters.tsx:208-231` | Share filter controls and labels while keeping page-specific options explicit. |
| 18 | `src/components/dashboard/table-filters.tsx:101-118` | `src/components/requests/request-filters.tsx:102-119` | Share filter controls and labels while keeping page-specific options explicit. |
| 18 | `src/components/dashboard/table-filters.tsx:150-167` | `src/components/requests/request-filters.tsx:139-156` | Share filter controls and labels while keeping page-specific options explicit. |

#### 10. Approval-chain pages — 1 pair, largest 27 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 27 | `src/app/(dashboard)/approval-chain/page.tsx:7-33` | `src/app/(dashboard)/dashboard/workflow/page.tsx:7-33` | Use one shared page body for the two entry points. |

#### 11. Audit actions — 1 pair, largest 27 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 27 | `src/server-actions/audit.ts:89-115` | `src/server-actions/audit.ts:173-199` | Share the audit record fields loaded by both queries. |

#### 12. Request actions — 3 pairs, largest 26 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 26 | `src/server-actions/requests.ts:693-718` | `src/server-actions/requests.ts:741-766` | Share repeated row shapes or validation, leaving action-specific access checks in place. |
| 21 | `src/server-actions/requests.ts:2411-2431` | `src/server-actions/requests.ts:2462-2482` | Share repeated row shapes or validation, leaving action-specific access checks in place. |
| 20 | `src/server-actions/requests.ts:1574-1593` | `src/server-actions/requests.ts:1636-1656` | Share repeated row shapes or validation, leaving action-specific access checks in place. |

#### 13. Solution and approval actions — 3 pairs, largest 24 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 24 | `src/server-actions/solutions.ts:261-284` | `src/server-actions/solutions.ts:1728-1753` | Share repeated loading or validation only; preserve each action’s authorization. |
| 15 | `src/server-actions/approvals.ts:123-137` | `src/server-actions/solutions.ts:1500-1514` | Share repeated loading or validation only; preserve each action’s authorization. |
| 15 | `src/server-actions/solutions.ts:261-275` | `src/server-actions/solutions.ts:1229-1243` | Share repeated loading or validation only; preserve each action’s authorization. |

#### 14. Test-only UI harness inside src — 1 pair, largest 23 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 23 | `src/app/test-harness/approval-pending-state/approval-pending-state-harness-client.tsx:15-37` | `src/app/test-harness/approval-pending-state/approval-pending-state-harness-client.tsx:42-64` | Build the repeated sample display data with a small test-only helper. |

#### 15. Mobile and desktop request rows — 1 pair, largest 21 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 21 | `src/components/mobile/request-card.tsx:7-27` | `src/components/requests/request-table.tsx:29-48` | Keep the shared request-row type in one module. |

#### 16. Dialog data conversion — 3 pairs, largest 20 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 20 | `src/lib/modal-data-adapters.ts:471-490` | `src/lib/modal-data-adapters.ts:500-519` | Share the approval sorting and display-row conversion. |
| 16 | `src/lib/modal-data-adapters.ts:191-206` | `src/lib/modal-data-adapters.ts:471-486` | Share the approval sorting and display-row conversion. |
| 16 | `src/lib/modal-data-adapters.ts:471-486` | `src/lib/modal-data-adapters.ts:529-544` | Share the approval sorting and display-row conversion. |

#### 17. Organization administration — 3 pairs, largest 20 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 20 | `src/lib/organization/workspace-admin.ts:1467-1486` | `src/lib/organization/workspace-admin.ts:1548-1567` | Share repeated loading or input validation, not the distinct mutation rules. |
| 14 | `src/lib/organization/workspace-admin.ts:1728-1741` | `src/lib/organization/workspace-admin.ts:1794-1807` | Share repeated loading or input validation, not the distinct mutation rules. |
| 13 | `src/lib/organization/workspace-admin.ts:1206-1218` | `src/lib/organization/workspace-admin.ts:1262-1274` | Share repeated loading or input validation, not the distinct mutation rules. |

#### 18. Engineering dashboard types — 1 pair, largest 20 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 20 | `src/components/engineering/engineering-dashboard-tabs.tsx:40-59` | `src/components/engineering/engineering-dashboard-tabs.tsx:129-148` | Define the shared request-row type once. |

#### 19. Retention settings — 1 pair, largest 20 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 20 | `src/lib/retention-archive.ts:17-36` | `src/server-actions/retention.ts:30-49` | Keep one conversion from stored settings to retention-policy input. |

#### 20. Approval controls and progress display — 2 pairs, largest 17 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 17 | `src/components/approvals/approval-actions.tsx:23-39` | `src/components/mobile/mobile-approval-actions.tsx:39-55` | Share action state or progress-row rendering, retaining mobile layout differences. |
| 17 | `src/components/approvals/approval-progress.tsx:48-64` | `src/components/solutions/solution-detail.tsx:166-182` | Share action state or progress-row rendering, retaining mobile layout differences. |

#### 21. Rich-text image output — 2 pairs, largest 16 lines

| Matched lines | First location | Second location | Suggested cleanup |
| ---: | --- | --- | --- |
| 16 | `src/lib/inline-images/pdf.ts:142-157` | `src/lib/rich-text-presentation.ts:100-115` | Share the image geometry and rotated-image markup helpers. |
| 14 | `src/lib/inline-images/pdf.ts:83-96` | `src/lib/rich-text-presentation.ts:49-62` | Share the image geometry and rotated-image markup helpers. |

### Specifically requested: create/edit user dialogs

**Yes — their dialog shells are near-identical in structure, but the whole files are not identical.** Compare `src/components/admin/create-user-dialog.tsx:17-48` with `src/components/admin/edit-user-dialog.tsx:28-68`: both open a dialog, show the shared `UserForm`, close on success and refresh the page. The edit version additionally accepts external open state, supplies initial user details and uses a different trigger and scrollable size. The identical close-and-refresh handlers are at `create-user-dialog.tsx:21-24` and `edit-user-dialog.tsx:34-37` (both under `src/components/admin/`).

jscpd reported **no matching pair between these two files** at the requested thresholds. The shared account form already lives in `src/components/admin/user-form.tsx`; only consider a small shared dialog shell if both wrappers need further changes. This is lower priority than the much larger repeated request dialogs. This structural comparison is manual and is not added to the scan totals.

## 2. Tests — separate, short summary

**Test-code duplication: 2.95%** (3,454 / 117,200 lines; 164 matching pairs across 316 scanned files). Do not combine this with the production percentage. Repeated test setup is often intentional; keep each test’s expected result independent.

```sh
npx jscpd tests --min-lines 12 --min-tokens 80 --reporters json --output scratch/jscpd-tests
```

Raw output: `scratch/jscpd-tests/jscpd-report.json`. Raw `statistics.total`:

```json
{
  "clones": 164,
  "duplicatedLines": 3454,
  "duplicatedTokens": 22890,
  "lines": 117200,
  "newClones": 0,
  "newDuplicatedLines": 0,
  "percentage": 2.9470989761092152,
  "percentageTokens": 2.894555478980014,
  "sources": 316,
  "tokens": 790795
}
```

Largest representative pairs by test area (not the complete 164-pair inventory):

| Area / matched lines | First location | Second location | Suggested cleanup |
| --- | --- | --- | --- |
| Native runners / 85 | `tests/support/native/run-native-admin-security-tests.ts:112-196` | `tests/support/native/run-native-business-tests.ts:180-268` | Share owned-runtime setup only; keep each runner’s safety checks explicit. |
| Monitoring regressions / 63 | `tests/regression/t15e-monitor-bridge.test.ts:43-105` | `tests/regression/t15e-monitor-session-adapter.test.ts:45-107` | Share the fake monitor setup, not the expected outcomes. |
| Inline-image editing / 55 | `tests/regression/inline-image-crop.test.ts:1214-1268` | `tests/regression/inline-image-resize.test.ts:538-592` | Share the repeated editor test setup. |
| Flowchart regressions / 49 | `tests/regression/flowchart-readability.test.ts:93-141` | `tests/regression/flowchart-visual-polish.test.ts:97-145` | Share the fake rendering setup while keeping readability assertions local. |
| Organization tests / 48 | `tests/regression/clean-start-team-deactivation.test.ts:21-68` | `tests/regression/clean-start-unit-deactivation.test.ts:20-67` | Share the repeated test-module loader and fake organization setup. |
| Visibility fixtures / 47 | `tests/regression/clean-start-files-access.test.ts:30-76` | `tests/regression/clean-start-visibility-scope.test.ts:34-80` | Share the in-memory query matcher, keeping policy assertions independent. |
| Approval engine tests / 41 | `tests/regression/clean-start-attempts.test.ts:199-239` | `tests/regression/clean-start-engine-plan.test.ts:203-243` | Share fixture construction, not approval-policy expectations. |
| Browser login setup / 40 | `tests/e2e/clean-start-approval-flow.spec.ts:26-65` | `tests/e2e/clean-start-sharing-visibility.spec.ts:16-55` | Share the sign-in helper with explicit user credentials per test. |

The scans only analyze text; they do not execute tests. Fixture validation is separate from this duplication report. Playwright/browser scenarios were not executed by this worker.

## Recommended first three clean-ups

1. Share the approver picker used by final-approval submission and resubmission (the 209-line pair), preserving selection order and disabled states.
2. Share request-dialog display pieces: file icons, status labels, attachment lists and activity rows; leave each workflow’s write controls separate.
3. Share dashboard request fields and row conversion (the 125-line pair), with tests ensuring each query keeps its own visibility and ownership filter.
