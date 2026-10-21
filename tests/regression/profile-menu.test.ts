import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

describe('profile and approval-chain user menu', () => {
  it('adds Profile and Approval Chain entries to the shared user dropdown', () => {
    const userMenu = readFileSync('src/components/navigation/user-menu.tsx', 'utf8')

    assert.match(userMenu, /href="\/profile"/)
    assert.match(userMenu, />\s*Profile\s*</)
    assert.match(userMenu, /href="\/approval-chain"/)
    assert.match(userMenu, />\s*Approval Chain\s*</)
    assert.match(userMenu, /href="\/change-password"/)
    assert.match(userMenu, />\s*Sign Out\s*</)
    assert.match(userMenu, /callbackUrl: ['"]\/sign-in['"]/
    )
  })

  it('shares the dropdown between both shells so they cannot drift', () => {
    const navbar = readFileSync('src/components/navigation/navbar.tsx', 'utf8')
    const mobileNav = readFileSync('src/components/mobile/mobile-nav.tsx', 'utf8')

    assert.match(
      navbar,
      /import \{ UserMenu \} from ['"]@\/components\/navigation\/user-menu['"]/,
    )
    assert.match(navbar, /<UserMenu\b/)
    assert.match(
      mobileNav,
      /import \{ UserMenu \} from ['"]@\/components\/navigation\/user-menu['"]/,
    )
    assert.match(mobileNav, /<UserMenu variant="mobile"/)
  })

  it('portals the menu to the document so it sits above the page layer', () => {
    const userMenu = readFileSync('src/components/navigation/user-menu.tsx', 'utf8')
    const mobileNav = readFileSync('src/components/mobile/mobile-nav.tsx', 'utf8')

    // An absolute panel inside the fixed nav paints on top but loses
    // hit-testing to the page on iOS. Radix portals the panel to body.
    assert.match(userMenu, /DropdownMenuContent/)
    assert.match(userMenu, /from ['"]@\/components\/ui\/dropdown-menu['"]/)
    assert.match(userMenu, /z-\[100\]/)
    assert.doesNotMatch(userMenu, /absolute right-0 mt-2/)

    // Keep the nav transform off while open so the trigger stays live.
    assert.match(mobileNav, /onOpenChange=\{setMenuOpen\}/)
    assert.match(mobileNav, /menuOpen \? ['"]transform-none['"]/)

    assert.match(userMenu, /href="\/profile"[\s\S]*?min-h-\[44px\]/)
    assert.match(userMenu, /href="\/approval-chain"[\s\S]*?min-h-\[44px\]/)
    assert.match(userMenu, /href="\/change-password"[\s\S]*?min-h-\[44px\]/)
    assert.match(userMenu, /handleSignOut[\s\S]*?min-h-\[44px\]|min-h-\[44px\][\s\S]*?handleSignOut/)
  })

  it('makes the mobile avatar a tappable menu button instead of a dead circle', () => {
    const mobileNav = readFileSync('src/components/mobile/mobile-nav.tsx', 'utf8')
    const userMenu = readFileSync('src/components/navigation/user-menu.tsx', 'utf8')

    // The old dead div avatar (h-9 w-9 circle) must be gone.
    assert.doesNotMatch(mobileNav, /h-9 w-9 rounded-full bg-blue-600/)

    // The mobile trigger is a real button meeting the 44px touch target.
    assert.match(userMenu, /<button[\s\S]*?aria-label="Open user menu"/)
    assert.match(userMenu, /min-h-\[44px\]/)
    assert.match(userMenu, /min-w-\[44px\]/)
    assert.match(userMenu, /aria-expanded=\{menuOpen\}/)
  })

  it('exposes self-service profile actions that only edit the current user display name', () => {
    const usersAction = readFileSync('src/server-actions/users.ts', 'utf8')

    assert.match(usersAction, /export async function getCurrentUserProfile\b/)
    assert.match(usersAction, /export async function updateOwnDisplayName\b/)

    const updateBody = usersAction.slice(
      usersAction.indexOf('export async function updateOwnDisplayName'),
      usersAction.indexOf('/**', usersAction.indexOf('export async function updateOwnDisplayName') + 1)
    )

    assert.match(updateBody, /session\.user\.id/)
    assert.match(updateBody, /where:\s*\{\s*id:\s*session\.user\.id\s*\}/)
    assert.match(updateBody, /name:\s*nextName/)
    assert.match(updateBody, /profile_display_name_changed/)
    assert.match(updateBody, /Display name changed from/)
    assert.doesNotMatch(updateBody, /email:/)
    assert.doesNotMatch(updateBody, /role:/)
    assert.doesNotMatch(updateBody, /departmentId:/)
  })

  it('updates the NextAuth session name after profile edits', () => {
    const authConfig = readFileSync('src/lib/auth-config.ts', 'utf8')

    assert.match(authConfig, /if \(session\.name\) token\.name = session\.name/)
    assert.match(authConfig, /session\.user\.name = token\.name as string/)
  })

  it('creates separate dashboard pages for Profile and Approval Chain', () => {
    assert.equal(existsSync('src/app/(dashboard)/profile/page.tsx'), true)
    assert.equal(existsSync('src/app/(dashboard)/approval-chain/page.tsx'), true)

    const profilePage = readFileSync('src/app/(dashboard)/profile/page.tsx', 'utf8')
    const approvalChainPage = readFileSync('src/app/(dashboard)/approval-chain/page.tsx', 'utf8')

    assert.match(profilePage, /getCurrentUserProfile/)
    assert.match(profilePage, /ProfileForm/)
    assert.doesNotMatch(approvalChainPage, /getCurrentUserApprovalChain/)
    assert.doesNotMatch(approvalChainPage, /HierarchyView/)
    assert.match(approvalChainPage, /published organization routes/)
  })

  it('C1: approval-chain is informational and does not load legacy hierarchy actions', () => {
    assert.equal(existsSync('src/server-actions/hierarchy.ts'), false)
    const approvalChainPage = readFileSync('src/app/(dashboard)/approval-chain/page.tsx', 'utf8')
    assert.match(approvalChainPage, /organization_assignments/)
    assert.match(approvalChainPage, /unitPathNames/)
    assert.doesNotMatch(approvalChainPage, /from '@\/server-actions\/hierarchy'/)
  })
})
