"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { PaginationState, SortingState } from "@tanstack/react-table"
import { formatDistanceToNow } from "date-fns"
import { RefreshCw } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { DashboardTable } from "./dashboard-table"
import { DEFAULT_WR_FILTER, type DashboardFilters } from "./table-filters"
import {
  getPendingMyApprovals,
  getMyCreatedRequests,
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

type DashboardTabKey = 'pending' | 'my-requests'

function TabCountBadge({
  count,
  urgent,
  active,
}: {
  count: number
  urgent?: boolean
  active?: boolean
}) {
  return (
    <span
      className={cn(
        "ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
        urgent && count > 0
          ? "bg-red-100 text-red-700"
          : "bg-slate-100 text-slate-600",
        active && "ring-1 ring-inset ring-current/20"
      )}
      aria-label={`${count} requests`}
    >
      {count}
    </span>
  )
}

export function DashboardTabs({ userId }: DashboardTabsProps) {
  const [activeTab, setActiveTab] = useState<DashboardTabKey>('pending')
  const [pendingData, setPendingData] = useState<RequestListRow[]>([])
  const [myRequestsData, setMyRequestsData] = useState<RequestListRow[]>([])
  const [visibleCounts, setVisibleCounts] = useState<Record<DashboardTabKey, number>>({
    pending: 0,
    'my-requests': 0,
  })
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([])
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [isInteracting, setIsInteracting] = useState(false)
  const interactionTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Per-tab state management - each tab remembers its own filters, pagination, sorting
  const [tabStates, setTabStates] = useState<Record<DashboardTabKey, TabState>>({
    pending: {
      filters: { wrStatus: DEFAULT_WR_FILTER },
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [],
    },
    'my-requests': {
      filters: { wrStatus: DEFAULT_WR_FILTER },
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [],
    },
  })

  // Helper to update individual tab state
  const updateTabState = (tab: DashboardTabKey, updates: Partial<TabState>) => {
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
      const [pending, myRequests] = await Promise.all([
        getPendingMyApprovals(),
        getMyCreatedRequests(),
      ])
      setPendingData(pending)
      setMyRequestsData(myRequests)
      setVisibleCounts((prev) => ({
        pending: activeTab === 'pending' ? prev.pending : pending.length,
        'my-requests': activeTab === 'my-requests' ? prev['my-requests'] : myRequests.length,
      }))
      setLastUpdated(new Date())
    } catch (error) {
      console.error('Auto-refresh failed:', error)
      // Silently fail - don't interrupt user
    } finally {
      setIsRefreshing(false)
    }
  }, [activeTab, isInteracting])

  // Function to refresh specific tab data immediately
  const refreshTabData = useCallback(async (tab: DashboardTabKey) => {
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
        const [pending, myRequests, filterOptions] = await Promise.all([
          getPendingMyApprovals(),
          getMyCreatedRequests(),
          getRequestFilterOptions(),
        ])
        setPendingData(pending)
        setMyRequestsData(myRequests)
        setVisibleCounts({
          pending: pending.length,
          'my-requests': myRequests.length,
        })
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

  const handlePendingVisibleRowCountChange = useCallback((count: number) => {
    setVisibleCounts((prev) => (
      prev.pending === count ? prev : { ...prev, pending: count }
    ))
  }, [])

  const handleMyRequestsVisibleRowCountChange = useCallback((count: number) => {
    setVisibleCounts((prev) => (
      prev['my-requests'] === count ? prev : { ...prev, 'my-requests': count }
    ))
  }, [])

  const getTabCount = (tab: DashboardTabKey) => {
    if (activeTab === tab) return visibleCounts[tab]
    return tab === 'pending' ? pendingData.length : myRequestsData.length
  }

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DashboardTabKey)} className="w-full">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <TabsList className="flex w-full sm:max-w-xl">
          <TabsTrigger value="pending" className="flex-1">
            Pending My Approval
            <TabCountBadge
              count={getTabCount('pending')}
              urgent
              active={activeTab === 'pending'}
            />
          </TabsTrigger>
          <TabsTrigger value="my-requests" className="flex-1">
            My Requests
            <TabCountBadge
              count={getTabCount('my-requests')}
              active={activeTab === 'my-requests'}
            />
          </TabsTrigger>
        </TabsList>

        <div className="flex items-center justify-end gap-2 text-sm text-gray-500">
          <span className="whitespace-nowrap">
            {isRefreshing ? 'Updating...' : `Updated ${formatDistanceToNow(lastUpdated, { addSuffix: true })}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refreshAllData()}
            disabled={isRefreshing}
            className="h-8 px-2"
            aria-label="Refresh dashboard data"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

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
            onVisibleRowCountChange={handlePendingVisibleRowCountChange}
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
            onVisibleRowCountChange={handleMyRequestsVisibleRowCountChange}
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

    </Tabs>
  )
}
