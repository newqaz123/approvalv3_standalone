'use client'

import { useState, useEffect } from 'react'
import { Search, X, SlidersHorizontal } from 'lucide-react'
import { RequestStatus } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export interface DashboardFilters {
  department?: string
  statuses?: string[]
  dateFrom?: string
  dateTo?: string
  search?: string
}

interface TableFiltersProps {
  departments: Array<{ id: string; name: string }>
  onFilterChange: (filters: DashboardFilters) => void
  initialFilters?: DashboardFilters
}

// Format status enum to readable label
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

// All available status values
const ALL_STATUSES = Object.values(RequestStatus)

export function TableFilters({ departments, onFilterChange, initialFilters }: TableFiltersProps) {
  const [filters, setFilters] = useState<DashboardFilters>(initialFilters || {})
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)

  // Sync with external filter changes (e.g., when switching tabs)
  useEffect(() => {
    if (initialFilters) {
      setFilters(initialFilters)
    }
  }, [initialFilters])

  const updateFilter = (key: keyof DashboardFilters, value: any) => {
    const newFilters = { ...filters, [key]: value }
    setFilters(newFilters)
    onFilterChange(newFilters)
  }

  const updateStatusFilter = (status: string, checked: boolean) => {
    const currentStatuses = filters.statuses || []
    let newStatuses: string[]

    if (checked) {
      // Add status if not already present
      newStatuses = [...currentStatuses, status]
    } else {
      // Remove status
      newStatuses = currentStatuses.filter(s => s !== status)
    }

    updateFilter('statuses', newStatuses.length > 0 ? newStatuses : undefined)
  }

  const clearFilters = () => {
    const emptyFilters: DashboardFilters = {}
    setFilters(emptyFilters)
    onFilterChange(emptyFilters)
    setMobileFilterOpen(false)
  }

  const handleApplyFilters = () => {
    setMobileFilterOpen(false)
  }

  const hasActiveFilters = Object.values(filters).some(
    v => v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0)
  )

  const activeFilterCount = Object.values(filters).filter(
    v => v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0)
  ).length

  return (
    <>
      {/* Mobile filter button */}
      <div className="md:hidden mb-4">
        <Dialog open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4" />
                <span>Filters</span>
              </div>
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Filter Requests</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Mobile filter content - same as desktop but in dialog */}
              <div className="space-y-3">
                {/* Search */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">
                    Search
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search by title..."
                      value={filters.search || ''}
                      onChange={(e) => updateFilter('search', e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                {/* Department Filter */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">
                    Department
                  </Label>
                  <Select
                    value={filters.department || 'all'}
                    onValueChange={(value) => updateFilter('department', value === 'all' ? undefined : value)}
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

                {/* Date Range */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm font-medium text-gray-700 mb-2 block">
                      From Date
                    </Label>
                    <Input
                      type="date"
                      placeholder="From Date"
                      value={filters.dateFrom || ''}
                      onChange={(e) => updateFilter('dateFrom', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700 mb-2 block">
                      To Date
                    </Label>
                    <Input
                      type="date"
                      placeholder="To Date"
                      value={filters.dateTo || ''}
                      onChange={(e) => updateFilter('dateTo', e.target.value)}
                    />
                  </div>
                </div>

                {/* Status Filter */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">
                    Status
                  </Label>
                  <div className="space-y-2">
                    {ALL_STATUSES.map((status) => {
                      const isChecked = filters.statuses?.includes(status) || false
                      return (
                        <div key={status} className="flex items-center space-x-2">
                          <Checkbox
                            id={`mobile-status-${status}`}
                            checked={isChecked}
                            onCheckedChange={(checked) => updateStatusFilter(status, checked as boolean)}
                          />
                          <Label
                            htmlFor={`mobile-status-${status}`}
                            className="text-sm cursor-pointer normal-case"
                          >
                            {formatStatusLabel(status)}
                          </Label>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Dialog action buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={clearFilters}
                  disabled={!hasActiveFilters}
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
                <Button className="flex-1" onClick={handleApplyFilters}>
                  Apply Filters
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Desktop inline filter layout */}
      <div className="hidden md:block space-y-4 p-4 bg-gray-50 rounded-lg border">
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
          {/* Search - Full width */}
          <div className="lg:col-span-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by title..."
                value={filters.search || ''}
                onChange={(e) => updateFilter('search', e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Department Filter */}
          <div>
            <Select
              value={filters.department || 'all'}
              onValueChange={(value) => updateFilter('department', value === 'all' ? undefined : value)}
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

          {/* Status Filter - Checkbox Group */}
          <div className="lg:col-span-3">
            <Label className="text-sm font-medium text-gray-700 mb-2 block">Status:</Label>
            <div className="flex flex-wrap gap-4">
              {ALL_STATUSES.map((status) => {
                const isChecked = filters.statuses?.includes(status) || false
                return (
                  <div key={status} className="flex items-center space-x-2">
                    <Checkbox
                      id={`status-${status}`}
                      checked={isChecked}
                      onCheckedChange={(checked) => updateStatusFilter(status, checked as boolean)}
                    />
                    <Label
                      htmlFor={`status-${status}`}
                      className="text-sm cursor-pointer normal-case"
                    >
                      {formatStatusLabel(status)}
                    </Label>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
