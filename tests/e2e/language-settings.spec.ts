import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const BASE_URL = 'http://localhost:32143'
const DATABASE_URL = 'postgresql://th_en_local@127.0.0.1:55473/app_cleanstart_dev'
const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'
const PASSWORD = process.env.E2E_PASSWORD || 'changeme'
const LABEL = 'ภาษา / Language'

test.setTimeout(90_000)

let prisma: PrismaClient

test.beforeAll(async () => {
  if (process.env.TEST_BASE_URL !== BASE_URL || process.env.DATABASE_URL !== DATABASE_URL) {
    throw new Error(`Language settings tests require TEST_BASE_URL=${BASE_URL} and the isolated PostgreSQL fixture target`)
  }
  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } })
  expect(await prisma.user.count({ where: { email: { in: [ALICE, BOB] }, preferredLocale: 'en', isActive: true } })).toBe(2)
})

test.afterEach(async () => {
  // Restore only the locale this suite changes; never seed or mutate credentials.
  await prisma?.user.updateMany({ where: { email: ALICE, preferredLocale: 'th' }, data: { preferredLocale: 'en' } })
})

test.afterAll(async () => {
  await prisma?.$disconnect()
})

async function signIn(page: Page, email: string, path = '/profile') {
  await page.goto(`/sign-in?callbackUrl=${encodeURIComponent(path)}`)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', { name: /^(Sign in|เข้าสู่ระบบ)$/ }).click()
  await expect(page).toHaveURL(`${BASE_URL}${path}`, { timeout: 20_000 })
}

const lang = (page: Page) => page.locator('html')
const publicSelector = (page: Page) => page.getByRole('group', { name: LABEL })
const avatar = (page: Page) => page.getByRole('button', { name: /^(Open user menu|เปิดเมนูผู้ใช้)$/ })
const menu = (page: Page) => page.getByRole('menu')

function isThaiLanguageSave(request: Request) {
  // Other Server Actions (e.g. the notification bell) also POST to /profile.
  return request.method() === 'POST' && !!request.headers()['next-action'] && request.postData() === '["th"]'
}

async function chooseThaiInMenu(page: Page) {
  await avatar(page).click()
  await expect(menu(page).getByRole('menuitemradio', { checked: true })).toHaveText('English')
  await menu(page).getByRole('menuitemradio', { name: 'ไทย' }).click()
  await expect(lang(page)).toHaveAttribute('lang', 'th')
  await expect(menu(page).getByRole('menuitemradio', { checked: true })).toHaveText('ไทย')
  await page.keyboard.press('Escape')
}

async function expectFirstDocument(context: BrowserContext, path: string, locale: string, heading: string) {
  // The browser renders the actual response with JavaScript disabled: neither
  // the document language nor the heading can be supplied during hydration.
  const page = await context.newPage()
  const response = await page.goto(path)
  expect(response?.ok()).toBe(true)
  await expect(lang(page)).toHaveAttribute('lang', locale)
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
}

