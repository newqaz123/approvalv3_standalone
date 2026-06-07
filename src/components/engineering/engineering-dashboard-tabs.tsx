'use client'

import { KeyboardEvent, useMemo, useState } from 'react'
import { NeedsActionList, NeedsActionListProps } from './needs-action-list'
import { StatusBadge } from '@/components/requests/status-badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RequestModalRouter } from '@/components/requests/request-modal-router'
import { Badge } from '@/components/ui/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Check, ChevronsUpDown, Clock, Info, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSubTaskSummary } from '@/lib/engineering-sub-tasks'

const ENGINEER_UNASSIGNED_FILTER = 'unassigned'
const STALE_DAY_PRESETS = ['3', '7', '14', '30']

interface EngineeringDashboardTabsProps extends NeedsActionListProps {
  allEngineeringRequests: Array<{
    id: string
    title: string
    status: any
    workRequisitionReceived: boolean
    department: { name: string } | null
    requester: { name: string } | null
    hasRejection?: boolean
    assignedEngineers: Array<{ id: string; name: string }>
    subTasks: Array<{
      id: string
      description: string
      customStageText?: string | null
      isCompleted: boolean
      updatedAt: Date | string
      stage: { id: string; name: string; isOthers: boolean }
      subContractor: { id: string; name: string } | null
    }>
  }>
  currentUserId: string
  subTaskStages: Array<{ id: string; name: string; isOthers: boolean }>
  subContractors: Array<{ id: string; name: string }>
  engineeringUsers: Array<{ id: string; name: string; email: string; level: number | null }>
}

export function EngineeringDashboardTabs({
  needsSolution,
  needsApproval,
  allEngineeringRequests,
  engineeringUsers,
  currentUserId,
  subTaskStages,
  subContractors,
}: EngineeringDashboardTabsProps) {
  const [activeTab, setActiveTab] = useState<'needs-action' | 'all'>('needs-action')

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('needs-action')}
            className={`border-b-2 py-4 px-1 text-sm font-medium ${
              activeTab === 'needs-action'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Needs My Action
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`border-b-2 py-4 px-1 text-sm font-medium ${
              activeTab === 'all'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Follow up work
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'needs-action' ? (
        <>
          {/* Needs Action List */}
          <NeedsActionList
            needsSolution={needsSolution}
            needsApproval={needsApproval}
            engineeringUsers={engineeringUsers}
            currentUserId={currentUserId}
          />
        </>
      ) : (
        <AllEngineeringRequests
          requests={allEngineeringRequests}
          subTaskStages={subTaskStages}
          subContractors={subContractors}
          engineeringUsers={engineeringUsers}
        />
      )}
    </div>
  )
}

type FollowUpRequest = {
  id: string
  title: string
  status: any
  workRequisitionReceived: boolean
  department: { name: string } | null
  requester: { name: string } | null
  hasRejection?: boolean
  assignedEngineers: Array<{ id: string; name: string }>
  subTasks: Array<{
    id: string
    description: string
    customStageText?: string | null
    isCompleted: boolean
    updatedAt: Date | string
    stage: { id: string; name: string; isOthers: boolean }
    subContractor: { id: string; name: string } | null
  }>
}

