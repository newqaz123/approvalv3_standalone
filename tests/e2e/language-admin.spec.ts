import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

const BASE = 'http://localhost:32143'
const DB = 'postgresql://th_en_local@127.0.0.1:55473/app_cleanstart_dev'
const ADMIN = 'admin@example.com'
const ALICE = 'alice@example.com'
const PASSWORD = process.env.E2E_PASSWORD || 'changeme'
const id = randomUUID()
const configuredName = `Admin fixture ${id} — ชื่อเดิม`
const reason = 'Legacy audit detail — เหตุผลเดิม {count}'
let prisma: PrismaClient
let preferences: { id: string; preferredLocale: string }[] = []
let rootId: string
let rootName: string
let adminId: string

test.setTimeout(180_000)
test.use({ navigationTimeout: 90_000, actionTimeout: 15_000 })
test.beforeAll(async () => {
  if (process.env.TEST_BASE_URL !== BASE || process.env.DATABASE_URL !== DB) {
    throw new Error(`Language admin tests require ${BASE} and the isolated PostgreSQL fixture target`)
  }
  prisma = new PrismaClient({ datasources: { db: { url: DB } } })
  preferences = await prisma.user.findMany({ where: { email: { in: [ALICE, ADMIN] } }, select: { id: true, preferredLocale: true } })
  await resetPreferences()
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN } })
  adminId = admin.id
  const root = await prisma.organization_units.findFirstOrThrow({ where: { parentId: null, isActive: true } })
  rootId = root.id
  rootName = root.name
  await prisma.$transaction([
    prisma.organization_units.create({ data: { id, name: configuredName, parentId: rootId } }),
    prisma.templates.create({ data: { id, name: configuredName, title: configuredName, description: 'Configured template details' } }),
    prisma.sub_task_stages.create({ data: { id, name: configuredName, sortOrder: 999, isDefault: false } }),
    prisma.requests.create({ data: { id, title: configuredName, description: 'Configured request details', status: 'FinalApproval', requesterId: admin.id, organizationUnitId: id, isDeleted: true, deletedAt: new Date(), deletedBy: admin.id, activities: { create: { userId: admin.id, action: 'deleted', comments: reason } } } }),
  ])
})

async function resetPreferences() {
  await prisma?.user.updateMany({ where: { id: { in: preferences.map(user => user.id) } }, data: { preferredLocale: 'en' } })
}
test.afterEach(resetPreferences)
test.afterAll(async () => {
  if (!prisma) return
  try {
    await prisma.$transaction([
      prisma.requests.deleteMany({ where: { id } }),
      prisma.sub_task_stages.deleteMany({ where: { id } }),
      prisma.templates.deleteMany({ where: { id } }),
      prisma.organization_units.deleteMany({ where: { id } }),
      ...preferences.map(user => prisma.user.update({ where: { id: user.id }, data: { preferredLocale: user.preferredLocale } })),
    ])
  } finally {
    await prisma.$disconnect()
  }
})

async function signIn(page: Page, email: string, target = '/admin') {
  await page.goto(`/sign-in?callbackUrl=${encodeURIComponent(target)}`)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(`${BASE}${email === ADMIN ? target : '/requests'}`, { timeout: 60_000 })
}

async function language(page: Page, locale: 'en' | 'th') {
  await page.getByRole('button', { name: /^(Open user menu|เปิดเมนูผู้ใช้)$/ }).click()
  await page.getByRole('menuitemradio', { name: locale === 'th' ? 'ไทย' : 'English', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', locale, { timeout: 45_000 })
  await page.keyboard.press('Escape')
}

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true, level: 1 })

