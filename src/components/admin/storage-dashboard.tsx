import type { ComponentType } from 'react'
import Link from 'next/link'
import {
  Database,
  FileStack,
  FileImage,
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
  type StorageOwner,
} from '@/lib/storage-dashboard'
import type { StorageDashboardData } from '@/server-actions/storage-dashboard'
import { StorageTrendChart } from '@/components/admin/storage-trend-chart'
import { StorageAlertCard } from '@/components/admin/storage-alert-card'
import { cn } from '@/lib/utils'
import type { MessageKey, Translator } from '@/lib/i18n/messages'

const OWNER_LABEL: Record<StorageOwner, MessageKey> = {
  request: 'admin.ownerRequest',
  solution: 'admin.ownerSolution',
  other: 'admin.ownerOther',
  inline: 'admin.ownerInline',
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

function VolumeStrip({ data, t }: { data: StorageDashboardData; t: Translator }) {
  const usedBytes = data.uploadDirBytes
  const recorded = data.recordedStorageBytes
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
            {t('admin.uploadVolume')}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            {usedBytes == null ? t('admin.folderUnread') : t('admin.volumeOnDisk', { size: formatStorageBytes(usedBytes) })}
          </h2>
        </div>
        {showCapacity ? (
          <p className="font-mono text-sm tabular-nums text-muted-foreground">
            {t('admin.volumeCapacity', { percent: usedPercent ?? 0, capacity: formatStorageBytes(capacity ?? 0), free: formatStorageBytes(data.diskFreeBytes ?? 0) })}
          </p>
        ) : null}
      </div>

      {data.uploadDirError ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('admin.volumeFileSizesFallback')}
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          <div
            className="flex h-4 overflow-hidden rounded-sm bg-stone-100"
            role="img"
            aria-label={
              showCapacity
                ? t('admin.volumePercent', { percent: usedPercent ?? 0 })
                : t('admin.uploadVolumeHelp')
            }
          >
            <span className="bg-slate-800" style={{ width: `${shares.recordedPct}%` }} />
            <span className="bg-amber-500" style={{ width: `${shares.otherPct}%` }} />
          </div>
          {!showCapacity ? (
            <p className="text-xs text-muted-foreground">
              {t('admin.volumeShare', { share: usedPercent == null ? t('admin.unknownVolumeShare') : `${usedPercent}%` })}
            </p>
          ) : null}
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-slate-800" />
              <dt className="text-muted-foreground">{t('admin.recordedFiles')}</dt>
              <dd className="font-mono tabular-nums">{formatStorageBytes(recorded)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-amber-500" />
              <dt className="text-muted-foreground">{t('admin.otherOnDisk')}</dt>
              <dd className="font-mono tabular-nums">{formatStorageBytes(otherOnDisk)}</dd>
            </div>
            {showCapacity ? (
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-stone-200" />
                <dt className="text-muted-foreground">{t('admin.freeSpace')}</dt>
                <dd className="font-mono tabular-nums">
                  {data.diskFreeBytes == null ? '—' : formatStorageBytes(data.diskFreeBytes)}
                </dd>
              </div>
            ) : null}
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
  t,
}: {
  label: string
  bytes: number
  count: number
  totalBytes: number
  t: Translator
  tone: 'slate' | 'amber' | 'emerald'
}) {
  const percent = totalBytes > 0 ? Math.round((bytes / totalBytes) * 100) : 0

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p className="font-medium">{label}</p>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {t('admin.fileShare', { size: formatStorageBytes(bytes), count, percent })}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-sm bg-stone-100">
        <div
          className={cn(
            'h-full',
            tone === 'slate'
              ? 'bg-slate-800'
              : tone === 'amber'
                ? 'bg-amber-500'
                : 'bg-emerald-600'
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

export function StorageDashboard({ data, t }: { data: StorageDashboardData; t: Translator }) {
  const splitTotal =
    data.requestAttachmentBytes + data.solutionAttachmentBytes + data.inlineImageBytes

  return (
    <div className="space-y-6">
      <VolumeStrip data={data} t={t} />

      <StorageAlertCard
        thresholdPct={data.alertThresholdPct}
        usedPercent={diskUsedPercent(
          data.diskTotalBytes != null && data.diskFreeBytes != null
            ? Math.max(0, data.diskTotalBytes - data.diskFreeBytes)
            : null,
          data.diskTotalBytes
        )}
        lastAlertOn={data.lastStorageAlertOn}
      />

      <StorageTrendChart points={data.trend} planEvents={data.planEvents} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t('admin.uploadsOnDisk')}
          value={data.uploadDirBytes == null ? '—' : formatStorageBytes(data.uploadDirBytes)}
          hint={t('admin.actualPrivateFiles')}
          icon={HardDrive}
        />
        <MetricCard
          label={t('admin.recordedFiles')}
          value={formatStorageBytes(data.recordedStorageBytes)}
          hint={t('admin.recordedFileSizes')}
          icon={HardDriveDownload}
        />
        <MetricCard
          label={t('admin.database')}
          value={data.databaseBytes == null ? '—' : formatStorageBytes(data.databaseBytes)}
          hint={t('admin.postgresSize')}
          icon={Database}
        />
        <MetricCard
          label={t('admin.attachments')}
          value={String(data.attachmentCount)}
          hint={t('admin.combinedAttachments')}
          icon={Files}
        />
        <MetricCard
          label={t('admin.inlineImages')}
          value={formatStorageBytes(data.inlineImageBytes)}
          hint={t(data.inlineImageCount === 1 ? 'admin.inlineImageHintOne' : 'admin.inlineImageHintMany', { count: data.inlineImageCount })}
          icon={FileImage}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <section className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileStack className="h-4 w-4" />
            <h2 className="text-sm font-semibold text-foreground">{t('admin.whereFilesLive')}</h2>
          </div>
          <div className="mt-5 space-y-4">
            <ShareBar
              label={t('admin.requestFiles')}
              bytes={data.requestAttachmentBytes}
              count={data.requestAttachmentCount}
              totalBytes={splitTotal}
              t={t}
              tone="slate"
            />
            <ShareBar
              label={t('admin.solutionFiles')}
              bytes={data.solutionAttachmentBytes}
              count={data.solutionAttachmentCount}
              totalBytes={splitTotal}
              t={t}
              tone="amber"
            />
            <ShareBar
              label={t('admin.inlineImages')}
              bytes={data.inlineImageBytes}
              count={data.inlineImageCount}
              totalBytes={splitTotal}
              t={t}
              tone="emerald"
            />
          </div>
        </section>

        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-sm font-semibold">{t('admin.largestFiles')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('admin.largestFilesHelp')}
          </p>
          {data.largestFiles.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">{t('admin.noStoredFiles')}</p>
          ) : (
            <div className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin.file')}</TableHead>
                    <TableHead>{t('admin.fileKind')}</TableHead>
                    <TableHead className="text-right">{t('admin.fileSize')}</TableHead>
                    <TableHead className="text-right">{t('admin.added')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.largestFiles.map((file) => (
                    <TableRow key={file.id}>
                      <TableCell className="max-w-[16rem] truncate font-medium">
                        {file.fileName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{t(OWNER_LABEL[file.owner])}</Badge>
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
        {t('admin.freeSpaceQuestion')}{' '}
        <Link href="/admin/retention" className="font-medium text-foreground underline underline-offset-4">
          {t('admin.retention')}
        </Link>{' '}
        {t('admin.canArchiveOldRequests')}
      </p>
    </div>
  )
}