function AllEngineeringRequests({
  requests,
  subTaskStages,
  subContractors,
  engineeringUsers,
}: {
  requests: FollowUpRequest[]
  subTaskStages: Array<{ id: string; name: string; isOthers: boolean }>
  subContractors: Array<{ id: string; name: string }>
  engineeringUsers: Array<{ id: string; name: string; email: string; level: number | null }>
}) {
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedStage, setSelectedStage] = useState<string | null>(null)
  const [subContractorIds, setSubContractorIds] = useState<string[]>([])
  const [subContractorQuery, setSubContractorQuery] = useState('')
  const [subContractorFilterOpen, setSubContractorFilterOpen] = useState(false)
  const [olderThanDays, setOlderThanDays] = useState<string>('all')
  const [staleFilterOpen, setStaleFilterOpen] = useState(false)
  const [selectedEngineer, setSelectedEngineer] = useState<string | null>(null)

  const sortedSubContractors = useMemo(() => (
    [...subContractors].sort((left, right) => left.name.localeCompare(right.name))
  ), [subContractors])

  const filteredSubContractors = useMemo(() => (
    sortedSubContractors.filter((subContractor) => fuzzyMatch(subContractor.name, subContractorQuery))
  ), [sortedSubContractors, subContractorQuery])

  const selectedSubContractorIdSet = useMemo(() => new Set(subContractorIds), [subContractorIds])
  const selectedSubContractors = sortedSubContractors.filter((subContractor) => (
    selectedSubContractorIdSet.has(subContractor.id)
  ))
  const selectedStalePreset = STALE_DAY_PRESETS.find((preset) => preset === olderThanDays)
  const visibleSubContractorChips = subContractorIds.length >= 3 ? [] : selectedSubContractors
  const collapsedSubContractorChip = subContractorIds.length >= 3
    ? `${selectedSubContractors.length} subcontractors`
    : null
  const subContractorButtonLabel = selectedSubContractors.length === 1
    ? selectedSubContractors[0].name
    : selectedSubContractors.length > 1
      ? 'Subcontractor'
      : 'Add'
  const hasActiveFilters = selectedStage !== null
    || subContractorIds.length > 0
    || olderThanDays !== 'all'
    || selectedEngineer !== null

  const filteredRequests = requests.filter((request) => {
    const hasStageFilter = selectedStage !== null
    const hasSubContractorFilter = subContractorIds.length > 0
    const hasEngineerFilter = selectedEngineer !== null
    const days = Number(olderThanDays)
    const hasOlderThanFilter = Number.isFinite(days) && days > 0
    const threshold = hasOlderThanFilter
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      : null
    const matchesEngineer = !hasEngineerFilter
      || (selectedEngineer === ENGINEER_UNASSIGNED_FILTER
        ? request.assignedEngineers.length === 0
        : request.assignedEngineers.some((engineer) => engineer.id === selectedEngineer))

    if (!matchesEngineer) return false

    if (!hasStageFilter && !hasSubContractorFilter && !hasOlderThanFilter) {
      return true
    }

    return request.subTasks.some((subTask) => {
      const matchesStage = !hasStageFilter || subTask.stage.id === selectedStage
      const matchesSubContractor = !hasSubContractorFilter
        || (!!subTask.subContractor?.id && selectedSubContractorIdSet.has(subTask.subContractor.id))
      const matchesOlderThanDays = !threshold || (!subTask.isCompleted && new Date(subTask.updatedAt) <= threshold)

      return matchesStage && matchesSubContractor && matchesOlderThanDays
    })
  })

  const handleRequestClick = (requestId: string) => {
    setSelectedRequestId(requestId)
    setIsModalOpen(true)
  }

  const handleRequestRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, requestId: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    handleRequestClick(requestId)
  }

  const formatLastUpdate = (value: Date | string) => (
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value))
  )

  const toggleSubContractorFilter = (id: string) => {
    setSubContractorIds((current) => (
      current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id]
    ))
    setSubContractorQuery('')
  }

  const removeSubContractorFilter = (id: string) => {
    setSubContractorIds((current) => current.filter((currentId) => currentId !== id))
  }

  const clearSubContractorFilter = () => {
    setSubContractorIds([])
    setSubContractorQuery('')
  }

  const clearAllFilters = () => {
    setSelectedStage(null)
    setSubContractorIds([])
    setSubContractorQuery('')
    setOlderThanDays('all')
    setSelectedEngineer(null)
  }

  const handleSubContractorPillClick = (event: React.MouseEvent<HTMLButtonElement>, name: string) => {
    event.stopPropagation()
    const subContractor = sortedSubContractors.find((item) => item.name === name)
    if (!subContractor) return

    setSubContractorIds((current) => (
      current.includes(subContractor.id) ? current : [...current, subContractor.id]
    ))
    setSubContractorQuery('')
  }

  return (
    <>
      <div className="rounded-lg border bg-gray-50 px-4 py-3">
        <div data-testid="follow-up-filter-chipline" className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm font-semibold text-gray-500">Stage</span>
          {subTaskStages.map((stage) => (
            <FilterChip
              key={stage.id}
              active={selectedStage === stage.id}
              onClick={() => setSelectedStage(selectedStage === stage.id ? null : stage.id)}
            >
              {stage.name}
            </FilterChip>
          ))}

          <FilterSeparator />

          <span className="mx-1 text-sm font-semibold text-gray-500">Sub-contractor</span>
          {visibleSubContractorChips.map((subContractor) => (
            <Badge key={subContractor.id} className="gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-50">
              {subContractor.name}
              <button
                type="button"
                aria-label={`Remove ${subContractor.name} subcontractor filter`}
                onClick={() => removeSubContractorFilter(subContractor.id)}
                className="rounded-full text-blue-500 hover:text-blue-700"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {collapsedSubContractorChip && (
            <Badge className="gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-50">
              {collapsedSubContractorChip}
              <button
                type="button"
                aria-label="Clear subcontractor filters"
                onClick={clearSubContractorFilter}
                className="rounded-full text-blue-500 hover:text-blue-700"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          <Popover open={subContractorFilterOpen} onOpenChange={setSubContractorFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-label="Subcontractor filter"
                aria-expanded={subContractorFilterOpen}
                className="h-8 gap-2 rounded-full border-dashed bg-white px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="max-w-32 truncate">{subContractorButtonLabel}</span>
                {selectedSubContractors.length >= 2 && (
                  <span className="ml-0.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    {selectedSubContractors.length}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  value={subContractorQuery}
                  onValueChange={setSubContractorQuery}
                  placeholder="Search subcontractor"
                />
                <CommandList>
                  <CommandGroup>
                    {filteredSubContractors.map((subContractor) => (
                      <CommandItem
                        key={subContractor.id}
                        value={subContractor.name}
                        className="gap-2"
                        onSelect={() => {
                          toggleSubContractorFilter(subContractor.id)
                        }}
                      >
                        <Checkbox
                          checked={selectedSubContractorIdSet.has(subContractor.id)}
                          aria-label={`${subContractor.name} subcontractor filter`}
                          tabIndex={-1}
                          className="h-4 w-4"
                        />
                        <span className="truncate">{subContractor.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {filteredSubContractors.length === 0 && (
                    <CommandEmpty>No subcontractors found</CommandEmpty>
                  )}
                </CommandList>
                <div className="border-t p-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearSubContractorFilter}
                    className="h-8 w-full justify-center text-xs font-semibold text-gray-600"
                    disabled={subContractorIds.length === 0}
                  >
                    Clear
                  </Button>
                </div>
              </Command>
            </PopoverContent>
          </Popover>

          <FilterSeparator />

          <span className="mx-1 text-sm font-semibold text-gray-500">Stale</span>
          <Popover open={staleFilterOpen} onOpenChange={setStaleFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-8 gap-2 rounded-full bg-white px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                aria-label="Last update > X days"
              >
                <Clock className="h-3.5 w-3.5" />
                {selectedStalePreset ? `>${selectedStalePreset} days` : 'Any date'}
                {!selectedStalePreset && <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="start">
              <div className="space-y-1">
                <FilterMenuItem active={olderThanDays === 'all'} onClick={() => {
                  setOlderThanDays('all')
                  setStaleFilterOpen(false)
                }}>
                  Any update
                </FilterMenuItem>
                {STALE_DAY_PRESETS.map((days) => (
                  <FilterMenuItem key={days} active={olderThanDays === days} onClick={() => {
                    setOlderThanDays(days)
                    setStaleFilterOpen(false)
                  }}>
                    <span className="flex flex-col items-start leading-tight">
                      <span>&gt;{days} days</span>
                      <span className="text-xs font-normal text-gray-500">No update &gt; {days} days</span>
                    </span>
                  </FilterMenuItem>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <FilterSeparator />

          <span className="mx-1 text-sm font-semibold text-gray-500">Engineer PIC</span>
          <FilterChip
            active={selectedEngineer === ENGINEER_UNASSIGNED_FILTER}
            onClick={() => setSelectedEngineer(selectedEngineer === ENGINEER_UNASSIGNED_FILTER ? null : ENGINEER_UNASSIGNED_FILTER)}
          >
            Unassigned
          </FilterChip>
          {engineeringUsers.map((engineer) => (
            <FilterChip
              key={engineer.id}
              active={selectedEngineer === engineer.id}
              onClick={() => setSelectedEngineer(selectedEngineer === engineer.id ? null : engineer.id)}
            >
              {engineer.name}
            </FilterChip>
          ))}

          {hasActiveFilters && (
            <>
              <FilterSeparator />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="h-8 rounded-full px-3 text-xs font-semibold text-gray-600 hover:bg-white"
              >
                Clear all
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="mb-4 flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            <Info className="h-4 w-4 shrink-0" />
            <span>
              This table does not show completed requests, including work with WR received and every sub-task checked complete, or cancelled work.
            </span>
          </p>
          {filteredRequests.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              No engineering requests found
            </div>
          ) : (
            <div className="space-y-2">
              {filteredRequests.map((request) => {
                const summary = getSubTaskSummary(request.subTasks)
                const isComplete = summary.total > 0 && summary.completed === summary.total
                const progressValue = summary.total === 0
                  ? 0
                  : Math.round((summary.completed / summary.total) * 100)
                const subContractorNames = Array.from(new Set(
                  request.subTasks
                    .map((subTask) => subTask.subContractor?.name)
                    .filter(Boolean) as string[]
                )).sort((left, right) => left.localeCompare(right))

                return (
                  <div
                    key={request.id}
                    role="button"
                    tabIndex={0}
                    data-testid="engineering-request-row"
                    data-request-id={request.id}
                    data-request-status={request.status}
                    onClick={() => handleRequestClick(request.id)}
                    onKeyDown={(event) => handleRequestRowKeyDown(event, request.id)}
                    className="w-full cursor-pointer rounded-lg border p-4 text-left transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    <div className="space-y-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="truncate font-medium text-gray-900">{request.title}</h3>
                        {request.hasRejection && (
                          <Badge variant="destructive" className="shrink-0">Rejected</Badge>
                        )}
                        {request.workRequisitionReceived && (
                          <Badge className="shrink-0 border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                            WR Received
                          </Badge>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                        <div className="min-w-[120px] flex-1">
                          <HoverCard>
                            <HoverCardTrigger asChild>
                              <button
                                type="button"
                                className="group/progress flex w-full cursor-pointer items-center gap-2 rounded-md px-0 text-left"
                                aria-label={`Sub-task progress ${summary.completed} of ${summary.total} completed`}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <Progress
                                  value={progressValue}
                                  className="h-2 min-w-24 bg-slate-200 transition-all duration-150 group-hover/progress:h-3 [&>div]:bg-emerald-500"
                                />
                                <span className="shrink-0 font-medium text-gray-500">{summary.completed}/{summary.total}</span>
                              </button>
                            </HoverCardTrigger>
                            <HoverCardContent align="start" className="w-96">
                              <div className="space-y-2">
                                <p className="text-sm font-semibold text-gray-900">Sub-task items</p>
                                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                                  {request.subTasks.length === 0 ? (
                                    <div className="rounded-md border border-dashed p-3 text-sm text-gray-500">
                                      No sub-tasks yet
                                    </div>
                                  ) : (
                                    request.subTasks.map((subTask) => {
                                      const stageName = subTask.stage.isOthers && subTask.customStageText
                                        ? subTask.customStageText
                                        : subTask.stage.name

                                      return (
                                        <div key={subTask.id} className="rounded-md border p-3 text-sm">
                                          <div className="flex items-start justify-between gap-2">
                                            <p className="font-medium text-gray-900">{subTask.description}</p>
                                            <Badge className={cn(
                                              'shrink-0',
                                              stageName.toLowerCase() === 'completed'
                                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-100'
                                            )} aria-label="Stage badge">
                                              {stageName}
                                            </Badge>
                                          </div>
                                          <p className="mt-2 text-xs text-gray-500">
                                            <span className={cn(
                                              'font-medium',
                                              subTask.isCompleted ? 'text-emerald-700' : 'text-gray-500'
                                            )}>
                                              {subTask.isCompleted ? 'Completed' : 'Not completed'}
                                            </span>
                                            {' • '}
                                            {subTask.subContractor?.name ?? 'No subcontractor'} • Last update {formatLastUpdate(subTask.updatedAt)}
                                          </p>
                                        </div>
                                      )
                                    })
                                  )}
                                </div>
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        </div>
                        <Badge className={cn(
                          isComplete
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-100'
                        )}>
                          {isComplete ? 'Completed' : 'Not completed'}
                        </Badge>
                        {subContractorNames.length > 0 ? (
                          subContractorNames.map((name) => (
                            <button
                              key={name}
                              type="button"
                              onClick={(event) => handleSubContractorPillClick(event, name)}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                            >
                              {name}
                            </button>
                          ))
                        ) : (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-500">
                            No subcontractor
                          </span>
                        )}
                        <StatusBadge status={request.status} hasRejection={request.hasRejection} />
                        <span>{request.department?.name || 'No department'}</span>
                        <span>{request.requester?.name || 'Unknown'}</span>
                        <span>
                          PIC: {request.assignedEngineers.length > 0
                            ? request.assignedEngineers.map((engineer) => engineer.name).join(', ')
                            : 'Unassigned'}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Request Modal Router */}
      {selectedRequestId && (
        <RequestModalRouter
          requestId={selectedRequestId}
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
          onActionComplete={() => {
            window.location.reload()
          }}
        />
      )}
    </>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'default' : 'outline'}
      onClick={onClick}
      className={cn(
        'h-8 rounded-full px-3 text-xs',
        active ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50'
      )}
    >
      {children}
    </Button>
  )
}

function FilterSeparator() {
  return <span className="mx-3 hidden h-8 w-px bg-gray-300 sm:inline-block" aria-hidden="true" />
}

function FilterMenuItem({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-gray-100',
        active ? 'font-semibold text-blue-700' : 'text-gray-700'
      )}
    >
      {children}
      {active && <Check className="h-4 w-4" />}
    </button>
  )
}

function fuzzyMatch(value: string, query: string) {
  const normalizedValue = value.toLowerCase()
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  let queryIndex = 0
  for (const character of normalizedValue) {
    if (character === normalizedQuery[queryIndex]) queryIndex += 1
    if (queryIndex === normalizedQuery.length) return true
  }

  return false
}
