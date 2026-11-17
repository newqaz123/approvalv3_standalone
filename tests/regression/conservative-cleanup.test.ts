import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import ts from 'typescript'

const retiredComponents = [
  'src/components/approvals/approval-actions.tsx',
  'src/components/approvals/approval-progress.tsx',
  'src/components/approvals/solution-approval-actions.tsx',
  'src/components/dashboard/activity-timeline.tsx',
  'src/components/dashboard/dashboard-table.tsx',
  'src/components/dashboard/dashboard-tabs.tsx',
  'src/components/dashboard/table-filters.tsx',
  'src/components/dashboard/table-pagination.tsx',
  'src/components/mobile/mobile-approval-actions.tsx',
  'src/components/mobile/request-drawer.tsx',
  'src/components/reports/export-pdf-button.tsx',
  'src/components/requests/delete-request-dialog.tsx',
  'src/components/requests/final-approval-modal.tsx',
  'src/components/requests/request-detail-desktop-example.tsx',
  'src/components/requests/request-detail-desktop-v2.tsx',
  'src/components/requests/request-detail-desktop.tsx',
  'src/components/requests/stale-data-banner.tsx',
  'src/components/requests/status-modal.tsx',
  'src/components/solutions/final-approval-actions.tsx',
  'src/components/solutions/mark-complete-button.tsx',
  'src/components/solutions/reject-solution-dialog.tsx',
  'src/components/solutions/solution-detail.tsx',
  'src/components/ui/alert.tsx',
  'src/hooks/use-interval.tsx',
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(path) ? [path] : []
  })
}

