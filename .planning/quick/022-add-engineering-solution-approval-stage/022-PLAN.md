---
phase: 022-add-engineering-solution-approval-stage
type: execute
wave: 1
depends_on: []
files_modified: [src/server-actions/reports.ts]
autonomous: false
user_setup: []

must_haves:
  truths:
    - "Solution approvals included in PDF pipeline"
    - "Engineering solution stages visible between request creation and final approval"
    - "Merged and sorted approvals show complete workflow"
  artifacts:
    - path: "src/server-actions/reports.ts"
      provides: "Merged approvals from RequestApproval and SolutionApproval"
      contains: "solution approvals in include query and merged pipeline"
  key_links:
    - from: "Solution model"
      to: "PDF approvals array"
      via: "mergedApprovals array combining RequestApproval and SolutionApproval"
---

<objective>
Fix missing engineering solution approval stages in PDF pipeline. Currently only RequestApproval records are shown, but SolutionApproval records (for engineering solution reviews) are missing.

Purpose: Show complete approval workflow including engineering solution review stages.
Output: PDF pipeline displays all approval stages: Initial Request → Engineering Solution Approval → Department Approval → Final Approval
</objective>

<execution_context>
@~/.config/opencode/get-shit-done/workflows/execute-plan.md
@~/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/server-actions/reports.ts
@prisma/schema.prisma (Solution, SolutionApproval models)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add solution approvals to Prisma query</name>
  <files>src/server-actions/reports.ts</files>
  <action>
Update the solutions include block in the Prisma query (around line 185) to include the approvals relation:

```typescript
        solutions: {
          include: {
            submittedBy: {
              select: {
                id: true,
                name: true,
              },
            },
            fileAttachments: {
              include: {
                uploadedBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
              orderBy: {
                createdAt: 'asc',
              },
            },
            approvals: {
              include: {
                approver: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    department: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
                requiredApprover: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    department: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
              orderBy: [
                {
                  order: 'asc',
                },
              ],
            },
          },
          take: 1,
          orderBy: {
            createdAt: 'desc',
          },
        },
```

This adds the approvals relation to the solutions query so we can access solution approval data.
  </action>
  <verify>Prisma query includes approvals in solutions include block</verify>
  <done>Solution approvals now fetched with request data</done>
</task>

<task type="auto">
  <name>Task 2: Merge solution approvals into pipeline</name>
  <files>src/server-actions/reports.ts</files>
  <action>
Update the pdfData building section to merge solution approvals into the approvals array.

Replace the current approvals mapping (around line 301) with a merged approach:

```typescript
      // Merge request approvals and solution approvals into unified pipeline
      approvals: (() => {
        // Start with request approvals
        const mergedApprovals = request.approvals.map((a, index) => ({
          approverName: a.approver?.name || a.requiredApprover?.name || request.requester.name || 'Unknown',
          approverRole: a.requiredApprover?.department?.name,
          approverDepartment: a.approver?.department?.name || a.requiredApprover?.department?.name,
          requiredLevel: a.requiredLevel,
          status: a.status as 'approved' | 'rejected' | 'pending',
          comments: a.comments || undefined,
          approvedAt: a.approvedAt || undefined,
          order: a.order,
          stage: getStageName(a, index, request),
          isSolutionApproval: false,
          sortOrder: a.order,
        }))

        // Add solution approvals if they exist
        if (request.solutions.length > 0 && request.solutions[0].approvals.length > 0) {
          const solution = request.solutions[0]
          const solutionApprovals = solution.approvals.map((a, index) => ({
            approverName: a.approver?.name || a.requiredApprover?.name || 'Engineering',
            approverRole: a.requiredApprover?.department?.name || 'Engineering',
            approverDepartment: a.approver?.department?.name || a.requiredApprover?.department?.name || 'Engineering',
            requiredLevel: a.requiredLevel || 1,
            status: a.status as 'approved' | 'rejected' | 'pending',
            comments: a.comments || undefined,
            approvedAt: a.approvedAt || undefined,
            order: a.order,
            stage: `Engineering Solution ${index === 0 ? 'Review' : `Approval ${index}`}`,
            isSolutionApproval: true,
            sortOrder: 100 + a.order, // Place after initial request but before final approvals
          }))

          // Merge and sort by sortOrder
          mergedApprovals.push(...solutionApprovals)
        }

        // Sort by sortOrder to maintain proper sequence
        mergedApprovals.sort((a, b) => a.sortOrder - b.sortOrder)

        // Reassign order numbers after sorting
        return mergedApprovals.map((a, index) => ({
          ...a,
          order: index + 1,
        }))
      })(),
```

This merges both RequestApproval and SolutionApproval records into a single unified pipeline, with solution approvals appearing after the initial request approval but before final department approvals.
  </action>
  <verify>Solution approvals merged into pipeline with proper stage names</verify>
  <done>Engineering solution approvals visible in PDF pipeline</done>
</task>

<task type="checkpoint:human-verify">
  <what-built>Merged approval pipeline including RequestApproval and SolutionApproval records</what-built>
  <how-to-verify>
1. Navigate to a request detail page that has:
   - An engineering solution submitted
   - Solution approvals (engineering review/approval)
   - Final department approvals
2. Click "Export PDF" button
3. Open the generated PDF file
4. Scroll to Approval History section
5. Verify:
   - [ ] First stage shows "INITIAL REQUEST" with submitter
   - [ ] Second stage(s) show "Engineering Solution Review" or "Engineering Solution Approval"
   - [ ] Engineering approver names visible
   - [ ] Engineering department shown
   - [ ] Subsequent stages show department approvals
   - [ ] Final stage shows "Final Approval" (if applicable)
   - [ ] All stages connected with arrows in correct order
   - [ ] Solution approval comments visible in yellow boxes
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
PDF Approval History pipeline shows complete workflow:
- Initial Request (submitter)
- Engineering Solution Review/Approval (if solution exists)
- Department approvals
- Final Approval (if applicable)
</verification>

<success_criteria>
Engineering solution approval stages visible in PDF pipeline between initial request and final approvals.
</success_criteria>

<output>
After completion, create `.planning/quick/022-add-engineering-solution-approval-stage/022-01-SUMMARY.md`
</output>
