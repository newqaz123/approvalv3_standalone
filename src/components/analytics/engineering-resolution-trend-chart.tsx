'use client'

import { useTranslations } from '@/lib/i18n/client'
import { useId } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { EngineeringResolutionTrendPoint } from '@/types/analytics'

interface EngineeringResolutionTrendChartProps {
  data: EngineeringResolutionTrendPoint[]
}

/**
 * Engineering Resolution Trend - two-line chart of open engineering backlog
 * at period end versus requests resolved by Engineering during each period.
 *
 * Accessibility: the Recharts accessibility layer provides keyboard
 * navigation, an accessible name/description is announced for screen
 * readers, and a visually hidden table mirrors every period's values so the
 * data is consumable without the chart. For sighted low-vision users the
 * resolved series is additionally encoded non-color: a darker green stroke
 * (>=3:1 against the card background), a dashed line versus the solid
 * unresolved line, and a distinct dashed-line legend marker.
 */
export function EngineeringResolutionTrendChart({ data }: EngineeringResolutionTrendChartProps) {
  const t = useTranslations()
  const headingId = useId()
  function seriesLabel(dataKey: unknown, fallback: string | number) {
    if (dataKey === 'engineeringUnresolved' || dataKey === 'resolvedByEngineering') {
      return t(`analytics.metric.${dataKey}`)
    }
    return fallback
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">
        {t('analytics.trendEmpty')}
      </div>
    )
  }

  // Sparse labels for long histories (monthly "all" ranges can span years);
  // short daily/weekly ranges show every period label.
  const labelInterval = data.length > 60 ? 6 : data.length > 14 ? 2 : 0

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="sr-only">
        {t('analytics.trend')}
      </h3>
      <p className="sr-only">
        {t('analytics.trendAccessibleIntro')}
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="period"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval={labelInterval}
          />
          <YAxis
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            formatter={(value, name, entry) => [value, seriesLabel(entry.dataKey, name)]}
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
              fontSize: '12px',
            }}
          />
          <Legend
            formatter={(value, entry) => seriesLabel(entry.dataKey, value)}
            iconSize={8}
            wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
          />
          <Line
            type="monotone"
            dataKey="engineeringUnresolved"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 2, fill: '#fff', stroke: '#3b82f6' }}
            activeDot={{ r: 4, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff' }}
            legendType="circle"
          />
          {/* Resolved series — sighted low-vision distinction: darker green
              (#15803d >=3:1 against light/dark card backgrounds) and a
              dashed stroke; the legend plainline marker echoes the dash so
              the series differ by shape, not color alone. */}
          <Line
            type="monotone"
            dataKey="resolvedByEngineering"
            stroke="#15803d"
            strokeWidth={2}
            strokeDasharray="8 4"
            dot={{ r: 3, strokeWidth: 2, fill: '#fff', stroke: '#15803d' }}
            activeDot={{ r: 4, stroke: '#15803d', strokeWidth: 2, fill: '#fff' }}
            legendType="plainline"
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="sr-only">
        <table>
          <caption>{t('analytics.trendCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('analytics.period')}</th>
              <th scope="col">{t('analytics.metric.engineeringUnresolved')}</th>
              <th scope="col">{t('analytics.metric.resolvedByEngineering')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.period}>
                <th scope="row">{point.period}</th>
                <td>{point.engineeringUnresolved}</td>
                <td>{point.resolvedByEngineering}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
