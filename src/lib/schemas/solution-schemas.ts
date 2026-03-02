import { z } from 'zod'

/**
 * Zod schema for solution submission
 */
export const submitSolutionSchema = z.object({
  requestId: z.string().cuid(),
  title: z.string().min(1, 'Title is required').max(200, 'Title must be less than 200 characters'),
  description: z.string().min(1, 'Description is required').max(5000, 'Description must be less than 5000 characters'),
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
  fileIds: z.array(z.string()).optional(),
})

/**
 * Type inference from submitSolutionSchema
 */
export type SubmitSolutionInput = z.infer<typeof submitSolutionSchema>
