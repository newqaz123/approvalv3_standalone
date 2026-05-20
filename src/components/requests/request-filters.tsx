'use client'

import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { RequestStatus } from '@prisma/client'
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

export interface RequestFilters {
  status?: string
  statuses?: string[]
  departmentId?: string
  requesterId?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}

interface RequestFiltersProps {
  departments: Array<{ id: string; name: string }>
  requesters: Array<{ id: string; name: string }>
  onFilterChange: (filters: RequestFilters) => void
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

export function RequestFilters({ departments, requesters, onFilterChange }: RequestFiltersProps) {
  const [filters, setFilters] = useState<RequestFilters>({})

  const updateFilter = (key: keyof RequestFilters, value: string | string[] | undefined) => {
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
    setFilters({})
    onFilterChange({})
  }

  const hasActiveFilters = Object.values(filters).some(
    v => v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0)
  )

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
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search title or description..."
              value={filters.search || ''}
              onChange={(e) => updateFilter('search', e.target.value)}
              className="h-9 min-h-9 pl-9"
            />
          </div>
        </div>

        <div>
          <Select
            value={filters.departmentId || 'all'}
            onValueChange={(value) => updateFilter('departmentId', value === 'all' ? undefined : value)}
          >
            <SelectTrigger className="h-9 min-h-9">
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
          <Select
            value={filters.requesterId || 'all'}
            onValueChange={(value) => updateFilter('requesterId', value === 'all' ? undefined : value)}
          >
            <SelectTrigger className="h-9 min-h-9">
              <SelectValue placeholder="All Requesters" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Requesters</SelectItem>
              {requesters.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Input
            id="request-date-from"
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
            className="h-9 min-h-9"
          />
        </div>

        <div>
          <Input
            id="request-date-to"
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
            className="h-9 min-h-9"
          />
        </div>
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
                id={`request-status-${status}`}
                checked={isChecked}
                onCheckedChange={(checked) => updateStatusFilter(status, checked as boolean)}
                className="h-3.5 w-3.5"
              />
              <Label
                htmlFor={`request-status-${status}`}
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
