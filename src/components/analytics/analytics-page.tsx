'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { AnalyticsData, AnalyticsFilters } from '@/types/analytics'
import { getAnalyticsData } from '@/server-actions/analytics'
import { SummaryCards } from '@/components/analytics/summary-cards'
import { FilterControls } from '@/components/analytics/filter-controls'
import { BottleneckAlerts } from '@/components/analytics/bottleneck-alerts'
import { Skeleton } from '@/components/ui/skeleton'
import { BarChart3, Building2, Clock, Activity, AlertTriangle, Wrench, Flag } from 'lucide-react'
import { cn } from '@/lib/utils'

// Dynamic imports for heavy chart components
const RequestTimelineChart = dynamic(
  () => import('@/components/analytics/request-timeline-chart').then(mod => ({ default: mod.RequestTimelineChart })),
  { loading: () => <Skeleton className="h-[280px] w-full rounded-lg" /> }
)

const WorkflowPipelineChart = dynamic(
  () => import('@/components/analytics/workflow-pipeline-chart').then(mod => ({ default: mod.WorkflowPipelineChart })),
  { loading: () => <Skeleton className="h-[280px] w-full rounded-lg" /> }
)

const DepartmentBreakdownChart = dynamic(
  () => import('@/components/analytics/department-breakdown-chart').then(mod => ({ default: mod.DepartmentBreakdownChart })),
  { loading: () => <Skeleton className="h-[200px] w-full rounded-lg" /> }
)

const TimeMetricsChart = dynamic(
  () => import('@/components/analytics/time-metrics-chart').then(mod => ({ default: mod.TimeMetricsChart })),
  { loading: () => <Skeleton className="h-[200px] w-full rounded-lg" /> }
)

const EngineeringMetricsPanel = dynamic(
  () => import('@/components/analytics/engineering-metrics').then(mod => ({ default: mod.EngineeringMetricsPanel })),
  { loading: () => <Skeleton className="h-[300px] w-full rounded-lg" /> }
)

const DepartmentSpeedChart = dynamic(
  () => import('@/components/analytics/department-speed-chart').then(mod => ({ default: mod.DepartmentSpeedChart })),
  { loading: () => <Skeleton className="h-[250px] w-full rounded-lg" /> }
)

interface AnalyticsPageProps {
  initialData: AnalyticsData
  filters: {
    departments: Array<{ id: string; name: string }>
    users: Array<{ id: string; name: string }>
  }
  userId: string
}

/**
 * Section card wrapper with consistent styling
 */
function SectionCard({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border bg-card shadow-sm', className)}>
      <div className="flex items-center gap-2 border-b px-5 py-3.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

export function AnalyticsPage({ initialData, filters, userId }: AnalyticsPageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState(initialData)
  const [isLoading, setIsLoading] = useState(false)
  const [isInitialLoad, setIsInitialLoad] = useState(true)

  // Mark initial load as complete after first render
  useEffect(() => {
    setIsInitialLoad(false)
  }, [])

  // Redirect if not authenticated
  if (!userId) {
    router.push('/sign-in')
    return null
  }

  /**
   * Handle filter changes
   * Fetches new analytics data based on applied filters
   * Updates URL search params for persistent, shareable state
   */
  async function handleFilterChange(newFilters: AnalyticsFilters) {
    setIsLoading(true)
    try {
      const newData = await getAnalyticsData(newFilters)
      setData(newData)

      // Update URL with new filter params
      const params = new URLSearchParams()
      params.set('dateRange', newFilters.dateRange)
      if (newFilters.departmentId) {
        params.set('departmentId', newFilters.departmentId)
      }
      if (newFilters.status) {
        params.set('status', newFilters.status)
      }
      if (newFilters.requesterId) {
        params.set('requesterId', newFilters.requesterId)
      }

      router.push(`/analytics?${params.toString()}`)
    } catch (error) {
      console.error('Failed to fetch analytics data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const showSkeleton = isLoading && !isInitialLoad

  return (
    <div className="container max-w-7xl py-6 space-y-6">
      {/* Page header + filters */}
      <div className="space-y-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Monitor approval workflows, track performance, and identify bottlenecks.
          </p>
        </div>
        <FilterControls filters={filters} onFilterChange={handleFilterChange} />
      </div>

      {/* Loading indicator */}
      {showSkeleton && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Updating analytics...
        </div>
      )}

      {/* Main content */}
      {!data ? (
        <div className="text-center py-12 text-muted-foreground">
          No analytics data available
        </div>
      ) : (
        <>
          {/* Row 1: KPI Summary Cards */}
          {showSkeleton ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-[120px] rounded-xl" />
              ))}
            </div>
          ) : (
            <SummaryCards summary={data.summary} trends={data.trends} />
          )}

          {/* Row 2: Timeline (wide) + Department Breakdown (side) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <SectionCard
              title="Request Volume"
              icon={Activity}
              className="lg:col-span-2"
            >
              {showSkeleton ? (
                <Skeleton className="h-[280px] w-full rounded-lg" />
              ) : (
                <RequestTimelineChart data={data.timeline} />
              )}
            </SectionCard>

            <SectionCard title="By Department" icon={Building2}>
              {showSkeleton ? (
                <Skeleton className="h-[200px] w-full rounded-lg" />
              ) : (
                <DepartmentBreakdownChart data={data.departments} />
              )}
            </SectionCard>
          </div>

          {/* Row 3: Engineering KPIs (wide) + Approval Speed (side) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <SectionCard
              title="Engineering Work Time"
              icon={Wrench}
              className="lg:col-span-2"
            >
              {showSkeleton ? (
                <Skeleton className="h-[300px] w-full rounded-lg" />
              ) : (
                <EngineeringMetricsPanel data={data.engineeringMetrics} />
              )}
            </SectionCard>

            <SectionCard title="Approval Speed" icon={Clock}>
              {showSkeleton ? (
                <Skeleton className="h-[200px] w-full rounded-lg" />
              ) : (
                <TimeMetricsChart data={data.timeMetrics} />
              )}
            </SectionCard>
          </div>

          {/* Row 4: Department Speed Racing Track */}
          <SectionCard title="Approval Speed by Department" icon={Flag}>
            {showSkeleton ? (
              <Skeleton className="h-[250px] w-full rounded-lg" />
            ) : (
              <DepartmentSpeedChart data={data.departmentSpeeds} />
            )}
          </SectionCard>

          {/* Row 5: Workflow Pipeline */}
          <SectionCard title="Workflow Pipeline" icon={BarChart3}>
            {showSkeleton ? (
              <Skeleton className="h-[280px] w-full rounded-lg" />
            ) : (
              <WorkflowPipelineChart data={data.pipeline} />
            )}
          </SectionCard>

          {/* Row 6: Bottleneck Alerts */}
          <SectionCard title="Bottleneck Alerts" icon={AlertTriangle}>
            {showSkeleton ? (
              <Skeleton className="h-[80px] w-full rounded-lg" />
            ) : (
              <BottleneckAlerts data={data.bottlenecks} />
            )}
          </SectionCard>
        </>
      )}
    </div>
  )
}
