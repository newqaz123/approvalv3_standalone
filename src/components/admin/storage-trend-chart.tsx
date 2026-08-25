'use client'

import { useId, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createStoragePlanEvent,
  deleteStoragePlanEvent,
} from '@/server-actions/storage-dashboard'
import {
  estimateBytesAtMonth,
  formatStorageBytes,
  type StoragePlanEventView,
  type StorageTrendPoint,
} from '@/lib/storage-dashboard'

export function StorageTrendChart({
  points,
  planEvents,
}: {
  points: StorageTrendPoint[]
  planEvents: StoragePlanEventView[]
}) {
  const headingId = useId()
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [plannedDate, setPlannedDate] = useState('')
  const [pending, startTransition] = useTransition()

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      try {
        const result = await createStoragePlanEvent({ label, plannedDate })
        if (!result.success) {
          toast.error(result.error)
          return
        }
        toast.success('Plan date marked on the chart')
        setLabel('')
        setPlannedDate('')
        router.refresh()
      } catch {
        toast.error('Could not save the plan date')
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      try {
        const result = await deleteStoragePlanEvent(id)
        if (!result.success) {
          toast.error(result.error)
          return
        }
        toast.success('Plan date removed')
        router.refresh()
      } catch {
        toast.error('Could not remove the plan date')
      }
    })
  }

  return (
    <section className="rounded-lg border bg-card p-6" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-sm font-semibold">
            Storage trend
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Recorded attachment growth and a 12-month estimate. Plan dates are markers only — the line does not drop until you actually delete data.
          </p>
        </div>
      </div>

      {points.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No attachment history yet. The trend appears after files are uploaded.
        </p>
      ) : (
        <div className="mt-5">
          <p className="sr-only">
            Solid line is recorded attachment size by month. Dashed line is a linear estimate. Vertical markers are planned backup or delete dates.
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={points} margin={{ top: 24, right: 12, left: -12, bottom: 0 }} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval={points.length > 18 ? 2 : 0}
              />
              <YAxis
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => formatStorageBytes(value)}
              />
              <Tooltip
                formatter={(value: number | string) => formatStorageBytes(Number(value))}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Legend iconSize={8} wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
              <Line
                type="monotone"
                dataKey="actualBytes"
                name="Recorded"
                stroke="#1e293b"
                strokeWidth={2}
                connectNulls={false}
                dot={{ r: 3, strokeWidth: 2, fill: '#fff', stroke: '#1e293b' }}
                legendType="circle"
              />
              <Line
                type="monotone"
                dataKey="estimatedBytes"
                name="Estimate"
                stroke="#d97706"
                strokeWidth={2}
                strokeDasharray="8 4"
                connectNulls={false}
                dot={false}
                legendType="plainline"
              />
              {planEvents.map((event) => {
                const point = points.find((item) => item.month === event.month)
                if (!point) return null
                return (
                  <ReferenceLine
                    key={event.id}
                    x={point.label}
                    stroke="#0f172a"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    label={{
                      value: event.label,
                      position: 'top',
                      fill: '#0f172a',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  />
                )
              })}
            </LineChart>
          </ResponsiveContainer>
          <div className="sr-only">
            <table>
              <caption>Recorded and estimated attachment storage by month</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Recorded</th>
                  <th scope="col">Estimate</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.month}>
                    <th scope="row">{point.label}</th>
                    <td>{point.actualBytes == null ? '—' : formatStorageBytes(point.actualBytes)}</td>
                    <td>{point.estimatedBytes == null ? '—' : formatStorageBytes(point.estimatedBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <form onSubmit={handleCreate} className="mt-6 grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="plan-label">Plan label</Label>
          <Input
            id="plan-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="End of fiscal year"
            maxLength={80}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-date">Date</Label>
          <Input
            id="plan-date"
            type="date"
            value={plannedDate}
            onChange={(event) => setPlannedDate(event.target.value)}
            required
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Add date'}
        </Button>
      </form>

      {planEvents.length > 0 ? (
        <ul className="mt-4 divide-y rounded-md border">
          {planEvents.map((event) => {
            const estimated = estimateBytesAtMonth(points, event.month)
            return (
              <li key={event.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{event.label}</p>
                  <p className="font-mono text-xs tabular-nums text-muted-foreground">
                    {event.plannedDate}
                    {estimated != null ? ` · about ${formatStorageBytes(estimated)} on the estimate line` : ''}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => handleDelete(event.id)}
                >
                  Remove
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Add a date to mark it on the chart. Nothing is backed up or deleted automatically.
        </p>
      )}
    </section>
  )
}
