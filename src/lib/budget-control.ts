import type { BudgetCodeGroup, BudgetRequestRecord } from '@/types/budget'

export function normalizeBudgetCode(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function fuzzyMatchBudgetCode(code: string, query: string): boolean {
  const normalizedCode = normalizeBudgetCode(code)
  const normalizedQuery = normalizeBudgetCode(query)

  if (!normalizedQuery) return true
  if (normalizedCode.includes(normalizedQuery)) return true

  let queryIndex = 0
  for (const char of normalizedCode) {
    if (char === normalizedQuery[queryIndex]) {
      queryIndex += 1
      if (queryIndex === normalizedQuery.length) return true
    }
  }

  return false
}

export function getBudgetUsageAmount(input: {
  projectEstimateCost: number | null
  engineeringEstimateCost: number | null
}): number {
  return input.engineeringEstimateCost ?? input.projectEstimateCost ?? 0
}

export function buildBudgetCodeGroups(requests: BudgetRequestRecord[]): BudgetCodeGroup[] {
  const groupsByCode = new Map<string, BudgetCodeGroup>()

  for (const request of requests) {
    if (!request.budgetCode) continue

    const usageAmount = getBudgetUsageAmount(request)
    const existing = groupsByCode.get(request.budgetCode.id)

    if (!existing) {
      groupsByCode.set(request.budgetCode.id, {
        budgetCode: request.budgetCode,
        usedAmount: usageAmount,
        remainingBudget:
          request.budgetCode.budgetAmount === null
            ? null
            : request.budgetCode.budgetAmount - usageAmount,
        assignedRequestCount: 1,
        requests: [{ ...request, usageAmount }],
      })
      continue
    }

    existing.usedAmount += usageAmount
    existing.remainingBudget =
      existing.budgetCode.budgetAmount === null
        ? null
        : existing.budgetCode.budgetAmount - existing.usedAmount
    existing.assignedRequestCount += 1
    existing.requests.push({ ...request, usageAmount })
  }

  return [...groupsByCode.values()].sort((a, b) =>
    a.budgetCode.displayCode.localeCompare(b.budgetCode.displayCode)
  )
}

export function buildBudgetExportRows(requests: BudgetRequestRecord[]) {
  const groups = buildBudgetCodeGroups(requests)
  const remainingByCode = new Map(groups.map((group) => [group.budgetCode.id, group.remainingBudget]))
  const usedByCode = new Map(groups.map((group) => [group.budgetCode.id, group.usedAmount]))

  return requests
    .filter((request) => request.budgetCode)
    .map((request) => {
      const usageAmount = getBudgetUsageAmount(request)
      const budgetCode = request.budgetCode!

      return {
        'Budget Code': budgetCode.displayCode,
        'Budget Amount': budgetCode.budgetAmount,
        'Used Amount': usedByCode.get(budgetCode.id) ?? usageAmount,
        'Remaining Budget': remainingByCode.get(budgetCode.id) ?? null,
        'Request Title': request.title,
        Department: request.department?.name ?? '',
        Status: request.status,
        'Project Estimate Cost': request.projectEstimateCost,
        'Engineering Estimate Cost': request.engineeringEstimateCost,
        'Usage Amount': usageAmount,
        'Request Created Date': request.createdAt.toISOString().slice(0, 10),
      }
    })
}
