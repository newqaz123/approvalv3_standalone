'use server'

import prisma from '@/lib/prisma'
import { getCurrentUser } from '@/lib/cache/user-cache'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import * as XLSX from 'xlsx'
import {
  buildBudgetCodeGroups,
  buildBudgetExportRows,
  fuzzyMatchBudgetCode,
  normalizeBudgetCode,
} from '@/lib/budget-control'
import type { BudgetMonitorData, BudgetMonitorFilters, BudgetRequestRecord } from '@/types/budget'

const moneySchema = z.coerce.number().min(0).nullable().optional()

const filtersSchema = z.object({
  budgetCodeSearch: z.string().optional(),
  requestSearch: z.string().optional(),
  departmentId: z.string().optional(),
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
})

const assignSchema = z.object({
  requestId: z.string().min(1),
  budgetCodeId: z.string().min(1).optional(),
  budgetCode: z.string().min(1).optional(),
  budgetAmount: moneySchema,
})

const requestEstimateSchema = z.object({
  requestId: z.string().min(1),
  projectEstimateCost: moneySchema,
})

const budgetAmountSchema = z.object({
  budgetCodeId: z.string().min(1),
  budgetAmount: moneySchema,
})

const createBudgetCodeSchema = z.object({
  budgetCode: z.string().min(1),
  budgetAmount: moneySchema,
})

function buildVisibleRequestWhere(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  if (user.role === 'admin' || user.department?.type === 'ENGINEERING') {
    return { isDeleted: false, isArchived: false }
  }

  return {
    isDeleted: false,
    isArchived: false,
    OR: [
      { departmentId: user.departmentId ?? undefined },
      { approvals: { some: { requiredApproverId: user.id } } },
      { solutions: { some: { approvals: { some: { requiredApproverId: user.id } } } } },
    ],
  }
}

function applyBudgetFilters(where: any, filters: BudgetMonitorFilters) {
  if (filters.departmentId) where.departmentId = filters.departmentId
  if (filters.status) where.status = filters.status as any
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {}
    if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom)
    if (filters.dateTo) {
      const endDate = new Date(filters.dateTo)
      endDate.setHours(23, 59, 59, 999)
      where.createdAt.lte = endDate
    }
  }
  if (filters.requestSearch) {
    where.AND = [
      ...(where.AND ?? []),
      {
        OR: [
          { title: { contains: filters.requestSearch, mode: 'insensitive' } },
          { description: { contains: filters.requestSearch, mode: 'insensitive' } },
          { requester: { name: { contains: filters.requestSearch, mode: 'insensitive' } } },
        ],
      },
    ]
  }
  return where
}

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  return Number(value)
}

function mapBudgetRequest(request: any): BudgetRequestRecord {
  const latestSolution = request.solutions?.[0]

  return {
    id: request.id,
    title: request.title,
    status: request.status,
    createdAt: request.createdAt,
    department: request.department ? { id: request.department.id, name: request.department.name } : null,
    budgetCode: request.budgetCode
      ? {
          id: request.budgetCode.id,
          code: request.budgetCode.code,
          displayCode: request.budgetCode.displayCode,
          budgetAmount: decimalToNumber(request.budgetCode.budgetAmount),
        }
      : null,
    projectEstimateCost: decimalToNumber(request.projectEstimateCost),
    engineeringEstimateCost: decimalToNumber(latestSolution?.costEstimate),
  }
}

async function requireVisibleRequest(requestId: string) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')

  const request = await prisma.requests.findFirst({
    where: {
      id: requestId,
      ...buildVisibleRequestWhere(user),
    },
    select: { id: true },
  })

  if (!request) throw new Error('Request not found or not visible')
  return user
}

