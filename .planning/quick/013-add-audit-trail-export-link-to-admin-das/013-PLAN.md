---
phase: quick-013
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [src/app/(admin)/admin/page.tsx]
autonomous: true

must_haves:
  truths:
    - "Admin dashboard Quick Actions grid includes an Audit Trail Export card"
    - "Clicking the Audit Trail Export card navigates to /admin/audit"
  artifacts:
    - path: "src/app/(admin)/admin/page.tsx"
      provides: "Audit Trail Export quick action link"
      contains: "/admin/audit"
  key_links:
    - from: "src/app/(admin)/admin/page.tsx"
      to: "/admin/audit"
      via: "Next.js Link component"
      pattern: 'href="/admin/audit"'
---

<objective>
Add an "Audit Trail Export" card to the admin dashboard Quick Actions grid, linking to /admin/audit.

Purpose: Give admins quick access to audit trail export functionality from the main admin dashboard.
Output: Updated admin page with a fourth quick action card.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/app/(admin)/admin/page.tsx
@src/app/admin/audit/page.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add Audit Trail Export card to Quick Actions grid</name>
  <files>src/app/(admin)/admin/page.tsx</files>
  <action>
    Add a new Link card to the Quick Actions grid in src/app/(admin)/admin/page.tsx, after the existing "Deleted Requests" card.

    1. Import `ClipboardList` from lucide-react (add to existing import). This icon represents audit/checklist functionality.
    2. Add a new Link block following the exact same pattern as the existing cards:
       - href="/admin/audit"
       - Same className as other cards: "rounded-lg border bg-card p-6 hover:bg-accent transition-colors"
       - Icon wrapper: rounded-full bg-primary/10 p-3 (same as Manage Users/Departments, NOT destructive)
       - ClipboardList icon with className "h-6 w-6 text-primary"
       - Title: "Audit Trail Export"
       - Description: "Export audit logs in CSV or JSON format"

    Do NOT modify any other cards or sections. Only add the import and the new Link card.
  </action>
  <verify>
    Run `npx next build 2>&1 | tail -20` to confirm no build errors.
    Grep for "/admin/audit" in the file to confirm the link exists.
  </verify>
  <done>Admin dashboard Quick Actions grid shows 4 cards: Manage Users, Manage Departments, Deleted Requests, and Audit Trail Export. The Audit Trail Export card links to /admin/audit with a ClipboardList icon.</done>
</task>

</tasks>

<verification>
- Build succeeds without errors
- Admin dashboard page renders 4 quick action cards
- Audit Trail Export card links to /admin/audit
</verification>

<success_criteria>
- The admin dashboard at /admin displays an "Audit Trail Export" quick action card
- Clicking the card navigates to /admin/audit
- Visual style matches existing quick action cards
</success_criteria>

<output>
After completion, create `.planning/quick/013-add-audit-trail-export-link-to-admin-das/013-SUMMARY.md`
</output>
