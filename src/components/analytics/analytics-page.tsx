'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { AnalyticsData, AnalyticsFilters } from '@/types/analytics'
import { getAnalyticsData } from '@/server-actions/analytics'
import { SummaryCards } from '@/components/analytics/summary-cards'
import { FilterControls } from '@/components/analytics/filter-controls'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// Dynamic imports for heavy chart components
const WorkflowPipelineChart = dynamic(
  () => import('@/components/analytics/workflow-pipeline-chart').then(mod => ({ default: mod.WorkflowPipelineChart })),
  { loading: () => <Skeleton className="h-[300px] w-full" /> }
)

const DepartmentBreakdownChart = dynamic(
  () => import('@/components/analytics/department-breakdown-chart').then(mod => ({ default: mod.DepartmentBreakdownChart })),
  { loading: () => <Skeleton className="h-[300px] w-full" /> }
)

const TimeMetricsChart = dynamic(
  () => import('@/components/analytics/time-metrics-chart').then(mod => ({ default: mod.TimeMetricsChart })),
  { loading: () => <Skeleton className="h-[300px] w-full" /> }
)

interface AnalyticsPageProps {
  initialData: AnalyticsData
  filters: {
    departments: Array<{ id: string; name: string }>
    users: Array<{ id: string; name: string }>
  }
  userId: string
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

  return (
    <div className="container py-6">
      <h1 className="text-2xl font-bold mb-6">Analytics</h1>

      {/* Filter Controls */}
      <div className="mb-6">
        <FilterControls filters={filters} onFilterChange={handleFilterChange} />
      </div>

      {/* Loading state for filter changes */}
      {isLoading && !isInitialLoad && data && (
        <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Updating charts...
        </div>
      )}

      {/* Conditional rendering for loading state */}
      {isLoading && !data ? (
        <div className="text-center py-12">Loading analytics...</div>
      ) : data ? (
        <>
          {/* Summary cards component with skeleton during loading */}
          {isLoading && !isInitialLoad ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <Card key={i}>
                  <CardHeader className="pb-2">
                    <Skeleton className="h-4 w-24" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-8 w-16" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <SummaryCards summary={data.summary} />
          )}

          {/* Workflow Pipeline Chart */}
          <Card className="mt-6">
            <CardHeader>
              <h2 className="text-lg font-semibold">Workflow Pipeline</h2>
            </CardHeader>
            <CardContent>
              {isLoading && !isInitialLoad ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <WorkflowPipelineChart data={data.pipeline} />
              )}
            </CardContent>
          </Card>

          {/* Department Breakdown Chart */}
          <Card className="mt-6">
            <CardHeader>
              <h2 className="text-lg font-semibold">Department Breakdown</h2>
            </CardHeader>
            <CardContent>
              {isLoading && !isInitialLoad ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <DepartmentBreakdownChart data={data.departments} />
              )}
            </CardContent>
          </Card>

          {/* Time Metrics Chart */}
          <Card className="mt-6">
            <CardHeader>
              <h2 className="text-lg font-semibold">Time Metrics</h2>
            </CardHeader>
            <CardContent>
              {isLoading && !isInitialLoad ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <TimeMetricsChart data={data.timeMetrics} />
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          No analytics data available
        </div>
      )}
    </div>
  )
}
