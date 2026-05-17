export type ExportPackageItemType = 'approval-report' | 'request-attachment' | 'solution-attachment'

export type ExportPackageFileKind = 'approval-report' | 'pdf' | 'image' | 'docx' | 'xlsx' | 'unsupported'

export type ExportPackageRequestItem =
  | { type: 'approval-report' }
  | { type: 'request-attachment'; attachmentId: string }
  | { type: 'solution-attachment'; attachmentId: string }

export interface ExportPackageAttachment {
  id: string
  fileName: string
  fileType?: string | null
  fileSize?: number | null
  filePath?: string | null
  description?: string | null
}

export interface ExportPackageItem {
  id: string
  type: ExportPackageItemType
  attachmentId?: string
  sourceLabel: string
  fileName: string
  fileType?: string | null
  fileSize?: number | null
  filePath?: string | null
  description?: string | null
  kind: ExportPackageFileKind
  selected: boolean
  mergeable: boolean
  order: number
}

export interface BuildDefaultExportPackageItemsInput {
  requestAttachments: ExportPackageAttachment[]
  solutionAttachments: ExportPackageAttachment[]
}

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])

export function getExportPackageFileKind(file: Pick<ExportPackageAttachment, 'fileName' | 'fileType'>): ExportPackageFileKind {
  const fileType = file.fileType?.toLowerCase() ?? ''
  const extension = getFileExtension(file.fileName)

  if (fileType === 'application/pdf' || extension === 'pdf') {
    return 'pdf'
  }

  if (fileType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }

  if (fileType === DOCX_MIME_TYPE || extension === 'docx') {
    return 'docx'
  }

  if (fileType === XLSX_MIME_TYPE || extension === 'xlsx') {
    return 'xlsx'
  }

  return 'unsupported'
}

export function isMergeableExportFile(file: Pick<ExportPackageAttachment, 'fileName' | 'fileType'>): boolean {
  return getExportPackageFileKind(file) !== 'unsupported'
}

export function buildDefaultExportPackageItems(input: BuildDefaultExportPackageItemsInput): ExportPackageItem[] {
  const items: ExportPackageItem[] = [
    {
      id: 'approval-report',
      type: 'approval-report',
      sourceLabel: 'Approval Evidence',
      fileName: 'Approval Evidence Report',
      kind: 'approval-report',
      selected: true,
      mergeable: true,
      order: 0,
    },
  ]

  for (const attachment of input.requestAttachments) {
    items.push(buildAttachmentPackageItem('request-attachment', 'Request Attachment', `request-${attachment.id}`, attachment, items.length))
  }

  for (const attachment of input.solutionAttachments) {
    items.push(buildAttachmentPackageItem('solution-attachment', 'Solution Attachment', `solution-${attachment.id}`, attachment, items.length))
  }

  return items
}

export function reorderExportPackageItems(items: ExportPackageItem[]): ExportPackageItem[] {
  return [...items]
    .sort((left, right) => left.order - right.order)
    .map((item, order) => ({
      ...item,
      order,
    }))
}

export function moveExportPackageItem(items: ExportPackageItem[], activeId: string, overId: string): ExportPackageItem[] {
  const orderedItems = reorderExportPackageItems(items)
  const activeIndex = orderedItems.findIndex((item) => item.id === activeId)
  const overIndex = orderedItems.findIndex((item) => item.id === overId)

  if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) {
    return orderedItems
  }

  const [activeItem] = orderedItems.splice(activeIndex, 1)
  orderedItems.splice(overIndex, 0, activeItem)

  return orderedItems.map((item, order) => ({
    ...item,
    order,
  }))
}

export function buildSelectedExportPackageRequestItems(items: ExportPackageItem[]): ExportPackageRequestItem[] {
  return reorderExportPackageItems(items)
    .filter((item) => item.selected && item.mergeable)
    .map((item) => {
      if (item.type === 'approval-report') {
        return { type: 'approval-report' }
      }

      if (!item.attachmentId) {
        throw new Error(`Attachment ID is missing for export package item ${item.id}.`)
      }

      return {
        type: item.type,
        attachmentId: item.attachmentId,
      }
    })
}

function buildAttachmentPackageItem(
  type: Extract<ExportPackageItemType, 'request-attachment' | 'solution-attachment'>,
  sourceLabel: string,
  id: string,
  attachment: ExportPackageAttachment,
  order: number
): ExportPackageItem {
  const kind = getExportPackageFileKind(attachment)
  const mergeable = kind !== 'unsupported'

  return {
    id,
    type,
    attachmentId: attachment.id,
    sourceLabel,
    fileName: attachment.fileName,
    fileType: attachment.fileType,
    fileSize: attachment.fileSize,
    filePath: attachment.filePath,
    description: attachment.description,
    kind,
    selected: mergeable,
    mergeable,
    order,
  }
}

function getFileExtension(fileName: string): string {
  const extensionSeparatorIndex = fileName.lastIndexOf('.')

  if (extensionSeparatorIndex === -1) {
    return ''
  }

  return fileName.slice(extensionSeparatorIndex + 1).toLowerCase()
}
