import { auth } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import { getRequestsNeedingEngineeringAction, getEngineeringUsers } from '@/server-actions/requests'
import { getEngineeringSubTaskOptions } from '@/server-actions/engineering-sub-tasks'
import { EngineeringDashboardTabs } from '@/components/engineering/engineering-dashboard-tabs'
import { FileText, Clock, CheckCircle2, TrendingUp, Minus } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

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

  // Fetch engineering requests for the Follow up work tab
  const allEngineeringRequestsRaw = await prisma.requests.findMany({
    where: {
      status: {
        in: ['SentToEngineer', 'SendBackToRequester', 'FinalApproval'],
      },
      isDeleted: false,
      OR: [
        { workRequisitionReceived: false },
        { subTasks: { some: { isCompleted: false } } },
      ],
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
      engineerAssignments: {
        include: {
          engineer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      subTasks: {
        select: {
          id: true,
          description: true,
          customStageText: true,
          isCompleted: true,
          updatedAt: true,
          stage: {
            select: {
              id: true,
              name: true,
              isOthers: true,
            },
          },
          subContractor: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: [
          { isCompleted: 'asc' },
          { updatedAt: 'desc' },
        ],
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
    workRequisitionReceived: request.workRequisitionReceived,
    department: request.department,
    requester: request.requester,
    hasRejection: request.solutions.some(s => s.approvals.length > 0) || request.activities.length > 0,
    assignedEngineers: request.engineerAssignments.map((assignment) => assignment.engineer),
    subTasks: request.subTasks.map((subTask) => ({
      id: subTask.id,
      description: subTask.description,
      customStageText: subTask.customStageText,
      isCompleted: subTask.isCompleted,
      updatedAt: subTask.updatedAt.toISOString(),
      stage: subTask.stage,
      subContractor: subTask.subContractor,
    })),
  }))

  // Calculate quick stats
  const totalInPipeline = await prisma.requests.count({
    where: {
      status: {
        in: ['SentToEngineer', 'SendBackToRequester', 'DesignCostEstimationApproval', 'FinalApproval'],
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

  const startOfYesterday = new Date()
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  startOfYesterday.setHours(0, 0, 0, 0)

  const [totalInPipelineDelta, awaitingSolutionDelta, inApprovalProcessDelta] = await Promise.all([
    prisma.requests.count({
      where: {
        status: {
          in: ['SentToEngineer', 'SendBackToRequester', 'DesignCostEstimationApproval', 'FinalApproval'],
        },
        isDeleted: false,
        createdAt: { gte: startOfYesterday },
      },
    }),
    prisma.requests.count({
      where: {
        status: 'SentToEngineer',
        isDeleted: false,
        createdAt: { gte: startOfYesterday },
      },
    }),
    prisma.requests.count({
      where: {
        status: 'DesignCostEstimationApproval',
        isDeleted: false,
        createdAt: { gte: startOfYesterday },
      },
    }),
  ])

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
        <EngineeringMetricCard
          title="Total in Pipeline"
          value={totalInPipeline}
          description="Active engineering workload"
          detail="Sent back, final approval, and pending solution"
          deltaValue={totalInPipelineDelta}
          icon={FileText}
          tone="blue"
        />
        <EngineeringMetricCard
          title="Awaiting Solution"
          value={awaitingSolution}
          description="Needs engineering response"
          detail="Open requests waiting for solution submission"
          deltaValue={awaitingSolutionDelta}
          icon={Clock}
          tone="amber"
        />
        <EngineeringMetricCard
          title="In Approval Process"
          value={inApprovalProcess}
          description="Solution review in progress"
          detail="Submitted solutions waiting for approval"
          deltaValue={inApprovalProcessDelta}
          icon={CheckCircle2}
          tone="violet"
        />
      </div>

      {/* Tab Navigation with Client-side Filtering */}
      <EngineeringDashboardTabs
        needsSolution={needsActionData.needsSolution}
        needsApproval={needsActionData.needsApproval}
        allEngineeringRequests={allEngineeringRequests}
        engineeringUsers={engineeringUsers}
        currentUserId={userId}
        subTaskStages={subTaskOptions.stages}
        subContractors={subTaskOptions.subcontractors}
      />
    </div>
  )
}

function EngineeringMetricCard({
  title,
  value,
  description,
  detail,
  deltaValue,
  icon: Icon,
  tone,
}: {
  title: string
  value: number
  description: string
  detail: string
  deltaValue: number
  icon: typeof FileText
  tone: 'blue' | 'amber' | 'violet'
}) {
  const isZeroState = value === 0
  const toneClasses = {
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    violet: 'border-violet-200 bg-violet-50 text-violet-700',
  }
  const activeBarClass = tone === 'blue' ? 'bg-blue-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-violet-500'
  const DeltaIcon = deltaValue > 0 ? TrendingUp : Minus

  return (
    <Card className={cn('overflow-hidden transition-colors', isZeroState && 'border-gray-200 bg-gray-50')}>
      <CardContent className="p-0">
        <div className={cn('h-1', isZeroState ? 'bg-gray-200' : activeBarClass)} />
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className={cn('text-sm font-semibold', isZeroState ? 'text-gray-400' : 'text-gray-600')}>{title}</p>
              <p className={cn('mt-2 text-3xl font-bold', isZeroState ? 'text-gray-400' : 'text-gray-950')}>{value}</p>
              <p className={cn('mt-2 text-sm font-medium', isZeroState ? 'text-gray-500' : 'text-gray-800')}>{description}</p>
              <p className="mt-1 text-xs text-gray-500">{detail}</p>
              <p className={cn('mt-3 flex items-center gap-1 text-xs font-medium', deltaValue > 0 ? 'text-emerald-700' : 'text-gray-400')}>
                <DeltaIcon className="h-3.5 w-3.5" />
                {deltaValue > 0 ? `+${deltaValue} since yesterday` : 'No new since yesterday'}
              </p>
            </div>
            <div className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border',
              isZeroState ? 'border-gray-200 bg-gray-100 text-gray-400' : toneClasses[tone]
            )}>
              <Icon className="h-5 w-5" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