test('public language survives reload without losing a draft; the account wins until sign-out', async ({ page, context, browser }) => {
  const path = '/sign-in?callbackUrl=%2Fprofile'
  await page.goto(path)
  await expect(lang(page)).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await page.getByLabel('Email address').fill(ALICE)
  const english = publicSelector(page).getByRole('radio', { name: 'English' })
  await expect(publicSelector(page).getByRole('radio', { checked: true })).toHaveAccessibleName('English')
  await english.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(lang(page)).toHaveAttribute('lang', 'th')
  await expect(publicSelector(page).getByRole('radio', { checked: true })).toHaveAccessibleName('ไทย')
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).toBeVisible()
  await expect(page.getByLabel('อีเมล')).toHaveValue(ALICE)
  await expect(page).toHaveURL(`${BASE_URL}${path}`, { timeout: 20_000 })
  await page.reload()
  await expect(lang(page)).toHaveAttribute('lang', 'th')
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).toBeVisible()
  await page.locator('#email').fill(ALICE)
  await page.locator('#password').fill('incorrect test password')
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' })).toBeVisible()

  const noScript = await browser.newContext({ storageState: await context.storageState(), javaScriptEnabled: false })
  try {
    await expectFirstDocument(noScript, '/sign-up', 'th', 'สร้างบัญชี')
  } finally {
    await noScript.close()
  }
  await page.goto('/sign-up')
  await expect(page.getByRole('heading', { name: 'สร้างบัญชี' })).toBeVisible()
  await expect(publicSelector(page).getByRole('radio', { checked: true })).toHaveAccessibleName('ไทย')
  await page.locator('#name').fill('Duplicate email test')
  await page.locator('#email').fill(ALICE)
  await page.locator('#password').fill('not-applied-test-password')
  await page.locator('#confirmPassword').fill('not-applied-test-password')
  await page.getByRole('button', { name: 'สร้างบัญชี', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'อีเมลนี้มีบัญชีแล้ว' })).toBeVisible()
  await publicSelector(page).getByRole('radio', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Create Account', exact: true })).toBeVisible()
  await expect(page.locator('#email')).toHaveValue(ALICE)
  await expect(page.getByRole('alert').filter({ hasText: 'A user with this email already exists' })).toBeVisible()
  await publicSelector(page).getByRole('radio', { name: 'ไทย' }).click()
  await expect(lang(page)).toHaveAttribute('lang', 'th')
  await page.goto('/missing-language-test-page')
  await expect(lang(page)).toHaveAttribute('lang', 'th')
  await expect(page.getByRole('heading', { name: 'ไม่พบหน้า' })).toBeVisible()

  await signIn(page, ALICE)
  await expect(lang(page)).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
  await chooseThaiInMenu(page)
  await avatar(page).click()
  await menu(page).getByRole('menuitemradio', { name: 'English' }).click()
  await expect(lang(page)).toHaveAttribute('lang', 'en')
  await menu(page).getByRole('menuitem', { name: 'Sign Out' }).click()
  await expect(page).toHaveURL(`${BASE_URL}/sign-in`)
  await expect(lang(page)).toHaveAttribute('lang', 'th')
  await expect(publicSelector(page).getByRole('radio', { checked: true })).toHaveAccessibleName('ไทย')
})

