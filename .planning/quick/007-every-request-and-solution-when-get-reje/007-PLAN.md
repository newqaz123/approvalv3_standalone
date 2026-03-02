---
phase: quick
plan: 007
type: execute
wave: 1
depends_on: []
files_modified:
  - src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx
  - src/components/solutions/solution-form.tsx
autonomous: true

must_haves:
  truths:
    - "When engineer resubmits a rejected solution, form pre-fills with previous solution data (title, description, cost, currency, timeline, concept design)"
    - "When requester resubmits a rejected request, form pre-fills with current title and description (already working)"
    - "Engineer can modify pre-filled values before resubmitting"
  artifacts:
    - path: "src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx"
      provides: "Fetches previous solution data and passes to SolutionForm"
    - path: "src/components/solutions/solution-form.tsx"
      provides: "Accepts optional previousSolution prop and uses as form defaults"
  key_links:
    - from: "src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx"
      to: "src/components/solutions/solution-form.tsx"
      via: "previousSolution prop"
      pattern: "previousSolution"
---

<objective>
Pre-fill solution form with previous solution data when resubmitting after rejection.

Purpose: When a solution is rejected, the engineer currently has to re-enter all data (title, description, cost estimate, currency, timeline, concept design) from scratch. The form should pre-fill with the previous solution's data so the engineer can make corrections and resubmit without re-typing everything.

Output: Solution form pre-fills all fields from the most recent rejected solution when navigating to resubmit.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx
@src/components/solutions/solution-form.tsx
@prisma/schema.prisma
</context>

<tasks>

<task type="auto">
  <name>Task 1: Load previous solution data and pre-fill form on resubmission</name>
  <files>
    src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx
    src/components/solutions/solution-form.tsx
  </files>
  <action>
    **In `src/app/(dashboard)/engineering/solutions/[requestId]/page.tsx`:**

    After fetching the request, query for the most recent Solution for this requestId:
    ```typescript
    const previousSolution = await prisma.solution.findFirst({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
      select: {
        title: true,
        description: true,
        costEstimate: true,
        currency: true,
        timeline: true,
        conceptDesign: true,
      },
    })
    ```

    Pass `previousSolution` to the SolutionForm component. Convert `costEstimate` from Prisma Decimal to number: `previousSolution ? { ...previousSolution, costEstimate: previousSolution.costEstimate ? Number(previousSolution.costEstimate) : undefined } : undefined`.

    **In `src/components/solutions/solution-form.tsx`:**

    1. Add optional `previousSolution` prop to `SolutionFormProps`:
    ```typescript
    interface SolutionFormProps {
      requestId: string
      requestTitle: string
      currentUserId: string
      allUsers: Array<{ id: string; name: string; email: string; level: number | null }>
      previousSolution?: {
        title: string
        description: string
        costEstimate?: number
        currency: string
        timeline?: string | null
        conceptDesign?: string | null
      }
    }
    ```

    2. Update `useForm` defaultValues to use previousSolution data when available:
    ```typescript
    defaultValues: {
      title: previousSolution?.title || `Solution for: ${requestTitle}`,
      description: previousSolution?.description || '',
      costEstimate: previousSolution?.costEstimate || undefined,
      currency: (previousSolution?.currency as 'THB' | 'USD' | 'EUR') || 'THB',
      timeline: previousSolution?.timeline || '',
      conceptDesign: previousSolution?.conceptDesign || '',
      useCustomApprovals: false,
      customApproverIds: [],
    },
    ```

    3. Add an informational banner at the top of the form (before the Request context card) when previousSolution exists:
    ```tsx
    {previousSolution && (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-medium text-blue-900">Resubmission</p>
        <p className="text-sm text-blue-700">
          Your previous solution data has been pre-filled. Review the rejection feedback, make your corrections, and resubmit.
        </p>
      </div>
    )}
    ```

    Note: Do NOT pre-fill useCustomApprovals or customApproverIds -- the approval chain should be set fresh each time since previous approvers may have rejected it. File attachments from the previous solution are already associated with the request and don't need re-upload.
  </action>
  <verify>
    1. `npx tsc --noEmit` passes without errors
    2. `npm run build` succeeds
    3. Manual check: Navigate to solution submission for a request that has a previously rejected solution -- form fields should be pre-filled with previous values
  </verify>
  <done>
    When a solution is rejected and the engineer goes to submit a new solution, the form pre-fills title, description, cost estimate, currency, timeline, and concept design from the previous rejected solution. A blue banner indicates this is a resubmission. The engineer can modify any field before submitting.
  </done>
</task>

</tasks>

<verification>
- TypeScript compiles without errors
- Build succeeds
- Solution form pre-fills from previous solution on resubmission
- New submissions (no previous solution) still work with empty defaults
- All form fields are editable after pre-fill
</verification>

<success_criteria>
- Engineer resubmitting a rejected solution sees all previous data pre-filled in the form
- No data loss on rejection -- title, description, cost, currency, timeline, concept design all preserved
- Blue resubmission banner visible when previous solution exists
- Fresh submissions (first time) unaffected -- form uses original empty defaults
</success_criteria>

<output>
After completion, create `.planning/quick/007-every-request-and-solution-when-get-reje/007-SUMMARY.md`
</output>
