import { ORGANIZATION_POSITION_LEVEL } from '@/lib/organization/types'
import type { OrganizationPositionCode, OrganizationPositionLevel } from '@/lib/organization/types'
import type { ApprovalRouteVersionDefinition } from './types'

export class ApprovalRouteConfigurationError extends Error {
  readonly code = 'APPROVAL_ROUTE_CONFIGURATION'

  constructor(message: string) {
    super(message)
    this.name = 'ApprovalRouteConfigurationError'
  }
}

export function validateRouteDefinition(definition: ApprovalRouteVersionDefinition): void {
  const ceiling = definition.maximumPositionLevel
  if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > 6) {
    throw new ApprovalRouteConfigurationError('Route maximum position level must be an integer ceiling from 1 through 6')
  }
  if (!Array.isArray(definition.steps)) {
    throw new ApprovalRouteConfigurationError('Route steps must be an array')
  }

  const seen = new Set<OrganizationPositionCode>()
  let previousLevel = 0
  definition.steps.forEach((step, index) => {
    if (!step || !Number.isInteger(step.order) || step.order !== index + 1) {
      throw new ApprovalRouteConfigurationError('Route step orders must be contiguous positive integers')
    }
    const position = step.position as OrganizationPositionCode
    const level = ORGANIZATION_POSITION_LEVEL[position] as OrganizationPositionLevel | undefined
    if (level === undefined) {
      throw new ApprovalRouteConfigurationError(`Unknown route position: ${String(step.position)}`)
    }
    if (seen.has(position)) {
      throw new ApprovalRouteConfigurationError(`Duplicate route position: ${position}`)
    }
    if (level <= previousLevel) {
      throw new ApprovalRouteConfigurationError('Route positions must be strictly ascending')
    }
    if (level > ceiling) {
      throw new ApprovalRouteConfigurationError(`Route position ${position} exceeds the configured ceiling`)
    }
    seen.add(position)
    previousLevel = level
  })
}
