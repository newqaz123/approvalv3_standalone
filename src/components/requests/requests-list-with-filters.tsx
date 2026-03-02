'use client'

import { useState, useEffect } from 'react'
import { RequestTable, RequestListRow } from './request-table'
import { RequestFilters } from './request-filters'
import type { GetRequestsFilters } from '@/server-actions/requests'

interface RequestsListWithFiltersProps {
  initialRequests: RequestListRow[]
  departments: Array<{ id: string; name: string }>
  requesters: Array<{ id: string; name: string }>
}

export function RequestsListWithFilters({
  initialRequests,
  departments,
  requesters,
}: RequestsListWithFiltersProps) {
  const [requests, setRequests] = useState<RequestListRow[]>(initialRequests)
  const [filters, setFilters] = useState<GetRequestsFilters>({})
  const [isLoading, setIsLoading] = useState(false)

  const handleFilterChange = async (newFilters: GetRequestsFilters) => {
    setFilters(newFilters)
    setIsLoading(true)

    try {
      const response = await fetch('/api/requests?' + new URLSearchParams(
        Object.entries(newFilters).reduce((acc, [key, value]) => {
          if (value) acc[key] = value
          return acc
        }, {} as Record<string, string>)
      ))

      if (response.ok) {
        const data = await response.json()
        setRequests(data)
      }
    } catch (error) {
      console.error('Failed to fetch filtered requests:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const refreshData = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/requests?' + new URLSearchParams(
        Object.entries(filters).reduce((acc, [key, value]) => {
          if (value) acc[key] = value
          return acc
        }, {} as Record<string, string>)
      ))
      if (response.ok) {
        const data = await response.json()
        setRequests(data)
      }
    } catch (error) {
      console.error('Failed to refresh requests:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <RequestFilters
        departments={departments}
        requesters={requesters}
        onFilterChange={handleFilterChange}
      />

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">
          Loading...
        </div>
      ) : (
        <RequestTable initialData={requests} onDataRefresh={refreshData} />
      )}
    </div>
  )
}
