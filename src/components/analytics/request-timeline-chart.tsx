'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { TimelinePoint } from '@/types/analytics'

interface RequestTimelineChartProps {
  data: TimelinePoint[]
}

/**
 * Request Volume Timeline - Area chart showing created vs completed requests over time
 */
export function RequestTimelineChart({ data }: RequestTimelineChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">
        No timeline data available
      </div>
    )
  }

  // For 90-day views, show every 7th label; for 30-day, every 3rd; for 7-day, all
  const labelInterval = data.length > 60 ? 6 : data.length > 14 ? 2 : 0

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="date"
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
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
            fontSize: '12px',
          }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
        />
        <Area
          type="monotone"
          dataKey="created"
          stroke="#3b82f6"
          strokeWidth={2}
          fill="url(#colorCreated)"
          name="Created"
          dot={false}
          activeDot={{ r: 4, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff' }}
        />
        <Area
          type="monotone"
          dataKey="completed"
          stroke="#22c55e"
          strokeWidth={2}
          fill="url(#colorCompleted)"
          name="Completed"
          dot={false}
          activeDot={{ r: 4, stroke: '#22c55e', strokeWidth: 2, fill: '#fff' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
