import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import { SolutionForm } from '@/components/solutions/solution-form'
import { RequestStatus, UserRole } from '@prisma/client'

interface SolutionSubmissionPageProps {
  params: Promise<{
    requestId: string
  }>
}

export default async function SolutionSubmissionPage({
  params,
}: SolutionSubmissionPageProps) {
  const { userId } = await auth()
  const { requestId } = await params

  if (!userId) {
    redirect('/sign-in')
  }

  // Get current user with role and department
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      departmentId: true,
    },
  })

  // Check if user is engineering
  if (!user || user.role !== UserRole.engineering) {
    redirect('/dashboard')
  }

  // Fetch request with validation
  const request = await prisma.request.findFirst({
    where: {
      id: requestId,
      status: RequestStatus.SentToEngineer,
      isDeleted: false,
    },
    include: {
      requester: {
        select: {
          name: true,
          email: true,
        },
      },
      department: {
        select: {
          name: true,
        },
      },
    },
  })

  if (!request) {
    notFound()
  }

  // Parallel data fetching: Fetch all active users and previous solution concurrently
  // These queries are independent and can execute simultaneously
  const [allUsers, previousSolution] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        level: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.solution.findFirst({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
      select: {
        title: true,
        description: true,
        costEstimate: true,
        currency: true,
        timeline: true,
        conceptDesign: true,
        fileAttachments: {
          select: {
            id: true,
            fileName: true,
            fileType: true,
            fileSize: true,
            filePath: true,
          },
        },
      },
    }),
  ])

  // Convert Decimal to number for form compatibility
  const previousSolutionData = previousSolution ? {
    ...previousSolution,
    costEstimate: previousSolution.costEstimate ? Number(previousSolution.costEstimate) : undefined,
  } : undefined

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <div className="mb-6">
        <a
          href="/engineering"
          className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1"
        >
          ← Back to Engineering Dashboard
        </a>
      </div>

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Submit Solution</h1>
        <p className="text-muted-foreground">
          Provide your engineering solution with cost estimate and implementation details
        </p>
      </div>

      <div className="mb-6 p-4 border rounded-lg bg-muted/30">
        <h2 className="font-semibold mb-2">Request Context</h2>
        <p className="text-sm font-medium">{request.title}</p>
        <p className="text-sm text-muted-foreground mt-1">
          From: {request.department.name} • Requested by: {request.requester.name}
        </p>
      </div>

      <SolutionForm
        requestId={requestId}
        requestTitle={request.title}
        currentUserId={userId}
        allUsers={allUsers}
        previousSolution={previousSolutionData}
        previousFiles={previousSolution?.fileAttachments || []}
      />
    </div>
  )
}
