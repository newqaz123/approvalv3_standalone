---
phase: quick-015
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/ui/hover-card.tsx
  - src/components/requests/approval-status-badge.tsx
  - src/server-actions/dashboard.ts
  - src/components/requests/request-table.tsx
  - src/components/dashboard/dashboard-table.tsx
  - src/components/mobile/request-card.tsx
autonomous: true

must_haves:
  truths:
    - "All request tables show an approval status column (Approved/approving/rejected)"
    - "Hovering over status badge shows approval hierarchy/history for requests in progress"
    - "Minimalist design - clean tooltip with clear hierarchy visualization"
  artifacts:
    - path: "src/components/ui/hover-card.tsx"
      provides: "Shadcn/ui hover card component for tooltips"
    - path: "src/components/requests/approval-status-badge.tsx"
      provides: "Approval status badge with hover hierarchy display"
      exports: ["ApprovalStatusBadge"]
    - path: "src/server-actions/dashboard.ts"
      provides: "Extended RequestListRow type with approvals[] field"
  key_links:
    - from: "src/components/requests/approval-status-badge.tsx"
      to: "src/components/ui/hover-card.tsx"
      via: "HoverCard, HoverCardTrigger, HoverCardContent imports"
    - from: "src/components/requests/request-table.tsx"
      to: "ApprovalStatusBadge"
      via: "Column definition using new badge component"
    - from: "src/components/dashboard/dashboard-table.tsx"
      to: "ApprovalStatusBadge"
      via: "Column definition using new badge component"
---

<objective>
Add approval status column to all request tables with hover tooltip showing approval hierarchy/history in minimalist style.

Purpose: Users need to quickly see the approval status of each request and understand the approval chain at a glance without clicking through to details.

Output: Working approval status badges with hover hierarchy display in dashboard and request list tables.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
# Current State
- Tables use StatusBadge component for request status (ImprovementRequest, Completed, etc.)
- RequestListRow type in dashboard.ts includes id, title, status, createdAt, requester, department, _count, hasRejection
- RequestApproval model tracks: status (pending/approved/rejected), approverId, requiredLevel, order, approvedAt
- Tables: request-table.tsx (requests page), dashboard-table.tsx (dashboard)
- Mobile card view: request-card.tsx

# Approval Data Available
From RequestApproval model:
- status: pending | approved | rejected
- approver: User (name when approved)
- requiredLevel: Int (hierarchy level)
- order: Int (sequence 1, 2, 3...)
- approvedAt: DateTime
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create hover card UI component and approval status badge</name>
  <files>src/components/ui/hover-card.tsx, src/components/requests/approval-status-badge.tsx</files>
  <action>
    Create TWO files:

    1. **src/components/ui/hover-card.tsx** - Standard shadcn/ui hover card component:
    - Use Radix UI @radix-ui/react-hover-card
    - Export: HoverCard, HoverCardTrigger, HoverCardContent, HoverCardArrow
    - Follow existing badge.tsx styling patterns (border, padding, transitions)
    - Add to src/components/ui/index.ts exports

    2. **src/components/requests/approval-status-badge.tsx** - New approval status badge component:
    - Props interface:
      ```typescript
      interface ApprovalStatusBadgeProps {
        approvals: Array<{
          status: 'pending' | 'approved' | 'rejected'
          approver?: { name: string }
          requiredLevel: number
          order: number
          approvedAt?: Date
        }>
        requestStatus: string
      }
      ```
    - Badge displays overall approval state:
      - All approved: Green "Approved" badge with checkmark
      - Any rejected: Red "Rejected" badge
      - In progress: Yellow "Approving..." badge with progress indicator (e.g., "2/3 approved")
    - Hover card content (minimalist):
      - Vertical list of approval levels in order
      - Each row shows:
        - Level name (Level 1, Level 2, etc.)
        - Status icon: green checkmark (approved), yellow clock (pending), red X (rejected)
        - Approver name (when approved/rejected)
        - Approved date (small, muted when approved)
      - Clean styling: border-separated rows, subtle backgrounds, max-width 280px
    - Use lucide-react icons: CheckCircle2, Clock, XCircle
    - Follow StatusBadge styling patterns for consistency
  </action>
  <verify>
    Files exist at src/components/ui/hover-card.tsx and src/components/requests/approval-status-badge.tsx
    Component exports match specification
    No TypeScript errors
  </verify>
  <done>
    Hover card UI component created
    ApprovalStatusBadge component created with props interface, badge display, hover hierarchy content
  </done>