for (const [path, english, thai] of [
  ['/admin', 'Admin Dashboard', 'แดชบอร์ดผู้ดูแลระบบ'],
  ['/admin/users', 'Users', 'ผู้ใช้'],
  ['/admin/organization', 'Organization & Approvals', 'องค์กรและการอนุมัติ'],
  ['/admin/templates', 'Request Templates', 'เทมเพลต Request'],
  ['/admin/templates/new', 'Create New Template', 'สร้างเทมเพลตใหม่'],
  [`/admin/templates/${id}`, 'Edit Template', 'แก้ไขเทมเพลต'],
  ['/admin/sub-task-stages', 'Sub-task stages', 'ขั้นตอนงานย่อย'],
  ['/admin/storage', 'Data storage', 'พื้นที่จัดเก็บข้อมูล'],
  ['/admin/retention', 'Request Retention', 'การเก็บรักษา Request'],
  ['/admin/email', 'Email notifications', 'การแจ้งเตือนทางอีเมล'],
  ['/admin/deleted-requests', 'Deleted Requests', 'Request ที่ลบแล้ว'],
  ['/admin/audit', 'Audit Trail Export', 'ส่งออกบันทึก Audit'],
]) {
  test(`${english} renders both languages on the same route`, async ({ page }) => {
    await signIn(page, ADMIN, path)
    await expect(heading(page, english)).toBeVisible()
    if (path === '/admin/templates') await expect(page.getByRole('cell', { name: configuredName, exact: true }).first()).toBeVisible()
    if (path === '/admin/sub-task-stages') await expect(page.locator(`input[value="${configuredName}"]`)).toBeVisible()
    if (path === `/admin/templates/${id}`) await expect(page.locator(`input[value="${configuredName}"]`).first()).toBeVisible()
    await language(page, 'th')
    await expect(heading(page, thai)).toBeVisible()
    await expect(page).toHaveURL(`${BASE}${path}`)
    if (path === '/admin/templates') await expect(page.getByRole('cell', { name: configuredName, exact: true }).first()).toBeVisible()
    if (path === '/admin/sub-task-stages') await expect(page.locator(`input[value="${configuredName}"]`)).toBeVisible()
    if (path === `/admin/templates/${id}`) await expect(page.locator(`input[value="${configuredName}"]`).first()).toBeVisible()
    if (path === '/admin/audit') await expect(page.getByText('ส่งออกตาม Request', { exact: true })).toBeVisible()
  })
}

test('user form localizes its validation without granting rights', async ({ page }) => {
  await signIn(page, ADMIN, '/admin/users')
  await language(page, 'th')
  await page.getByRole('button', { name: 'เพิ่มผู้ใช้', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'สร้างผู้ใช้' })
  await dialog.getByRole('button', { name: 'สร้างผู้ใช้' }).click()
  await expect(dialog.getByText('ชื่อต้องมีอย่างน้อย 2 ตัวอักษร')).toBeVisible()
  await dialog.getByRole('button', { name: 'ยกเลิก' }).click()
  await expect(dialog).toHaveCount(0)
})

test('approval route editor retains its configured scope and does not publish', async ({ page }) => {
  await signIn(page, ADMIN, '/admin/organization?panel=chains')
  await page.getByTestId('chains-root-customize-REQUEST').click()
  const editor = page.getByTestId(`route-editor-${rootId}-REQUEST`)
  await expect(editor.getByRole('heading')).toContainText(`${rootName} — REQUEST`)
  const editorUrl = page.url()
  await language(page, 'th')
  await expect(editor.getByRole('heading')).toContainText(`${rootName} — REQUEST`)
  await expect(editor.getByTestId('route-editor-publish')).toHaveText('เผยแพร่')
  await expect(page).toHaveURL(editorUrl)
})

