/**
 * Shared chart utilities and constants for analytics visualizations
 * Provides consistent colors and styling across all chart components
 */

/**
 * Status colors matching the app-wide color scheme
 * These colors align with Tailwind CSS color utilities used throughout the app
 */
export const STATUS_COLORS = {
  /** Yellow for pending requests (matches Tailwind yellow-500) */
  pending: '#eab308',
  /** Green for approved requests (matches Tailwind green-500) */
  approved: '#22c55e',
  /** Red for rejected requests (matches Tailwind red-500) */
  rejected: '#ef4444',
} as const

/**
 * Color palette for department visualizations
 * Distinct colors that work well on both light and dark backgrounds
 */
export const DEPT_COLORS = [
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#f97316', // orange-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
] as const