export async function getBudgetMonitorData(input: BudgetMonitorFilters = {}): Promise<BudgetMonitorData> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')

  const filters = filtersSchema.parse(input)
  const where = applyBudgetFilters(buildVisibleRequestWhere(user), filters)

  const [requests, departments, budgetCodes] = await Promise.all([
    prisma.requests.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        projectEstimateCost: true,
        department: { select: { id: true, name: true } },
        budgetCode: { select: { id: true, code: true, displayCode: true, budgetAmount: true } },
        solutions: {
          select: { costEstimate: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.departments.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.budget_codes.findMany({ select: { id: true, code: true, displayCode: true, budgetAmount: true }, orderBy: { displayCode: 'asc' } }),
  ])

  let mapped = requests.map(mapBudgetRequest)
  if (filters.budgetCodeSearch) {
    mapped = mapped.filter((request) =>
      request.budgetCode
        ? fuzzyMatchBudgetCode(request.budgetCode.displayCode, filters.budgetCodeSearch!)
        : false
    )
  }

  const groups = buildBudgetCodeGroups(mapped)
  const remainingRequests = mapped.filter((request) => !request.budgetCode)

  return {
    budgetCodes: budgetCodes.map((code) => ({
      id: code.id,
      code: code.code,
      displayCode: code.displayCode,
      budgetAmount: decimalToNumber(code.budgetAmount),
    })),
    groups,
    remainingRequests,
    filters: {
      departments,
      statuses: ['ImprovementRequest', 'SentToEngineer', 'DesignCostEstimationApproval', 'SendBackToRequester', 'FinalApproval', 'Completed', 'Cancelled'],
    },
  }
}

export async function assignRequestToBudgetCode(input: z.infer<typeof assignSchema>) {
  const data = assignSchema.parse(input)
  await requireVisibleRequest(data.requestId)

  const budgetCode = data.budgetCodeId
    ? await prisma.budget_codes.findUniqueOrThrow({ where: { id: data.budgetCodeId } })
    : await prisma.budget_codes.upsert({
        where: { code: normalizeBudgetCode(data.budgetCode!) },
        create: {
          code: normalizeBudgetCode(data.budgetCode!),
          displayCode: data.budgetCode!.trim(),
          budgetAmount: data.budgetAmount ?? null,
        },
        update: data.budgetAmount === undefined ? {} : { budgetAmount: data.budgetAmount ?? null },
      })

  await prisma.requests.update({
    where: { id: data.requestId },
    data: { budgetCodeId: budgetCode.id },
  })

  revalidatePath('/budget-monitor')
  return { success: true }
}

export async function unassignRequestBudgetCode(requestId: string) {
  await requireVisibleRequest(requestId)
  await prisma.requests.update({ where: { id: requestId }, data: { budgetCodeId: null } })
  revalidatePath('/budget-monitor')
  return { success: true }
}

export async function updateRequestProjectEstimate(input: z.infer<typeof requestEstimateSchema>) {
  const data = requestEstimateSchema.parse(input)
  await requireVisibleRequest(data.requestId)
  await prisma.requests.update({
    where: { id: data.requestId },
    data: { projectEstimateCost: data.projectEstimateCost ?? null },
  })
  revalidatePath('/budget-monitor')
  return { success: true }
}

export async function updateBudgetCodeAmount(input: z.infer<typeof budgetAmountSchema>) {
  const data = budgetAmountSchema.parse(input)
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')

  const visibleUsage = await prisma.requests.findFirst({
    where: {
      ...buildVisibleRequestWhere(user),
      budgetCodeId: data.budgetCodeId,
    },
    select: { id: true },
  })

  if (!visibleUsage) throw new Error('Budget code not visible')

  await prisma.budget_codes.update({
    where: { id: data.budgetCodeId },
    data: { budgetAmount: data.budgetAmount ?? null },
  })
  revalidatePath('/budget-monitor')
  return { success: true }
}

export async function createBudgetCode(input: z.infer<typeof createBudgetCodeSchema>) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')

  const data = createBudgetCodeSchema.parse(input)
  await prisma.budget_codes.upsert({
    where: { code: normalizeBudgetCode(data.budgetCode) },
    create: {
      code: normalizeBudgetCode(data.budgetCode),
      displayCode: data.budgetCode.trim(),
      budgetAmount: data.budgetAmount ?? null,
    },
    update: {
      budgetAmount: data.budgetAmount ?? null,
    },
  })

  revalidatePath('/budget-monitor')
  return { success: true }
}

export async function exportBudgetMonitorXlsx(input: BudgetMonitorFilters = {}) {
  const data = await getBudgetMonitorData(input)
  const rows = buildBudgetExportRows(data.groups.flatMap((group) => group.requests))
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Budget Monitor')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return {
    fileName: `budget-monitor-${new Date().toISOString().slice(0, 10)}.xlsx`,
    base64: buffer.toString('base64'),
  }
}
