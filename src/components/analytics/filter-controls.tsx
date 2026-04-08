'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import type { AnalyticsFilters, DateRangePreset } from '@/types/analytics'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { SlidersHorizontal, X } from 'lucide-react'

interface FilterControlsProps {
  filters: {
    departments: Array<{ id: string; name: string }>
    users: Array<{ id: string; name: string }>
  }
  onFilterChange: (filters: AnalyticsFilters) => void
}

/**
 * FilterControls component for analytics dashboard
 * Compact inline filter bar with date range tabs and dropdown filters
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
  const [showAdvanced, setShowAdvanced] = React.useState(
    !!(searchParams.get('departmentId') || searchParams.get('status') || searchParams.get('requesterId'))
  )

  // Status options based on workflow
  const statusOptions = [
    { value: 'ImprovementRequest', label: 'Improvement Request' },
    { value: 'SentToEngineer', label: 'Sent to Engineer' },
    { value: 'DesignCostEstimationApproval', label: 'Cost Estimation' },
    { value: 'SendBackToRequester', label: 'Sent Back' },
    { value: 'FinalApproval', label: 'Final Approval' },
    { value: 'Completed', label: 'Completed' },
    { value: 'Cancelled', label: 'Cancelled' },
  ]

  // Date range presets
  const dateRangePresets: Array<{ value: DateRangePreset; label: string }> = [
    { value: '7days', label: '7D' },
    { value: '30days', label: '30D' },
    { value: '90days', label: '90D' },
    { value: 'all', label: 'All' },
  ]

  const hasActiveFilters = !!(departmentId || status || requesterId)

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

  function clearFilters() {
    setDepartmentId(undefined)
    setStatus(undefined)
    setRequesterId(undefined)
  }

  // Auto-apply filters when any filter changes
  React.useEffect(() => {
    handleApplyFilter()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, departmentId, status, requesterId])

  return (
    <div className="space-y-3">
      {/* Primary row: date range tabs + filter toggle */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Date range pill tabs */}
        <div className="inline-flex items-center rounded-lg border bg-muted/50 p-1">
          {dateRangePresets.map((preset) => (
            <button
              key={preset.value}
              onClick={() => setDateRange(preset.value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                dateRange === preset.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Filter toggle button */}
        <Button
          variant={showAdvanced ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="gap-1.5"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {hasActiveFilters && (
            <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
              {[departmentId, status, requesterId].filter(Boolean).length}
            </span>
          )}
        </Button>

        {/* Clear filters button */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="gap-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {/* Advanced filters row (collapsible) */}
      {showAdvanced && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
          {/* Department Filter */}
          <Select
            value={departmentId || 'all'}
            onValueChange={(value) => setDepartmentId(value === 'all' ? undefined : value)}
          >
            <SelectTrigger className="w-[180px] bg-background">
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

          {/* Status Filter */}
          <Select
            value={status || 'all'}
            onValueChange={(value) => setStatus(value === 'all' ? undefined : value)}
          >
            <SelectTrigger className="w-[180px] bg-background">
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

          {/* Requester Filter */}
          <Select
            value={requesterId || 'all'}
            onValueChange={(value) => setRequesterId(value === 'all' ? undefined : value)}
          >
            <SelectTrigger className="w-[180px] bg-background">
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
      )}
    </div>
  )
}
