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
    assert.ok(requestFilters.includes('lg:grid-cols-[minmax(16rem,1.4fr)_repeat(5,minmax(0,1fr))]'))
    assert.match(requestFilters, /h-10/)
    assert.match(requestFilters, /From date/)
    assert.match(requestFilters, /To date/)
    assert.match(requestFilters, /Show only no WR/)
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

  it('engineering users see engineering dashboard navigation instead of dashboard', () => {
    const navbar = read('src/components/navigation/navbar.tsx')
    const mobileNav = read('src/components/mobile/mobile-nav.tsx')

    assert.match(navbar, /{!isEngineering && \(\s*<Link\s+href="\/dashboard"/)
    assert.match(navbar, /{isEngineering && \(\s*<Link\s+href="\/engineering"/)
    assert.match(mobileNav, /isEngineering \? engineeringTabs : tabs/)
    assert.match(mobileNav, /href: '\/engineering'/)
  })

  it('desktop My Actions navigation shows the pending action count badge', () => {
    const navbar = read('src/components/navigation/navbar.tsx')

    assert.match(navbar, /const \[pendingCount, setPendingCount\] = useState\(0\)/)
    assert.match(navbar, /fetch\('\/api\/actions\/pending-count'\)/)
    assert.match(navbar, /setInterval\(fetchPendingCount, 30000\)/)
    assert.match(navbar, /approvalapp:request-data-changed/)
    assert.match(navbar, /pendingCount > 0/)
    assert.match(navbar, /pendingCount > 9 \? '9\+' : pendingCount/)
    assert.match(navbar, /bg-red-500/)
  })

  it('mobile My Actions navigation refreshes the pending badge after request actions', () => {
    const mobileNav = read('src/components/mobile/mobile-nav.tsx')

    assert.match(mobileNav, /fetch\('\/api\/actions\/pending-count'\)/)
    assert.match(mobileNav, /setInterval\(fetchPendingCount, 30000\)/)
    assert.match(mobileNav, /approvalapp:request-data-changed/)
  })

  it('engineering dashboard sends plain request objects to client tabs', () => {
    const page = read('src/app/(dashboard)/engineering/page.tsx')
    const requests = read('src/server-actions/requests.ts')

    assert.doesNotMatch(page, /\.\.\.request,\s*hasRejection/)
    assert.match(page, /id: request\.id/)
    assert.match(page, /title: request\.title/)
    assert.match(page, /status: request\.status/)
    assert.match(page, /department: request\.department/)
    assert.match(page, /requester: request\.requester/)
    assert.doesNotMatch(requests, /request: \{\s*\.\.\.request,\s*hasRejection/)
    assert.doesNotMatch(requests, /solution: \{\s*\.\.\.solution,/)
    assert.match(requests, /costEstimate: Number\(solution\.costEstimate\)/)
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

  it('email notification request links open the same modal flow as in-app notifications', () => {
    const notifications = read('src/server-actions/notifications.ts')
    const deepLinkModal = read('src/components/requests/request-deep-link-modal.tsx')
    const myActionsPage = read('src/app/(dashboard)/requests/my-actions/page.tsx')
    const requestsPage = read('src/app/(dashboard)/requests/page.tsx')
    const middleware = read('src/middleware.ts')
    const signInPage = read('src/app/(auth)/sign-in/[[...sign-in]]/page.tsx')

    assert.match(notifications, /buildNotificationRequestPath/)
    assert.match(notifications, /approval_needed/)
    assert.match(notifications, /final_approval_needed/)
    assert.match(notifications, /\/requests\/my-actions\?requestId=/)
    assert.doesNotMatch(notifications, /\$\{baseUrl\}\/requests\/\$\{notification\.requestId\}/)
    assert.match(myActionsPage, /searchParams/)
    assert.match(requestsPage, /searchParams/)
    assert.match(myActionsPage, /RequestDeepLinkModal requestId=\{requestId\} returnTo="\/requests\/my-actions"/)
    assert.match(myActionsPage, /requestId \? \(\s*<ActionItemsList \/>\s*\) : \(/)
    assert.match(requestsPage, /RequestDeepLinkModal requestId=\{requestId\} returnTo="\/requests"/)
    assert.match(requestsPage, /requestId \? \(\s*<RequestsList \/>\s*\) : \(/)
    assert.match(deepLinkModal, /RequestModalRouter/)
    assert.match(deepLinkModal, /router\.replace\(returnTo\)/)
    assert.match(middleware, /callbackUrl/)
    assert.match(middleware, /encodeURIComponent\(req\.nextUrl\.pathname \+ req\.nextUrl\.search\)/)
    assert.match(signInPage, /useSearchParams/)
    assert.match(signInPage, /callbackUrl/)
    assert.match(signInPage, /router\.push\(callbackUrl\)/)
  })

  it('approval and rejection emails include request details and use the email helper', () => {
    const notifications = read('src/server-actions/notifications.ts')
    const approvals = read('src/server-actions/approvals.ts')
    const solutions = read('src/server-actions/solutions.ts')

    assert.match(notifications, /getNotificationRequestDetails/)
    assert.match(notifications, /Approval System/)
    assert.match(notifications, /Request topic/)
    assert.match(notifications, /resolveEmailCostEstimate/)
    assert.match(notifications, /Cost estimate/)
    assert.doesNotMatch(notifications, /Budget code/)
    assert.doesNotMatch(notifications, /Project estimate/)
    assert.doesNotMatch(notifications, /Engineering estimate/)
    assert.doesNotMatch(notifications, /Latest solution estimate/)

    const notifyNextApprover = approvals.match(/async function notifyNextApprover[\s\S]*?\n\}/)?.[0] ?? ''
    assert.match(notifyNextApprover, /createNotification/)
    assert.doesNotMatch(notifyNextApprover, /notifications\.createMany/)

    const notifyNextSolutionApprover = solutions.match(/async function notifyNextSolutionApprover[\s\S]*?^}/m)?.[0] ?? ''
    const notifyNextFinalApprover = solutions.match(/async function notifyNextFinalApprover[\s\S]*?^}/m)?.[0] ?? ''
    const rejectSolution = solutions.match(/export async function rejectSolution[\s\S]*?^}/m)?.[0] ?? ''

    assert.match(notifyNextSolutionApprover, /createNotification/)
    assert.doesNotMatch(notifyNextSolutionApprover, /tx\.notifications\.create/)
    assert.doesNotMatch(notifyNextSolutionApprover, /notifications\.createMany/)
    assert.match(notifyNextFinalApprover, /createNotification/)
    assert.doesNotMatch(notifyNextFinalApprover, /tx\.notifications\.create/)
    assert.doesNotMatch(notifyNextFinalApprover, /notifications\.createMany/)
    assert.match(rejectSolution, /createNotification/)
    assert.doesNotMatch(rejectSolution, /tx\.notifications\.create/)

    const directNotificationCreates = `${approvals}\n${solutions}`
      .match(/notifications\.create(?:Many)?\(\{[\s\S]*?\n\s*\}\)/g) ?? []

    for (const createCall of directNotificationCreates) {
      assert.doesNotMatch(createCall, /approval_needed|final_approval_needed|approval_rejected/)
    }
  })

  it('seeds the session provider from the server session for email deep links', () => {
    const rootLayout = read('src/app/layout.tsx')

    assert.match(rootLayout, /import \{ auth \} from ['"]@\/lib\/auth-config['"]/)
    assert.match(rootLayout, /const session = await auth\(\)/)
    assert.match(rootLayout, /<SessionProvider session=\{session\}>/)
  })

  it('sends solution submission emails after the solution transaction commits', () => {
    const solutions = read('src/server-actions/solutions.ts')
    const submitSolution = solutions.match(/export async function submitSolution[\s\S]*?\n\}/)?.[0] ?? ''
    const transactionStart = submitSolution.indexOf('const result = await prisma.$transaction')
    const notificationSendStart = submitSolution.indexOf('if (pendingNotifications.length > 0)')

    assert.match(submitSolution, /pendingNotifications/)
    assert.ok(transactionStart >= 0)
    assert.ok(notificationSendStart > transactionStart)

    const transactionBlock = submitSolution.slice(transactionStart, notificationSendStart)

    assert.doesNotMatch(transactionBlock, /createNotification|notifyUsersInDepartment|tx\.notifications\.create/)
    assert.match(submitSolution, /await Promise\.all\(\s*pendingNotifications\.map\(\(notification\) =>\s*createNotification\(notification\)/)
  })

  it('merges department-wide notification emails while keeping per-user in-app notifications', () => {
    const notifications = read('src/server-actions/notifications.ts')
    const notifyUsersInDepartment = notifications.match(/export async function notifyUsersInDepartment[\s\S]*?^}/m)?.[0] ?? ''

    assert.match(notifyUsersInDepartment, /select:\s*\{\s*id:\s*true,\s*email:\s*true\s*\}/)
    assert.match(notifyUsersInDepartment, /prisma\.notifications\.createMany/)
    assert.match(notifyUsersInDepartment, /emailRecipients/)
    assert.match(notifyUsersInDepartment, /new Set/)
    assert.match(notifyUsersInDepartment, /sendEmailNotification\(\s*notification,\s*emailRecipients/)
    assert.doesNotMatch(notifyUsersInDepartment, /createNotification\(/)
  })
})
