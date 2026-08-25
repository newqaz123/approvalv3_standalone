import type { ComponentType } from 'react'
import Link from 'next/link'
import {
  Database,
  FileStack,
  Files,
  HardDrive,
  HardDriveDownload,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  diskUsedPercent,
  formatStorageBytes,
  resolveVolumeStripShares,
  type AttachmentOwner,
} from '@/lib/storage-dashboard'
import type { StorageDashboardData } from '@/server-actions/storage-dashboard'
import { StorageTrendChart } from '@/components/admin/storage-trend-chart'
import { cn } from '@/lib/utils'

const OWNER_LABEL: Record<AttachmentOwner, string> = {
  request: 'Request',
  solution: 'Solution',
  other: 'Other',
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: string
  hint?: string
  icon: ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <p className="text-xs font-medium uppercase tracking-[0.14em]">{label}</p>
      </div>
      <p className="mt-3 font-mono text-3xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function VolumeStrip({ data }: { data: StorageDashboardData }) {
  const usedBytes = data.uploadDirBytes
  const recorded = data.recordedAttachmentBytes
  const otherOnDisk =
    usedBytes == null ? 0 : Math.max(0, usedBytes - recorded)
  const capacity = data.diskTotalBytes
  const usedPercent = diskUsedPercent(usedBytes, capacity)

  const shares = resolveVolumeStripShares({
    uploadDirBytes: usedBytes,
    recordedBytes: recorded,
    capacityBytes: capacity,
  })
  const showCapacity = shares.mode === 'capacity'

  return (
    <section className="rounded-lg border bg-card p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Upload volume
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            {usedBytes == null ? 'Folder unread' : `${formatStorageBytes(usedBytes)} on disk`}
          </h2>
        </div>
        {showCapacity ? (
          <p className="font-mono text-sm tabular-nums text-muted-foreground">
            {usedPercent ?? 0}% of {formatStorageBytes(capacity ?? 0)} · {formatStorageBytes(data.diskFreeBytes ?? 0)} free
          </p>
        ) : null}
      </div>

      {data.uploadDirError ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {data.uploadDirError}. Showing recorded file sizes from the database.
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          <div
            className="flex h-4 overflow-hidden rounded-sm bg-stone-100"
            role="img"
            aria-label={
              showCapacity
                ? `Upload volume ${usedPercent} percent full`
                : 'Share of files on the upload disk'
            }
          >
            <span className="bg-slate-800" style={{ width: `${shares.recordedPct}%` }} />
            <span className="bg-amber-500" style={{ width: `${shares.otherPct}%` }} />
          </div>
          {!showCapacity ? (
            <p className="text-xs text-muted-foreground">
              Uploads use {usedPercent == null ? 'an unknown share' : `${usedPercent}%`} of this disk —
              the bar above shows the split inside the uploads folder so it stays visible.
            </p>
          ) : null}
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-slate-800" />
              <dt className="text-muted-foreground">Recorded files</dt>
              <dd className="ml-auto font-mono tabular-nums">{formatStorageBytes(recorded)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-amber-500" />
              <dt className="text-muted-foreground">Other on disk</dt>
              <dd className="ml-auto font-mono tabular-nums">{formatStorageBytes(otherOnDisk)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-stone-200" />
              <dt className="text-muted-foreground">Free</dt>
              <dd className="ml-auto font-mono tabular-nums">
                {data.diskFreeBytes == null ? '—' : formatStorageBytes(data.diskFreeBytes)}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  )
}

function ShareBar({
  label,
  bytes,
  count,
  totalBytes,
  tone,
}: {
  label: string
  bytes: number
  count: number
  totalBytes: number
  tone: 'slate' | 'amber'
}) {
  const percent = totalBytes > 0 ? Math.round((bytes / totalBytes) * 100) : 0

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p className="font-medium">{label}</p>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatStorageBytes(bytes)} · {count} files · {percent}%
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-sm bg-stone-100">
        <div
          className={cn('h-full', tone === 'slate' ? 'bg-slate-800' : 'bg-amber-500')}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

export function StorageDashboard({ data }: { data: StorageDashboardData }) {
  const splitTotal = data.requestAttachmentBytes + data.solutionAttachmentBytes

  return (
    <div className="space-y-6">
      <VolumeStrip data={data} />

      <StorageTrendChart points={data.trend} planEvents={data.planEvents} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Uploads on disk"
          value={data.uploadDirBytes == null ? '—' : formatStorageBytes(data.uploadDirBytes)}
          hint="Actual files in the private uploads folder"
          icon={HardDrive}
        />
        <MetricCard
          label="Recorded files"
          value={formatStorageBytes(data.recordedAttachmentBytes)}
          hint="Sum of attachment sizes in the database"
          icon={HardDriveDownload}
        />
        <MetricCard
          label="Database"
          value={data.databaseBytes == null ? '—' : formatStorageBytes(data.databaseBytes)}
          hint="PostgreSQL database size"
          icon={Database}
        />
        <MetricCard
          label="Attachments"
          value={String(data.attachmentCount)}
          hint="Request and solution files combined"
          icon={Files}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <section className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileStack className="h-4 w-4" />
            <h2 className="text-sm font-semibold text-foreground">Where files live</h2>
          </div>
          <div className="mt-5 space-y-4">
            <ShareBar
              label="Request files"
              bytes={data.requestAttachmentBytes}
              count={data.requestAttachmentCount}
              totalBytes={splitTotal}
              tone="slate"
            />
            <ShareBar
              label="Solution files"
              bytes={data.solutionAttachmentBytes}
              count={data.solutionAttachmentCount}
              totalBytes={splitTotal}
              tone="amber"
            />
          </div>
        </section>

        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-sm font-semibold">Largest files</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Top 10 by recorded size. Nothing here can be deleted.
          </p>
          {data.largestFiles.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">No attachments stored yet.</p>
          ) : (
            <div className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="text-right">Added</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.largestFiles.map((file) => (
                    <TableRow key={file.id}>
                      <TableCell className="max-w-[16rem] truncate font-medium">
                        {file.fileName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{OWNER_LABEL[file.owner]}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatStorageBytes(file.fileSize)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {file.createdAt.toLocaleDateString('en-US', {
                          month: '2-digit',
                          day: '2-digit',
                          year: 'numeric',
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>

      <p className="text-sm text-muted-foreground">
        Need to free space?{' '}
        <Link href="/admin/retention" className="font-medium text-foreground underline underline-offset-4">
          Request Retention
        </Link>{' '}
        can archive or permanently delete old requests.
      </p>
    </div>
  )
}
