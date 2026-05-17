import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

describe('completed approval export builder wiring', () => {
  it('renders the package builder in the completed final modal', () => {
    const modal = readFileSync('src/components/requests/completed-final-modal.tsx', 'utf8')
    const builder = readFileSync('src/components/reports/completed-approval-export-builder.tsx', 'utf8')

    assert.match(modal, /CompletedApprovalExportBuilder/)
    assert.match(modal, /onExportPackage\?:/)
    assert.match(modal, /requestAttachments=\{data\.requestFiles\}/)
    assert.match(modal, /solutionAttachments=\{data\.solution\.files\}/)
    assert.match(builder, /buildDefaultExportPackageItems/)
    assert.match(builder, /buildSelectedExportPackageRequestItems/)
    assert.match(builder, /buildPackageItemsKey/)
    assert.match(builder, /\[packageItemsKey\]/)
    assert.match(builder, /moveExportPackageItem/)
    assert.match(builder, /Export Selected Package/)
    assert.match(builder, /Unsupported files stay visible/)
    assert.match(builder, /disabled=\{!item\.mergeable\}/)
  })

  it('routes ordered selected package items to the package server action', () => {
    const router = readFileSync('src/components/requests/request-modal-router.tsx', 'utf8')

    assert.match(router, /exportRequestPackageAsPDF/)
    assert.match(router, /handleExportPackage/)
    assert.match(router, /onExportPackage=\{handleExportPackage\}/)
    assert.match(router, /Evidence package exported successfully/)
  })
})
