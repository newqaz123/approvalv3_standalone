import { auth } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import { getRequestsNeedingEngineeringAction, getEngineeringUsers } from '@/server-actions/requests'
import { getEngineeringSubTaskOptions } from '@/server-actions/engineering-sub-tasks'
import { EngineeringDashboardTabs } from '@/components/engineering/engineering-dashboard-tabs'
import { FileText, Clock, CheckCircle2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export const metadata = {
  title: 'Engineering Dashboard | Approval System',
}

export default async function EngineeringDashboardPage() {
  const session = await auth()
  const userId = session?.user?.id

  if (!userId) {
    redirect('/sign-in')
  }

  // Get current user with role
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      departmentId: true,
    },
  })

  // Validate user has engineering role
  if (!user || user.role !== 'engineering') {
    redirect('/dashboard')
  }

  // Get engineering department for stats
  const engineeringDept = await prisma.departments.findFirst({
    where: { type: 'ENGINEERING' },
    select: { id: true },
  })

  // Fetch needs action data
  const needsActionData = await getRequestsNeedingEngineeringAction(userId)

  // Fetch engineering users for Person in Charge selector
  const engineeringUsers = await getEngineeringUsers()

  const subTaskOptions = await getEngineeringSubTaskOptions()

  // Fetch all engineering requests for "All Engineering Requests" tab
  const allEngineeringRequestsRaw = await prisma.requests.findMany({
    where: {
      status: {
        in: ['SentToEngineer', 'DesignCostEstimationApproval', 'SendBackToRequester'],
      },
      isDeleted: false,
    },
    include: {
      department: {
        select: {
          name: true,
        },
      },
      requester: {
        select: {
          name: true,
        },
      },
      solutions: {
        select: {
          approvals: {
            where: { status: 'rejected' },
            take: 1,
          },
        },
      },
      activities: {
        where: { action: 'solution_rejected' },
        take: 1,
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  // Send only plain fields used by the client component. Full Prisma records
  // include Decimal values, which cannot cross the Server/Client boundary.
  const allEngineeringRequests = allEngineeringRequestsRaw.map(request => ({
    id: request.id,
    title: request.title,
    status: request.status,
    department: request.department,
    requester: request.requester,
    hasRejection: request.solutions.some(s => s.approvals.length > 0) || request.activities.length > 0,
  }))

  // Calculate quick stats
  const totalInPipeline = await prisma.requests.count({
    where: {
      status: {
        in: ['SentToEngineer', 'DesignCostEstimationApproval'],
      },
      isDeleted: false,
    },
  })

  const awaitingSolution = await prisma.requests.count({
    where: {
      status: 'SentToEngineer',
      isDeleted: false,
    },
  })

  const inApprovalProcess = await prisma.requests.count({
    where: {
      status: 'DesignCostEstimationApproval',
      isDeleted: false,
    },
  })

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Engineering Dashboard</h1>
        <p className="text-gray-600 mt-1">
          Manage engineering solutions and approvals
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Total in Pipeline
                </p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {totalInPipeline}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Awaiting Solution
                </p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {awaitingSolution}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-yellow-100 flex items-center justify-center">
                <Clock className="h-6 w-6 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  In Approval Process
                </p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {inApprovalProcess}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tab Navigation with Client-side Filtering */}
      <EngineeringDashboardTabs
        needsSolution={needsActionData.needsSolution}
        needsApproval={needsActionData.needsApproval}
        allEngineeringRequests={allEngineeringRequests}
        engineeringUsers={engineeringUsers}
        currentUserId={userId}
        subTaskStages={subTaskOptions.stages}
      />
    </div>
  )
}
