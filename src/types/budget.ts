export interface BudgetCodeSummary {
  id: string
  code: string
  displayCode: string
  budgetAmount: number | null
  department: {
    id: string
    name: string
  } | null
}

export interface BudgetRequestRecord {
  id: string
  title: string
  status: string
  createdAt: Date
  department: {
    id: string
    name: string
  } | null
  budgetCode: BudgetCodeSummary | null
  projectEstimateCost: number | null
  engineeringEstimateCost: number | null
}

export interface BudgetCodeGroup {
  budgetCode: BudgetCodeSummary
  usedAmount: number
  remainingBudget: number | null
  assignedRequestCount: number
  requests: Array<BudgetRequestRecord & { usageAmount: number }>
}

export interface BudgetMonitorFilters {
  budgetCodeSearch?: string
  requestSearch?: string
  departmentId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
}

export interface BudgetMonitorData {
  budgetCodes: BudgetCodeSummary[]
  groups: BudgetCodeGroup[]
  remainingRequests: BudgetRequestRecord[]
  filters: {
    departments: Array<{ id: string; name: string }>
    statuses: string[]
  }
}
