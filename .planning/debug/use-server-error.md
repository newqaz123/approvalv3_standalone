---
status: resolved
trigger: "Diagnose the root cause of this blocker error: 'A 'use server' file can only export async functions, found object.'"
created: 2026-02-02T00:00:00Z
updated: 2026-02-02T00:00:00Z
---

## Current Focus
hypothesis: CONFIRMED - Line 12 exports a Zod schema object (submitSolutionSchema), not an async function
test: Read src/server-actions/solutions.ts and examined all exports
expecting: Find at least one export that is not an async function
next_action: Document root cause and recommend fix

## Symptoms
expected: Submit Solution button should submit form data via server action
actual: Next.js throws error: "A 'use server' file can only export async functions, found object"
errors: "A 'use server' file can only export async functions, found object. Read more: https://nextjs.org/docs/messages/invalid-use-server-value"
reproduction: Engineering user clicks "Submit Solution" button at /engineering/solutions/[requestId]
started: Unknown when this started (blocker error)

## Eliminated

## Evidence
- timestamp: 2026-02-02T00:00:00Z
  checked: src/server-actions/solutions.ts, lines 1-1497
  found: Line 12 exports `submitSolutionSchema` (a Zod schema object): `export const submitSolutionSchema = z.object({...})`
  found: Line 27 exports `SubmitSolutionInput` type: `export type SubmitSolutionInput = z.infer<typeof submitSolutionSchema>`
  implication: Next.js 'use server' directive ONLY allows async function exports. Zod schemas are objects, not functions.
  found: All other exports (submitSolution, getSolutionBySolutionId, etc.) are correctly exported as async functions
  implication: Only lines 12 and 27 violate the 'use server' export rules

## Resolution
root_cause: src/server-actions/solutions.ts exports two non-function values at lines 12 and 27:
  1. Line 12: `export const submitSolutionSchema = z.object({...})` - This is a Zod schema object
  2. Line 27: `export type SubmitSolutionInput = z.infer<typeof submitSolutionSchema>` - This is a TypeScript type export

  Next.js 'use server' files can ONLY export async functions. These exports violate that rule.

fix: Move the schema and type exports to a separate non-'use server' file, then import them in the server actions file.
  Option 1: Create src/lib/schemas/solution-schemas.ts with the schema/type definitions
  Option 2: Create src/server-actions/solutions.schema.ts in the same directory (simpler, keeps related files together)

verification: NOT APPLICABLE (diagnose-only mode)
files_changed: []
