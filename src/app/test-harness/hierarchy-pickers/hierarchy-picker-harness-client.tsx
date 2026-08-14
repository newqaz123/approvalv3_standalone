'use client'

import { useState } from 'react'
import { SharedApprovalPickerHarness } from '@/components/solutions/custom-approval-picker'
import { SubmitterApprovalPickerHarness } from '@/components/requests/submitter-modal'
import { SubmitFinalApprovalPickerHarness } from '@/components/requests/submit-final-approval-modal'
import { FinalApprovalResubmitPickerHarness } from '@/components/requests/final-approval-resubmit-modal'
import { SolutionModalApprovalPickerHarness } from '@/components/requests/solution-modal'

/**
 * Deterministic, server-action-free approver pool shared by every harness
 * fixture. Each entry carries name + email + role + level so search parity can
 * be exercised across all four metadata axes. Level values are numeric so the
 * shared picker's `level: number | null` contract is satisfied; the search
 * helper renders them as "Level N" at runtime.
 */
interface HarnessUser {
  id: string
  name: string
  email: string
  role: string
  level: number
}

const HARNESS_USERS: HarnessUser[] = [
  { id: 'ada', name: 'Ada Lovelace', email: 'ada@example.com', role: 'Engineering', level: 1 },
  { id: 'grace', name: 'Grace Hopper', email: 'grace@example.com', role: 'Production', level: 2 },
  { id: 'linus', name: 'Linus Torvalds', email: 'linus@example.com', role: 'Quality', level: 3 },
]

const ALL_USER_IDS = HARNESS_USERS.map((user) => user.id)

/** Does not collide with any harness user id so no user is self-excluded. */
const CURRENT_USER_ID = 'harness-current-user'

export function HierarchyPickerHarnessClient() {
  const [customIds, setCustomIds] = useState<string[]>([])
  const [submitterIds, setSubmitterIds] = useState<string[]>([])
  const [submitFinalIds, setSubmitFinalIds] = useState<string[]>([])
  const [finalResubmitIds, setFinalResubmitIds] = useState<string[]>([])
  const [solutionIds, setSolutionIds] = useState<string[]>([])

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-8">
      <header>
        <h1 className="text-2xl font-bold">Hierarchy Picker Test Harness</h1>
        <p className="text-sm text-muted-foreground">
          Deterministic server-action-free fixtures for the five real approval
          hierarchy pickers.
        </p>
      </header>

      <section data-picker-fixture="custom">
        <h2 className="mb-2 text-lg font-semibold">Shared Solution Picker</h2>
        <SharedApprovalPickerHarness
          users={HARNESS_USERS}
          selectedIds={customIds}
          onChange={setCustomIds}
          currentUserId={CURRENT_USER_ID}
        />
        <FixtureControls
          onExhaust={() => setCustomIds(ALL_USER_IDS)}
          onReset={() => setCustomIds([])}
        />
      </section>

      <section data-picker-fixture="submitter">
        <h2 className="mb-2 text-lg font-semibold">Submitter Modal Picker</h2>
        <SubmitterApprovalPickerHarness
          availableUsers={HARNESS_USERS}
          selectedApprovers={submitterIds}
          onChange={setSubmitterIds}
        />
        <FixtureControls
          onExhaust={() => setSubmitterIds(ALL_USER_IDS)}
          onReset={() => setSubmitterIds([])}
        />
      </section>

      <section data-picker-fixture="submit-final">
        <h2 className="mb-2 text-lg font-semibold">Submit Final Approval Picker</h2>
        <SubmitFinalApprovalPickerHarness
          availableUsers={HARNESS_USERS}
          selectedApprovers={submitFinalIds}
          onChange={setSubmitFinalIds}
        />
        <FixtureControls
          onExhaust={() => setSubmitFinalIds(ALL_USER_IDS)}
          onReset={() => setSubmitFinalIds([])}
        />
      </section>

      <section data-picker-fixture="final-resubmit">
        <h2 className="mb-2 text-lg font-semibold">Final Approval Resubmit Picker</h2>
        <FinalApprovalResubmitPickerHarness
          availableUsers={HARNESS_USERS}
          selectedApprovers={finalResubmitIds}
          onChange={setFinalResubmitIds}
        />
        <FixtureControls
          onExhaust={() => setFinalResubmitIds(ALL_USER_IDS)}
          onReset={() => setFinalResubmitIds([])}
        />
      </section>

      <section data-picker-fixture="solution">
        <h2 className="mb-2 text-lg font-semibold">Solution Modal Picker</h2>
        <SolutionModalApprovalPickerHarness
          users={HARNESS_USERS}
          selectedIds={solutionIds}
          onChange={setSolutionIds}
        />
        <FixtureControls
          onExhaust={() => setSolutionIds(ALL_USER_IDS)}
          onReset={() => setSolutionIds([])}
        />
      </section>
    </div>
  )
}

/**
 * Harness-owned fixture controls. [data-picker-exhaust] preselects every user
 * so the picker's exhausted state can be asserted. [data-picker-reset] clears
 * all selections. These manipulate only local selected-ID state — they never
 * call server actions, fetch, or write storage/database state.
 */
function FixtureControls({
  onExhaust,
  onReset,
}: {
  onExhaust: () => void
  onReset: () => void
}) {
  return (
    <div className="mt-3 flex gap-2">
      <button
        type="button"
        data-picker-exhaust
        onClick={onExhaust}
        className="rounded border px-3 py-1 text-sm"
      >
        Preselect All (Exhaust)
      </button>
      <button
        type="button"
        data-picker-reset
        onClick={onReset}
        className="rounded border px-3 py-1 text-sm"
      >
        Reset
      </button>
    </div>
  )
}
