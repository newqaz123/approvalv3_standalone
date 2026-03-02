# Phase 5: Dashboard & Visibility - Research

**Researched:** 2026-02-06
**Domain:** React data tables, activity timelines, dashboard navigation patterns
**Confidence:** HIGH

## Summary

This phase implements request discovery and tracking views through a dashboard page with three tabbed views ("My Requests", "Pending My Approval", "All Requests"), data tables with pagination/sorting/filtering, and an activity timeline grouped by day. The research focused on extending the existing TanStack Table pattern to include pagination and filtering, implementing tab navigation with shadcn/ui Tabs component, and creating a day-grouped activity timeline.

The existing codebase already uses TanStack React Table v8.21.3 with shadcn/ui components. The `request-table.tsx` and `user-table.tsx` provide the base pattern to follow. The `request-filters.tsx` component demonstrates real-time filtering with state updates (no apply button). However, tabs and collapsible components need to be added via shadcn CLI.

**Primary recommendation:** Use client-side pagination/sorting/filtering with TanStack Table, add shadcn/ui tabs and collapsible components, and create a day-grouped activity timeline component using date-fns utilities.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Implementation Decisions

#### View Organization & Navigation
- Single `/dashboard` page with tab navigation at the top (not separate routes or sidebar)
- Default tab is "Pending My Approval" — action-oriented entry point
- Always default to Pending tab (no session memory for tab selection)
- Tab labels without count badges — simpler, no counting query overhead

#### Table/List Layout & Density
- Data table format (not cards or list rows) — traditional table with sortable columns
- Moderate density: 4-5 columns per table — Title, Status, Requester, Date (essentials, not cluttered)
- Consistent column layout across all three views
- Native horizontal scrolling for overflow on smaller screens (no sticky columns)
- Clicking a row opens existing request detail modal (not navigation to detail page)
- Standard pagination with page size controls (10, 25, 50, 100) — not infinite scroll or load-more button

#### Search & Filter Behavior
- Separate controls: filters in sidebar or above table, text search as separate input (not unified search bar)
- Real-time filtering — results update immediately as filters change (no apply button)
- Per-tab filter memory — each tab remembers its own filter state independently
- Filters reset to defaults on page refresh (no localStorage persistence across sessions)

#### Activity Timeline Design
- Simple chronological list (not vertical timeline with visual line)
- Group by day — "Today", "Yesterday", "February 5, 2026" headers
- Summary only per event — timestamp, action type, brief one-line summary (not full details inline)
- Collapsible day groups — users can expand/collapse each day's events

### Claude's Discretion
- Exact visual styling of day group headers
- Pagination component implementation details
- Filter control UI (dropdowns, checkboxes, etc.)
- Timeline animation/transition effects
- Mobile responsiveness details

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tanstack/react-table | ^8.21.3 | Data table with pagination, sorting, filtering | Already in project, industry standard for React tables |
| shadcn/ui tabs | (add via CLI) | Tab navigation between dashboard views | Official shadcn/ui component, follows existing patterns |
| date-fns | ^4.1.0 | Date formatting and day grouping utilities | Already in project, functional approach, tree-shakeable |
| shadcn/ui collapsible | (add via CLI) | Collapsible day groups in activity timeline | Official shadcn/ui component |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | ^0.563.0 | Icons (ChevronDown, ChevronUp for collapse) | For collapse/expand indicators |
| @radix-ui/react-* | (existing) | shadcn/ui dependencies | Already installed as part of shadcn/ui |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TanStack Table | React-Table v7 | TanStack v8 is current, better TypeScript support |
| shadcn/ui tabs | Radix UI tabs directly | shadcn/ui provides pre-styled components matching project |
| Client-side filters | Server-side filters | Client-side simpler for dataset size, real-time updates |

**Installation:**
```bash
# Add tabs component (not currently in project)
npx shadcn@latest add tabs

# Add collapsible component (not currently in project)
npx shadcn@latest add collapsible
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   └── dashboard/
│       └── page.tsx              # Main dashboard page with tabs
├── components/
│   └── dashboard/
│       ├── dashboard-tabs.tsx    # Tab navigation component
│       ├── requests-table.tsx    # TanStack Table with pagination/sorting
│       ├── table-pagination.tsx  # Pagination controls (page size, prev/next)
│       ├── table-filters.tsx     # Filter controls (reused/adapted from request-filters.tsx)
│       └── activity-timeline.tsx # Day-grouped activity timeline
```

