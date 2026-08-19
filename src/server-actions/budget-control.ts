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
  matchesBudgetMonitorSearch,
  normalizeBudgetCode,
} from '@/lib/budget-control'
import type { BudgetMonitorData, BudgetMonitorFilters, BudgetRequestRecord } from '@/types/budget'

const MAX_BUDGET_MONEY_AMOUNT = 9999999999999.99

const moneySchema = z.preprocess((value) => {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    if (value.trim() === '') return value
    return Number(value)
  }
  return value
}, z.number()
  .refine((value) => Number.isFinite(value), 'Amount must be finite')
  .min(0)
  .max(MAX_BUDGET_MONEY_AMOUNT)
  .nullable()
  .optional())

const requiredMoneySchema = z.preprocess((value) => {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    if (value.trim() === '') return value
    return Number(value)
  }
  return value
}, z.number()
  .refine((value) => Number.isFinite(value), 'Amount must be finite')
  .min(0)
  .max(MAX_BUDGET_MONEY_AMOUNT))

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
  departmentId: z.string().min(1).nullable().optional(),
}).superRefine((data, ctx) => {
  if (Boolean(data.budgetCodeId) === Boolean(data.budgetCode)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Provide exactly one of budgetCodeId or budgetCode',
      path: ['budgetCode'],
    })
  }
})

const requestEstimateSchema = z.object({
  requestId: z.string().min(1),
  projectEstimateCost: moneySchema,
})

const budgetAmountSchema = z.object({
  budgetCodeId: z.string().min(1),
  name: z.string().trim().min(1),
  budgetAmount: requiredMoneySchema,
  departmentId: z.string().min(1).nullable().optional(),
})

const createBudgetCodeSchema = z.object({
  budgetCode: z.string().min(1),
  name: z.string().trim().min(1),
  budgetAmount: requiredMoneySchema,
  departmentId: z.string().min(1).nullable().optional(),
})

const pasteBudgetCodesSchema = z.object({
  rows: z.array(z.object({
    code: z.string().min(1),
    name: z.string().trim().min(1),
    budgetAmount: requiredMoneySchema,
  })).min(1),
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
  return where
}

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  return Number(value)
}

function mapBudgetCodeSummary(budgetCode: any): NonNullable<BudgetRequestRecord['budgetCode']> {
  return {
    id: budgetCode.id,
    code: budgetCode.code,
    displayCode: budgetCode.displayCode,
    name: typeof budgetCode.name === 'string' ? budgetCode.name : null,
    budgetAmount: decimalToNumber(budgetCode.budgetAmount),
    department: budgetCode.department ? { id: budgetCode.department.id, name: budgetCode.department.name } : null,
  }
}

function mapBudgetRequest(request: any): BudgetRequestRecord {
  const latestSolution = request.solutions?.[0]

  return {
    id: request.id,
    title: request.title,
    status: request.status,
    createdAt: request.createdAt,
    department: request.department ? { id: request.department.id, name: request.department.name } : null,
    budgetCode: request.budgetCode ? mapBudgetCodeSummary(request.budgetCode) : null,
    projectEstimateCost: decimalToNumber(request.projectEstimateCost),
    engineeringEstimateCost: decimalToNumber(latestSolution?.costEstimate),
  }
}

function getVisibleBudgetCodes(requests: BudgetRequestRecord[]) {
  const budgetCodesById = new Map<string, NonNullable<BudgetRequestRecord['budgetCode']>>()

  for (const request of requests) {
    if (request.budgetCode) {
      budgetCodesById.set(request.budgetCode.id, request.budgetCode)
    }
  }

  return [...budgetCodesById.values()].sort((a, b) => a.displayCode.localeCompare(b.displayCode))
}

