// Add sub-unit from the organization tree: real React/Radix browser
// interaction with the compiled application CSS. The create action is stubbed
// in the bundle, so there are no server or database writes.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { chromium, expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

type Box = { x: number; y: number; width: number; height: number }

let browser: Browser
let bundle = ''
let css = ''

before(async () => {
  const [built, compiled] = await Promise.all([
    build({
      stdin: {
        contents: `
          import React from 'react'
          import { createRoot } from 'react-dom/client'
          import { OrganizationTree } from './src/components/organization/OrganizationTree'
          const unit = (id, name, parentId) => ({ id, name, parentId, isActive: true,
            shareRequests: false, canWorkOnSolutions: false, managerUserId: null })
          const snapshot = { units: [unit('qsec', 'QSEC Department', null), unit('qc', 'QC Section', 'qsec')],
            positions: [], assignments: [], teams: [], users: [], unassignedUsers: [],
            routeSources: [], customChainExceptions: [], readiness: { ready: true, blockers: [] } }
          function App() {
            const [opens, setOpens] = React.useState(0)
            return <><output data-testid="opens">{opens}</output>
              <div id="scale" style={{ width: 'max-content' }}>
                <OrganizationTree snapshot={snapshot} onSelectUnit={() => setOpens(n => n + 1)} />
              </div></>
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
          // The real action persists the unit and revalidates the Next route.
          // The stub records the call, takes long enough for a double submit
          // to land mid-save, and rejects one name like the sibling-name check.
          builder.onResolve({ filter: /server-actions\/organization$/ }, () => ({ path: 'actions', namespace: 'test' }))
          builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
            export async function renameOrganizationUnit() {}
            export async function renameTeam() {}
            export async function createOrganizationUnit(input) {
              window.__created = [...(window.__created || []), input]
              await new Promise((resolve) => setTimeout(resolve, input.name === 'Slow' ? 1000 : 150))
              if (input.name === 'Slow') throw new Error('Late failure')
              if (input.name === 'Dup') throw new Error('Name must be unique among sibling units')
              return { id: 'created' }
            }
          ` }))
        },
      }],
    }),
    postcss([tailwindcss(), autoprefixer])
      .process(readFileSync('src/app/globals.css', 'utf8'), { from: 'src/app/globals.css' }),
  ])
  bundle = built.outputFiles[0].text
  css = compiled.css
  browser = await chromium.launch({ headless: true })
})

after(async () => {
  await browser?.close()
})

async function withTree(
  run: (page: Page) => Promise<void>,
  options: BrowserContextOptions = { viewport: { width: 1280, height: 900 } },
): Promise<void> {
  const context = await browser.newContext(options)
  try {
    const page = await context.newPage()
    await page.setContent(`<!DOCTYPE html><html><head><style>${css}</style></head><body><div id="root"></div></body></html>`)
    await page.addScriptTag({ content: bundle })
    await expect(page.getByTestId('unit-card-qc')).toBeVisible()
    await run(page)
  } finally {
    await context.close()
  }
}

async function box(page: Page, testId: string): Promise<Box> {
  const result = await page.getByTestId(testId).boundingBox()
  assert.ok(result, `no box for ${testId}`)
  return result
}

async function created(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as unknown as { __created?: unknown[] }).__created ?? [])
}

async function openFromHover(page: Page, unitId: string) {
  await page.getByTestId(`unit-card-${unitId}`).hover()
  await page.getByTestId(`unit-add-child-${unitId}`).click()
  const input = page.getByTestId('add-child-unit-name-input')
  await expect(input).toBeVisible()
  return input
}