### Pattern 1: TanStack Table with Pagination
**What:** Extend existing table pattern to include pagination state and controls
**When to use:** For all three dashboard views (My Requests, Pending My Approval, All Requests)
**Example:**
```typescript
// Source: https://tanstack.com/table/v8/docs/guide/pagination
import {
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type PaginationState,
} from '@tanstack/react-table'

const [pagination, setPagination] = useState<PaginationState>({
  pageIndex: 0,
  pageSize: 10,
})

const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
  getPaginationRowModel: getPaginationRowModel(),
  state: {
    pagination,
  },
  onPaginationChange: setPagination,
})

// Access pagination state
table.getState().pagination.pageIndex
table.getPageCount()
```

### Pattern 2: TanStack Table with Column Sorting
**What:** Enable click-to-sort on column headers
**When to use:** For sortable columns (Title, Status, Requester, Date)
**Example:**
```typescript
// Source: https://tanstack.com/table/v8/docs/guide/sorting
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'

const [sorting, setSorting] = useState<SortingState>([])

const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  state: {
    sorting,
  },
  onSortingChange: setSorting,
})

// Enable sort on column definition
const column = {
  accessorKey: 'createdAt',
  header: 'Date',
  enableSorting: true,
}
```

### Pattern 3: TanStack Table with Column Filtering
**What:** Filter data by column values
**When to use:** For status, department, requester, and date range filters
**Example:**
```typescript
// Source: https://tanstack.com/table/v8/docs/guide/filters
import {
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
  type ColumnFiltersState,
} from '@tanstack/react-table'

const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  state: {
    columnFilters,
  },
  onColumnFiltersChange: setColumnFilters,
})

// Apply filter programmatically
table.getColumn('status')?.setFilterValue(['ImprovementRequest', 'SentToEngineer'])
```

### Pattern 4: shadcn/ui Tabs Navigation
**What:** Tab component for switching between dashboard views
**When to use:** Main navigation between the three dashboard views
**Example:**
```typescript
// Source: https://ui.shadcn.com/docs/components/tabs
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useState } from 'react'

export function DashboardTabs() {
  const [activeTab, setActiveTab] = useState('pending') // Default to Pending My Approval

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList>
        <TabsTrigger value="pending">Pending My Approval</TabsTrigger>
        <TabsTrigger value="my-requests">My Requests</TabsTrigger>
        <TabsTrigger value="all">All Requests</TabsTrigger>
      </TabsList>
      <TabsContent value="pending">
        {/* Pending table component */}
      </TabsContent>
      <TabsContent value="my-requests">
        {/* My requests table component */}
      </TabsContent>
      <TabsContent value="all">
        {/* All requests table component */}
      </TabsContent>
    </Tabs>
  )
}
```

### Pattern 5: Per-Tab Filter State Management
**What:** Independent filter state for each dashboard tab
**When to use:** To maintain separate filter/sort/pagination state per tab
**Example:**
```typescript
import { useState } from 'react'

type TabState = {
  pagination: { pageIndex: number; pageSize: number }
  sorting: SortingState
  columnFilters: ColumnFiltersState
}

const defaultTabState: TabState = {
  pagination: { pageIndex: 0, pageSize: 10 },
  sorting: [],
  columnFilters: [],
}

export function useDashboardTabs() {
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({
    pending: defaultTabState,
    'my-requests': defaultTabState,
    all: defaultTabState,
  })
  const [activeTab, setActiveTab] = useState('pending')

  const updateTabState = (tab: string, updates: Partial<TabState>) => {
    setTabStates(prev => ({
      ...prev,
      [tab]: { ...prev[tab], ...updates },
    }))
  }

  return { activeTab, setActiveTab, tabStates, updateTabState }
}
```

