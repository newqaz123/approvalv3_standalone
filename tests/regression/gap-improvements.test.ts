import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('Gapforimprove regressions', () => {
  it('request upload validation allows PowerPoint files and tells users supported types', () => {
    const filesAction = read('src/server-actions/files.ts')
    const requestForm = read('src/components/requests/submitter-modal.tsx')

    assert.match(filesAction, /application\/vnd\.ms-powerpoint/)
    assert.match(filesAction, /application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation/)
    assert.match(filesAction, /PowerPoint/)
    assert.match(requestForm, /\.pptx/)
    assert.match(requestForm, /10MB/)
  })

  it('/requests status filter exposes every RequestStatus option used by dashboard', () => {
    const requestFilters = read('src/components/requests/request-filters.tsx')

    for (const status of [
      'ImprovementRequest',
      'SentToEngineer',
      'DesignCostEstimationApproval',
      'SendBackToRequester',
      'FinalApproval',
      'Completed',
      'Cancelled',
    ]) {
      assert.match(requestFilters, new RegExp(status))
    }
  })

  it('modal approval steps can show potential pending approver names instead of Pending Assignment', () => {
    const adapters = read('src/lib/modal-data-adapters.ts')

    assert.match(adapters, /potentialApprovers/)
    assert.doesNotMatch(adapters, /'Pending Assignment'/)
  })

  it('notification refresh does not replace an open notification list with loading state', () => {
    const bell = read('src/components/notifications/notification-bell.tsx')

    assert.match(bell, /hasLoadedNotifications/)
    assert.match(bell, /if \(!hasLoadedNotifications\) \{\s*setIsLoading\(true\)\s*\}/)
    assert.match(bell, /<RequestModalRouter/)
  })
})
