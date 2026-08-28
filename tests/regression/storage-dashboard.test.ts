import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import {
  formatStorageBytes,
  classifyAttachmentOwner,
  aggregateStorageRows,
  toStorageRows,
  diskUsedPercent,
  buildStorageTrendChart,
  resolveVolumeStripShares,
  filterRetentionRowsByUpdatedDate,
  utcMonthKey,
  isMissingStoragePlanTable,
  estimateBytesAtMonth,
  type AttachmentStorageRow,
  type InlineImageStorageRow,
} from '../../src/lib/storage-dashboard'
import { measureUploadVolume } from '../../src/lib/storage-volume'

function row(
  overrides: Partial<AttachmentStorageRow> & Pick<AttachmentStorageRow, 'id' | 'fileSize'>
): AttachmentStorageRow {
  return {
    fileName: overrides.fileName ?? `${overrides.id}.bin`,
    fileType: overrides.fileType ?? 'application/pdf',
    createdAt: overrides.createdAt ?? new Date('2026-03-01T00:00:00.000Z'),
    requestId: overrides.requestId ?? null,
    solutionId: overrides.solutionId ?? null,
    ...overrides,
  }
}

function inlineRow(
  overrides: Partial<InlineImageStorageRow> & Pick<InlineImageStorageRow, 'id' | 'fileSize'>
): InlineImageStorageRow {
  return {
    fileName: overrides.fileName ?? `${overrides.id}.png`,
    fileType: overrides.fileType ?? 'image/png',
    createdAt: overrides.createdAt ?? new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('formatStorageBytes', () => {
  it('formats zero and sub-kilobyte sizes', () => {
    assert.equal(formatStorageBytes(0), '0 B')
    assert.equal(formatStorageBytes(512), '512 B')
  })

  it('formats KB, MB, and GB with one decimal when needed', () => {
    assert.equal(formatStorageBytes(1024), '1 KB')
    assert.equal(formatStorageBytes(1536), '1.5 KB')
    assert.equal(formatStorageBytes(1048576), '1 MB')
    assert.equal(formatStorageBytes(1610612736), '1.5 GB')
  })
})

describe('classifyAttachmentOwner', () => {
  it('prefers request when both ids are present', () => {
    assert.equal(
      classifyAttachmentOwner({ requestId: 'r1', solutionId: 's1' }),
      'request'
    )
  })

  it('classifies solution-only and unowned files', () => {
    assert.equal(classifyAttachmentOwner({ requestId: null, solutionId: 's1' }), 'solution')
    assert.equal(classifyAttachmentOwner({ requestId: null, solutionId: null }), 'other')
  })
})

describe('aggregateStorageRows', () => {
  it('sums bytes and counts by owner and keeps the largest files', () => {
    const totals = aggregateStorageRows(
      toStorageRows(
        [
          row({ id: 'a', fileSize: 100, requestId: 'r1', fileName: 'small.pdf' }),
          row({ id: 'b', fileSize: 400, requestId: 'r1', fileName: 'big.pdf' }),
          row({ id: 'c', fileSize: 250, solutionId: 's1', fileName: 'mid.xlsx' }),
          row({ id: 'd', fileSize: 50, fileName: 'orphan.bin' }),
        ],
        []
      ),
      2
    )

    assert.equal(totals.recordedStorageBytes, 800)
    assert.equal(totals.attachmentCount, 4)
    assert.equal(totals.requestAttachmentBytes, 500)
    assert.equal(totals.requestAttachmentCount, 2)
    assert.equal(totals.solutionAttachmentBytes, 250)
    assert.equal(totals.solutionAttachmentCount, 1)
    assert.equal(totals.inlineImageBytes, 0)
    assert.equal(totals.inlineImageCount, 0)
    assert.deepEqual(
      totals.largestFiles.map((file) => ({ id: file.id, owner: file.owner })),
      [
        { id: 'b', owner: 'request' },
        { id: 'c', owner: 'solution' },
      ]
    )
  })

  it('aggregates mixed attachment and inline assets while keeping attachment metrics separate', () => {
    const totals = aggregateStorageRows(
      toStorageRows(
        [
          row({ id: 'att-request', fileSize: 100, requestId: 'r1' }),
          row({ id: 'att-solution', fileSize: 250, solutionId: 's1' }),
        ],
        [
          inlineRow({ id: 'img-1', fileSize: 400, fileName: 'plan.webp' }),
          inlineRow({ id: 'img-2', fileSize: 50, fileName: 'detail.png' }),
        ]
      ),
      3
    )

    // Recorded storage covers attachments plus inline images exactly once.
    assert.equal(totals.recordedStorageBytes, 800)
    // Existing attachment metrics stay attachment-only.
    assert.equal(totals.attachmentCount, 2)
    assert.equal(totals.requestAttachmentBytes, 100)
    assert.equal(totals.requestAttachmentCount, 1)
    assert.equal(totals.solutionAttachmentBytes, 250)
    assert.equal(totals.solutionAttachmentCount, 1)
    // Dedicated inline metrics use each asset's stored size.
    assert.equal(totals.inlineImageBytes, 450)
    assert.equal(totals.inlineImageCount, 2)
    assert.deepEqual(
      totals.largestFiles.map((file) => ({ id: file.id, owner: file.owner })),
      [
        { id: 'img-1', owner: 'inline' },
        { id: 'att-solution', owner: 'solution' },
        { id: 'att-request', owner: 'request' },
      ]
    )
  })

  it('counts an inline asset once even when its references are shared', () => {
    // 'shared-photo' is referenced by both a request description and a
    // solution description. Asset rows load once per asset, never once per
    // reference, so shared storage must never double count.
    const totals = aggregateStorageRows(
      toStorageRows(
        [row({ id: 'att-request', fileSize: 100, requestId: 'r1' })],
        [inlineRow({ id: 'shared-photo', fileSize: 400 })]
      )
    )

    assert.equal(totals.inlineImageBytes, 400)
    assert.equal(totals.inlineImageCount, 1)
    assert.equal(totals.recordedStorageBytes, 500)
    assert.deepEqual(
      totals.largestFiles.map((file) => ({ id: file.id, owner: file.owner })),
      [
        { id: 'shared-photo', owner: 'inline' },
        { id: 'att-request', owner: 'request' },
      ]
    )
  })
})

describe('diskUsedPercent', () => {
  it('returns a 0-100 percent when both values are known', () => {
    assert.equal(diskUsedPercent(25, 100), 25)
    assert.equal(diskUsedPercent(0, 100), 0)
    assert.equal(diskUsedPercent(150, 100), 100)
  })

  it('returns null when capacity cannot be computed', () => {
    assert.equal(diskUsedPercent(null, 100), null)
    assert.equal(diskUsedPercent(10, null), null)
    assert.equal(diskUsedPercent(10, 0), null)
  })
})

describe('measureUploadVolume', () => {
  it('sums nested files under the upload root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storage-dash-'))
    try {
      await mkdir(join(root, 'req-1'), { recursive: true })
      await writeFile(join(root, 'req-1', 'a.txt'), Buffer.alloc(40))
      await writeFile(join(root, 'b.bin'), Buffer.alloc(60))

      const usage = await measureUploadVolume(root)
      assert.equal(usage.uploadDirBytes, 100)
      assert.equal(usage.uploadDirError, null)
      assert.equal(typeof usage.diskTotalBytes, 'number')
      assert.equal(typeof usage.diskFreeBytes, 'number')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports an error when the upload root is missing', async () => {
    const usage = await measureUploadVolume(join(tmpdir(), 'missing-storage-dash-root'))
    assert.equal(usage.uploadDirBytes, null)
    assert.match(usage.uploadDirError ?? '', /not found|ENOENT|missing/i)
  })
})