### Pattern 6: Day-Grouped Activity Timeline
**What:** Group activities by day with collapsible sections
**When to use:** Activity timeline showing request history
**Example:**
```typescript
// Source: Combination of date-fns patterns and shadcn/ui collapsible
import { format, isToday, isYesterday, parseISO } from 'date-fns'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'

function getDayLabel(date: Date): string {
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'MMMM d, yyyy')
}

function groupActivitiesByDay(activities: RequestActivity[]) {
  const groups = new Map<string, RequestActivity[]>()

  activities.forEach(activity => {
    const date = new Date(activity.createdAt)
    const dayKey = format(date, 'yyyy-MM-dd')
    const dayLabel = getDayLabel(date)

    if (!groups.has(dayLabel)) {
      groups.set(dayLabel, [])
    }
    groups.get(dayLabel)!.push(activity)
  })

  // Sort by date descending
  return Array.from(groups.entries()).sort((a, b) =>
    b[0].localeCompare(a[0])
  )
}

export function ActivityTimeline({ activities }: { activities: RequestActivity[] }) {
  const [openDays, setOpenDays] = useState<Set<string>>(new Set())

  const dayGroups = groupActivitiesByDay(activities)

  const toggleDay = (dayLabel: string) => {
    setOpenDays(prev => {
      const next = new Set(prev)
      if (next.has(dayLabel)) {
        next.delete(dayLabel)
      } else {
        next.add(dayLabel)
      }
      return next
    })
  }

  return (
    <div className="space-y-4">
      {dayGroups.map(([dayLabel, dayActivities]) => (
        <Collapsible
          key={dayLabel}
          open={openDays.has(dayLabel)}
          onOpenChange={() => toggleDay(dayLabel)}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-gray-50 rounded hover:bg-gray-100">
            <span className="font-medium">{dayLabel}</span>
            {openDays.has(dayLabel) ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {dayActivities.map(activity => (
              <div key={activity.id} className="p-3 bg-white rounded border">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{activity.action}</span>
                  <span className="text-sm text-gray-500">
                    {format(new Date(activity.createdAt), 'h:mm a')}
                  </span>
                </div>
                {activity.comments && (
                  <p className="mt-1 text-sm text-gray-600">{activity.comments}</p>
                )}
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  )
}
```

### Anti-Patterns to Avoid
- **Unified search bar**: Don't combine text search and filters into a single input — CONTEXT.md requires separate controls
- **Apply button for filters**: Don't add an apply button — filters should update results immediately
- **Session persistence**: Don't save filter state to localStorage — filters reset on page refresh
- **Count badges on tabs**: Don't add request counts to tab labels — CONTEXT.md explicitly rejects this
- **Infinite scroll**: Don't implement infinite scroll — use standard pagination with page size controls
- **Sticky columns**: Don't implement sticky columns on small screens — use native horizontal scrolling

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Table pagination | Custom pagination logic with state management | TanStack Table's built-in pagination (`getPaginationRowModel`) | Handles edge cases (page boundary, page size changes), integrates with sorting/filtering |
| Table sorting | Custom sort functions and state | TanStack Table's built-in sorting (`getSortedRowModel`) | Handles multi-column sorting, sort direction, column header indicators |
| Table filtering | Custom filter logic with nested object traversal | TanStack Table's built-in filtering (`getFilteredRowModel`) | Handles fuzzy matching, multi-value filters, integrates with sort/page |
| Tab navigation | Custom tab state and conditional rendering | shadcn/ui Tabs component (Radix UI under the hood) | Keyboard navigation, ARIA attributes, accessibility built-in |
| Collapsible sections | Custom state and animation logic | shadcn/ui Collapsible component (Radix UI under the hood) | Proper ARIA expanded state, keyboard support, animation transitions |
| Date grouping | Manual date comparison and string formatting | date-fns utilities (`isToday`, `isYesterday`, `format`) | Handles timezone edge cases, localization, consistent formatting |

**Key insight:** TanStack Table v8 is designed as a "headless" table library — it handles all the complex state management (pagination, sorting, filtering) while letting you build the UI. Building custom pagination/filtering on top of it defeats its purpose and creates integration bugs.

## Common Pitfalls

### Pitfall 1: Server-Side vs Client-Side Pagination Confusion
**What goes wrong:** Implementing server-side pagination when client-side is sufficient, or vice versa
**Why it happens:** TanStack Table supports both, and it's easy to confuse the APIs
**How to avoid:** For this phase, use client-side pagination (`getPaginationRowModel`). The dataset size (requests visible to a user) is small enough for client-side. Server-side pagination requires additional API complexity and isn't needed yet.
**Warning signs:** API calls for page changes, complex server-side filter logic

