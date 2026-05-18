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

  it('replaces legacy request detail export buttons with the package builder', () => {
    const detailModal = readFileSync('src/components/requests/request-detail-modal.tsx', 'utf8')

    assert.match(detailModal, /CompletedApprovalExportBuilder/)
    assert.match(detailModal, /exportRequestPackageAsPDF/)
    assert.match(detailModal, /renderExportBuilder/)
    assert.match(detailModal, /request\.status !== 'Completed'/)
    assert.doesNotMatch(detailModal, /ExportPDFButton/)
  })

  it('keeps completed-only export eligibility across legacy and server paths', () => {
    const legacyButton = readFileSync('src/components/reports/export-pdf-button.tsx', 'utf8')
    const reportsAction = readFileSync('src/server-actions/reports.ts', 'utf8')

    assert.match(legacyButton, /requestStatus === 'Completed' && allApprovalsComplete/)
    assert.doesNotMatch(legacyButton, /FinalApproval'\s*\|\|/)
    assert.match(reportsAction, /request\.status !== 'Completed'/)
    assert.doesNotMatch(reportsAction, /FinalApproval', 'Completed/)
  })
})