describe('resolveVolumeStripShares', () => {
  it('uses capacity shares when the used share is visible', () => {
    const shares = resolveVolumeStripShares({
      uploadDirBytes: 50 * 1024 ** 3,
      recordedBytes: 30 * 1024 ** 3,
      capacityBytes: 100 * 1024 ** 3,
    })
    assert.equal(shares.mode, 'capacity')
    assert.equal(shares.recordedPct, 30)
    assert.equal(shares.otherPct, 20)
    assert.equal(shares.freePct, 50)
  })

  it('falls back to folder shares when the used share of the disk is invisible', () => {
    const shares = resolveVolumeStripShares({
      uploadDirBytes: 10 * 1024 ** 2, // 10 MB used ...
      recordedBytes: 7 * 1024 ** 2,
      capacityBytes: 1024 ** 4, // ... of a 1 TB disk -> 0.001%
    })
    assert.equal(shares.mode, 'folder')
    assert.equal(shares.recordedPct, 70)
    assert.equal(shares.otherPct, 30)
  })

  it('keeps a tiny non-zero segment visible with a 2% floor', () => {
    const shares = resolveVolumeStripShares({
      uploadDirBytes: 1024 ** 2,
      recordedBytes: 1,
      capacityBytes: null,
    })
    assert.equal(shares.mode, 'folder')
    assert.equal(shares.recordedPct, 2)
    assert.equal(shares.otherPct, 98)
  })

  it('returns zeroed folder mode when the volume is unreadable', () => {
    const shares = resolveVolumeStripShares({
      uploadDirBytes: null,
      recordedBytes: 5,
      capacityBytes: 100,
    })
    assert.equal(shares.mode, 'folder')
    assert.equal(shares.recordedPct, 0)
    assert.equal(shares.otherPct, 0)
  })

  it('switches mode exactly at the 1.5% visibility threshold', () => {
    const at = resolveVolumeStripShares({
      uploadDirBytes: 1.5,
      recordedBytes: 1,
      capacityBytes: 100,
    })
    assert.equal(at.mode, 'capacity')

    const below = resolveVolumeStripShares({
      uploadDirBytes: 1.49,
      recordedBytes: 1,
      capacityBytes: 100,
    })
    assert.equal(below.mode, 'folder')
  })

  it('never produces NaN or negative widths from bad numeric input', () => {
    const nanRecorded = resolveVolumeStripShares({
      uploadDirBytes: 2,
      recordedBytes: Number.NaN,
      capacityBytes: 100,
    })
    assert.ok(Number.isFinite(nanRecorded.recordedPct))
    assert.ok(Number.isFinite(nanRecorded.otherPct))
    assert.ok(nanRecorded.recordedPct >= 0 && nanRecorded.otherPct >= 0)

    const negativeRecorded = resolveVolumeStripShares({
      uploadDirBytes: 2,
      recordedBytes: -5,
      capacityBytes: 100,
    })
    assert.ok(negativeRecorded.recordedPct >= 0)
    assert.ok(negativeRecorded.otherPct >= 0)

    // recorded > used is clamped so capacity shares can never exceed 100%
    const oversized = resolveVolumeStripShares({
      uploadDirBytes: 10,
      recordedBytes: 50,
      capacityBytes: 100,
    })
    assert.ok(oversized.mode === 'capacity')
    assert.ok(oversized.recordedPct <= 100)
    assert.ok(oversized.otherPct <= 100)

    const zeroCapacity = resolveVolumeStripShares({
      uploadDirBytes: 10,
      recordedBytes: 5,
      capacityBytes: 0,
    })
    assert.equal(zeroCapacity.mode, 'folder')
  })
})