test('deleted requests retain the exact status and audit detail; cancel leaves fixture untouched', async ({ page }) => {
  await signIn(page, ADMIN, '/admin/deleted-requests')
  await expect(page.getByText('Status: FinalApproval', { exact: true })).toBeVisible()
  await expect(page.getByText(`Reason: ${reason}`, { exact: true })).toBeVisible()
  await language(page, 'th')
  await expect(page.getByText('สถานะ: FinalApproval', { exact: true })).toBeVisible()
  await expect(page.getByText(`เหตุผล: ${reason}`, { exact: true })).toBeVisible()
  const deletedCount = await prisma.requests.count({ where: { isDeleted: true } })
  const deleteAll = `ลบทั้งหมด (${deletedCount})`
  await page.getByRole('button', { name: deleteAll, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'ลบ Request ที่ลบแล้วทั้งหมด' })
  await expect(dialog.getByRole('button', { name: deleteAll })).toBeDisabled()
  await expect(dialog.getByPlaceholder('PERMANENTLY DELETE')).toBeVisible()
  await dialog.getByRole('button', { name: 'ยกเลิก' }).click()
  await expect(dialog).toHaveCount(0)
  expect((await prisma.requests.findUniqueOrThrow({ where: { id } })).isDeleted).toBe(true)
})

test('a non-admin is redirected outside Admin in both locales', async ({ page }) => {
  await signIn(page, ALICE)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await language(page, 'th')
  await page.goto('/admin/users')
  await expect(page).toHaveURL(`${BASE}/requests`)
  await expect(page.locator('html')).toHaveAttribute('lang', 'th')
})