</task>

<task type="auto">
  <name>Task 2: Extend server actions to include approval data</name>
  <files>src/server-actions/dashboard.ts</files>
  <action>
    Modify RequestListRow type and server action queries:

    1. Extend RequestListRow type to include approvals array:
    ```typescript
    export type RequestListRow = {
      id: string
      title: string
      status: string
      createdAt: Date
      requesterId: string
      department: { name: string } | null
      requester: { id: string; name: string } | null
      _count: { fileAttachments: number }
      hasRejection?: boolean
      approvals: Array<{
        id: string
        status: 'pending' | 'approved' | 'rejected'
        approver?: { name: string }
        requiredLevel: number
        order: number
        approvedAt?: Date | null
      }>
    }
    ```

    2. Update all three functions (getPendingMyApprovals, getMyCreatedRequests, getAllRequests):
       - Add to select/include: approvals with orderBy order
       - Include approver name for each approval
       - Map results to include approvals array in return

    Keep existing hasRejection logic intact.
  </action>
  <verify>
    RequestListRow type includes approvals array
    Server action functions include approvals in select with approver name
    All three functions updated: getPendingMyApprovals, getMyCreatedRequests, getAllRequests
  </verify>
  <done>
    RequestListRow type extended with approvals field
    Server actions return approval hierarchy data for all requests
  </done>
</task>

<task type="auto">
  <name>Task 3: Integrate approval badge into tables and mobile cards</name>
  <files>src/components/requests/request-table.tsx, src/components/dashboard/dashboard-table.tsx, src/components/mobile/request-card.tsx</files>
  <action>
    Replace/add to approval status display in THREE files:

    1. **request-table.tsx**:
       - Import ApprovalStatusBadge
       - Add new column "Approval Status" after "Status" column
       - Column cell renders ApprovalStatusBadge with row.original.approvals and row.original.status
       - Status badge column stays (shows request workflow status)

    2. **dashboard-table.tsx**:
       - Import ApprovalStatusBadge
       - Add new column "Approval Status" after "Status" column
       - Column cell renders ApprovalStatusBadge with row.original.approvals and row.original.status
       - Keep existing filters and sorting

    3. **request-card.tsx** (mobile view):
       - Import ApprovalStatusBadge
       - Add approval status badge display in middle row alongside existing StatusBadge
       - Show in compact form - small badge between status and date

    Styling:
       - Use consistent column width (approx 140px)
       - Center-align badge in table cells
       - Mobile: inline display with small gap from status badge
  </action>
  <verify>
    request-table.tsx has ApprovalStatus column with ApprovalStatusBadge
    dashboard-table.tsx has Approval Status column with ApprovalStatusBadge
    request-card.tsx shows ApprovalStatusBadge on mobile
    ApprovalStatusBadge receives approvals and status props
  </verify>
  <done>
    All table views show approval status column
    Hovering over approval badge displays approval hierarchy
    Mobile cards display approval status
  </done>
</task>

</tasks>

<verification>
1. Visit /dashboard page - verify "Approval Status" column appears
2. Hover over approval badge in table - verify hierarchy tooltip shows with minimalist design
3. Verify green badges for completed approvals, yellow for in-progress, red for rejected
4. Visit /requests page - verify same approval status column exists
5. On mobile viewport - verify approval badge displays in card view
6. Test with requests at different approval stages (pending, partially approved, completed)
</verification>

<success_criteria>
- All request tables display approval status column
- Hovering approval badge shows clean hierarchy list with status icons
- Minimalist design achieved (subtle borders, proper spacing, clear icons)
- Mobile view displays approval status without overflow
- No TypeScript errors
- Existing functionality preserved
</success_criteria>

<output>
After completion, create `.planning/quick/015-approval-status-column-and-hover-hierarchy/015-SUMMARY.md`
</output>
