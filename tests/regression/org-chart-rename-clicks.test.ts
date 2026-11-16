// Real React/Radix browser interaction regression; no server or database writes.
import { it } from 'node:test'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'

it('org-chart rename controls do not activate the Manage header', async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import { TreeNodeRow } from './src/components/organization/TreeNodeRow'
        const unit = { id: 'qc', name: 'QC Section', parentId: null, isActive: true,
          shareRequests: false, canWorkOnSolutions: false, managerUserId: null }
        const snapshot = { units: [unit], positions: [], assignments: [], teams: [],
          users: [], unassignedUsers: [], routeSources: [], customChainExceptions: [],
          readiness: { ready: true, blockers: [] } }
        function App() {
          const [opens, setOpens] = React.useState(0)
          return <><output data-testid="opens">{opens}</output>
            <TreeNodeRow unit={unit} snapshot={snapshot} childrenByParentId={new Map()}
              onSelectUnit={() => setOpens(n => n + 1)} /></>
        }
        createRoot(document.getElementById('root')).render(<App />)
      `,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{
      name: 'no-server-writes',
      setup(builder) {
        // Server actions persist names and revalidate Next routes; neither is
        // needed to test client click routing. Keep all UI components real.
        builder.onResolve({ filter: /server-actions\/organization$/ }, () => ({ path: 'actions', namespace: 'test' }))
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents:
          'export async function renameOrganizationUnit() {} export async function renameTeam() {}'
          + ' export async function createOrganizationUnit() { return { id: "unused" } }' }))
      },
    }],
  })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const opens = page.getByTestId('opens')
    const input = page.getByTestId('inline-name-edit-input')

    // Direct Rename also programmatically clicks the hidden pencil.
    await page.getByTestId('unit-rename-qc').click()
    await expect(input).toBeVisible()
    await expect(opens).toHaveText('0')
    await input.click()
    await input.fill('QC revised')
    await expect(opens).toHaveText('0')
    await input.press('Escape')

    await page.getByTestId('unit-overflow-qc').click()
    await expect(opens).toHaveText('0')
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    await expect(input).toBeVisible()
    await expect(opens).toHaveText('0')
    await input.click()
    await expect(opens).toHaveText('0')
    await input.press('Escape')

    // Ordinary name/header clicks still manage the unit; explicit Manage
    // must activate once, not again through the header's bubbling handler.
    await page.getByTestId('unit-name-qc').click()
    await expect(opens).toHaveText('1')
    await page.getByTestId('unit-manage-qc').click()
    await expect(opens).toHaveText('2')
    await page.getByTestId('unit-overflow-qc').click()
    await page.getByRole('menuitem', { name: 'Manage', exact: true }).click()
    await expect(opens).toHaveText('3')
    await page.getByTestId('unit-header-qc').focus()
    await page.keyboard.press('Enter')
    await expect(opens).toHaveText('4')
    await page.keyboard.press('Space')
    await expect(opens).toHaveText('5')
  } finally {
    await browser.close()
  }
})
