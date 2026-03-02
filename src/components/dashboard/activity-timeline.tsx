'use client'

import { useState } from 'react'
import { format, isToday, isYesterday } from 'date-fns'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

/**
 * NOTE: Activity data can be fetched using the audit query API:
 * - getAuditTrailForRequest(requestId) - for single request activity
 * - getAuditTrailForDateRange(start, end) - for date-range queries
 * - getAuditTrailForUser(userId) - for user-specific activity
 *
 * These functions are available in @/server-actions/audit for future use
 * in dashboard components and audit log exports.
 */

interface Activity {
  id: string
  action: string
  fromStatus?: string | null
  toStatus?: string | null
  comments?: string | null
  createdAt: Date
  user: {
    name: string
  }
}

interface ActivityTimelineProps {
  activities: Activity[]
}

/**
 * Get day label for a given date
 * Returns "Today", "Yesterday", or formatted date string
 */
function getDayLabel(date: Date): string {
  if (isToday(date)) {
    return 'Today'
  }
  if (isYesterday(date)) {
    return 'Yesterday'
  }
  return format(date, 'MMMM d, yyyy')
}

/**
 * Group activities by day
 * Returns array of [dayLabel, activities[]] tuples sorted by date descending
 */
function groupActivitiesByDay(activities: Activity[]): Array<[string, Activity[]]> {
  const groups = new Map<string, Activity[]>()

  // Group activities by date (yyyy-MM-dd key)
  activities.forEach((activity) => {
    const dateKey = format(new Date(activity.createdAt), 'yyyy-MM-dd')
    if (!groups.has(dateKey)) {
      groups.set(dateKey, [])
    }
    groups.get(dateKey)!.push(activity)
  })

  // Convert to array and sort by date descending (most recent first)
  const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
    return b[0].localeCompare(a[0]) // Sort date keys descending
  })

  // Map date keys to day labels
  return sortedGroups.map(([dateKey, dayActivities]) => {
    const dayLabel = getDayLabel(new Date(dateKey))
    return [dayLabel, dayActivities]
  })
}

/**
 * Build a one-line summary for an activity event
 */
function getActivitySummary(activity: Activity): string {
  const { action, fromStatus, toStatus, comments } = activity

  switch (action) {
    case 'status_change':
      if (fromStatus && toStatus) {
        return `Status changed from ${formatStatusName(fromStatus)} to ${formatStatusName(toStatus)}`
      }
      return 'Status updated'

    case 'approved':
      return `Approved by ${activity.user.name}`

    case 'rejected':
      if (comments) {
        return `Rejected by ${activity.user.name}: ${comments}`
      }
      return `Rejected by ${activity.user.name}`

    case 'cancelled':
      return `Cancelled by ${activity.user.name}`

    case 'file_attached':
      if (comments) {
        return `Attached ${comments}`
      }
      return 'Attached a file'

    case 'submitted':
      return `Submitted by ${activity.user.name}`

    case 'solution_submitted':
      return `Solution submitted by ${activity.user.name}`

    case 'solution_approved':
      return `Solution approved by ${activity.user.name}`

    case 'solution_rejected':
      if (comments) {
        return `Solution rejected by ${activity.user.name}: ${comments}`
      }
      return `Solution rejected by ${activity.user.name}`

    case 'final_approval_initiated':
      return `Final approval initiated by ${activity.user.name}`

    case 'final_approved':
      return `Final approval completed by ${activity.user.name}`

    case 'final_rejected':
      if (comments) {
        return `Final approval rejected by ${activity.user.name}: ${comments}`
      }
      return `Final approval rejected by ${activity.user.name}`

    case 'manually_completed':
      return `Marked as complete by ${activity.user.name}`

    default:
      if (comments) {
        return `${action}: ${comments}`
      }
      return action
  }
}

/**
 * Format status name for display
 * Convert camelCase to readable format
 */
function formatStatusName(status: string): string {
  return status
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}

/**
 * ActivityTimeline component
 * Displays chronological list of events grouped by day with collapsible sections
 * Mobile: compact layout with smaller text and spacing
 * Desktop: larger text with more spacing
 */
export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  const dayGroups = groupActivitiesByDay(activities)

  // Initialize with "Today" group expanded if exists, otherwise first group
  const [openDays, setOpenDays] = useState<Set<string>>(() => {
    const initialOpen = new Set<string>()
    if (dayGroups.length > 0) {
      const [firstDayLabel] = dayGroups[0]
      initialOpen.add(firstDayLabel)
    }
    return initialOpen
  })

  const toggleDay = (dayLabel: string) => {
    setOpenDays((prev) => {
      const newOpen = new Set(prev)
      if (newOpen.has(dayLabel)) {
        newOpen.delete(dayLabel)
      } else {
        newOpen.add(dayLabel)
      }
      return newOpen
    })
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        No activity recorded
      </div>
    )
  }

  return (
    <div className="space-y-2 md:space-y-3">
      {dayGroups.map(([dayLabel, dayActivities]) => {
        const isOpen = openDays.has(dayLabel)

        return (
          <Collapsible
            key={dayLabel}
            open={isOpen}
            onOpenChange={() => toggleDay(dayLabel)}
          >
            <CollapsibleTrigger className="flex items-center justify-between w-full p-2 md:p-3 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors">
              <span className="font-medium text-xs md:text-sm text-gray-900">{dayLabel}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded-full">
                  {dayActivities.length} event{dayActivities.length !== 1 ? 's' : ''}
                </span>
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 text-gray-600" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-gray-600" />
                )}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 md:mt-2 space-y-1 md:space-y-2 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
              {dayActivities.map((activity) => (
                <ActivityItem key={activity.id} activity={activity} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </div>
  )
}

/**
 * Individual activity item component
 * Mobile: compact with smaller icons and text
 * Desktop: larger with more detail
 *
 * PERFORMANCE OPTIMIZATION: content-visibility CSS defers rendering of off-screen items
 * For 100+ activity timeline items, this can improve initial render time by 60%+
 * Reference: https://web.dev/content-visibility/
 */
function ActivityItem({ activity }: { activity: Activity }) {
  const timestamp = format(new Date(activity.createdAt), 'h:mm a')
  const summary = getActivitySummary(activity)

  return (
    <div
      className="flex items-start gap-2 md:gap-3 p-2 md:p-3 bg-white border border-gray-100 rounded-md hover:bg-gray-50 transition-colors"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 100px' }}
    >
      {/* Mobile: smaller dot, Desktop: larger */}
      <div className="flex-shrink-0">
        <div className="h-1.5 w-1.5 md:h-2 md:w-2 rounded-full bg-blue-500 mt-1 md:mt-1.5" />
      </div>
      <div className="flex-1 min-w-0">
        {/* Mobile: hide exact timestamp, show on desktop */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="hidden sm:inline-block text-xs font-medium text-gray-500">{timestamp}</span>
          <span className="text-sm text-gray-900">{summary}</span>
        </div>
        {/* Mobile: show user inline, Desktop: show on separate line */}
        {activity.user && (
          <p className="text-xs text-gray-500 mt-0 sm:mt-0.5">
            <span className="sm:hidden">{timestamp} &bull; </span>
            {activity.user.name}
          </p>
        )}
      </div>
    </div>
  )
}