describe('conservative cleanup compatibility boundary', () => {
  it('retires only the unused component trees, not the supported routes', () => {
    assert.deepEqual(retiredComponents.filter(path => existsSync(path)), [], 'orphan implementations must stay retired')

    for (const path of [
      'src/components/requests/request-modal-router.tsx',
      'src/components/requests/submitter-modal.tsx',
      'src/components/dashboard/follow-up-dashboard.tsx',
      'src/app/(dashboard)/approval-chain/page.tsx',
      'src/app/(dashboard)/dashboard/workflow/page.tsx',
      'src/app/admin/deleted-requests/page.tsx',
      'src/app/api/user/role/route.ts',
      'src/app/api/user/department/route.ts',
      'src/app/api/organization/unit-users/route.ts',
      'src/app/api/cron/archive/route.ts',
      'src/app/sequential-stages-preview/page.tsx',
      'src/app/test-harness/hierarchy-pickers/page.tsx',
    ]) assert.ok(existsSync(path), `${path} is not part of the retirement`)
  })

  it('leaves no static or dynamic imports of retired components in the live source tree', () => {
    const retired = new Set(retiredComponents.map(path => resolve(path.replace(/\.tsx?$/, ''))))
    const staleImports: string[] = []
    for (const path of sourceFiles('src')) {
      const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node) => {
        let specifier: ts.Expression | undefined
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier = node.arguments[0]
        if (specifier && ts.isStringLiteralLike(specifier)) {
          const value = specifier.text
          const target = value.startsWith('@/') ? resolve('src', value.slice(2))
            : value.startsWith('.') ? resolve(dirname(path), value) : null
          if (target && retired.has(target.replace(/\.tsx?$/, ''))) staleImports.push(`${path}: ${value}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
    assert.deepEqual(staleImports, [])
  })
})

// These names are the reviewed retirement boundary, not a general unused-export rule.
const retiredDeclarations: Record<string, readonly string[]> = {
  "src/lib/auth-config.ts": [
    "signIn",
    "signOut"
  ],
  "src/lib/workflow-pipeline.ts": [
    "InFlightStep"
  ],
  "src/lib/engineering-resolution-trend.ts": [
    "EngineeringLifecycleStatus"
  ],
  "src/components/ui/select.tsx": [
    "SelectGroup"
  ],
  "src/components/analytics/chart-utils.ts": [
    "STATUS_COLORS"
  ],
  "src/components/ui/command.tsx": [
    "CommandDialog"
  ],
  "src/components/rich-text/inline-image-resize.ts": [
    "InlineImageResizeKey"
  ],
  "src/components/rich-text/inline-image-extension.ts": [
    "InlineImage"
  ],
  "src/lib/auth.ts": [
    "requireUser",
    "getUserRole",
    "hasRole",
    "getSession"
  ],
  "src/lib/permission-checks.ts": [
    "isUserAdmin",
    "getAvailableActions"
  ],
  "src/lib/cache/user-cache.ts": [
    "getUserById"
  ],
  "src/server-actions/requests.ts": [
    "deleteRequestSchema",
    "deleteRequest",
    "GetRequestsForEngineeringFilters",
    "getRequestsForEngineering",
    "permanentDeleteRequest"
  ],
  "src/server-actions/engineering-sub-tasks.ts": [
    "deactivateSubContractor",
    "getStaleSubTaskRequests"
  ],
  "src/server-actions/approvals.ts": [
    "getRequestApprovals"
  ],
  "src/server-actions/solutions.ts": [
    "getSolutionBySolutionId",
    "getSolutionByRequestId",
    "getSolutionApprovals",
    "markRequestComplete",
    "canMarkComplete"
  ],
  "src/lib/modal-data-adapters.ts": [
    "transformApprovalsToStages"
  ],
  "src/hooks/use-media-query.tsx": [
    "useIsMobile",
    "useIsTablet",
    "useIsDesktop"
  ],
  "src/server-actions/dashboard.ts": [
    "RequestListRow",
    "getPendingMyApprovals",
    "getMyCreatedRequests",
    "getAllRequests"
  ],
  "src/components/ui/dropdown-menu.tsx": [
    "DropdownMenuGroup",
    "DropdownMenuPortal",
    "DropdownMenuSub",
    "DropdownMenuRadioGroup"
  ],
  "src/components/organization/ExceptionBranchBadges.tsx": [
    "exceptionSourceLabel"
  ],
  "src/lib/retention-archive.ts": [
    "revalidateRetentionPage"
  ],
  "src/server-actions/templates.ts": [
    "getActiveTemplates",
    "getDefaultTemplatePublic",
    "getDefaultTemplate"
  ],
  "src/components/admin/admin-skeleton.tsx": [
    "AdminStatsSkeleton",
    "AdminQuickActionsSkeleton"
  ],
  "src/server-actions/audit.ts": [
    "getAuditTrailForUser"
  ]
}

function declarationNames(path: string): Set<string> {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const names = new Set<string>()
  const addBinding = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) names.add(name.text)
    else for (const element of name.elements) if (ts.isBindingElement(element)) addBinding(element.name)
  }
  for (const node of file.statements) {
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) addBinding(declaration.name)
    else if ((ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) names.add(node.name.text)
  }
  return names
}

it('retires uncalled declarations but preserves live authorization and dashboard seams', () => {
  for (const [path, retired] of Object.entries(retiredDeclarations)) {
    const names = declarationNames(path)
    assert.deepEqual(retired.filter(name => names.has(name)), [], path)
  }
  for (const [path, required] of Object.entries({
    'src/lib/auth.ts': ['requireAdmin'],
    'src/lib/cache/user-cache.ts': ['getCurrentUser'],
    'src/server-actions/dashboard.ts': ['getFollowUpDashboard'],
    'src/server-actions/requests.ts': ['getRequest', 'createRequest', 'resubmitRequest', 'assignEngineers'],
    'src/server-actions/solutions.ts': ['submitSolution', 'resubmitSolution', 'initiateFinalApproval', 'approveFinalApproval'],
    // getUser has a real string-based caller in the native admin-security suite.
    'src/server-actions/users.ts': ['getUser', 'getUsers'],
  })) for (const name of required) assert.ok(declarationNames(path).has(name), path + ': ' + name)
})

it('keeps operational commands while dropping unused packages and missing phase-7 commands', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
  for (const name of ['@auth/prisma-adapter', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities', '@types/bcryptjs']) {
    assert.equal(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name], undefined, name)
  }
  for (const name of ['test:phase7', 'test:phase7:headed', 'test:phase7:report']) assert.equal(pkg.scripts[name], undefined)
  assert.equal(pkg.dependencies['@tiptap/core'], lock.packages['node_modules/@tiptap/core'].version)
  for (const name of ['check', 'test:manage', 'business:native', 'admin:native', 'migrate:uploads', 'seed:dev', 'upgrade:verify']) {
    assert.ok(pkg.scripts[name], name)
  }
  for (const path of [
    'scripts/migrate-uploads.ts', 'scripts/verify-clean-start-readiness.ts',
    'scripts/upgrade/verify-upgrade.sh', 'scripts/deploy.sh', 'scripts/backup.sh',
    'scripts/restore.sh', 'scripts/rollback.sh', 'scripts/health-check.sh',
  ]) assert.ok(existsSync(path), path)
})
