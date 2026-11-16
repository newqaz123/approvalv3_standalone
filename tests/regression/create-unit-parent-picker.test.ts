// Exercise the real dialog and shared picker without a server or database.
import { it } from 'node:test'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'

it('Create unit uses searchable hierarchy paths and submits the selected parent ID', async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import { CreateUnitDialog } from './src/components/organization/CreateUnitDialog'
        import { UnitTreeSelect } from './src/components/organization/UnitTreeSelect'
        const unit = (id, name, parentId, isActive = true) => ({ id, name, parentId,
          isActive, shareRequests: false, canWorkOnSolutions: false, managerUserId: null })
        const units = [unit('qc', 'QC Section', 'qsec'), unit('factory', 'Factory', null),
          unit('admin', 'Admin Division', 'factory'), unit('qsec', 'QSEC Department', 'admin'),
          unit('ga', 'GA Department', 'admin'), unit('inactive', 'Old Section', 'qsec', false),
          unit('production', 'Production Division', 'factory'), unit('qc-other', 'QC Section', 'production')]
        createRoot(document.getElementById('root')).render(<>
          <CreateUnitDialog units={units} />
          <UnitTreeSelect units={units} value={null} onChange={() => {}} />
        </>)
      `,
      resolveDir: process.cwd(), loader: 'tsx',
    },
    bundle: true, write: false, platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{
      name: 'server-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /server-actions\/organization$/ }, () => ({ path: 'actions', namespace: 'test' }))
        builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'router', namespace: 'test' }))
        builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ contents: path === 'router'
          ? 'export const useRouter = () => ({ refresh() {} })'
          : 'export async function createOrganizationUnit(value) { document.getElementById("saved").textContent = JSON.stringify(value) }',
        }))
      },
    }],
  })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="root"></div><output id="saved"></output>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    // Existing Assign person identifiers remain unchanged.
    await page.getByTestId('assignment-unit-select').click()
    await expect(page.getByTestId('assignment-unit-search')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByTestId('create-unit-open').click()
    const trigger = page.getByTestId('create-unit-parent-select')
    const save = page.getByTestId('create-unit-save')
    await expect(save).toBeDisabled()
    await expect(trigger).toHaveAccessibleName('Parent unit')
    await expect(trigger).toHaveText('Select parent unit')
    await page.getByTestId('create-unit-name-input').fill('New Team Unit')
    await expect(save).toBeDisabled()
    await trigger.click()
    const search = page.getByPlaceholder('Search units…')
    await expect(search).toBeVisible()
    const options = page.getByRole('option')
    await expect(options).toHaveCount(7)
    await expect(options).toHaveText([
      'FactoryFactory', 'Admin DivisionFactory › Admin Division',
      'GA DepartmentFactory › Admin Division › GA Department',
      'QSEC DepartmentFactory › Admin Division › QSEC Department',
      'QC SectionFactory › Admin Division › QSEC Department › QC Section',
      'Production DivisionFactory › Production Division',
      'QC SectionFactory › Production Division › QC Section',
    ])
    await expect(page.getByRole('option', { name: 'Old Section' })).toHaveCount(0)
    const qc = page.getByRole('option', { name: 'QC Section', exact: true }).first()
    await expect(qc.locator('span[style]')).toHaveCSS('padding-left', '42px')

    await search.fill('not a unit')
    await expect(page.getByText('No unit found')).toBeVisible()
    await search.fill('Admin Division')
    await expect(options).toHaveCount(4)
    await expect(qc).toBeVisible()
    await qc.click()
    await expect(trigger).toHaveText('Factory › Admin Division › QSEC Department › QC Section')
    await expect(save).toBeEnabled()
    await save.click()
    await expect(page.locator('#saved')).toHaveText('{"name":"New Team Unit","parentId":"qc"}')
    await expect(page.getByTestId('create-unit-dialog')).toHaveCount(0)

    // Reopening resets the parent; keyboard selection distinguishes duplicate names.
    await page.getByTestId('create-unit-open').click()
    await expect(trigger).toHaveText('Select parent unit')
    await page.getByTestId('create-unit-name-input').fill('Second Unit')
    await trigger.click()
    await search.fill('Production Division › QC Section')
    await expect(options).toHaveCount(1)
    await search.press('ArrowDown')
    await search.press('Enter')
    await expect(trigger).toHaveText('Factory › Production Division › QC Section')
    await save.click()
    await expect(page.locator('#saved')).toHaveText('{"name":"Second Unit","parentId":"qc-other"}')
  } finally {
    await browser.close()
  }
})
