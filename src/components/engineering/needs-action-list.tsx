'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { FileText, CheckCircle2 } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { RequestModalRouter } from '@/components/requests/request-modal-router'
import { RejectedBadge } from '@/components/requests/rejected-badge'
import { EngineerPicPicker } from './engineer-pic-picker'
import { cn } from '@/lib/utils'

const ENGINEER_ALL_FILTER = 'all'
const ENGINEER_UNASSIGNED_FILTER = 'unassigned'

export interface NeedsActionListProps {
  needsSolution: Array<{
    request: any
    assignedEngineers: any[]
  }>
  needsApproval: Array<{
    request: any
    solution: any
    approval: any
  }>
  engineeringUsers: Array<{
    id: string
    name: string
    email: string
    level: number | null
  }>
  currentUserId: string
}

export function NeedsActionList({
  needsSolution,
  needsApproval,
  engineeringUsers,
  currentUserId,
}: NeedsActionListProps) {
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedSolutionRequestId, setSelectedSolutionRequestId] = useState<string | null>(null)
  const [isSolutionModalOpen, setIsSolutionModalOpen] = useState(false)
  const [engineerId, setEngineerId] = useState<string>(ENGINEER_ALL_FILTER)

  const filteredNeedsSolution = needsSolution.filter(({ assignedEngineers }) => {
    const matchesEngineer = engineerId === ENGINEER_ALL_FILTER
      || (engineerId === ENGINEER_UNASSIGNED_FILTER
        ? assignedEngineers.length === 0
        : assignedEngineers.some((engineer) => engineer.id === engineerId))

    return matchesEngineer
  })

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: currency,
    }).format(amount)
  }

  const handleReviewApprove = (requestId: string) => {
    setSelectedRequestId(requestId)
    setIsModalOpen(true)
  }

  const handleSubmitSolution = (requestId: string) => {
    setSelectedSolutionRequestId(requestId)
    setIsSolutionModalOpen(true)
  }

  return (
    <div className="space-y-6">
      {/* Section 1: Solutions Awaiting Your Approval */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5" />
          Solutions Awaiting Your Approval
        </h2>
        {needsApproval.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-gray-500">
              No solutions awaiting your approval
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Request Title</TableHead>
                    <TableHead>Solution By</TableHead>
                    <TableHead>Cost Estimate</TableHead>
                    <TableHead>Submitted Date</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {needsApproval.map(({ request, solution, approval }) => (
                    <TableRow key={solution.id}>
                      <TableCell className="font-medium">
                        {request.title}
                      </TableCell>
                      <TableCell>
                        {solution.submittedBy?.name || '-'}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(
                          Number(solution.costEstimate),
                          solution.currency
                        )}
                      </TableCell>
                      <TableCell>
                        {format(new Date(solution.submittedAt), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReviewApprove(request.id)}
                        >
                          Review & Approve
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>

      {/* Section 2: Requests Awaiting Solution */}
      <div>
        <div className="mb-4 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Requests Awaiting Solution
          </h2>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-gray-500">Engineer PIC</p>
            <div className="flex flex-wrap gap-2">
              <EngineerFilterChip
                active={engineerId === ENGINEER_ALL_FILTER}
                onClick={() => setEngineerId(ENGINEER_ALL_FILTER)}
              >
                All PIC
              </EngineerFilterChip>
              <EngineerFilterChip
                active={engineerId === ENGINEER_UNASSIGNED_FILTER}
                onClick={() => setEngineerId(ENGINEER_UNASSIGNED_FILTER)}
              >
                Unassigned
              </EngineerFilterChip>
              {engineeringUsers.map((engineer) => (
                <EngineerFilterChip
                  key={engineer.id}
                  active={engineerId === engineer.id}
                  onClick={() => setEngineerId(engineer.id)}
                >
                  {engineer.name}
                </EngineerFilterChip>
              ))}
            </div>
          </div>
        </div>
        {filteredNeedsSolution.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-gray-500">
              No requests awaiting solution
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Requester</TableHead>
                    <TableHead>Submitted Date</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredNeedsSolution.map(({ request, assignedEngineers }) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {request.title}
                          {request.hasRejection && <RejectedBadge size="sm" showText={false} />}
                        </div>
                      </TableCell>
                      <TableCell>{request.department?.name || '-'}</TableCell>
                      <TableCell>{request.requester?.name || '-'}</TableCell>
                      <TableCell>
                        {format(new Date(request.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <EngineerPicPicker
                            requestId={request.id}
                            engineeringUsers={engineeringUsers}
                            initialAssignedIds={assignedEngineers.map((e: any) => e.id)}
                            currentUserId={currentUserId}
                          />
                          {assignedEngineers.length === 0 && (
                            <Badge variant="secondary" className="rounded-full text-xs">
                              Unassigned
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleSubmitSolution(request.id)}
                        >
                          {request.hasRejection ? 'Resubmit Solution' : 'Submit Solution'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>

      {/* Request Modal Router for Approvals */}
      {selectedRequestId && (
        <RequestModalRouter
          requestId={selectedRequestId}
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
          onActionComplete={() => {
            // Refresh the page to update the lists
            window.location.reload()
          }}
        />
      )}

      {/* Request Modal Router for Solution Submission */}
      {selectedSolutionRequestId && (
        <RequestModalRouter
          requestId={selectedSolutionRequestId}
          open={isSolutionModalOpen}
          onOpenChange={setIsSolutionModalOpen}
          onActionComplete={() => {
            // Refresh the page to update the lists
            window.location.reload()
          }}
        />
      )}
    </div>
  )
}

function EngineerFilterChip({
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
