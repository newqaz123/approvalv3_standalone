'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { RequestTable, RequestListRow } from './request-table'
import { RequestFilters } from './request-filters'
import type { GetRequestsFilters } from '@/server-actions/requests'

interface RequestsListWithFiltersProps {
  initialRequests: RequestListRow[]
  departments: Array<{ id: string; name: string }>
  requesters: Array<{ id: string; name: string }>
  refreshSignal?: number
}

export function RequestsListWithFilters({
  initialRequests,
  departments,
  requesters,
  refreshSignal = 0,
}: RequestsListWithFiltersProps) {
  const [requests, setRequests] = useState<RequestListRow[]>(initialRequests)
  const [filters, setFilters] = useState<GetRequestsFilters>({})
  const [isLoading, setIsLoading] = useState(false)
  const hasMountedRef = useRef(false)

  useEffect(() => {
    setRequests(initialRequests)
  }, [initialRequests])

  const buildSearchParams = (activeFilters: GetRequestsFilters) => {
    const params = new URLSearchParams()
    const { wrStatus, ...remainingFilters } = activeFilters

    Object.entries(remainingFilters).forEach(([key, value]) => {
      if (!value) return

      if (Array.isArray(value)) {
        value.forEach((item) => params.append(key, item))
        return
      }

      params.set(key, String(value))
    })

    if (wrStatus) {
      params.set('wrStatus', wrStatus)
    }

    return params
  }

  const handleFilterChange = async (newFilters: GetRequestsFilters) => {
    setFilters(newFilters)
    setIsLoading(true)

    try {
      const response = await fetch('/api/requests?' + buildSearchParams(newFilters), {
        cache: 'no-store',
      })

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

  const refreshData = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/requests?' + buildSearchParams(filters), {
        cache: 'no-store',
      })
      if (response.ok) {
        const data = await response.json()
        setRequests(data)
      }
    } catch (error) {
      console.error('Failed to refresh requests:', error)
    } finally {
      setIsLoading(false)
    }
  }, [filters])

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }

    refreshData()
  }, [refreshSignal, refreshData])

  useEffect(() => {
    window.addEventListener('approvalapp:request-data-changed', refreshData)
    return () => {
      window.removeEventListener('approvalapp:request-data-changed', refreshData)
    }
  }, [refreshData])

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
