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

  it('/requests filters use a compact responsive layout', () => {
    const requestFilters = read('src/components/requests/request-filters.tsx')

    assert.match(requestFilters, /gap-2/)
    assert.ok(requestFilters.includes('lg:grid-cols-[minmax(16rem,1.4fr)_repeat(4,minmax(0,1fr))]'))
    assert.match(requestFilters, /h-9/)
    assert.match(requestFilters, /From date/)
    assert.match(requestFilters, /To date/)
    assert.doesNotMatch(requestFilters, /lg:col-span-3/)
  })

  it('modal approval steps can show potential pending approver names instead of Pending Assignment', () => {
    const adapters = read('src/lib/modal-data-adapters.ts')

    assert.match(adapters, /potentialApprovers/)
    assert.doesNotMatch(adapters, /'Pending Assignment'/)
  })

  it('solution submission starts from the request title and THB currency', () => {
    const submitterModal = read('src/components/requests/submitter-modal.tsx')

    assert.match(submitterModal, /mode === 'solution' \? initialData\?\.requestTitle \|\| '' : ''/)
    assert.match(submitterModal, /useState\(initialData\?\.solution\?\.currency \|\| 'THB'\)/)
    assert.match(submitterModal, /setCurrency\(initialData\.solution\.currency \|\| 'THB'\)/)
  })

  it('notification refresh does not replace an open notification list with loading state', () => {
    const bell = read('src/components/notifications/notification-bell.tsx')

    assert.match(bell, /hasLoadedNotifications/)
    assert.match(bell, /if \(!hasLoadedNotifications\) \{\s*setIsLoading\(true\)\s*\}/)
    assert.match(bell, /<RequestModalRouter/)
  })

  it('request list refreshes local table state after mutations and router refreshes', () => {
    const requestTable = read('src/components/requests/request-table.tsx')
    const listWithFilters = read('src/components/requests/requests-list-with-filters.tsx')
    const listClient = read('src/components/requests/requests-list-client.tsx')
    const modalRouter = read('src/components/requests/request-modal-router.tsx')
    const dashboardTabs = read('src/components/dashboard/dashboard-tabs.tsx')
    const analyticsPage = read('src/components/analytics/analytics-page.tsx')

    assert.match(requestTable, /const \[data, setData\] = useState/)
    assert.match(requestTable, /useEffect\(\(\) => \{\s*setData\(initialData\)\s*\}, \[initialData\]\)/)
    assert.match(listWithFilters, /useEffect\(\(\) => \{\s*setRequests\(initialRequests\)\s*\}, \[initialRequests\]\)/)
    assert.match(listWithFilters, /cache: 'no-store'/)
    assert.match(listWithFilters, /approvalapp:request-data-changed/)
    assert.match(listClient, /refreshSignal=\{requestListRefreshSignal\}/)
    assert.match(listClient, /setRequestListRefreshSignal/)
    assert.match(modalRouter, /approvalapp:request-data-changed/)
    assert.match(dashboardTabs, /approvalapp:request-data-changed/)
    assert.match(analyticsPage, /approvalapp:request-data-changed/)
  })

  it('request mutations invalidate every request-backed page surface', () => {
    const invalidation = read('src/server-actions/request-view-invalidation.ts')
    const requests = read('src/server-actions/requests.ts')
    const approvals = read('src/server-actions/approvals.ts')
    const solutions = read('src/server-actions/solutions.ts')

    for (const route of [
      '/requests',
      '/requests/my-actions',
      '/dashboard',
      '/engineering',
      '/analytics',
      '/admin/retention',
    ]) {
      assert.match(invalidation, new RegExp(route.replaceAll('/', '\\/')))
    }

    assert.match(requests, /revalidateRequestViews/)
    assert.match(approvals, /revalidateRequestViews/)
    assert.match(solutions, /revalidateRequestViews/)
  })
})
