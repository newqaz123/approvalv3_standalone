'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import type { AnalyticsFilters, DateRangePreset } from '@/types/analytics'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface FilterControlsProps {
  filters: {
    departments: Array<{ id: string; name: string }>
    users: Array<{ id: string; name: string }>
  }
  onFilterChange: (filters: AnalyticsFilters) => void
}

/**
 * FilterControls component for analytics dashboard
 * Provides date range, department, status, and requester filters
 * Uses URL search params for persistent, shareable filter state
 */
export function FilterControls({ filters, onFilterChange }: FilterControlsProps) {
  const searchParams = useSearchParams()

  // Local state for filter values
  const [dateRange, setDateRange] = React.useState<DateRangePreset>(
    (searchParams.get('dateRange') as DateRangePreset) || '30days'
  )
  const [departmentId, setDepartmentId] = React.useState<string | undefined>(
    searchParams.get('departmentId') || undefined
  )
  const [status, setStatus] = React.useState<string | undefined>(
    searchParams.get('status') || undefined
  )
  const [requesterId, setRequesterId] = React.useState<string | undefined>(
    searchParams.get('requesterId') || undefined
  )

  // Status options based on workflow
  const statusOptions = [
    { value: 'ImprovementRequest', label: 'Improvement Request' },
    { value: 'SentToEngineer', label: 'Sent to Engineer' },
    { value: 'DesignCostEstimationApproval', label: 'Cost Estimation' },
    { value: 'SendBackToRequester', label: 'Sent Back to Requester' },
    { value: 'FinalApproval', label: 'Final Approval' },
    { value: 'Completed', label: 'Completed' },
    { value: 'Cancelled', label: 'Cancelled' },
  ]

  // Date range presets
  const dateRangePresets: Array<{ value: DateRangePreset; label: string }> = [
    { value: '7days', label: 'Last 7 days' },
    { value: '30days', label: 'Last 30 days' },
    { value: '90days', label: 'Last 90 days' },
    { value: 'all', label: 'All time' },
  ]

  /**
   * Apply filters and notify parent component
   */
  function handleApplyFilter() {
    const newFilters: AnalyticsFilters = {
      dateRange,
      ...(departmentId && { departmentId }),
      ...(status && { status }),
      ...(requesterId && { requesterId }),
    }
    onFilterChange(newFilters)
  }

  // Auto-apply filters when any filter changes
  React.useEffect(() => {
    handleApplyFilter()
  }, [dateRange, departmentId, status, requesterId])

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">Filters</h2>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Date Range Filter */}
          <div className="space-y-2">
            <label htmlFor="date-range" className="text-sm font-medium">
              Date Range
            </label>
            <Select
              value={dateRange}
              onValueChange={(value) => setDateRange(value as DateRangePreset)}
            >
              <SelectTrigger id="date-range">
                <SelectValue placeholder="Select date range" />
              </SelectTrigger>
              <SelectContent>
                {dateRangePresets.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Department Filter */}
          <div className="space-y-2">
            <label htmlFor="department" className="text-sm font-medium">
              Department
            </label>
            <Select
              value={departmentId || 'all'}
              onValueChange={(value) => setDepartmentId(value === 'all' ? undefined : value)}
            >
              <SelectTrigger id="department">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {filters.departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status Filter */}
          <div className="space-y-2">
            <label htmlFor="status" className="text-sm font-medium">
              Status
            </label>
            <Select
              value={status || 'all'}
              onValueChange={(value) => setStatus(value === 'all' ? undefined : value)}
            >
              <SelectTrigger id="status">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Requester Filter */}
          <div className="space-y-2">
            <label htmlFor="requester" className="text-sm font-medium">
              Requester
            </label>
            <Select
              value={requesterId || 'all'}
              onValueChange={(value) => setRequesterId(value === 'all' ? undefined : value)}
            >
              <SelectTrigger id="requester">
                <SelectValue placeholder="All Requesters" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Requesters</SelectItem>
                {filters.users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