test('Organization keyboard collapse, create, rename and deactivation work in the localized tree', async ({ page }) => {
  await signIn(page, ADMIN, '/admin/organization')
  const rootToggle = page.getByTestId(`unit-toggle-${rootId}`)
  const fixtureRow = page.getByTestId(`unit-row-${id}`)
  await expect(page.getByTestId(`unit-name-${id}`)).toHaveText(configuredName)
  await rootToggle.focus()
  await rootToggle.press('Enter')
  await expect(rootToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(fixtureRow).toBeHidden()
  await rootToggle.press('Space')
  await expect(fixtureRow).toBeVisible()
  await language(page, 'th')
  await expect(rootToggle).toHaveAccessibleName(`ย่อ ${rootName}`)
  await expect(page.getByTestId(`unit-name-${id}`)).toHaveText(configuredName)

  const newName = `${configuredName} child`
  const renamed = `${newName} renamed`
  let createdId: string | undefined
  try {
    await page.getByTestId('create-unit-open').click()
    await expect(page.getByTestId('create-unit-dialog').getByText('ชื่อหน่วยงาน', { exact: true })).toBeVisible()
    await page.getByTestId('create-unit-name-input').fill(newName)
    await page.getByTestId('create-unit-parent-select').click()
    await page.getByRole('option', { name: rootName, exact: true }).click()
    await page.getByTestId('create-unit-save').click()
    await expect(page.getByTestId('create-unit-dialog')).toHaveCount(0)
    const created = await prisma.organization_units.findFirstOrThrow({ where: { name: newName, parentId: rootId } })
    createdId = created.id
    expect(created.isActive).toBe(true)

    const row = page.getByTestId(`unit-row-${created.id}`)
    const unitHeader = row.getByTestId(`unit-header-${created.id}`)
    const rename = unitHeader.getByTestId(`unit-rename-${created.id}`)
    const input = unitHeader.getByTestId('inline-name-edit-input')
    await expect(row).toBeVisible()
    async function openRename() {
      const overflow = unitHeader.getByTestId(`unit-overflow-${created.id}`)
      if (await overflow.isVisible()) {
        // The tree intentionally uses its compact menu on narrow cards, even at desktop width.
        await expect(overflow).toHaveAccessibleName('เปิดเมนูหน่วยงาน')
        await overflow.focus()
        await overflow.press('Enter')
        await page.getByRole('menuitem', { name: 'เปลี่ยนชื่อ' }).press('Enter')
      } else {
        await unitHeader.focus()
        await expect(rename).toHaveAccessibleName('เปลี่ยนชื่อ')
        await rename.focus()
        await rename.press('Enter')
      }
      await expect(input).toBeVisible()
    }
    await openRename()
    await input.fill(configuredName) // Existing sibling: the guarded action must reject it.
    await heading(page, 'องค์กรและการอนุมัติ').click()
    await expect(unitHeader.getByRole('alert')).toContainText('เปลี่ยนชื่อไม่ได้')
    await expect(input).toHaveValue(configuredName)
    const auditWhere = { requestId: null, comments: { contains: created.id } }
    expect(await prisma.request_activities.count({ where: { ...auditWhere, action: 'organization_unit_renamed' } })).toBe(0)
    await input.press('Escape')
    await expect(input).toHaveCount(0)
    await openRename()
    await input.fill(renamed)
    await input.press('Tab')
    await expect(input).toHaveCount(0)
    await expect(row.getByTestId(`unit-name-${created.id}`)).toHaveText(renamed)
    expect(await prisma.request_activities.count({ where: { ...auditWhere, action: 'organization_unit_renamed' } })).toBe(1)

    await unitHeader.press('Enter')
    await page.getByTestId('unit-deactivate').click()
    const confirmation = page.getByTestId('unit-deactivate-confirmation')
    await expect(confirmation).toContainText(renamed)
    await page.getByTestId('unit-deactivate-cancel').click()
    await expect(confirmation).toHaveCount(0)
    expect((await prisma.organization_units.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(true)
    await page.getByTestId('unit-deactivate').click()
    await page.getByTestId('unit-deactivate-confirm').click()
    await expect(row).toHaveCount(0)
    const deactivated = await prisma.organization_units.findUniqueOrThrow({ where: { id: created.id } })
    expect(deactivated).toMatchObject({ name: renamed, parentId: rootId, isActive: false })
    const event = await prisma.request_activities.findFirstOrThrow({ where: { ...auditWhere, action: 'organization_unit_deactivated' } })
    expect(event.comments).toContain(renamed)
    expect(event.userId).toBe(adminId)
  } finally {
    const created = createdId ?? (await prisma.organization_units.findFirst({ where: { name: { in: [newName, renamed] } }, select: { id: true } }))?.id
    if (created) {
      await prisma.request_activities.deleteMany({ where: { requestId: null, comments: { contains: created }, action: { in: ['organization_unit_created', 'organization_unit_renamed', 'organization_unit_deactivated'] } } })
      await prisma.organization_units.deleteMany({ where: { id: created } })
    }
  }
})

test('stage name draft survives a locale refresh; duplicate errors translate by key', async ({ page }) => {
  await signIn(page, ADMIN, '/admin/sub-task-stages')
  const draft = `${configuredName} unsaved`
  const stageInput = page.locator(`input[value="${configuredName}"]`)
  await stageInput.fill(draft)
  await language(page, 'th')
  await expect(page.getByRole('textbox', { name: `ชื่อของ ${configuredName}` })).toHaveValue(draft)
  await page.getByRole('textbox', { name: 'ชื่อขั้นตอนงานย่อยใหม่' }).fill(configuredName)
  await page.getByRole('button', { name: 'เพิ่มขั้นตอน', exact: true }).click()
  await expect(page.getByText('มีขั้นตอนชื่อนี้แล้ว', { exact: true })).toBeVisible()
  expect((await prisma.sub_task_stages.findUniqueOrThrow({ where: { id } })).name).toBe(configuredName)
})

test('Audit CSV keeps the original action, comments and bytes in both languages', async ({ page }) => {
  await signIn(page, ADMIN, '/admin/audit')
  const url = `/api/audit/export/request/${id}?format=csv`
  const en = await page.request.get(url)
  expect(en.ok()).toBe(true)
  const body = await en.text()
  expect(body).toContain(reason)
  expect(body).toContain('"deleted"')
  await language(page, 'th')
  await expect(page.getByText('ส่งออกตามช่วงวันที่', { exact: true })).toBeVisible()
  const th = await page.request.get(url)
  expect(th.ok()).toBe(true)
  expect(th.headers()['content-disposition']).toBe(`attachment; filename="audit-trail-${id}.csv"`)
  expect(await th.text()).toBe(body)
})

test('mobile user cards localize accessible actions, not status names', async ({ page }) => {
  await signIn(page, ADMIN, '/admin/users')
  await language(page, 'th')
  await page.setViewportSize({ width: 390, height: 844 })
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN }, select: { name: true } })
  const card = page.getByRole('heading', { name: admin.name, exact: true }).locator('../..')
  await expect(card.getByText('Active', { exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'เปิดเมนู', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'ตั้งรหัสผ่านใหม่' })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('approval chains keep Published unchanged while translating the version label', async ({ page }) => {
  const published = await prisma.approval_route_versions.findFirstOrThrow({
    where: { scopeUnitId: rootId, status: 'PUBLISHED' },
  })
  await signIn(page, ADMIN, '/admin/organization?panel=chains')
  const row = page.getByTestId(`chains-published-route-${published.id}`)
  await expect(row.getByText(`Published · version ${published.version}`, { exact: true })).toBeVisible()
  await language(page, 'th')
  await expect(row.getByText(`Published · เวอร์ชัน ${published.version}`, { exact: true })).toBeVisible()
})

test('position dialogs use their translated headings as accessible names', async ({ page }) => {
  const position = await prisma.positions.findFirstOrThrow({ where: { isActive: true } })
  await signIn(page, ADMIN, '/admin/organization?panel=positions')
  await language(page, 'th')
  for (const [trigger, title] of [
    ['position-create-open', 'เพิ่มตำแหน่ง'],
    [`position-rank-edit-${position.id}`, 'แก้ไขระดับตำแหน่ง'],
  ]) {
    await page.getByTestId(trigger).click()
    const dialog = page.getByRole('dialog', { name: title, exact: true })
    await expect(dialog.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
    await dialog.getByRole('button', { name: 'ปิด', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
})

test('an open route publish refusal follows the language without losing its draft', async ({ page }) => {
  const stepId = `${id}-route-step`
  const limitId = `${id}-route-limit`
  const versionId = `${id}-route-version`
  const maxRank = (await prisma.positions.aggregate({ _max: { rank: true } }))._max.rank ?? 0
  await prisma.$transaction([
    prisma.positions.createMany({ data: [
      { id: stepId, name: `${configuredName} step`, rank: maxRank + 2 },
      { id: limitId, name: `${configuredName} ceiling`, rank: maxRank + 3 },
    ] }),
    prisma.approval_route_versions.create({ data: {
      id: versionId, scopeUnitId: id, phase: 'REQUEST', version: 1, status: 'PUBLISHED',
      createdById: adminId, approvalLimitPositionId: limitId, publishedAt: new Date(),
      steps: { create: { positionId: stepId, stepOrder: 1 } },
    } }),
  ])
  try {
    const path = `/admin/organization?panel=chains&scope=${id}&phase=REQUEST`
    await signIn(page, ADMIN, path)
    const editor = page.getByTestId(`route-editor-${id}-REQUEST`)
    const publish = editor.getByTestId('route-editor-publish')
    await expect(publish).toBeEnabled()
    // The displayed draft still allows Publish; the live server sees a lowered ceiling.
    await prisma.positions.update({ where: { id: limitId }, data: { rank: maxRank + 1 } })
    await publish.click()
    const error = editor.getByRole('alert')
    await expect(error).toHaveText('Publication refused: 1 step(s) exceed the approval limit. Correct the flagged steps first.')
    await language(page, 'th')
    await expect(error.filter({ hasText: 'เผยแพร่ไม่ได้: มี 1 ขั้นที่เกินเพดานอนุมัติ แก้ไขขั้นที่ระบุก่อน' })).toBeVisible()
    await expect(editor.getByTestId('route-editor-limit-select')).toContainText(`${configuredName} ceiling`)
    await expect(editor.getByTestId('route-editor-step-1')).toContainText(`${configuredName} step`)
    await expect(page).toHaveURL(`${BASE}${path}`)
    await language(page, 'en')
    await expect(error.filter({ hasText: 'Publication refused: 1 step(s)' })).toBeVisible()
    const versions = await prisma.approval_route_versions.findMany({ where: { scopeUnitId: id }, select: { id: true, status: true } })
    expect(versions).toEqual([{ id: versionId, status: 'PUBLISHED' }])
  } finally {
    await prisma.approval_route_versions.deleteMany({ where: { scopeUnitId: id } })
    await prisma.positions.deleteMany({ where: { id: { in: [stepId, limitId] } } })
  }
})

test('team deactivation names live blockers rather than the open snapshot', async ({ page }) => {
  const teamId = `${id}-team`
  const users = ['lead', 'old member', 'new member'].map((name, i) => ({ id: `${id}-team-user-${i}`, name: `${configuredName} ${name}`, email: `${id}-${i}@example.com` }))
  const assignments = users.map(user => `${user.id}-assignment`)
  const positions = await prisma.positions.findMany({ where: { isActive: true }, orderBy: { rank: 'asc' } })
  const highest = positions.at(-1)!
  expect(highest.rank).toBeGreaterThan(positions[0].rank)
  await prisma.$transaction([
    prisma.user.createMany({ data: users }),
    prisma.organization_assignments.createMany({ data: users.map((user, i) => ({
      id: assignments[i], userId: user.id, unitId: id, positionId: i === 0 ? highest.id : positions[0].id,
    })) }),
    prisma.teams.create({ data: { id: teamId, unitId: id, name: configuredName, reportsToAssignmentId: assignments[0] } }),
    prisma.organization_assignments.update({ where: { id: assignments[1] }, data: { teamId } }),
  ])
  try {
    await signIn(page, ADMIN, '/admin/organization')
    await language(page, 'th')
    await page.getByTestId(`team-select-${teamId}`).click()
    await expect(page.getByTestId(`team-member-${assignments[1]}`)).toBeChecked()
    await expect(page.getByTestId(`team-member-${assignments[2]}`)).not.toBeChecked()
    await page.getByTestId('team-deactivate').click()
    await prisma.$transaction([
      prisma.organization_assignments.update({ where: { id: assignments[1] }, data: { teamId: null } }),
      prisma.organization_assignments.update({ where: { id: assignments[2] }, data: { teamId } }),
    ])
    await page.getByTestId('team-deactivate-confirm').click()
    const alert = page.getByTestId('team-deactivate-error')
    await expect(alert).toContainText(`สมาชิกที่ยังอยู่ในทีม: ${users[2].name}`)
    await expect(alert).not.toContainText(users[1].name)
    await expect(page.getByTestId('team-deactivate-confirmation')).toBeVisible()
    const auditWhere = { action: 'team_deactivated', comments: { contains: teamId } }
    expect((await prisma.teams.findUniqueOrThrow({ where: { id: teamId } })).isActive).toBe(true)
    expect(await prisma.request_activities.count({ where: auditWhere })).toBe(0)

    // A different live refusal must not misreport the stale member or the prior blocker.
    await prisma.teams.update({ where: { id: teamId }, data: { isActive: false } })
    await page.getByTestId('team-deactivate-confirm').click()
    await expect(alert).toHaveText('ปิดใช้งานทีมไม่ได้ ลองอีกครั้ง')

    await prisma.$transaction([
      prisma.organization_assignments.update({ where: { id: assignments[2] }, data: { teamId: null } }),
      prisma.teams.update({ where: { id: teamId }, data: { isActive: true } }),
    ])
    await page.getByTestId('team-deactivate-confirm').click()
    await expect(page.getByTestId(`team-select-${teamId}`)).toHaveCount(0)
    expect((await prisma.teams.findUniqueOrThrow({ where: { id: teamId } }))).toMatchObject({ isActive: false, reportsToAssignmentId: assignments[0] })
    expect(await prisma.request_activities.count({ where: auditWhere })).toBe(1)
  } finally {
    await prisma.$transaction([
      prisma.request_activities.deleteMany({ where: { action: 'team_deactivated', comments: { contains: teamId } } }),
      prisma.teams.deleteMany({ where: { id: teamId } }),
      prisma.organization_assignments.deleteMany({ where: { id: { in: assignments } } }),
      prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } }),
    ])
  }
})