### Pitfall 2: Filter State Bleeding Between Tabs
**What goes wrong:** Changing tabs shows the previous tab's filters/sort/pagination state
**Why it happens:** Using a single filter state object shared across tabs
**How to avoid:** Use separate state objects per tab (see Pattern 5: Per-Tab Filter State Management). Each tab should have its own independent filter, sort, and pagination state.
**Warning signs:** `useEffect` resetting filters on tab change, filters persisting when they shouldn't

### Pitfall 3: Re-fetching Data on Every Filter Change
**What goes wrong:** Making API calls for every keystroke or filter change
**Why it happens:** Following the existing `requests-list-with-filters.tsx` pattern which fetches from API
**How to avoid:** For dashboard views, fetch all relevant data once and filter client-side using TanStack Table's filtering. Only re-fetch when switching tabs or on initial load.
**Warning signs:** Network requests on every filter change, loading spinners on filter updates

### Pitfall 4: Day Grouping Timezone Issues
**What goes wrong:** Activities appearing under wrong day headers due to timezone conversion
**Why it happens:** Date operations without considering timezone, mixing UTC and local time
**How to avoid:** Use date-fns functions that operate on local time, ensure dates from Prisma are properly converted to Date objects before grouping
**Warning signs:** "Today" section empty when there are today's activities, activities shifting days

### Pitfall 5: Modal Opens on Sort Click
**What goes wrong:** Clicking column header to sort also opens the request detail modal
**Why it happens:** Sortable headers are inside clickable table rows
**How to avoid:** Stop event propagation on sort header clicks, or use the `onSortingChange` callback without triggering row click
**Warning signs:** Modal opens when trying to sort, sort indicator not appearing

### Pitfall 6: Default Tab Not Respected After Navigation
**What goes wrong:** User navigates away and back to dashboard, tab changes from "Pending My Approval"
**Why it happens:** Using session storage or URL state to remember tab selection
**How to avoid:** Always hard-code default tab as "Pending My Approval" — don't persist tab selection (CONTEXT.md requirement)
**Warning signs:** Tab state in localStorage, URL query params for tab selection

## Code Examples

Verified patterns from official sources:

### TanStack Table Basic Setup (with Pagination)
```typescript
// Source: https://tanstack.com/table/v8/docs/examples/react/basic
import {
  ColumnDef,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'

function DataTable({ data, columns }: { data: unknown[]; columns: ColumnDef<unknown>[] }) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  return (
    <div>
      <table>
        {/* Table header and body */}
      </table>
      <div>
        <button onClick={() => table.setPageIndex(0)}>First</button>
        <button onClick={() => table.previousPage()}>Previous</button>
        <button onClick={() => table.nextPage()}>Next</button>
        <button onClick={() => table.setPageIndex(table.getPageCount() - 1)}>Last</button>
      </div>
    </div>
  )
}
```

### Column Sorting Setup
```typescript
// Source: https://tanstack.com/table/v8/docs/guide/sorting
import {
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'

const [sorting, setSorting] = useState<SortingState>([])

const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  onSortingChange: setSorting,
  state: { sorting },
})

// Column definition with sorting
const column = {
  accessorKey: 'title',
  header: () => 'Title',
  enableSorting: true,
}
```

### Column Filtering Setup
```typescript
// Source: https://tanstack.com/table/v8/docs/guide/filters
import {
  getFilteredRowModel,
  useReactTable,
  type ColumnFiltersState,
} from '@tanstack/react-table'

const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  onColumnFiltersChange: setColumnFilters,
  state: { columnFilters },
})

// Apply filter
table.getColumn('status')?.setFilterValue(['ImprovementRequest'])
```

### shadcn/ui Tabs Basic Usage
```typescript
// Source: https://ui.shadcn.com/docs/components/tabs
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function TabsDemo() {
  return (
    <Tabs defaultValue="account">
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
      </TabsList>
      <TabsContent value="account">Make changes to your account.</TabsContent>
      <TabsContent value="password">Change your password.</TabsContent>
    </Tabs>
  )
}
```

### shadcn/ui Collapsible Basic Usage
```typescript
// Source: https://ui.shadcn.com/docs/components/collapsible
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

export function CollapsibleDemo() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger>Trigger</CollapsibleTrigger>
      <CollapsibleContent>Content</CollapsibleContent>
    </Collapsible>
  )
}
```

