'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { TimeMetrics } from '@/types/analytics'

interface TimeMetricsChartProps {
  data: TimeMetrics
}

/**
 * Time Metrics Chart Component
 * Displays approval time statistics (average, median, min, max) as a grouped bar chart
 */
export function TimeMetricsChart({ data }: TimeMetricsChartProps) {
  // Check if data is empty (all zeros)
  const isEmptyData =
    data.avgPerRequest === 0 &&
    data.avgPerApprovalLevel === 0 &&
    data.medianPerRequest === 0 &&
    data.minPerRequest === 0 &&
    data.maxPerRequest === 0

  if (isEmptyData) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No time data available
      </div>
    )
  }

  // Transform data for Recharts
  // Create a single bar chart with 4 bars for request-based metrics
  const chartData = [
    {
      name: 'Average',
      'Per Request': data.avgPerRequest,
      'Per Approval Level': data.avgPerApprovalLevel,
    },
    {
      name: 'Median',
      'Per Request': data.medianPerRequest,
      'Per Approval Level': 0, // Not applicable for median
    },
    {
      name: 'Minimum',
      'Per Request': data.minPerRequest,
      'Per Approval Level': 0, // Not applicable for minimum
    },
    {
      name: 'Maximum',
      'Per Request': data.maxPerRequest,
      'Per Approval Level': 0, // Not applicable for maximum
    },
  ]

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} margin={{ top: 20, right: 30, left: 40, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis
          label={{
            value: 'Hours',
            angle: -90,
            position: 'insideLeft',
            style: { textAnchor: 'middle' },
          }}
        />
        <Tooltip formatter={(value: number) => [`${value.toFixed(1)} hours`, '']} />
        <Legend />
        <Bar dataKey="Per Request" fill="#3b82f6" name="Per Request" />
        <Bar dataKey="Per Approval Level" fill="#10b981" name="Per Approval Level" />
      </BarChart>
    </ResponsiveContainer>
  )
}
