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
import type { WorkflowPipelineSegment } from '@/types/analytics'
import { STATUS_COLORS } from './chart-utils'

interface WorkflowPipelineChartProps {
  /** Pipeline data showing status breakdown at each workflow step */
  data: WorkflowPipelineSegment[]
}

/**
 * WorkflowPipelineChart displays request distribution across workflow steps
 * Shows stacked bars with pending/approved/rejected segments for each status
 */
export function WorkflowPipelineChart({ data }: WorkflowPipelineChartProps) {
  // Handle empty data
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground">
        No data available
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={data}
        margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="step"
          className="text-sm"
          tick={{ fill: 'hsl(var(--muted-foreground))' }}
        />
        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--background))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
          }}
        />
        <Legend />
        <Bar
          dataKey="approved"
          stackId="status"
          fill={STATUS_COLORS.approved}
          name="Approved"
        />
        <Bar
          dataKey="pending"
          stackId="status"
          fill={STATUS_COLORS.pending}
          name="Pending"
        />
        <Bar
          dataKey="rejected"
          stackId="status"
          fill={STATUS_COLORS.rejected}
          name="Rejected"
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