describe('filterRetentionRowsByUpdatedDate', () => {
  const rows = [
    { id: 'a', updatedAt: '2026-08-01T12:00:00.000Z' },
    { id: 'b', updatedAt: '2026-08-15T12:00:00.000Z' },
    { id: 'c', updatedAt: '2026-09-02T12:00:00.000Z' },
  ]

  it('returns all rows without filters', () => {
    assert.equal(filterRetentionRowsByUpdatedDate(rows).length, 3)
  })

  it('filters inclusive of both boundary days', () => {
    const onlyAugust = filterRetentionRowsByUpdatedDate(rows, '2026-08-01', '2026-08-31')
    assert.deepEqual(onlyAugust.map((row) => row.id), ['a', 'b'])
    const fromMid = filterRetentionRowsByUpdatedDate(rows, '2026-08-15', undefined)
    assert.deepEqual(fromMid.map((row) => row.id), ['b', 'c'])
    const toMid = filterRetentionRowsByUpdatedDate(rows, undefined, '2026-08-15')
    assert.deepEqual(toMid.map((row) => row.id), ['a', 'b'])
  })

  it('ignores invalid date strings instead of dropping every row', () => {
    assert.equal(filterRetentionRowsByUpdatedDate(rows, 'not-a-date', undefined).length, 3)
  })

  it('ignores calendar-invalid dates like 2026-02-30 instead of rolling them over', () => {
    const result = filterRetentionRowsByUpdatedDate(rows, '2026-02-30', undefined)
    assert.equal(result.length, 3)
    const toInvalid = filterRetentionRowsByUpdatedDate(rows, undefined, '2026-02-31')
    assert.equal(toInvalid.length, 3)
  })

  it('treats the boundary days as full local days regardless of UTC offset', () => {
    // Build timestamps relative to LOCAL midnight via the Date API so the
    // test is deterministic in any machine timezone: one instant just before
    // local midnight Aug 2, one just after.
    const justBeforeLocalMidnight = new Date(2026, 7, 2, 0, 0, 0, 0).getTime() - 1
    const justAfterLocalMidnight = new Date(2026, 7, 2, 0, 0, 0, 0).getTime() + 1
    const localRows = [
      { id: 'before', updatedAt: new Date(justBeforeLocalMidnight).toISOString() },
      { id: 'after', updatedAt: new Date(justAfterLocalMidnight).toISOString() },
    ]

    const toAug1 = filterRetentionRowsByUpdatedDate(localRows, undefined, '2026-08-01')
    assert.deepEqual(toAug1.map((row) => row.id), ['before'], 'instant before local Aug-2 midnight belongs to Aug 1')

    const fromAug2 = filterRetentionRowsByUpdatedDate(localRows, '2026-08-02', undefined)
    assert.deepEqual(fromAug2.map((row) => row.id), ['after'], 'instant at/after local Aug-2 midnight belongs to Aug 2')
  })
})

