'use client'

import { useState } from 'react'
import { NeedsActionList, NeedsActionListProps } from './needs-action-list'
import { StatusBadge } from '@/components/requests/status-badge'
import { Card, CardContent } from '@/components/ui/card'
import { FileText, Users, CheckCircle2 } from 'lucide-react'
import { RequestModalRouter } from '@/components/requests/request-modal-router'

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
}

export function EngineeringDashboardTabs({
  needsSolution,
  needsApproval,
  allEngineeringRequests,
  engineeringUsers,
  currentUserId,
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
        <AllEngineeringRequests requests={allEngineeringRequests} />
      )}
    </div>
  )
}

function AllEngineeringRequests({
  requests
}: {
  requests: Array<{
    id: string
    title: string
    status: any
    department: { name: string } | null
    requester: { name: string } | null
    hasRejection?: boolean
  }>
}) {
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const handleRequestClick = (requestId: string) => {
    setSelectedRequestId(requestId)
    setIsModalOpen(true)
  }

  return (
    <>
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
