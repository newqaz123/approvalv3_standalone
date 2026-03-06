'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { FileText, Users, CheckCircle2 } from 'lucide-react'
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
import { StatusBadge } from '@/components/requests/status-badge'
import { RequestModalRouter } from '@/components/requests/request-modal-router'
import { RejectedBadge } from '@/components/requests/rejected-badge'
import { EngineerPicPicker } from './engineer-pic-picker'

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
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Requests Awaiting Solution
                </p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {needsSolution.length}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
            </div>
            {needsSolution.length > 0 && (
              <Link href="/engineering?status=SentToEngineer">
                <Button variant="link" className="mt-2 p-0 h-auto text-sm">
                  View all requests →
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Solutions Awaiting Your Approval
                </p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {needsApproval.length}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-purple-600" />
              </div>
            </div>
            {needsApproval.length > 0 && (
              <Link href="/engineering?status=DesignCostEstimationApproval">
                <Button variant="link" className="mt-2 p-0 h-auto text-sm">
                  View all approvals →
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Section 1: Requests Awaiting Solution */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Requests Awaiting Solution
        </h2>
        {needsSolution.length === 0 ? (
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
                  {needsSolution.map(({ request, assignedEngineers }) => (
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
                        <EngineerPicPicker
                          requestId={request.id}
                          engineeringUsers={engineeringUsers}
                          initialAssignedIds={assignedEngineers.map((e: any) => e.id)}
                          currentUserId={currentUserId}
                        />
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

      {/* Section 2: Solutions Awaiting Your Approval */}
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
