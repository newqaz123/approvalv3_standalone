---
phase: quick
plan: 001
type: execute
wave: 1
depends_on: []
files_modified: [src/components/navigation/navbar.tsx]
autonomous: true

must_haves:
  truths:
    - "Engineering role users see an 'Engineering Dashboard' link in the top navbar"
    - "Non-engineering users do not see the Engineering Dashboard link"
    - "Clicking the link navigates to /engineering"
    - "Active state highlights when on /engineering path"
  artifacts:
    - path: "src/components/navigation/navbar.tsx"
      provides: "Engineering Dashboard nav link for engineering users"
      contains: "href=\"/engineering\""
  key_links:
    - from: "src/components/navigation/navbar.tsx"
      to: "/engineering"
      via: "Next.js Link component"
      pattern: "href.*engineering"
---

<objective>
Add an "Engineering Dashboard" navigation button to the top navbar, visible to users with the engineering role, linking to /engineering.

Purpose: Engineering users currently have no quick way to access their dashboard from the navbar - they must know the URL.
Output: Updated navbar with role-conditional Engineering Dashboard link.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/components/navigation/navbar.tsx
@src/app/(dashboard)/engineering/page.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add Engineering Dashboard link to navbar</name>
  <files>src/components/navigation/navbar.tsx</files>
  <action>
Add an "Engineering Dashboard" navigation link to the navbar, positioned after "My Actions" and before the Admin Panel link. Follow the exact same pattern as the existing Admin Panel conditional link.

Implementation details:
- Import Wrench icon from lucide-react (add to existing import)
- Detect engineering role: `const isEngineering = (user?.publicMetadata as any)?.role === 'engineering'`
- Conditionally render the link when `isEngineering` is true
- Link href: "/engineering"
- Active state: highlight when `pathname?.startsWith('/engineering')`
- Use same styling pattern as other nav links (flex items-center gap-2, rounded-md px-3 py-2, text-sm font-medium, gray color scheme with bg-gray-100 active state)
- Icon: Wrench with h-4 w-4 class
- Label text: "Engineering"

Note: The engineering role check uses Clerk publicMetadata, same pattern as the isAdmin check already in the component.
  </action>
  <verify>
    Run `npx next build 2>&1 | tail -20` to verify no build errors.
    Visually confirm: grep the navbar file for "engineering" to verify the link exists with correct href and conditional rendering.
  </verify>
  <done>
    Engineering role users see an "Engineering" link in the navbar between "My Actions" and "Admin Panel". Non-engineering users do not see it. Link navigates to /engineering with active state highlighting.
  </done>
</task>

</tasks>

<verification>
- `grep -n "engineering" src/components/navigation/navbar.tsx` shows the new link with href="/engineering"
- `grep -n "isEngineering" src/components/navigation/navbar.tsx` shows role check
- Build completes without errors
</verification>

<success_criteria>
- Engineering Dashboard link appears in navbar for engineering role users
- Link navigates to /engineering
- Active state works when on /engineering path
- Non-engineering users do not see the link
- No build errors
</success_criteria>

<output>
After completion, create `.planning/quick/001-add-access-engineer-dashboard-button-at-/001-SUMMARY.md`
</output>
