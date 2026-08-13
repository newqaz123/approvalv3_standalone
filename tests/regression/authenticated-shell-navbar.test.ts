import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const dashboardLayout = 'src/app/(dashboard)/layout.tsx'
const adminLayouts = ['src/app/(admin)/layout.tsx', 'src/app/admin/layout.tsx']

describe('authenticated shell and navigation', () => {
  it('defines one 1720px shell with the approved gutters', () => {
    const source = read('src/lib/authenticated-shell.ts')

    assert.match(source, /AUTHENTICATED_SHELL_CLASS/)
    for (const token of ['w-full', 'max-w-[1720px]', 'mx-auto', 'px-4', 'sm:px-6', 'lg:px-8', '2xl:px-10']) {
      assert.ok(source.includes(token), `missing ${token}`)
    }
  })

  it('uses the shared shell in every authenticated layout', () => {
    for (const path of [dashboardLayout, ...adminLayouts]) {
      const source = read(path)
      assert.match(source, /AUTHENTICATED_SHELL_CLASS/)
      assert.doesNotMatch(source, /md:max-w-7xl/)
      assert.match(source, /<MobileNav \/>/)
      assert.match(source, /<Navbar \/>/)
    }
  })

  it('marks every authenticated main with the shared shell contract', () => {
    for (const path of [dashboardLayout, ...adminLayouts]) {
      assert.match(read(path), /<main[^>]*data-auth-shell/)
    }
  })

  it('hands navigation from mobile to desktop at lg without a gap', () => {
    for (const path of [dashboardLayout, ...adminLayouts]) {
      assert.match(read(path), /hidden lg:block/)
    }

    const mobileNav = read('src/components/mobile/mobile-nav.tsx')
    assert.match(mobileNav, /lg:hidden/)
    assert.doesNotMatch(mobileNav, /md:hidden/)
  })

  it('aligns the navbar to the same shell and keeps links keyboard-visible', () => {
    const source = read('src/components/navigation/navbar.tsx')

    assert.match(source, /AUTHENTICATED_SHELL_CLASS/)
    assert.doesNotMatch(source, /max-w-7xl/)
    assert.match(source, /min-h-\[44px\]/)
    assert.match(source, /focus-visible:/)
    assert.match(source, /aria-current=\{[^}]+\? 'page' : undefined\}/)
    assert.match(source, /data-auth-shell/)
  })

  it('keeps the pending badge inline and collapses secondary user metadata', () => {
    const source = read('src/components/navigation/navbar.tsx')

    assert.match(source, /aria-label=\{`\$\{pendingCount\} pending actions`\}/)
    assert.doesNotMatch(source, /absolute -right-1 -top-1/)
    assert.match(source, /data-user-secondary/)
    assert.match(source, /hidden 2xl:inline/)
    assert.match(source, /callbackUrl: '\/sign-in'/)
    assert.match(source, /setInterval\(fetchPendingCount, 30000\)/)
  })
})
