import { z } from 'zod'

export const MIN_APPROVAL_LEVEL = 1 as const
export const MAX_APPROVAL_LEVEL = 10 as const
export const APPROVAL_LEVELS = Array.from(
  { length: MAX_APPROVAL_LEVEL },
  (_, index) => index + MIN_APPROVAL_LEVEL,
) as readonly number[]

const APPROVAL_LEVEL_ERROR = 'Approval level must be an integer from 1 to 10'
const LEVEL_NAMES_ERROR =
  'Approval level names must use levels 1 through 10 with non-empty names'

const LEVEL_KEY_PATTERN = /^(?:[1-9]|10)$/

export const approvalLevelSchema = z
  .number()
  .int()
  .min(MIN_APPROVAL_LEVEL)
  .max(MAX_APPROVAL_LEVEL)

export const nullableApprovalLevelSchema = approvalLevelSchema.nullable()

export const levelNamesSchema = z.record(
  z.string().regex(LEVEL_KEY_PATTERN),
  z.string().trim().min(1),
)

export type ApprovalLevel = z.infer<typeof approvalLevelSchema>
export type LevelNames = Record<string, string>

function isApprovalLevel(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_APPROVAL_LEVEL &&
    value <= MAX_APPROVAL_LEVEL
  )
}

export function validateApprovalLevel(
  value: unknown,
  options: { allowNull?: boolean } = {},
): number | null {
  const { allowNull = false } = options

  if (value === null || value === undefined) {
    if (allowNull) return null
    throw new Error(APPROVAL_LEVEL_ERROR)
  }

  if (!isApprovalLevel(value)) {
    throw new Error(APPROVAL_LEVEL_ERROR)
  }

  return value
}

export function validateLevelNames(value: unknown): LevelNames | null {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(LEVEL_NAMES_ERROR)
  }

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) {
    return null
  }

  const normalized: LevelNames = {}

  for (const [key, rawName] of entries) {
    if (!LEVEL_KEY_PATTERN.test(key)) {
      throw new Error(LEVEL_NAMES_ERROR)
    }

    if (typeof rawName !== 'string') {
      throw new Error(LEVEL_NAMES_ERROR)
    }

    const name = rawName.trim()
    if (!name) {
      throw new Error(LEVEL_NAMES_ERROR)
    }

    normalized[key] = name
  }

  return normalized
}

export function normalizePersistedApprovalLevel(value: unknown): number | null {
  return isApprovalLevel(value) ? value : null
}

export function normalizePersistedLevelNames(value: unknown): LevelNames | null {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const normalized: LevelNames = {}

  for (const [key, rawName] of Object.entries(value as Record<string, unknown>)) {
    if (!LEVEL_KEY_PATTERN.test(key) || typeof rawName !== 'string') {
      continue
    }

    const name = rawName.trim()
    if (!name) {
      continue
    }

    normalized[key] = name
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}

function levelsThrough(maxLevel: number): number[] {
  return Array.from({ length: maxLevel }, (_, index) => index + MIN_APPROVAL_LEVEL)
}

export function getDisplayApprovalLevels(
  levelNames: Record<string, string> | null | undefined,
  assignedLevels: Array<number | null | undefined>,
): number[] {
  let highestConfigured = 0
  const normalizedNames = normalizePersistedLevelNames(levelNames) ?? {}

  for (const key of Object.keys(normalizedNames)) {
    const level = Number(key)
    if (level > highestConfigured) {
      highestConfigured = level
    }
  }

  let highestAssigned = 0
  for (const assigned of assignedLevels) {
    if (isApprovalLevel(assigned) && assigned > highestAssigned) {
      highestAssigned = assigned
    }
  }

  const depth = Math.min(
    MAX_APPROVAL_LEVEL,
    Math.max(3, highestConfigured, highestAssigned),
  )

  return levelsThrough(depth)
}

export function getApprovalLevelsAboveSubmitter(
  submitterLevel: number,
  maximumLevel: number,
): number[] {
  const submitter = validateApprovalLevel(submitterLevel)
  const maximum = validateApprovalLevel(maximumLevel)

  if (submitter === null || maximum === null || submitter >= maximum) {
    return []
  }

  const levels: number[] = []
  for (let level = submitter + 1; level <= maximum; level += 1) {
    levels.push(level)
  }
  return levels
}

export function getApprovalLevelLabel(
  levelNames: Record<string, string> | null | undefined,
  level: number,
): string {
  const normalizedNames = normalizePersistedLevelNames(levelNames) ?? {}
  const configured = normalizedNames[String(level)]
  return configured ?? `Level ${level}`
}
