import { z } from 'zod'
import { MAX_ATTACHMENTS_PER_FORM } from '@/lib/attachments/policy'
import { extractInlineImageIds } from '@/lib/inline-images/policy'
import {
  containsRichTextHtml,
  richTextToPlainText,
  sanitizeRichText,
} from '@/lib/rich-text-sanitizer'

/**
 * Shared description validator: rich HTML may span up to 20000 stored
 * characters (markup envelope overhead), while the non-empty check runs
 * against sanitized visible text plus approved inline images — so
 * `<p><br></p>` is still rejected like whitespace.
 */
const visibleNonEmpty = (value: string) => {
  if (!containsRichTextHtml(value)) {
    return value.trim().length > 0
  }

  const sanitized = sanitizeRichText(value)
  return richTextToPlainText(sanitized).trim().length > 0 || extractInlineImageIds(sanitized).length > 0
}

export const descriptionSchema = z
  .string()
  .max(20000, 'Description too long')
  .refine(visibleNonEmpty, 'Description is required')

/**
 * Zod schema for solution submission
 */
export const submitSolutionSchema = z.object({
  requestId: z.string().uuid(),
  title: z.string().min(1, 'Title is required').max(200, 'Title must be less than 200 characters'),
  description: descriptionSchema,
  inlineImageSessionId: z.string().uuid(),
  costEstimate: z
    .number({ message: 'Cost must be a number' })
    .positive('Cost must be greater than 0')
    .min(0.01, 'Cost must be at least 0.01')
    .optional(),
  currency: z.enum(['THB', 'USD', 'EUR']).default('THB'),
  timeline: z.string().max(500).optional(),
  conceptDesign: z.string().max(2000).optional(),
  useCustomApprovals: z.boolean().default(false),
  customApproverIds: z.array(z.string()).optional(),
  fileIds: z.array(z.string().uuid()).max(MAX_ATTACHMENTS_PER_FORM).refine(
    (ids) => new Set(ids).size === ids.length,
    'Attachment IDs must be unique'
  ).default([]),
})

/**
 * Type inference from submitSolutionSchema
 */
export type SubmitSolutionInput = z.infer<typeof submitSolutionSchema>

/**
 * Zod schema for solution resubmission after rejection.
 *
 * Resubmission consumes staged attachment IDs (uploaded via the authorized
 * draft upload action) rather than raw File objects: `newFileIds` are newly
 * staged rows to link, `deletedFileIds` are existing solution attachments to
 * remove. Both are bounded to <= MAX_ATTACHMENTS_PER_FORM unique UUIDs and
 * default to an empty array. Overlap between the two sets is rejected at the
 * server-action layer (a single id cannot be both added and deleted).
 */
export const resubmitSolutionSchema = z.object({
  requestId: z.string().uuid(),
  title: z.string().min(1, 'Title is required').max(200, 'Title must be less than 200 characters'),
  description: descriptionSchema,
  inlineImageSessionId: z.string().uuid(),
  cost: z.number({ message: 'Cost must be a number' }).positive('Cost must be greater than 0'),
  currency: z.enum(['THB', 'USD', 'EUR']),
  timeline: z.string().min(1, 'Timeline is required').max(500, 'Timeline must be less than 500 characters'),
  newFileIds: z.array(z.string().uuid()).max(MAX_ATTACHMENTS_PER_FORM).refine(
    (ids) => new Set(ids).size === ids.length,
    'New attachment IDs must be unique'
  ).default([]),
  deletedFileIds: z.array(z.string().uuid()).max(MAX_ATTACHMENTS_PER_FORM).refine(
    (ids) => new Set(ids).size === ids.length,
    'Deleted attachment IDs must be unique'
  ).default([]),
  useCustomHierarchy: z.boolean(),
  customApprovers: z.array(z.string().uuid()).refine(
    (ids) => new Set(ids).size === ids.length,
    'Custom approver IDs must be unique'
  ).default([]),
})

/**
 * Type inference from resubmitSolutionSchema
 */
export type ResubmitSolutionInput = z.infer<typeof resubmitSolutionSchema>
