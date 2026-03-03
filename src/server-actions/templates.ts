'use server'

import prisma from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

export interface CreateTemplateInput {
  name: string
  title: string
  description: string
  isDefault?: boolean
}

export interface UpdateTemplateInput {
  id: string
  name: string
  title: string
  description: string
  isActive?: boolean
}

export interface GetTemplatesOptions {
  includeInactive?: boolean
}

// Zod validation schemas
const createTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required'),
  title: z.string().min(1, 'Template title is required'),
  description: z.string().min(1, 'Description is required'),
  isDefault: z.boolean().optional(),
})

const updateTemplateSchema = z.object({
  id: z.string().min(1, 'Template ID is required'),
  name: z.string().min(1, 'Template name is required'),
  title: z.string().min(1, 'Template title is required'),
  description: z.string().min(1, 'Description is required'),
  isActive: z.boolean().optional(),
})

/**
 * Get all templates with optional filtering (admin only)
 */
export async function getTemplates(options: GetTemplatesOptions = {}) {
  await requireAdmin()

  const { includeInactive = false } = options

  const templates = await prisma.templates.findMany({
    where: {
      isActive: includeInactive ? undefined : true,
    },
    orderBy: [
      { isDefault: 'desc' }, // Default templates first
      { name: 'asc' },
    ],
  })

  return templates
}

/**
 * Get active templates for public use (no auth required)
 * Used in new request form to show available templates to users
 */
export async function getActiveTemplates() {
  const templates = await prisma.templates.findMany({
    where: {
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      title: true,
      description: true,
      isDefault: true,
    },
    orderBy: [
      { isDefault: 'desc' }, // Default templates first
      { name: 'asc' },
    ],
  })

  return templates
}

/**
 * Get the default template for public use (no auth required)
 */
export async function getDefaultTemplatePublic() {
  const template = await prisma.templates.findFirst({
    where: {
      isDefault: true,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      title: true,
      description: true,
      isDefault: true,
    },
  })

  return template
}

/**
 * Get a single template by ID
 */
export async function getTemplate(id: string) {
  await requireAdmin()

  const template = await prisma.templates.findUnique({
    where: { id },
  })

  return template
}

/**
 * Get the default template
 */
export async function getDefaultTemplate() {
  const template = await prisma.templates.findFirst({
    where: {
      isDefault: true,
      isActive: true,
    },
  })

  return template
}

/**
 * Create a new template
 * If isDefault is true, will set all other templates' isDefault to false
 */
export async function createTemplate(input: CreateTemplateInput) {
  await requireAdmin()

  // Validate input
  const validatedFields = createTemplateSchema.safeParse(input)

  if (!validatedFields.success) {
    const errors = validatedFields.error.flatten().fieldErrors
    const errorMessages = Object.values(errors).flat().join(', ')
    throw new Error(errorMessages)
  }

  // Use transaction to ensure only one default template
  await prisma.$transaction(async (tx) => {
    // If setting as default, unset all other defaults
    if (input.isDefault) {
      await tx.templates.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      })
    }

    // Create new template
    await tx.templates.create({
      data: {
        name: input.name,
        title: input.title,
        description: input.description,
        isDefault: input.isDefault || false,
        isActive: true,
      },
    })
  })

  revalidatePath('/admin/templates')
}

/**
 * Update an existing template
 * Does not change default status - use setTemplateDefault for that
 */
export async function updateTemplate(input: UpdateTemplateInput) {
  await requireAdmin()

  // Validate input
  const validatedFields = updateTemplateSchema.safeParse(input)

  if (!validatedFields.success) {
    const errors = validatedFields.error.flatten().fieldErrors
    const errorMessages = Object.values(errors).flat().join(', ')
    throw new Error(errorMessages)
  }

  const template = await prisma.templates.update({
    where: { id: input.id },
    data: {
      name: input.name,
      title: input.title,
      description: input.description,
      isActive: input.isActive,
    },
  })

  revalidatePath('/admin/templates')

  return template
}

/**
 * Toggle template active status (soft delete/restore)
 */
export async function toggleTemplateStatus(id: string) {
  await requireAdmin()

  const template = await prisma.templates.findUnique({
    where: { id },
  })

  if (!template) {
    throw new Error('Template not found')
  }

  // Prevent deactivating the default template
  if (template.isDefault && template.isActive) {
    throw new Error('Cannot deactivate the default template')
  }

  const updated = await prisma.templates.update({
    where: { id },
    data: {
      isActive: !template.isActive,
    },
  })

  revalidatePath('/admin/templates')

  return updated
}

/**
 * Set a template as default
 * Uses transaction to ensure only one default template exists
 */
export async function setTemplateDefault(id: string) {
  await requireAdmin()

  const template = await prisma.templates.findUnique({
    where: { id },
  })

  if (!template) {
    throw new Error('Template not found')
  }

  if (!template.isActive) {
    throw new Error('Cannot set an inactive template as default')
  }

  // Use transaction to ensure atomic default status change
  await prisma.$transaction([
    // Set all templates to non-default
    prisma.templates.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    }),
    // Set target template as default
    prisma.templates.update({
      where: { id },
      data: { isDefault: true },
    }),
  ])

  revalidatePath('/admin/templates')
}

/**
 * Delete a template (soft delete by setting isActive to false)
 * Equivalent to toggleTemplateStatus for deletion
 */
export async function deleteTemplate(id: string) {
  await requireAdmin()

  const template = await prisma.templates.findUnique({
    where: { id },
  })

  if (!template) {
    throw new Error('Template not found')
  }

  if (template.isDefault) {
    throw new Error('Cannot delete the default template')
  }

  await prisma.templates.update({
    where: { id },
    data: {
      isActive: false,
    },
  })

  revalidatePath('/admin/templates')
}
