import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDefaultExportPackageItems,
  getExportPackageFileKind,
  isMergeableExportFile,
  moveExportPackageItem,
} from '../../src/lib/export-package'

describe('completed approval export package utilities', () => {
  it('detects mergeable attachment kinds from MIME type and extension', () => {
    assert.equal(getExportPackageFileKind({ fileName: 'approval.pdf', fileType: 'application/pdf' }), 'pdf')
    assert.equal(getExportPackageFileKind({ fileName: 'approval.PDF', fileType: '' }), 'pdf')
    assert.equal(getExportPackageFileKind({ fileName: 'upload.bin', fileType: 'image/jpeg' }), 'image')
    assert.equal(getExportPackageFileKind({ fileName: 'photo.JPG', fileType: '' }), 'image')
    assert.equal(
      getExportPackageFileKind({
        fileName: 'upload.bin',
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      'docx'
    )
    assert.equal(getExportPackageFileKind({ fileName: 'scope.docx', fileType: '' }), 'docx')
    assert.equal(
      getExportPackageFileKind({
        fileName: 'upload.bin',
        fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'xlsx'
    )
    assert.equal(getExportPackageFileKind({ fileName: 'budget.xlsx', fileType: '' }), 'xlsx')
    assert.equal(getExportPackageFileKind({ fileName: 'slides.pptx', fileType: '' }), 'unsupported')
    assert.equal(isMergeableExportFile({ fileName: 'budget.xlsx', fileType: '' }), true)
    assert.equal(isMergeableExportFile({ fileName: 'slides.pptx', fileType: '' }), false)
  })

  it('builds default package items with the approval report first and mergeable attachments selected', () => {
    const items = buildDefaultExportPackageItems({
      requestAttachments: [
        {
          id: 'r1',
          fileName: 'scope.pdf',
          fileType: 'application/pdf',
          fileSize: 100,
          filePath: 'uploads/r1/scope.pdf',
          description: 'Scope document',
        },
        { id: 'r2', fileName: 'slides.pptx', fileType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', fileSize: 200, filePath: 'uploads/r1/slides.pptx' },
      ],
      solutionAttachments: [
        { id: 's1', fileName: 'photo.png', fileType: 'image/png', fileSize: 300, filePath: 'uploads/r1/photo.png' },
      ],
    })

    assert.deepEqual(
      items.map((item) => ({
        id: item.id,
        type: item.type,
        attachmentId: item.attachmentId,
        sourceLabel: item.sourceLabel,
        fileName: item.fileName,
        fileType: item.fileType,
        fileSize: item.fileSize,
        filePath: item.filePath,
        description: item.description,
        kind: item.kind,
        selected: item.selected,
        mergeable: item.mergeable,
        order: item.order,
      })),
      [
        {
          id: 'approval-report',
          type: 'approval-report',
          attachmentId: undefined,
          sourceLabel: 'Approval Evidence',
          fileName: 'Approval Evidence Report',
          fileType: undefined,
          fileSize: undefined,
          filePath: undefined,
          description: undefined,
          kind: 'approval-report',
          selected: true,
          mergeable: true,
          order: 0,
        },
        {
          id: 'request-r1',
          type: 'request-attachment',
          attachmentId: 'r1',
          sourceLabel: 'Request Attachment',
          fileName: 'scope.pdf',
          fileType: 'application/pdf',
          fileSize: 100,
          filePath: 'uploads/r1/scope.pdf',
          description: 'Scope document',
          kind: 'pdf',
          selected: true,
          mergeable: true,
          order: 1,
        },
        {
          id: 'request-r2',
          type: 'request-attachment',
          attachmentId: 'r2',
          sourceLabel: 'Request Attachment',
          fileName: 'slides.pptx',
          fileType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          fileSize: 200,
          filePath: 'uploads/r1/slides.pptx',
          description: undefined,
          kind: 'unsupported',
          selected: false,
          mergeable: false,
          order: 2,
        },
        {
          id: 'solution-s1',
          type: 'solution-attachment',
          attachmentId: 's1',
          sourceLabel: 'Solution Attachment',
          fileName: 'photo.png',
          fileType: 'image/png',
          fileSize: 300,
          filePath: 'uploads/r1/photo.png',
          description: undefined,
          kind: 'image',
          selected: true,
          mergeable: true,
          order: 3,
        },
      ]
    )
  })

  it('moves package items and rewrites contiguous order values', () => {
    const items = buildDefaultExportPackageItems({
      requestAttachments: [
        { id: 'r1', fileName: 'scope.pdf', fileType: 'application/pdf', fileSize: 100, filePath: 'uploads/r1/scope.pdf' },
      ],
      solutionAttachments: [
        { id: 's1', fileName: 'photo.png', fileType: 'image/png', fileSize: 300, filePath: 'uploads/r1/photo.png' },
      ],
    })

    const moved = moveExportPackageItem(items, 'solution-s1', 'approval-report')

    assert.deepEqual(
      moved.map((item) => ({ id: item.id, order: item.order })),
      [
        { id: 'solution-s1', order: 0 },
        { id: 'approval-report', order: 1 },
        { id: 'request-r1', order: 2 },
      ]
    )

    const movedDown = moveExportPackageItem(moved, 'approval-report', 'request-r1')

    assert.deepEqual(
      movedDown.map((item) => ({ id: item.id, order: item.order })),
      [
        { id: 'solution-s1', order: 0 },
        { id: 'request-r1', order: 1 },
        { id: 'approval-report', order: 2 },
      ]
    )

    assert.deepEqual(
      moveExportPackageItem(movedDown, 'missing-item', 'approval-report').map((item) => ({ id: item.id, order: item.order })),
      [
        { id: 'solution-s1', order: 0 },
        { id: 'request-r1', order: 1 },
        { id: 'approval-report', order: 2 },
      ]
    )
  })
})