test('saved account language follows the account, including the first document, not the next user', async ({ page, browser }) => {
  const path = '/profile?from=language-test'
  await signIn(page, ALICE, path)
  await page.getByLabel('Display Name').fill('Unsaved locale test draft')
  await chooseThaiInMenu(page)
  await expect(page).toHaveURL(`${BASE_URL}${path}`, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'โปรไฟล์', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'เมนูหลัก' }).getByRole('link', { name: 'รายการ Request' })).toHaveAttribute('href', '/requests')
  await expect(page.getByLabel('ชื่อที่แสดง')).toHaveValue('Unsaved locale test draft')
  await page.getByLabel('ชื่อที่แสดง').fill('  ')
  await page.getByRole('button', { name: 'บันทึกโปรไฟล์', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'ชื่อที่แสดงต้องมีอย่างน้อย 2 ตัวอักษร' })).toBeVisible()

  const fresh = await browser.newContext()
  try {
    const freshPage = await fresh.newPage()
    await signIn(freshPage, ALICE)
    const noScript = await browser.newContext({ storageState: await fresh.storageState(), javaScriptEnabled: false })
    try {
      await expectFirstDocument(noScript, '/profile', 'th', 'โปรไฟล์')
    } finally {
      await noScript.close()
    }
    await expect(freshPage.getByRole('heading', { name: 'โปรไฟล์', exact: true })).toBeVisible()
    await freshPage.goto('/approval-chain')
    await expect(freshPage.getByRole('heading', { name: 'สายอนุมัติ' })).toBeVisible()
    await freshPage.goto('/change-password')
    await expect(freshPage.getByRole('heading', { name: 'เปลี่ยนรหัสผ่าน' })).toBeVisible()
    await freshPage.getByLabel('รหัสผ่านปัจจุบัน', { exact: true }).fill('incorrect test password')
    await freshPage.getByLabel('รหัสผ่านใหม่', { exact: true }).fill('not-applied-test-password')
    await freshPage.getByLabel('ยืนยันรหัสผ่านใหม่', { exact: true }).fill('not-applied-test-password')
    await freshPage.getByRole('button', { name: 'เปลี่ยนรหัสผ่าน', exact: true }).click()
    await expect(freshPage.getByRole('alert').filter({ hasText: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' })).toBeVisible()

    await avatar(freshPage).click()
    await expect(menu(freshPage).getByRole('menuitemradio', { checked: true })).toHaveText('ไทย')
    await menu(freshPage).getByRole('menuitem', { name: 'ออกจากระบบ' }).click()
    await expect(lang(freshPage)).toHaveAttribute('lang', 'en')
    await signIn(freshPage, BOB)
    await expect(lang(freshPage)).toHaveAttribute('lang', 'en')
    await expect(freshPage.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
  } finally {
    await fresh.close()
  }
})

async function scrollAvatarOffscreen(page: Page) {
  // Make the short profile scrollable without introducing another app surface.
  await page.locator('main').evaluate(element => {
    element.style.minHeight = '200vh'
    window.scrollTo(0, 600)
  })
  await expect(avatar(page)).not.toBeInViewport()
}

test('restores keyboard retry focus to the desktop avatar in view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page, ALICE)
  let failed = false
  await page.route('**/profile', async route => {
    if (failed || !isThaiLanguageSave(route.request())) return route.fallback()
    failed = true
    return route.abort()
  })
  // Close the menu after the first failure; the next attempt uses the banner.
  await avatar(page).click()
  await menu(page).getByRole('menuitemradio', { name: 'ไทย' }).click()
  await expect(menu(page).getByRole('alert')).toBeVisible()
  await page.keyboard.press('Escape')
  const retry = page.getByRole('button', { name: 'Try again', exact: true })
  await retry.focus()
  await scrollAvatarOffscreen(page)
  await expect(retry).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(lang(page)).toHaveAttribute('lang', 'th')
  await expect(avatar(page)).toBeFocused()
  await expect(avatar(page)).toBeInViewport({ ratio: 1 })
})

test.describe('mobile avatar selector', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('reveals the scroll-hidden mobile navbar when its avatar receives focus', async ({ page }) => {
    await signIn(page, ALICE)
    await scrollAvatarOffscreen(page)
    // Restore focus without scrolling: the fixed navbar must reveal itself.
    await avatar(page).evaluate(button => (button as HTMLButtonElement).focus({ preventScroll: true }))
    await expect(avatar(page)).toBeFocused()
    await expect(avatar(page)).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => window.scrollY)).toBe(600)
  })

  test('announces a failed save after the avatar menu closes and offers a retry there', async ({ page }) => {
    await signIn(page, ALICE)
    await avatar(page).tap()
    const thai = menu(page).getByRole('menuitemradio', { name: 'ไทย' })
    let saves = 0
    let releaseFailure!: () => void
    const pendingFailure = new Promise<void>(resolve => { releaseFailure = resolve })
    let releaseRetry!: () => void
    const pendingRetry = new Promise<void>(resolve => { releaseRetry = resolve })
    await page.route('**/profile', async route => {
      if (!isThaiLanguageSave(route.request())) return route.fallback()
      saves++
      if (saves === 1) {
        await pendingFailure
        return route.abort()
      }
      if (saves === 2) {
        await pendingRetry
        return route.abort()
      }
      await route.continue()
    })
    try {
      await thai.tap()
      await expect.poll(() => saves).toBe(1)
      await page.keyboard.press('Escape')
      await expect(menu(page)).toBeHidden()
      await expect(avatar(page)).toBeFocused()
      releaseFailure()

      const alert = page.getByRole('alert').filter({ hasText: 'Could not save the language. Try again.' })
      await expect(alert).toBeVisible()
      await expect(lang(page)).toHaveAttribute('lang', 'en')
      await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
      await expect(avatar(page)).toBeFocused()

      const retry = page.getByRole('button', { name: 'Try again', exact: true })
      await retry.focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => saves).toBe(2)
      await expect(retry).toBeFocused()
      await expect(retry).toBeDisabled()
      await page.keyboard.press('Enter')
      releaseRetry()

      await expect(alert).toBeVisible()
      await expect(retry).toBeEnabled()
      await expect(retry).toBeFocused()
      expect(saves).toBe(2)

      await scrollAvatarOffscreen(page)
      await expect(retry).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(lang(page)).toHaveAttribute('lang', 'th')
      await expect(alert).toBeHidden()
      await expect(retry).toBeHidden()
      await expect(avatar(page)).toBeFocused()
      await expect(avatar(page)).toBeInViewport({ ratio: 1 })
      await expect(menu(page)).toBeHidden()
      expect(saves).toBe(3)
    } finally {
      releaseFailure()
      releaseRetry()
      await page.unrouteAll({ behavior: 'wait' })
    }
  })

  test('does not announce the old error when the avatar menu reopens during a direct retry', async ({ page }) => {
    await signIn(page, ALICE)
    const thai = menu(page).getByRole('menuitemradio', { name: 'ไทย' })
    let saves = 0
    let releaseRetry!: () => void
    const pendingRetry = new Promise<void>(resolve => { releaseRetry = resolve })
    await page.route('**/profile', async route => {
      if (!isThaiLanguageSave(route.request())) return route.fallback()
      if (++saves === 2) await pendingRetry
      return route.abort()
    })
    try {
      await avatar(page).tap()
      await thai.tap()
      await expect(menu(page).getByRole('alert')).toBeVisible()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Try again', exact: true }).tap()
      await expect.poll(() => saves).toBe(2)
      await avatar(page).tap()
      await expect(thai).toBeDisabled()
      await expect(menu(page).getByRole('menuitemradio', { checked: true })).toHaveText('English')
      await expect(menu(page).getByRole('alert')).toBeHidden()
      releaseRetry()
      await expect(menu(page).getByRole('alert')).toHaveText('Could not save the language. Try again.')
      await expect(thai).toBeEnabled()
    } finally {
      releaseRetry()
      await page.unrouteAll({ behavior: 'wait' })
    }
  })

  test('clears a failed retry after a same-page refresh confirms the committed locale', async ({ page }) => {
    await signIn(page, ALICE)
    const displayName = page.getByLabel('Display Name')
    const originalName = await displayName.inputValue()
    const draft = `${originalName} (unsaved test draft)`
    let releaseFailure!: () => void
    const pendingFailure = new Promise<void>(resolve => { releaseFailure = resolve })
    let releaseProfileSave!: () => void
    const pendingProfileSave = new Promise<void>(resolve => { releaseProfileSave = resolve })
    await page.route('**/profile', async route => {
      const request = route.request()
      if (isThaiLanguageSave(request)) {
        // Run the real write upstream, but drop its response to the browser.
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        await pendingFailure
        return route.abort()
      }
      if (request.method() === 'POST' && request.headers()['next-action'] && request.postData() === JSON.stringify([draft])) {
        // Run the real profile success/refresh path without changing the name or audit log.
        await pendingProfileSave
        return route.continue({ postData: JSON.stringify([originalName]) })
      }
      await route.fallback()
    })
    try {
      await avatar(page).tap()
      await menu(page).getByRole('menuitemradio', { name: 'ไทย' }).tap()
      await expect.poll(async () => (await prisma.user.findUniqueOrThrow({ where: { email: ALICE } })).preferredLocale).toBe('th')
      await page.keyboard.press('Escape')
      await expect(menu(page)).toBeHidden()
      releaseFailure()
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
      await expect(lang(page)).toHaveAttribute('lang', 'en')

      await displayName.fill(draft)
      await page.getByRole('button', { name: 'Save Profile' }).tap()
      await displayName.focus()
      releaseProfileSave()
      await expect(lang(page)).toHaveAttribute('lang', 'th', { timeout: 20_000 })
      await expect(page.getByRole('status').filter({ hasText: 'บันทึกโปรไฟล์แล้ว' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'ลองอีกครั้ง', exact: true })).toBeHidden()
      await expect(page.getByLabel('ชื่อที่แสดง')).toBeFocused()
    } finally {
      releaseFailure()
      releaseProfileSave()
      await page.unrouteAll({ behavior: 'wait' })
    }
  })

  test('announces a failed save in the previous language and serializes retries across menu reopening', async ({ page }) => {
    await signIn(page, ALICE)
    await avatar(page).focus()
    await page.keyboard.press('Enter')
    const thai = menu(page).getByRole('menuitemradio', { name: 'ไทย' })
    const english = menu(page).getByRole('menuitemradio', { name: 'English' })
    await expect(menu(page).getByText(LABEL)).toBeVisible()
    await expect(menu(page).getByRole('menuitemradio', { checked: true })).toHaveText('English')
    expect(await thai.evaluate(el => (el as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44)
    // Move to Thai through Radix's roving focus, without a pointer.
    await page.keyboard.press('End')
    await expect(english).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(thai).toBeFocused()

    let saves = 0
    let releaseRetry!: () => void
    const pendingRetry = new Promise<void>(resolve => { releaseRetry = resolve })
    await page.route('**/profile', async route => {
      if (!isThaiLanguageSave(route.request())) return route.fallback()
      saves++
      if (saves === 1) return route.abort()
      await pendingRetry
      await route.continue()
    })
    try {
      await page.keyboard.press('Enter')
      await expect(menu(page).getByRole('alert')).toHaveText('Could not save the language. Try again.')
      await expect(menu(page).getByRole('menuitemradio', { checked: true })).toHaveText('English')
      await expect(lang(page)).toHaveAttribute('lang', 'en')
      await expect(page.getByRole('heading', { name: 'Profile', exact: true, includeHidden: true })).toBeVisible()

      await thai.tap()
      await expect(thai).toBeDisabled()
      await expect(english).toBeDisabled()
      await expect.poll(() => saves).toBe(2)
      await page.keyboard.press('Escape')
      await expect(avatar(page)).toBeFocused()
      await avatar(page).tap()
      await expect(thai).toBeDisabled()
      await expect(english).toBeDisabled()
      await thai.dispatchEvent('click')
      releaseRetry()
      await expect(lang(page)).toHaveAttribute('lang', 'th')
      await expect(menu(page).getByRole('menuitemradio', { checked: true })).toHaveText('ไทย')
      await expect(menu(page).getByRole('alert')).toBeHidden()
      const box = await menu(page).boundingBox()
      expect(box?.x).toBeGreaterThanOrEqual(0)
      expect(box && box.x + box.width).toBeLessThanOrEqual(390)
      expect(saves).toBe(2)
    } finally {
      releaseRetry()
      await page.unrouteAll({ behavior: 'wait' })
    }

    await page.keyboard.press('Escape')
    await expect(page.getByRole('navigation', { name: 'เมนูหลัก' }).getByRole('link', { name: 'รอคุณอนุมัติ' })).toHaveAttribute('href', '/requests/my-actions')
    await avatar(page).tap()
    await english.tap()
    await expect(lang(page)).toHaveAttribute('lang', 'en')
    await expect(menu(page).getByRole('menuitemradio', { checked: true })).toHaveText('English')
  })
})
