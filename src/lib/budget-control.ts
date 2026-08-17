import type { BudgetCodeGroup, BudgetRequestRecord } from '@/types/budget'

export const MAX_BUDGET_MONEY_AMOUNT = 9999999999999.99

export type BudgetCodeHealth = 'Over' | 'Watch' | 'Healthy'

export type BudgetCodePasteRow = {
  code: string
  displayCode: string
  name: string
  budgetAmount: number
}

export type BudgetCodePasteSkip = {
  line: number
  reason: string
  raw: string
}

function roundMoneyAmount(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

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

export function matchesBudgetMonitorSearch(
  request: Pick<BudgetRequestRecord, 'title' | 'status' | 'department' | 'budgetCode'>,
  query: string
): boolean {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return true

  if (request.budgetCode && fuzzyMatchBudgetCode(request.budgetCode.displayCode, normalizedQuery)) {
    return true
  }

  if (request.budgetCode?.name && fuzzyMatchBudgetCode(request.budgetCode.name, normalizedQuery)) {
    return true
  }

  const searchableRequestText = [
    request.title,
    request.department?.name ?? '',
    request.status,
    request.budgetCode?.name ?? '',
  ].join(' ').toLowerCase()
  const queryTerms = normalizedQuery.toLowerCase().split(/\s+/).filter(Boolean)

  return queryTerms.every((term) => searchableRequestText.includes(term))
}

export function getBudgetCodeLabel(budgetCode: Pick<{ name: string | null; displayCode: string }, 'name' | 'displayCode'>): string {
  const name = budgetCode.name?.trim()
  return name ? name : budgetCode.displayCode
}

export function getBudgetCodeHealth(
  remainingBudget: number | null,
  budgetAmount: number | null
): BudgetCodeHealth {
  if (remainingBudget !== null && remainingBudget < 0) return 'Over'
  if (
    remainingBudget !== null &&
    budgetAmount !== null &&
    budgetAmount > 0 &&
    remainingBudget / budgetAmount < 0.15
  ) {
    return 'Watch'
  }
  return 'Healthy'
}

export function getBudgetUsageAmount(input: {
  projectEstimateCost: number | null
  engineeringEstimateCost: number | null
}): number {
  return roundMoneyAmount(input.engineeringEstimateCost ?? input.projectEstimateCost ?? 0)
}

export function getBudgetProjectEstimateAmount(input: {
  projectEstimateCost: number | null
  engineeringEstimateCost: number | null
}): number | null {
  const amount = input.engineeringEstimateCost ?? input.projectEstimateCost
  return amount === null ? null : roundMoneyAmount(amount)
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
            : roundMoneyAmount(request.budgetCode.budgetAmount - usageAmount),
        assignedRequestCount: 1,
        requests: [{ ...request, usageAmount }],
      })
      continue
    }

    existing.usedAmount = roundMoneyAmount(existing.usedAmount + usageAmount)
    existing.remainingBudget =
      existing.budgetCode.budgetAmount === null
        ? null
        : roundMoneyAmount(existing.budgetCode.budgetAmount - existing.usedAmount)
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
        'Budget Department': budgetCode.department?.name ?? '',
        'Budget Amount': budgetCode.budgetAmount,
        'Used Amount': usedByCode.get(budgetCode.id) ?? usageAmount,
        'Remaining Budget': remainingByCode.get(budgetCode.id) ?? null,
        'Request Title': request.title,
        'Request Department': request.department?.name ?? '',
        Status: request.status,
        'Project Estimate Cost': request.projectEstimateCost,
        'Engineering Estimate Cost': request.engineeringEstimateCost,
        'Request Created Date': request.createdAt.toISOString().slice(0, 10),
      }
    })
}

