

/**
 * Color palette for department visualizations
 * Distinct colors that work well on both light and dark backgrounds
 */
/** In-flight pipeline stage fills — same family as the rest of analytics */
export const PIPELINE_STAGE_COLORS: Record<string, string> = {
  ImprovementRequest: 'bg-blue-500',
  SentToEngineer: 'bg-indigo-500',
  DesignCostEstimationApproval: 'bg-violet-500',
  SendBackToRequester: 'bg-amber-500',
  FinalApproval: 'bg-orange-500',
}

export const DEPT_COLORS = [
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#f97316', // orange-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
] as const
