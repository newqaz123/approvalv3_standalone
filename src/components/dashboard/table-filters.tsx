'use client'

import { useEffect, useState } from 'react'
import { RequestStatus } from '@prisma/client'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface DashboardFilters {
  department?: string
  statuses?: string[]
  dateFrom?: string
  dateTo?: string
  search?: string
  wrStatus?: 'all' | 'not-received' | 'received'
}

export const DEFAULT_WR_FILTER = 'all' as const

interface TableFiltersProps {
  departments: Array<{ id: string; name: string }>
  onFilterChange: (filters: DashboardFilters) => void
  initialFilters?: DashboardFilters
}

const formatStatusLabel = (status: string): string => {
  const statusMap: Record<string, string> = {
    [RequestStatus.ImprovementRequest]: 'Improvement Request',
    [RequestStatus.SentToEngineer]: 'Sent to Engineer',
    [RequestStatus.DesignCostEstimationApproval]: 'Design/Cost Estimation',
    [RequestStatus.SendBackToRequester]: 'Send Back to Requester',
    [RequestStatus.FinalApproval]: 'Final Approval',
    [RequestStatus.Completed]: 'Completed',
    [RequestStatus.Cancelled]: 'Cancelled',
  }
  return statusMap[status] || status
}

const ALL_STATUSES = Object.values(RequestStatus)

export function TableFilters({ departments, onFilterChange, initialFilters }: TableFiltersProps) {
  const [filters, setFilters] = useState<DashboardFilters>(initialFilters || { wrStatus: DEFAULT_WR_FILTER })

  useEffect(() => {
    if (initialFilters) {
      setFilters(initialFilters)
    }
  }, [initialFilters])

  const updateFilter = (key: keyof DashboardFilters, value: string | string[] | undefined) => {
    const newFilters = { ...filters, [key]: value }
    setFilters(newFilters)
    onFilterChange(newFilters)
  }

  const updateStatusFilter = (status: string, checked: boolean) => {
    const currentStatuses = filters.statuses || []
    const statuses = checked
      ? [...currentStatuses, status]
      : currentStatuses.filter((item) => item !== status)

    updateFilter('statuses', statuses.length > 0 ? statuses : undefined)
  }

  const clearFilters = () => {
    const defaultFilters = { wrStatus: DEFAULT_WR_FILTER }
    setFilters(defaultFilters)
    onFilterChange(defaultFilters)
  }

  const toggleNoWrFilter = () => {
    updateFilter('wrStatus', filters.wrStatus === 'not-received' ? DEFAULT_WR_FILTER : 'not-received')
  }

  const hasActiveFilters = Object.entries(filters).some(([key, value]) => {
    if (key === 'wrStatus' && value === DEFAULT_WR_FILTER) return false
    return value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)
  })

  const showOnlyNoWr = filters.wrStatus === 'not-received'

  return (
    <div className="space-y-3 rounded-lg border bg-gray-50 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Filters</h3>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-8 text-xs"
          >
            <X className="h-3 w-3 mr-1" />
            Clear All
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-[minmax(16rem,1.4fr)_repeat(4,minmax(0,1fr))]">
        <div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search title..."
              value={filters.search || ''}
              onChange={(e) => updateFilter('search', e.target.value)}
              className="h-10 min-h-10 pl-9"
            />
          </div>
        </div>

        <div>
          <Select
            value={filters.department || 'all'}
            onValueChange={(value) => updateFilter('department', value === 'all' ? undefined : value)}
          >
            <SelectTrigger className="h-10 min-h-10">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((dept) => (
                <SelectItem key={dept.id} value={dept.id}>
                  {dept.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Input
            id="dashboard-date-from"
            type={filters.dateFrom ? 'date' : 'text'}
            placeholder="From date"
            aria-label="From date"
            value={filters.dateFrom || ''}
            onFocus={(e) => {
              e.currentTarget.type = 'date'
              e.currentTarget.showPicker?.()
            }}
            onBlur={(e) => {
              if (!e.currentTarget.value) e.currentTarget.type = 'text'
            }}
            onChange={(e) => updateFilter('dateFrom', e.target.value)}
            className="h-10 min-h-10"
          />
        </div>

        <div>
          <Input
            id="dashboard-date-to"
            type={filters.dateTo ? 'date' : 'text'}
            placeholder="To date"
            aria-label="To date"
            value={filters.dateTo || ''}
            onFocus={(e) => {
              e.currentTarget.type = 'date'
              e.currentTarget.showPicker?.()
            }}
            onBlur={(e) => {
              if (!e.currentTarget.value) e.currentTarget.type = 'text'
            }}
            onChange={(e) => updateFilter('dateTo', e.target.value)}
            className="h-10 min-h-10"
          />
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={toggleNoWrFilter}
          aria-pressed={showOnlyNoWr}
          className={cn(
            'h-10 min-h-10 w-full justify-start gap-2 text-xs font-medium',
            showOnlyNoWr && 'border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50'
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'relative h-5 w-9 rounded-full bg-gray-200 transition-colors',
              showOnlyNoWr && 'bg-emerald-500'
            )}
          >
            <span
              className={cn(
                'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                showOnlyNoWr && 'translate-x-4'
              )}
            />
          </span>
          <span>Show only no WR</span>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-600">Status</span>
        {ALL_STATUSES.map((status) => {
          const isChecked = filters.statuses?.includes(status) || false
          return (
            <div
              key={status}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-white px-2 text-xs font-normal text-gray-700 shadow-sm"
            >
              <Checkbox
                id={`dashboard-status-${status}`}
                checked={isChecked}
                onCheckedChange={(checked) => updateStatusFilter(status, checked as boolean)}
                className="h-3.5 w-3.5"
              />
              <Label
                htmlFor={`dashboard-status-${status}`}
                className="cursor-pointer text-xs font-normal"
              >
                {formatStatusLabel(status)}
              </Label>
            </div>
          )
        })}
      </div>
    </div>
  )
}