### date-fns Day Grouping Utilities
```typescript
// Source: https://date-fns.org/docs/IsToday
import { format, isToday, isYesterday } from 'date-fns'

const date = new Date()

if (isToday(date)) {
  console.log('Today')
} else if (isYesterday(date)) {
  console.log('Yesterday')
} else {
  console.log(format(date, 'MMMM d, yyyy')) // e.g., "February 5, 2026"
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| React-Table v7 | TanStack Table v8 | 2022 | New hooks-based API, better TypeScript, smaller bundle |
| Manual pagination state | getPaginationRowModel() | TanStack v8 | Built-in pagination state management |
| Server-side only filters | Client + server filtering support | TanStack v8 | Flexibility to choose based on dataset size |

**Current as of:** 2026-02-06

**No deprecations:**
- TanStack Table v8 is actively maintained (latest: v8.21.3+)
- shadcn/ui components are wrappers around stable Radix UI primitives
- date-fns v4.x is current (project uses v4.1.0)

## Open Questions

1. **Activity Timeline Data Source**
   - What we know: RequestActivity model exists with action, fromStatus, toStatus, comments, userId, createdAt
   - What's unclear: Should the timeline show all activities for all requests visible in the current tab, or for a specific selected request?
   - Recommendation: If it's a dashboard-wide activity feed, show recent activities across all visible requests. If it's per-request, it belongs in the request detail modal. Based on phase description ("monitor requests relevant to them"), a dashboard-wide recent activity feed seems appropriate.

2. **"Pending My Approval" Query Logic**
   - What we know: RequestApproval model tracks approvals with approverId, status, order
   - What's unclear: Exact query to find requests "pending my approval" — does this mean any request where there's a pending approval at the user's hierarchy level?
   - Recommendation: Query requests where at least one RequestApproval exists with approverId = current user AND status = pending. This is the simplest and most direct interpretation.

3. **Pagination Initial State**
   - What we know: Default page size should be 10, with options for 25, 50, 100
   - What's unclear: Should pagination reset to page 0 when filters change?
   - Recommendation: Yes, reset to page 0 when filters change to prevent showing empty pages (common UX pattern).

## Sources

### Primary (HIGH confidence)
- TanStack Table v8 Documentation - https://tanstack.com/table/v8/docs/guide/pagination - Pagination setup and configuration
- TanStack Table v8 Documentation - https://tanstack.com/table/v8/docs/guide/sorting - Column sorting implementation
- TanStack Table v8 Documentation - https://tanstack.com/table/v8/docs/guide/filters - Column filtering implementation
- TanStack Table v8 Documentation - https://tanstack.com/table/v8/docs/examples/react/basic - Basic table setup pattern
- shadcn/ui Tabs Documentation - https://ui.shadcn.com/docs/components/tabs - Tabs component API and usage
- shadcn/ui Collapsible Documentation - https://ui.shadcn.com/docs/components/collapsible - Collapsible component API and usage
- date-fns Documentation - https://date-fns.org/docs/IsToday - isToday utility for day grouping
- date-fns Documentation - https://date-fns.org/docs/IsYesterday - isYesterday utility for day grouping
- date-fns Documentation - https://date-fns.org/docs/Format - format utility for date formatting

### Secondary (MEDIUM confidence)
- Existing codebase patterns verified:
  - `/src/components/requests/request-table.tsx` - TanStack Table usage pattern
  - `/src/components/requests/request-filters.tsx` - Real-time filter state management pattern
  - `/src/components/requests/requests-list-with-filters.tsx` - Filter + table integration pattern
  - `/prisma/schema.prisma` - RequestActivity model for timeline data
  - `/package.json` - Verified @tanstack/react-table ^8.21.3, date-fns ^4.1.0

### Tertiary (LOW confidence)
- None — all findings verified with official documentation or existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified in package.json or official documentation
- Architecture: HIGH - Patterns verified with TanStack Table and shadcn/ui official docs
- Pitfalls: HIGH - Based on common TanStack Table mistakes documented in guides
- Code examples: HIGH - All code from official documentation

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - TanStack Table v8 is stable, unlikely to change)
