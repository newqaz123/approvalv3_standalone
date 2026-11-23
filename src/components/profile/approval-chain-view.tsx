import React from 'react'
import type { PersonalApprovalChain } from '@/lib/approval-routes/chains-admin'
import type { ApprovalPhase } from '@/lib/approval-routes/definition'

const phaseCopy: Record<ApprovalPhase, { title: string; description: string }> = {
  REQUEST: {
    title: 'Request approval',
    description: 'If you submit a new request, approval follows your organization assignment.',
  },
  SOLUTION: {
    title: 'Solution approval',
    description: 'If you submit a solution using the published route, approval follows your assignment. Another submitter may have a different route.',
  },
  FINAL: {
    title: 'Final approval',
    description: 'This preview assumes you start final approval on a request you submitted. The route follows the requester. The person who starts final approval can change which steps are required.',
  },
}

export function ApprovalChainView({ chain }: { chain: PersonalApprovalChain }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Approval Chain</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          See who could approve future submissions under your published organization routes.
          For an existing submission, check its request details for the actual chain.
        </p>
      </header>

      {chain.kind === 'unassigned' ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-card-foreground">
          You are not assigned to an organization unit. Please contact your administrator.
        </p>
      ) : (
        <>
          <p className="break-words text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Your unit:</span> {chain.unitPath.join(' / ')}
          </p>
          <div className="grid gap-4 lg:grid-cols-3">
            {chain.phases.map((entry) => {
              const copy = phaseCopy[entry.phase]
              const headingId = `approval-chain-${entry.phase.toLowerCase()}`
              return (
                <section
                  key={entry.phase}
                  aria-labelledby={headingId}
                  className="min-w-0 space-y-4 rounded-xl border bg-card p-4 text-card-foreground sm:p-5"
                >
                  <div className="space-y-1.5">
                    <h2 id={headingId} className="text-lg font-semibold">{copy.title}</h2>
                    {entry.kind !== 'not-permitted' && (
                      <p className="text-sm text-muted-foreground">{copy.description}</p>
                    )}
                  </div>
                  {entry.kind === 'not-permitted' ? (
                    <p className="rounded-md bg-muted px-3 py-2 text-sm">
                      You don&rsquo;t have permission to submit solutions.
                    </p>
                  ) : entry.kind === 'unavailable' ? (
                    <p className="rounded-md bg-muted px-3 py-2 text-sm">
                      No usable published route for this phase. Please contact your administrator.
                    </p>
                  ) : (
                    <div className="space-y-3 border-t pt-3">
                      <p className="break-words text-sm font-medium">Route from {entry.routeUnitName}</p>
                      {entry.preview.autoApproved && (
                        <p className="text-sm text-muted-foreground">
                          Automatically approved: your position meets or exceeds the approval limit.
                        </p>
                      )}
                      {entry.preview.noEligibleSteps && (
                        <p className="text-sm text-muted-foreground">
                          No eligible approval steps: this phase would complete without an approver.
                        </p>
                      )}
                      {entry.preview.steps.length > 0 && (
                        <ol className="list-decimal space-y-3 pl-5 text-sm marker:font-medium">
                          {entry.preview.steps.map((step) => (
                            <li key={step.requiredPositionId} value={step.order} className="space-y-0.5 break-words pl-1">
                              <p className="font-medium">{step.positionName}</p>
                              {step.skipped ? (
                                <p className="text-muted-foreground">Skipped: No active approver for this step.</p>
                              ) : (
                                <>
                                  <p>{step.candidates.map(({ name }) => name).join(', ')}</p>
                                  {step.candidates.length > 1 && (
                                    <p className="text-muted-foreground">Any one of these people can approve.</p>
                                  )}
                                </>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
