'use client'

import { useState } from 'react'
import { NeedsActionList, NeedsActionListProps } from './needs-action-list'
import { StatusBadge } from '@/components/requests/status-badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FileText, CheckCircle2 } from 'lucide-react'
import { RequestModalRouter } from '@/components/requests/request-modal-router'
import { getStaleSubTaskRequests } from '@/server-actions/engineering-sub-tasks'

interface EngineeringDashboardTabsProps extends NeedsActionListProps {
  allEngineeringRequests: Array<{
    id: string
    title: string
    status: any
    department: { name: string } | null
    requester: { name: string } | null
    hasRejection?: boolean
  }>
  currentUserId: string
  subTaskStages: Array<{ id: string; name: string; isOthers: boolean }>
}

export function EngineeringDashboardTabs({
  needsSolution,
  needsApproval,
  allEngineeringRequests,
  engineeringUsers,
  currentUserId,
  subTaskStages,
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
            All Engineering Requests
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
        <AllEngineeringRequests requests={allEngineeringRequests} subTaskStages={subTaskStages} />
      )}
    </div>
  )
}

type StaleRequest = {
  id: string
  title: string
  status: any
  department: { name: string } | null
  requester: { name: string } | null
  subTasks: Array<{
    id: string
    description: string
    updatedAt: Date | string
    stage: { id: string; name: string }
    subContractor: { name: string } | null
  }>
}

function AllEngineeringRequests({
  requests,
  subTaskStages,
}: {
  requests: Array<{
    id: string
    title: string
    status: any
    department: { name: string } | null
    requester: { name: string } | null
    hasRejection?: boolean
  }>
  subTaskStages: Array<{ id: string; name: string; isOthers: boolean }>
}) {
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [stageId, setStageId] = useState<string>('all')
  const [olderThanDays, setOlderThanDays] = useState<string>('')
  const [staleRequests, setStaleRequests] = useState<StaleRequest[]>([])
  const [loadingStale, setLoadingStale] = useState(false)

  const handleRequestClick = (requestId: string) => {
    setSelectedRequestId(requestId)
    setIsModalOpen(true)
  }

  const loadStaleRequests = async () => {
    const days = Number(olderThanDays)
    if (!days || days <= 0) {
      setStaleRequests([])
      return
    }

    setLoadingStale(true)
    try {
      const rows = await getStaleSubTaskRequests({
        olderThanDays: days,
        stageId: stageId === 'all' ? undefined : stageId,
      })
      setStaleRequests(rows)
    } finally {
      setLoadingStale(false)
    }
  }

  const formatLastUpdate = (value: Date | string) => (
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value))
  )

  return (
    <>
      <div className="rounded-lg border bg-gray-50 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Sub-task follow-up filter</h3>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
          <Select value={stageId} onValueChange={setStageId}>
            <SelectTrigger>
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {subTaskStages.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>
                  {stage.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            value={olderThanDays}
            onChange={(event) => setOlderThanDays(event.target.value)}
            placeholder="Last update older than X days"
            aria-label="Last update older than days"
          />
          <Button onClick={loadStaleRequests} disabled={loadingStale}>
            {loadingStale ? 'Finding...' : 'Find stuck sub-tasks'}
          </Button>
        </div>
      </div>

      {staleRequests.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Stuck sub-tasks</h2>
            <div className="space-y-2">
              {staleRequests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => handleRequestClick(request.id)}
                  className="w-full p-4 border rounded-lg text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-medium text-gray-900">{request.title}</h3>
                      <p className="text-sm text-gray-500 mt-1">
                        {request.department?.name || 'No department'} •{' '}
                        {request.requester?.name || 'Unknown'}
                      </p>
                    </div>
                    <StatusBadge status={request.status} />
                  </div>
                  <div className="mt-3 space-y-2">
                    {request.subTasks.map((subTask) => (
                      <div key={subTask.id} className="rounded-md bg-white px-3 py-2 text-sm text-gray-700">
                        <div className="font-medium text-gray-900">{subTask.description}</div>
                        <div className="mt-1 text-gray-500">
                          {subTask.stage.name}
                          {subTask.subContractor ? ` • ${subTask.subContractor.name}` : ''}
                          {' • '}
                          Last update {formatLastUpdate(subTask.updatedAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">All Engineering Requests</h2>
          {requests.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              No engineering requests found
            </div>
          ) : (
            <div className="space-y-2">
              {requests.map((request) => (
                <div
                  key={request.id}
                  onClick={() => handleRequestClick(request.id)}
                  className="p-4 border rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900">{request.title}</h3>
                      <p className="text-sm text-gray-500 mt-1">
                        {request.department?.name || 'No department'} •{' '}
                        {request.requester?.name || 'Unknown'}
                      </p>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={request.status} hasRejection={request.hasRejection} />
                    </div>
                  </div>
                </div>
              ))}
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
