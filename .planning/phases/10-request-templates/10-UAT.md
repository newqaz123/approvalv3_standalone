---
status: complete
phase: 10-request-templates
source: 10-01-SUMMARY.md, 10-02-SUMMARY.md
started: 2026-02-16T10:00:00Z
updated: 2026-02-16T10:50:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Admin: Create Template
expected: 1. Login as Admin. 2. Navigate to Admin > Request Templates. 3. Click "Create Template". 4. Fill form (Name="Hardware Request", Title="New Hardware: [Item]", Desc="Please specify specs..."). 5. Submit. 6. Verify "Hardware Request" appears in list.
result: pass

### 2. Admin: Edit Template
expected: 1. Click "Edit" on "Hardware Request" template. 2. Change Title to "Hardware Request: [Item Name]". 3. Save. 4. Verify list shows updated title.
result: pass

### 3. Admin: Set Default Template
expected: 1. Create a second template "General Inquiry". 2. Toggle "Default" ON for "General Inquiry". 3. Verify "General Inquiry" has (Default) badge. 4. Verify "Hardware Request" does NOT have default badge (only one default allowed).
result: pass

### 4. User: Default Template on Load
expected: 1. Navigate to "New Request" (as any user). 2. Verify "General Inquiry" is selected in the Template dropdown. 3. Verify Title and Description are pre-filled with "General Inquiry" content.
result: pass

### 5. User: Switch Template
expected: 1. On New Request page, change Template dropdown to "Hardware Request". 2. Verify Title updates to "Hardware Request: [Item Name]". 3. Verify Description updates to "Please specify specs...".
result: pass

### 6. User: Blank Request
expected: 1. Select "Select a template..." or "Blank Request" (if available) from dropdown. 2. Verify Title and Description fields are cleared/empty.
result: pass

### 7. Admin: Deactivate Template
expected: 1. Go to Admin > Templates. 2. Toggle "Active" status OFF for "Hardware Request". 3. Verify status shows as Inactive/Draft.
result: pass

### 8. User: Inactive Template Hidden
expected: 1. Go to New Request page. 2. Open Template dropdown. 3. Verify "Hardware Request" is NOT listed. 4. Verify "General Inquiry" is still listed.
result: pass

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0

## Gaps

<!-- Issues fixed immediately during testing:
1. Prisma orderBy syntax - corrected and committed (8971701)
2. FormField error with template selector - fixed and committed (7f6c665)
3. FormLabel/FormDescription without FormField context - fixed and committed (febbea4)
-->
