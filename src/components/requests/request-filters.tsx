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
    <div className="space-y-4 p-4 bg-gray-50 rounded-lg border">
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Search */}
        <div className="lg:col-span-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search title or description..."
              value={filters.search || ''}
              onChange={(e) => updateFilter('search', e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Status Filter */}
        <div className="lg:col-span-3">
          <Label className="text-sm font-medium text-gray-700 mb-2 block">Status</Label>
          <div className="flex flex-wrap gap-4">
            {ALL_STATUSES.map((status) => {
              const isChecked = filters.statuses?.includes(status) || false
              return (
                <div key={status} className="flex items-center space-x-2">
                  <Checkbox
                    id={`request-status-${status}`}
                    checked={isChecked}
                    onCheckedChange={(checked) => updateStatusFilter(status, checked as boolean)}
                  />
                  <Label
                    htmlFor={`request-status-${status}`}
                    className="text-sm cursor-pointer normal-case"
                  >
                    {formatStatusLabel(status)}
                  </Label>
                </div>
              )
            })}
          </div>
        </div>

        {/* Department Filter */}
        <div>
          <Select
            value={filters.departmentId || 'all'}
            onValueChange={(value) => updateFilter('departmentId', value === 'all' ? undefined : value)}
          >
            <SelectTrigger>
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

        {/* Requester Filter */}
        <div>
          <Select
            value={filters.requesterId || 'all'}
            onValueChange={(value) => updateFilter('requesterId', value === 'all' ? undefined : value)}
          >
            <SelectTrigger>
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

        {/* Date From */}
        <div>
          <Input
            type="date"
            placeholder="From Date"
            value={filters.dateFrom || ''}
            onChange={(e) => updateFilter('dateFrom', e.target.value)}
          />
        </div>

        {/* Date To */}
        <div>
          <Input
            type="date"
            placeholder="To Date"
            value={filters.dateTo || ''}
            onChange={(e) => updateFilter('dateTo', e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
