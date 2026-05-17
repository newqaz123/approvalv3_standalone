"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { PaginationState, SortingState } from "@tanstack/react-table"
import { formatDistanceToNow } from "date-fns"
import { RefreshCw } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { DashboardTable } from "./dashboard-table"
import type { DashboardFilters } from "./table-filters"
import {
  getPendingMyApprovals,
  getMyCreatedRequests,
  getAllRequests,
  type RequestListRow,
} from "@/server-actions/dashboard"
import { getRequestFilterOptions } from "@/server-actions/requests"
import { useInterval } from "@/hooks/use-interval"
import { cn } from "@/lib/utils"

interface DashboardTabsProps {
  userId: string | null
}

// Per-tab state type for filter memory
type TabState = {
  filters: DashboardFilters
  pagination: PaginationState
  sorting: SortingState
}

export function DashboardTabs({ userId }: DashboardTabsProps) {
  const [pendingData, setPendingData] = useState<RequestListRow[]>([])
  const [myRequestsData, setMyRequestsData] = useState<RequestListRow[]>([])
  const [allData, setAllData] = useState<RequestListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([])
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [isInteracting, setIsInteracting] = useState(false)
  const interactionTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Per-tab state management - each tab remembers its own filters, pagination, sorting
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({
    pending: {
      filters: {},
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [],
    },
    'my-requests': {
      filters: {},
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [],
    },
    all: {
      filters: {},
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [],
    },
  })

  // Helper to update individual tab state
  const updateTabState = (tab: string, updates: Partial<TabState>) => {
    setTabStates((prev) => ({
      ...prev,
      [tab]: { ...prev[tab], ...updates },
    }))

    // Mark user as interacting when filters change
    if (updates.filters) {
      setIsInteracting(true)

      // Clear existing timeout
      if (interactionTimeoutRef.current) {
        clearTimeout(interactionTimeoutRef.current)
      }

      // Auto-resume after 5 seconds of no interaction
      interactionTimeoutRef.current = setTimeout(() => {
        setIsInteracting(false)
      }, 5000)
    }
  }

  const refreshAllData = useCallback(async (force = false) => {
    if (isInteracting && !force) return // Skip if user is actively interacting

    try {
      setIsRefreshing(true)
      const [pending, myRequests, all] = await Promise.all([
        getPendingMyApprovals(),
        getMyCreatedRequests(),
        getAllRequests(),
      ])
      setPendingData(pending)
      setMyRequestsData(myRequests)
      setAllData(all)
      setLastUpdated(new Date())
    } catch (error) {
      console.error('Auto-refresh failed:', error)
      // Silently fail - don't interrupt user
    } finally {
      setIsRefreshing(false)
    }
  }, [isInteracting])

  // Function to refresh specific tab data immediately
  const refreshTabData = useCallback(async (tab: string) => {
    try {
      setIsRefreshing(true)
      switch (tab) {
        case 'pending':
          const pending = await getPendingMyApprovals()
          setPendingData(pending)
          break
        case 'my-requests':
          const myRequests = await getMyCreatedRequests()
          setMyRequestsData(myRequests)
          break
        case 'all':
          const all = await getAllRequests()
          setAllData(all)
          break
      }
      setLastUpdated(new Date())
    } catch (error) {
      console.error('Tab refresh failed:', error)
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  // Set up auto-refresh interval (30 seconds, paused when interacting)
  useInterval({
    callback: refreshAllData,
    delay: isInteracting ? null : 30000,
  })

  // Handle visibility change - refresh when user returns to tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && !isInteracting) {
        refreshAllData()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [refreshAllData, isInteracting])

  useEffect(() => {
    const handleRequestDataChanged = () => {
      refreshAllData(true)
    }

    window.addEventListener('approvalapp:request-data-changed', handleRequestDataChanged)
    return () => {
      window.removeEventListener('approvalapp:request-data-changed', handleRequestDataChanged)
    }
  }, [refreshAllData])

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      try {
        // Load data and filter options in parallel
        const [pending, myRequests, all, filterOptions] = await Promise.all([
          getPendingMyApprovals(),
          getMyCreatedRequests(),
          getAllRequests(),
          getRequestFilterOptions(),
        ])
        setPendingData(pending)
        setMyRequestsData(myRequests)
        setAllData(all)
        setDepartments(filterOptions.departments)
        setLastUpdated(new Date())
      } catch (error) {
        console.error("Failed to load dashboard data:", error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  return (
    <Tabs defaultValue="pending" className="w-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500">
          {isRefreshing ? 'Updating...' : `Updated ${formatDistanceToNow(lastUpdated, { addSuffix: true })}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refreshAllData()}
          disabled={isRefreshing}
          className="h-7 px-2"
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
        </Button>
      </div>

      <TabsList className="flex w-full">
        <TabsTrigger value="pending" className="flex-1">
          Pending My Approval
        </TabsTrigger>
        <TabsTrigger value="my-requests" className="flex-1">
          My Requests
        </TabsTrigger>
        <TabsTrigger value="all" className="flex-1">
          All Requests
        </TabsTrigger>
      </TabsList>

      <TabsContent value="pending" className="mt-4">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">
            Loading...
          </div>
        ) : (
          <DashboardTable
            initialData={pendingData}
            dataFetchingFunction={getPendingMyApprovals}
            departments={departments}
            externalFilters={tabStates.pending.filters}
            onFilterChange={(filters) => updateTabState('pending', { filters })}
            onModalOpen={() => setIsInteracting(true)}
            onModalClose={() => {
              setIsInteracting(false)
              // Clear any existing timeout
              if (interactionTimeoutRef.current) {
                clearTimeout(interactionTimeoutRef.current)
              }
              // Resume auto-refresh immediately
              interactionTimeoutRef.current = setTimeout(() => {
                setIsInteracting(false)
              }, 5000)
            }}
            onActionComplete={() => refreshTabData('pending')}
          />
        )}
      </TabsContent>

      <TabsContent value="my-requests" className="mt-4">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">
            Loading...
          </div>
        ) : (
          <DashboardTable
            initialData={myRequestsData}
            dataFetchingFunction={getMyCreatedRequests}
            departments={departments}
            externalFilters={tabStates['my-requests'].filters}
            onFilterChange={(filters) => updateTabState('my-requests', { filters })}
            onModalOpen={() => setIsInteracting(true)}
            onModalClose={() => {
              setIsInteracting(false)
              // Clear any existing timeout
              if (interactionTimeoutRef.current) {
                clearTimeout(interactionTimeoutRef.current)
              }
              // Resume auto-refresh immediately
              interactionTimeoutRef.current = setTimeout(() => {
                setIsInteracting(false)
              }, 5000)
            }}
            onActionComplete={() => refreshTabData('my-requests')}
          />
        )}
      </TabsContent>

      <TabsContent value="all" className="mt-4">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">
            Loading...
          </div>
        ) : (
          <DashboardTable
            initialData={allData}
            dataFetchingFunction={getAllRequests}
            departments={departments}
            externalFilters={tabStates.all.filters}
            onFilterChange={(filters) => updateTabState('all', { filters })}
            onModalOpen={() => setIsInteracting(true)}
            onModalClose={() => {
              setIsInteracting(false)
              // Clear any existing timeout
              if (interactionTimeoutRef.current) {
                clearTimeout(interactionTimeoutRef.current)
              }
              // Resume auto-refresh immediately
              interactionTimeoutRef.current = setTimeout(() => {
                setIsInteracting(false)
              }, 5000)
            }}
            onActionComplete={() => refreshTabData('all')}
          />
        )}
      </TabsContent>
    </Tabs>
  )
}