describe('buildStorageTrendChart', () => {
  const now = new Date('2026-03-15T12:00:00.000Z')

  it('builds a cumulative monthly actual series and fills empty months', () => {
    const chart = buildStorageTrendChart(
      [
        { fileSize: 100, createdAt: new Date('2026-01-10T00:00:00.000Z') },
        { fileSize: 50, createdAt: new Date('2026-03-02T00:00:00.000Z') },
      ],
      now,
      { monthsAhead: 2 }
    )

    const actuals = chart.filter((point) => point.actualBytes != null)
    assert.deepEqual(
      actuals.map((point) => ({ month: point.month, actualBytes: point.actualBytes })),
      [
        { month: '2026-01', actualBytes: 100 },
        { month: '2026-02', actualBytes: 100 },
        { month: '2026-03', actualBytes: 150 },
      ]
    )
  })

  it('projects a dashed estimate from recent growth without using plan dates', () => {
    const chart = buildStorageTrendChart(
      [
        { fileSize: 100, createdAt: new Date('2026-01-01T00:00:00.000Z') },
        { fileSize: 50, createdAt: new Date('2026-03-01T00:00:00.000Z') },
      ],
      now,
      { monthsAhead: 2 }
    )

    const march = chart.find((point) => point.month === '2026-03')
    const april = chart.find((point) => point.month === '2026-04')
    const may = chart.find((point) => point.month === '2026-05')
    assert.equal(march?.actualBytes, 150)
    assert.equal(march?.estimatedBytes, 150)
    assert.equal(april?.actualBytes, null)
    assert.equal(april?.estimatedBytes, 175)
    assert.equal(may?.estimatedBytes, 200)
    assert.equal(utcMonthKey(new Date('2026-04-30T00:00:00.000Z')), '2026-04')
  })

  it('feeds combined attachment and inline rows into the cumulative trend', () => {
    const chart = buildStorageTrendChart(
      toStorageRows(
        [row({ id: 'att', fileSize: 100, createdAt: new Date('2026-01-10T00:00:00.000Z') })],
        [inlineRow({ id: 'img', fileSize: 50, createdAt: new Date('2026-03-02T00:00:00.000Z') })]
      ),
      now,
      { monthsAhead: 1 }
    )

    const actuals = chart.filter((point) => point.actualBytes != null)
    assert.deepEqual(
      actuals.map((point) => ({ month: point.month, actualBytes: point.actualBytes })),
      [
        { month: '2026-01', actualBytes: 100 },
        { month: '2026-02', actualBytes: 100 },
        { month: '2026-03', actualBytes: 150 },
      ]
    )
  })

  it('returns no points when there are no attachments', () => {
    assert.deepEqual(buildStorageTrendChart(toStorageRows([], []), now), [])
  })
})