export function groupBudgetCodesByDepartment(groups: BudgetCodeGroup[]) {
  const named = new Map<string, { departmentName: string; departmentId: string; groups: BudgetCodeGroup[] }>()
  const unassigned: BudgetCodeGroup[] = []

  for (const group of groups) {
    const department = group.budgetCode.department
    if (!department) {
      unassigned.push(group)
      continue
    }
    const existing = named.get(department.id)
    if (existing) {
      existing.groups.push(group)
      continue
    }
    named.set(department.id, {
      departmentName: department.name,
      departmentId: department.id,
      groups: [group],
    })
  }

  const departments = [...named.values()].sort((a, b) =>
    a.departmentName.localeCompare(b.departmentName)
  )

  if (unassigned.length > 0) {
    departments.push({
      departmentName: 'No department',
      departmentId: null as unknown as string,
      groups: unassigned,
    })
  }

  return departments.map((entry) => ({
    departmentName: entry.departmentName,
    departmentId: entry.departmentName === 'No department' ? null : entry.departmentId,
    groups: entry.groups,
  }))
}

export function sumVisibleRemainingBudget(groups: BudgetCodeGroup[]) {
  const numbered = groups.filter((group) => group.remainingBudget !== null)
  return {
    total: numbered.reduce((sum, group) => sum + (group.remainingBudget as number), 0),
    groupCount: numbered.length,
  }
}

function splitPasteLine(line: string): string[] {
  return line.split(/[,\t;]/).map((cell) => cell.replace(/^"|"$/g, '').trim())
}

function normalizePasteHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function parsePasteAmount(value: string): number | null {
  const stripped = String(value).replace(/[^0-9.-]/g, '')
  if (!stripped) return null
  const amount = Number(stripped)
  if (!Number.isFinite(amount)) return null
  if (amount < 0 || amount > MAX_BUDGET_MONEY_AMOUNT) return null
  return amount
}

export function parseBudgetCodePaste(text: string): {
  valid: BudgetCodePasteRow[]
  skipped: BudgetCodePasteSkip[]
} {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const valid: BudgetCodePasteRow[] = []
  const skipped: BudgetCodePasteSkip[] = []
  if (lines.length === 0) return { valid, skipped }

  const firstCells = splitPasteLine(lines[0]).map(normalizePasteHeader)
  const findIndex = (aliases: string[]) =>
    firstCells.findIndex((header) => aliases.some((alias) => header === alias || header.includes(alias)))

  const headerCode = findIndex(['budget code', 'code'])
  const headerName = findIndex(['budget code name', 'name'])
  const headerAmount = findIndex(['budget amount', 'amount'])
  const hasHeader = headerCode >= 0 || headerName >= 0 || headerAmount >= 0
  const codeIndex = hasHeader && headerCode >= 0 ? headerCode : 0
  const nameIndex = hasHeader && headerName >= 0 ? headerName : 1
  const amountIndex = hasHeader && headerAmount >= 0 ? headerAmount : 2
  const start = hasHeader ? 1 : 0
  const seen = new Set<string>()

  for (let index = start; index < lines.length; index++) {
    const raw = lines[index]
    const cells = splitPasteLine(raw)
    const displayCode = cells[codeIndex] ?? ''
    const name = cells[nameIndex] ?? ''
    const amount = parsePasteAmount(cells[amountIndex] ?? '')
    const line = index + 1

    if (!displayCode.trim()) {
      skipped.push({ line, reason: 'Missing budget code', raw })
      continue
    }
    if (!name.trim()) {
      skipped.push({ line, reason: 'Missing budget code name', raw })
      continue
    }
    if (amount === null) {
      skipped.push({ line, reason: 'Invalid budget amount', raw })
      continue
    }

    const code = normalizeBudgetCode(displayCode)
    if (seen.has(code)) {
      skipped.push({ line, reason: 'Duplicate budget code', raw })
      continue
    }
    seen.add(code)
    valid.push({
      code,
      displayCode: displayCode.trim(),
      name: name.trim(),
      budgetAmount: amount,
    })
  }

  return { valid, skipped }
}

export function classifyBudgetCodePasteRows(
  valid: BudgetCodePasteRow[],
  existingCodes: Array<{ code: string }>
) {
  const existing = new Set(existingCodes.map((item) => normalizeBudgetCode(item.code)))
  return {
    creates: valid.filter((row) => !existing.has(row.code)),
    updates: valid.filter((row) => existing.has(row.code)),
  }
}