function mergeBudgetCodes(
  visibleRequests: BudgetRequestRecord[],
  creatorCodes: Array<{
    id: string
    code: string
    displayCode: string
    name?: string | null
    budgetAmount: unknown
    department: { id: string; name: string } | null
  }>,
) {
  const budgetCodesById = new Map<string, NonNullable<BudgetRequestRecord['budgetCode']>>()

  for (const budgetCode of getVisibleBudgetCodes(visibleRequests)) {
    budgetCodesById.set(budgetCode.id, budgetCode)
  }

  for (const code of creatorCodes) {
    budgetCodesById.set(code.id, mapBudgetCodeSummary(code))
  }

  return [...budgetCodesById.values()].sort((a, b) => a.displayCode.localeCompare(b.displayCode))
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
  const visibleWhere = { ...where, status: where.status ?? { not: 'Cancelled' } }

  const [requests, departments, creatorBudgetCodes] = await Promise.all([
    prisma.requests.findMany({
      where: visibleWhere,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        projectEstimateCost: true,
        department: { select: { id: true, name: true } },
        budgetCode: {
          select: {
            id: true,
            code: true,
            displayCode: true,
            name: true,
            budgetAmount: true,
            department: { select: { id: true, name: true } },
          },
        },
        solutions: {
          select: { costEstimate: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.departments.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.budget_codes.findMany({
      where: { createdById: user.id },
      select: {
        id: true,
        code: true,
        displayCode: true,
        name: true,
        budgetAmount: true,
        department: { select: { id: true, name: true } },
      },
      orderBy: { displayCode: 'asc' },
    }),
  ])

  let mapped = requests.map(mapBudgetRequest)
  const assignedRequests = mapped.filter((request) => request.budgetCode)
  let budgetRequests = assignedRequests
  if (filters.departmentId) {
    budgetRequests = budgetRequests.filter((request) => request.budgetCode?.department?.id === filters.departmentId)
  }
  if (filters.budgetCodeSearch) {
    budgetRequests = budgetRequests.filter((request) => matchesBudgetMonitorSearch(request, filters.budgetCodeSearch!))
  }

  let remainingRequests = mapped.filter((request) => !request.budgetCode)
  if (filters.departmentId) {
    remainingRequests = remainingRequests.filter((request) => request.department?.id === filters.departmentId)
  }
  if (filters.requestSearch) {
    const requestSearch = filters.requestSearch.toLowerCase()
    remainingRequests = remainingRequests.filter((request) =>
      `${request.title} ${request.department?.name ?? ''} ${request.status}`.toLowerCase().includes(requestSearch)
    )
  }

  let pageRequests = mapped
  if (filters.departmentId) {
    pageRequests = pageRequests.filter((request) => request.department?.id === filters.departmentId)
  }
  if (filters.budgetCodeSearch) {
    pageRequests = pageRequests.filter((request) =>
      matchesBudgetMonitorSearch(request, filters.budgetCodeSearch!)
    )
  }

  let budgetCodes = mergeBudgetCodes(mapped, creatorBudgetCodes)
  if (filters.departmentId) {
    budgetCodes = budgetCodes.filter((budgetCode) => budgetCode.department?.id === filters.departmentId)
  }
  if (filters.budgetCodeSearch) {
    budgetCodes = budgetCodes.filter((budgetCode) =>
      fuzzyMatchBudgetCode(budgetCode.displayCode, filters.budgetCodeSearch!) ||
      (budgetCode.name ? fuzzyMatchBudgetCode(budgetCode.name, filters.budgetCodeSearch!) : false)
    )
  }

  const groups = buildBudgetCodeGroups(budgetRequests)

  return {
    budgetCodes,
    groups,
    remainingRequests,
    requests: pageRequests,
    filters: {
      departments,
      statuses: ['ImprovementRequest', 'SentToEngineer', 'DesignCostEstimationApproval', 'SendBackToRequester', 'FinalApproval', 'Completed', 'Cancelled'],
    },
  }
}

export async function assignRequestToBudgetCode(input: z.infer<typeof assignSchema>) {
  const data = assignSchema.parse(input)
  const user = await requireVisibleRequest(data.requestId)

  let budgetCode
  if (data.budgetCodeId) {
    budgetCode = await prisma.budget_codes.findUniqueOrThrow({ where: { id: data.budgetCodeId } })
  } else {
    const normalizedCode = normalizeBudgetCode(data.budgetCode!)
    budgetCode = await prisma.budget_codes.findUnique({ where: { code: normalizedCode } })

    if (!budgetCode) {
      budgetCode = await prisma.budget_codes.create({
        data: {
          code: normalizedCode,
          displayCode: data.budgetCode!.trim(),
          budgetAmount: data.budgetAmount ?? null,
          departmentId: data.departmentId ?? null,
          createdById: user.id,
        },
      })
    }
  }

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
  const creatorOwnedCode = await prisma.budget_codes.findFirst({
    where: { id: data.budgetCodeId, createdById: user.id },
    select: { id: true },
  })

  if (!visibleUsage && !creatorOwnedCode) throw new Error('Budget code not visible')

  await prisma.budget_codes.update({
    where: { id: data.budgetCodeId },
    data: {
      name: data.name,
      budgetAmount: data.budgetAmount,
      ...(data.departmentId !== undefined ? { departmentId: data.departmentId } : {}),
    },
  })
  revalidatePath('/budget-monitor')
  return { success: true }
}

export async function createBudgetCode(input: z.infer<typeof createBudgetCodeSchema>) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')

  const data = createBudgetCodeSchema.parse(input)
  const normalizedCode = normalizeBudgetCode(data.budgetCode)
  const existingBudgetCode = await prisma.budget_codes.findUnique({ where: { code: normalizedCode } })

  if (!existingBudgetCode) {
    await prisma.budget_codes.create({
      data: {
        code: normalizedCode,
        displayCode: data.budgetCode.trim(),
        name: data.name,
        budgetAmount: data.budgetAmount,
        departmentId: data.departmentId ?? null,
        createdById: user.id,
      },
    })
  }

  revalidatePath('/budget-monitor')
  return { success: true }
}

export async function pasteBudgetCodes(input: z.infer<typeof pasteBudgetCodesSchema>) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')

  const data = pasteBudgetCodesSchema.parse(input)
  let created = 0
  let updated = 0
  let skipped = 0

  for (const row of data.rows) {
    const normalizedCode = normalizeBudgetCode(row.code)
    const existing = await prisma.budget_codes.findUnique({ where: { code: normalizedCode } })

    if (!existing) {
      await prisma.budget_codes.create({
        data: {
          code: normalizedCode,
          displayCode: row.code.trim(),
          name: row.name,
          budgetAmount: row.budgetAmount,
          createdById: user.id,
        },
      })
      created += 1
      continue
    }

    const visibleUsage = await prisma.requests.findFirst({
      where: {
        ...buildVisibleRequestWhere(user),
        budgetCodeId: existing.id,
      },
      select: { id: true },
    })
    const creatorOwnedCode = existing.createdById === user.id
    if (!visibleUsage && !creatorOwnedCode) {
      skipped += 1
      continue
    }

    await prisma.budget_codes.update({
      where: { id: existing.id },
      data: {
        name: row.name,
        budgetAmount: row.budgetAmount,
      },
    })
    updated += 1
  }

  revalidatePath('/budget-monitor')
  return { created, updated, skipped }
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