describe('organization tree + Add unit (browser)', () => {
  it('+ Add unit is hidden at rest and appears only for the hovered card, without moving anything', async () => {
    await withTree(async (page) => {
      const addQc = page.getByTestId('unit-add-child-qc')
      const addQsec = page.getByTestId('unit-add-child-qsec')
      await expect(addQc).toBeHidden()
      await expect(addQsec).toBeHidden()
      const before = [await box(page, 'unit-card-qsec'), await box(page, 'unit-card-qc')]

      await page.getByTestId('unit-card-qc').hover()
      await expect(addQc).toBeVisible()
      await expect(addQc).toHaveText('+ Add unit')
      await expect(addQsec).toBeHidden()
      assert.deepEqual([await box(page, 'unit-card-qsec'), await box(page, 'unit-card-qc')], before)

      // Below the card box, horizontally centered on it.
      const card = before[1]
      const button = await box(page, 'unit-add-child-qc')
      assert.ok(button.y + button.height > card.y + card.height, 'button extends below the card')
      assert.ok(button.y >= card.y + card.height - 6, `button starts at the card's bottom edge (got ${button.y} vs ${card.y + card.height})`)
      assert.ok(Math.abs((button.x + button.width / 2) - (card.x + card.width / 2)) <= 1, 'button is centered under the card')

      // QC is the bottom-most card: its button must not grow a scrollbar.
      const scroll = await page.getByTestId('organization-tree').evaluate((element) => ({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }))
      assert.equal(scroll.scrollHeight, scroll.clientHeight)

      // The pointer can travel from the card onto the button.
      await addQc.hover()
      await expect(addQc).toBeVisible()

      await page.getByTestId('unit-card-qsec').hover()
      await expect(addQsec).toBeVisible()
      await expect(addQc).toBeHidden()

      // Keyboard: focus inside the card reveals a focusable button.
      await page.mouse.move(0, 0)
      await expect(addQsec).toBeHidden()
      await page.getByTestId('unit-header-qc').focus()
      await expect(addQc).toBeVisible()
      await addQc.focus()
      await expect(addQc).toBeFocused()
      assert.deepEqual(await created(page), [])
      await expect(page.getByTestId('opens')).toHaveText('0')
    })
  })

  it('creates a child of the hovered unit from the popover, once', async () => {
    await withTree(async (page) => {
      const input = await openFromHover(page, 'qc')
      await expect(input).toBeFocused()
      const form = page.getByTestId('add-child-unit-form')
      await expect(form).toContainText('New unit under QC Section')

      // The popover owns the button's visibility once the pointer leaves.
      await page.mouse.move(0, 0)
      await expect(page.getByTestId('unit-add-child-qc')).toBeVisible()
      const button = await box(page, 'unit-add-child-qc')
      const formBox = await box(page, 'add-child-unit-form')
      assert.ok(formBox.y >= button.y + button.height - 1, 'popover opens below the button')

      await input.press('Enter')
      await input.fill('   ')
      await input.press('Enter')
      await page.waitForTimeout(200)
      assert.deepEqual(await created(page), [])
      await expect(form).toBeVisible()

      await input.fill('  Line 1 ')
      await input.press('Enter')
      await input.press('Enter')
      await expect(form).toBeHidden()
      await page.waitForTimeout(300)
      assert.deepEqual(await created(page), [{ name: 'Line 1', parentId: 'qc' }])
      await expect(page.getByTestId('opens')).toHaveText('0')

      // A fresh popover starts empty.
      const reopened = await openFromHover(page, 'qc')
      await expect(reopened).toHaveValue('')
    })
  })

  it('places the popover under the button when the canvas is scaled', async () => {
    await withTree(async (page) => {
      await page.locator('#scale').evaluate((element) => {
        (element as HTMLElement).style.transform = 'scale(0.5)'
        ;(element as HTMLElement).style.transformOrigin = 'top left'
      })
      await openFromHover(page, 'qc')
      const button = await box(page, 'unit-add-child-qc')
      const formBox = await box(page, 'add-child-unit-form')
      assert.ok(formBox.y >= button.y + button.height - 1, 'popover opens below the scaled button')
      assert.ok(formBox.y - (button.y + button.height) <= 40, 'popover stays close to the scaled button')
      const buttonCenter = button.x + button.width / 2
      assert.ok(formBox.x <= buttonCenter && buttonCenter <= formBox.x + formBox.width, 'popover spans the button horizontally')
    })
  })

  it('keeps the typed name and shows the error when the server rejects it', async () => {
    await withTree(async (page) => {
      const input = await openFromHover(page, 'qc')
      const form = page.getByTestId('add-child-unit-form')
      await input.fill('Dup')
      await input.press('Enter')
      await expect(page.getByTestId('add-child-unit-error')).toHaveText('Name must be unique among sibling units')
      await expect(page.getByTestId('add-child-unit-error')).toHaveAttribute('role', 'alert')
      await expect(input).toHaveValue('Dup')
      await expect(form).toBeVisible()
      await expect(page.getByTestId('add-child-unit-save')).toBeEnabled()
      assert.deepEqual(await created(page), [{ name: 'Dup', parentId: 'qc' }])

      await page.keyboard.press('Escape')
      await expect(form).toBeHidden()
      const reopened = await openFromHover(page, 'qc')
      await expect(reopened).toHaveValue('')
      await expect(page.getByTestId('add-child-unit-error')).toHaveCount(0)

      await page.getByTestId('add-child-unit-cancel').click()
      await expect(form).toBeHidden()
      await expect(page.getByTestId('opens')).toHaveText('0')
    })
  })

  it('Escape dismisses the popover while a save is still running, and its late error never reaches the next popover', async () => {
    await withTree(async (page) => {
      const form = page.getByTestId('add-child-unit-form')
      const save = page.getByTestId('add-child-unit-save')
      const input = await openFromHover(page, 'qc')
      await input.fill('Slow')
      await input.press('Enter')
      await expect(save).toBeDisabled()
      await page.keyboard.press('Escape')
      await expect(form).toBeHidden({ timeout: 600 })

      // The abandoned request neither blocks nor pollutes a new attempt.
      const reopened = await openFromHover(page, 'qc')
      await expect(reopened).toHaveValue('')
      await reopened.fill('Line 5')
      await expect(save).toBeEnabled()
      await page.waitForTimeout(1300)
      await expect(page.getByTestId('add-child-unit-error')).toHaveCount(0)
      await expect(reopened).toHaveValue('Line 5')
      await expect(save).toBeEnabled()
      await reopened.press('Enter')
      await expect(form).toBeHidden()
      assert.deepEqual(await created(page), [{ name: 'Slow', parentId: 'qc' }, { name: 'Line 5', parentId: 'qc' }])
    })
  })

  it('returns keyboard focus to the + Add unit button when the popover closes', async () => {
    await withTree(async (page) => {
      const addQc = page.getByTestId('unit-add-child-qc')
      const form = page.getByTestId('add-child-unit-form')
      const input = page.getByTestId('add-child-unit-name-input')
      await page.mouse.move(0, 0)
      await page.getByTestId('unit-header-qc').focus()
      await addQc.focus()

      // Escape
      await page.keyboard.press('Enter')
      await expect(input).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(form).toBeHidden()
      await expect(addQc).toBeFocused()

      // Cancel
      await page.keyboard.press('Enter')
      await expect(input).toBeFocused()
      await page.getByTestId('add-child-unit-cancel').click()
      await expect(form).toBeHidden()
      await expect(addQc).toBeFocused()

      // Successful create: ready to add the next sibling.
      await page.keyboard.press('Enter')
      await input.fill('Line 6')
      await input.press('Enter')
      await expect(form).toBeHidden()
      await expect(addQc).toBeFocused()

      // Clicking elsewhere closes it without yanking focus back.
      await page.keyboard.press('Enter')
      await expect(input).toBeFocused()
      // Radix arms its outside-press listener one tick after the popover
      // mounts, so a click that races it is retried.
      await expect(async () => {
        await page.mouse.click(1100, 800)
        await expect(form).toBeHidden({ timeout: 500 })
      }).toPass()
      await expect(addQc).not.toBeFocused()
      await expect(page.getByTestId('opens')).toHaveText('0')
    })
  })

  it('opens the same popover from the overflow menu and keeps it open', async () => {
    await withTree(async (page) => {
      await page.getByTestId('unit-overflow-qc').click()
      await page.getByRole('menuitem', { name: 'Add unit', exact: true }).click()
      const input = page.getByTestId('add-child-unit-name-input')
      await expect(input).toBeVisible()
      await page.waitForTimeout(300)
      await expect(input).toBeVisible()
      await expect(input).toBeFocused()
      await expect(page.getByTestId('add-child-unit-form')).toContainText('New unit under QC Section')
      await input.fill('Line 3')
      await input.press('Enter')
      await expect(input).toBeHidden()
      assert.deepEqual(await created(page), [{ name: 'Line 3', parentId: 'qc' }])
      await expect(page.getByTestId('opens')).toHaveText('0')
    })
  })

  it('on touch devices hides the hover button and still adds from the overflow menu', async () => {
    await withTree(async (page) => {
      assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'harness emulates a coarse pointer')
      const addQc = page.getByTestId('unit-add-child-qc')
      await expect(addQc).toBeHidden()
      await page.getByTestId('unit-overflow-qc').tap()
      await page.getByRole('menuitem', { name: 'Add unit', exact: true }).tap()
      const input = page.getByTestId('add-child-unit-name-input')
      await expect(input).toBeVisible()
      await page.waitForTimeout(300)
      await expect(input).toBeVisible()
      await expect(addQc).toBeHidden()
      // With the button gone, the popover still hangs off the card's bottom.
      const touchHeader = page.getByTestId('unit-header-qc')
      const card = await box(page, 'unit-card-qc')
      const formBox = await box(page, 'add-child-unit-form')
      assert.ok(formBox.y >= card.y + card.height - 1, 'popover opens below the card')
      const cardCenter = card.x + card.width / 2
      assert.ok(formBox.x <= cardCenter && cardCenter <= formBox.x + formBox.width, 'popover spans the card center')
      await input.fill('Line 4')
      await input.press('Enter')
      await expect(input).toBeHidden()
      assert.deepEqual(await created(page), [{ name: 'Line 4', parentId: 'qc' }])
      // No hover button to return to: focus lands on the card, not the page body.
      await expect(touchHeader).toBeFocused()
      await expect(page.getByTestId('opens')).toHaveText('0')
    }, { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })
  })

  it('adds under a unit that already has children, and expands it if collapsed', async () => {
    await withTree(async (page) => {
      const children = page.getByTestId('unit-children-qsec')
      await page.getByTestId('unit-toggle-qsec').click()
      await expect(children).toBeHidden()

      // Clicking proves the button paints above the connector stem.
      const input = await openFromHover(page, 'qsec')
      await expect(page.getByTestId('add-child-unit-form')).toContainText('New unit under QSEC Department')
      await input.fill('Line 2')
      await input.press('Enter')
      await expect(input).toBeHidden()
      assert.deepEqual(await created(page), [{ name: 'Line 2', parentId: 'qsec' }])
      await expect(children).toBeVisible()
      await expect(page.getByTestId('unit-card-qc')).toBeVisible()
      await expect(page.getByTestId('opens')).toHaveText('0')
    })
  })
})