describe('estimateBytesAtMonth', () => {
  it('prefers estimated bytes and falls back to recorded bytes', () => {
    const points = [
      { month: '2026-08', label: 'Aug 2026', actualBytes: 100, estimatedBytes: 100 },
      { month: '2026-09', label: 'Sep 2026', actualBytes: null, estimatedBytes: 125 },
    ]
    assert.equal(estimateBytesAtMonth(points, '2026-08'), 100)
    assert.equal(estimateBytesAtMonth(points, '2026-09'), 125)
    assert.equal(estimateBytesAtMonth(points, '2026-10'), null)
  })
})

describe('isMissingStoragePlanTable', () => {
  it('detects Prisma P2021 for storage_plan_events and ignores other errors', () => {
    assert.equal(
      isMissingStoragePlanTable({
        code: 'P2021',
        meta: { table: 'public.storage_plan_events' },
      }),
      true
    )
    assert.equal(isMissingStoragePlanTable({ code: 'P2025' }), false)
    assert.equal(isMissingStoragePlanTable(new Error('boom')), false)
  })
})

describe('admin storage dashboard wiring', () => {
  it('adds a dedicated admin storage page that loads metrics as an admin', () => {
    assert.equal(existsSync('src/app/admin/storage/page.tsx'), true)
    const page = readFileSync('src/app/admin/storage/page.tsx', 'utf8')
    const action = readFileSync('src/server-actions/storage-dashboard.ts', 'utf8')
    assert.match(page, /getStorageDashboardData/)
    assert.match(page, /StorageDashboard/)
    assert.match(action, /requireAdmin/)
    assert.match(action, /measureUploadVolume/)
    assert.match(action, /aggregateStorageRows/)
    assert.match(action, /toStorageRows/)
    assert.match(action, /pg_database_size/)
  })

  it('loads inline image assets once and records them alongside attachments', () => {
    const action = readFileSync('src/server-actions/storage-dashboard.ts', 'utf8')
    assert.match(action, /inline_description_images\.findMany/)

    // The inline query selects asset columns only: expanding references would
    // duplicate a shared asset once per reference and double count its bytes.
    const inlineQuery = action.slice(
      action.indexOf('inline_description_images.findMany'),
      action.indexOf('})', action.indexOf('inline_description_images.findMany'))
    )
    assert.doesNotMatch(inlineQuery, /references/)

    // Combined rows feed totals and the trend series together.
    const combined = action.slice(action.indexOf('const storageRows = toStorageRows'))
    assert.match(combined, /aggregateStorageRows\(storageRows\)/)
    assert.match(combined, /buildStorageTrendChart\(storageRows/)
  })

  it('adds an inline image metric and owner label without changing attachment labels', () => {
    const dashboard = readFileSync('src/components/admin/storage-dashboard.tsx', 'utf8')
    assert.match(dashboard, /inline: 'Inline image'/)
    assert.match(dashboard, /Inline images/)
    assert.match(dashboard, /inlineImageBytes/)
    assert.match(dashboard, /inlineImageCount/)
    // Existing attachment labels and volume-strip math remain unchanged.
    assert.match(dashboard, /request: 'Request'/)
    assert.match(dashboard, /solution: 'Solution'/)
    assert.match(dashboard, /other: 'Other'/)
    assert.match(dashboard, /resolveVolumeStripShares/)
  })

  it('links the admin hub to storage and retention management', () => {
    const hub = readFileSync('src/app/admin/page.tsx', 'utf8')
    assert.match(hub, /\/admin\/storage/)
    assert.match(hub, /Data storage/)
    assert.match(hub, /\/admin\/retention/)
    assert.match(hub, /Request Retention/)
    assert.doesNotMatch(hub, /href="\/admin\/deleted-requests"/)
  })

  it('loads a trend chart and admin-managed plan date markers', () => {
    const action = readFileSync('src/server-actions/storage-dashboard.ts', 'utf8')
    const dashboard = readFileSync('src/components/admin/storage-dashboard.tsx', 'utf8')
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    assert.match(action, /buildStorageTrendChart/)
    assert.match(action, /storage_plan_events/)
    assert.match(action, /createStoragePlanEvent/)
    assert.match(action, /deleteStoragePlanEvent/)
    assert.match(dashboard, /StorageTrendChart/)
    const chart = readFileSync('src/components/admin/storage-trend-chart.tsx', 'utf8')
    assert.match(chart, /router\.refresh\(\)/)
    assert.match(schema, /model storage_plan_events/)
    assert.match(schema, /plannedDate/)
  })

  it('keeps the client trend chart off node:fs so webpack can build it', () => {
    const chart = readFileSync('src/components/admin/storage-trend-chart.tsx', 'utf8')
    const libImport = chart.match(/from '(@\/lib\/storage[^']+)'/)
    assert.ok(libImport, 'chart should import a storage helper module')
    const libPath = `${libImport[1].replace('@/', 'src/')}.ts`
    const lib = readFileSync(libPath, 'utf8')
    assert.doesNotMatch(lib, /node:fs/)
    assert.doesNotMatch(lib, /node:path/)
  })

  it('renders the volume strip through resolveVolumeStripShares with a fallback mode', () => {
    const dashboard = readFileSync('src/components/admin/storage-dashboard.tsx', 'utf8')
    assert.match(dashboard, /resolveVolumeStripShares/)
    assert.match(dashboard, /mode === 'capacity'/)
  })

  it('scopes the volume legend to the folder in folder mode', () => {
    const dashboard = readFileSync('src/components/admin/storage-dashboard.tsx', 'utf8')
    const legendStart = dashboard.indexOf('grid gap-2 text-sm sm:grid-cols-3')
    assert.notEqual(legendStart, -1, 'legend grid should exist')
    const legend = dashboard.slice(legendStart, dashboard.indexOf('</dl>', legendStart))

    // Exactly two unconditional rows (Recorded, Other); Free is gated.
    const rows = legend.match(/<dt className="text-muted-foreground">/g) ?? []
    const gated = legend.match(/\{showCapacity \? \([\s\S]*?\) : null\}/g) ?? []
    assert.equal(rows.length, 3, 'three legend rows total')
    assert.equal(gated.length, 1, 'exactly one gated legend row')
    const gatedBlock = gated[0]
    assert.match(gatedBlock, />Free</, 'the gated row is Free')
    assert.match(gatedBlock, /diskFreeBytes/, 'the gated row shows disk free bytes')
    // Ungated portion must not mention Free or disk free space
    const ungated = legend.replace(/\{showCapacity \? \([\s\S]*?\) : null\}/, '')
    assert.doesNotMatch(ungated, /Free/)
    assert.doesNotMatch(ungated, /diskFreeBytes/)
  })

  it('keeps each legend value adjacent to its label instead of far right', () => {
    const dashboard = readFileSync('src/components/admin/storage-dashboard.tsx', 'utf8')
    const legendStart = dashboard.indexOf('grid gap-2 text-sm sm:grid-cols-3')
    const legend = dashboard.slice(legendStart, dashboard.indexOf('</dl>', legendStart))
    assert.doesNotMatch(legend, /ml-auto/, 'values must not be pushed to the far edge of the card')
  })

  it('gives the retention list select-all and date filtering for batch actions', () => {
    const list = readFileSync('src/components/admin/retention-request-list.tsx', 'utf8')
    assert.match(list, /filterRetentionRowsByUpdatedDate/)
    assert.match(list, /Select all/)
    assert.match(list, /aria-label="Select all/)
    assert.match(list, /indeterminate/)
    assert.match(list, /date-from/)
    assert.match(list, /date-to/)
    assert.match(list, /Download selected/)
    assert.match(list, /Hard-delete selected/)
  })
})
