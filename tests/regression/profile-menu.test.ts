import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

describe('profile and approval-chain user menu', () => {
  it('adds Profile and Approval Chain entries to the top-right user dropdown', () => {
    const navbar = readFileSync('src/components/navigation/navbar.tsx', 'utf8')

    assert.match(navbar, /href="\/profile"/)
    assert.match(navbar, />\s*Profile\s*</)
    assert.match(navbar, /href="\/approval-chain"/)
    assert.match(navbar, />\s*Approval Chain\s*</)
    assert.match(navbar, /href="\/change-password"/)
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
    assert.match(approvalChainPage, /getCurrentUserApprovalChain/)
    assert.match(approvalChainPage, /HierarchyView/)
    assert.match(approvalChainPage, /readOnly/)
  })

  it('builds the current user approval chain with external department approvers included', () => {
    const hierarchyAction = readFileSync('src/server-actions/hierarchy.ts', 'utf8')

    assert.match(hierarchyAction, /export async function getCurrentUserApprovalChain\b/)

    const actionBody = hierarchyAction.slice(
      hierarchyAction.indexOf('export async function getCurrentUserApprovalChain'),
      hierarchyAction.indexOf('/**', hierarchyAction.indexOf('export async function getCurrentUserApprovalChain') + 1)
    )

    assert.match(actionBody, /session\.user\.id/)
    assert.match(actionBody, /departmentApprovers/)
    assert.match(actionBody, /isExternal:\s*true/)
    assert.match(actionBody, /processedUserIds/)
    assert.doesNotMatch(actionBody, /admin access required/i)
    assert.doesNotMatch(actionBody, /role !== 'admin'/)
  })
})
