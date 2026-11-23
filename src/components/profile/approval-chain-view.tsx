import React from 'react'
import type { PersonalApprovalChain } from '@/lib/approval-routes/chains-admin'
import type { Translator } from '@/lib/i18n/messages'

export function ApprovalChainView({ chain, t }: { chain: PersonalApprovalChain; t: Translator }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">{t('account.approvalChain')}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t('account.chainIntro')}
        </p>
      </header>

      {chain.kind === 'unassigned' ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-card-foreground">
          {t('account.chainUnassigned')}
        </p>
      ) : (
        <>
          <p className="break-words text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t('account.chainUnit')}</span> {chain.unitPath.join(' / ')}
          </p>
          <div className="grid gap-4 lg:grid-cols-3">
            {chain.phases.map((entry) => {
              const headingId = `approval-chain-${entry.phase.toLowerCase()}`
              return (
                <section
                  key={entry.phase}
                  aria-labelledby={headingId}
                  className="min-w-0 space-y-4 rounded-xl border bg-card p-4 text-card-foreground sm:p-5"
                >
                  <div className="space-y-1.5">
                    <h2 id={headingId} className="text-lg font-semibold">{t(`account.chain.${entry.phase}.title`)}</h2>
                    {entry.kind !== 'not-permitted' && (
                      <p className="text-sm text-muted-foreground">{t(`account.chain.${entry.phase}.description`)}</p>
                    )}
                  </div>
                  {entry.kind === 'not-permitted' ? (
                    <p className="rounded-md bg-muted px-3 py-2 text-sm">
                      {t('account.chainNoPermission')}
                    </p>
                  ) : entry.kind === 'unavailable' ? (
                    <p className="rounded-md bg-muted px-3 py-2 text-sm">
                      {t('account.chainUnavailable')}
                    </p>
                  ) : (
                    <div className="space-y-3 border-t pt-3">
                      <p className="break-words text-sm font-medium">{t('account.chainRouteFrom', { unit: entry.routeUnitName })}</p>
                      {entry.preview.autoApproved && (
                        <p className="text-sm text-muted-foreground">
                          {t('account.chainAutoApproved')}
                        </p>
                      )}
                      {entry.preview.noEligibleSteps && (
                        <p className="text-sm text-muted-foreground">
                          {t('account.chainNoEligibleSteps')}
                        </p>
                      )}
                      {entry.preview.steps.length > 0 && (
                        <ol className="list-decimal space-y-3 pl-5 text-sm marker:font-medium">
                          {entry.preview.steps.map((step) => (
                            <li key={step.requiredPositionId} value={step.order} className="space-y-0.5 break-words pl-1">
                              <p className="font-medium">{step.positionName}</p>
                              {step.skipped ? (
                                <p className="text-muted-foreground">{t('account.chainStepSkipped')}</p>
                              ) : (
                                <>
                                  <p>{step.candidates.map(({ name }) => name).join(', ')}</p>
                                  {step.candidates.length > 1 && (
                                    <p className="text-muted-foreground">{t('account.chainAnyCanApprove')}</p>
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
