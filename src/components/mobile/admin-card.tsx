'use client'

import { ReactNode } from 'react'
import { MoreVertical, ChevronRight, Mail, Building, Shield, Hash } from 'lucide-react'
import Link from 'next/link'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Badge, badgeVariants } from '@/components/ui/badge'
import type { VariantProps } from 'class-variance-authority'

type BadgeVariant = VariantProps<typeof badgeVariants>['variant']

export type AdminCardAction = {
  label: string
  onClick?: () => void
  icon?: ReactNode
  destructive?: boolean
  disabled?: boolean
  asChild?: boolean
  href?: string
}

export interface AdminCardProps {
  // Card title (primary identifier)
  title: ReactNode

  // Key-value pairs to display in the card body
  details: Array<{
    label: string
    value: ReactNode
    icon?: ReactNode
  }>

  // Optional status badge
  status?: {
    label: string
    variant?: BadgeVariant
  }

  // Optional badges to display (e.g., "Default", "Active")
  badges?: Array<{
    label: string
    variant?: BadgeVariant
  }>

  // Actions menu
  actions?: AdminCardAction[]

  // On tap handler for the whole card
  onTap?: () => void

  // Show chevron on the right
  showChevron?: boolean

  // Additional CSS classes
  className?: string
}

/**
 * Generic admin card component for mobile card views
 * Used for displaying table data in card format on mobile screens
 */
export function AdminCard({
  title,
  details,
  status,
  badges,
  actions,
  onTap,
  showChevron = false,
  className = '',
}: AdminCardProps) {
  const cardContent = (
    <>
      {/* Header: Title + Status/Actions */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg text-gray-900 truncate">{title}</h3>
          {status && (
            <div className="mt-1">
              <Badge variant={status.variant || 'secondary'} className="text-xs">
                {status.label}
              </Badge>
            </div>
          )}
        </div>

        {/* Actions menu or chevron */}
        {actions && actions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 flex-shrink-0">
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((action, idx) => (
                <DropdownMenuItem
                  key={idx}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  className={action.destructive ? 'text-destructive focus:text-destructive' : ''}
                  asChild={action.asChild}
                >
                  {action.asChild && action.href ? (
                    <Link href={action.href}>
                      {action.icon}
                      {action.label}
                    </Link>
                  ) : (
                    <>
                      {action.icon}
                      {action.label}
                    </>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : showChevron ? (
          <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" />
        ) : null}
      </div>

      {/* Badges row */}
      {badges && badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {badges.map((badge, idx) => (
            <Badge key={idx} variant={badge.variant || 'secondary'} className="text-xs">
              {badge.label}
            </Badge>
          ))}
        </div>
      )}

      {/* Details */}
      <div className="space-y-2">
        {details.map((detail, idx) => (
          <div key={idx} className="flex items-start gap-2 text-base">
            {detail.icon && (
              <div className="flex-shrink-0 mt-0.5 text-gray-400">
                {detail.icon}
              </div>
            )}
            <span className="text-gray-500 flex-shrink-0">{detail.label}:</span>
            <span className="text-gray-900 break-words">{detail.value}</span>
          </div>
        ))}
      </div>
    </>
  )

  if (onTap) {
    return (
      <button
        onClick={onTap}
        className={`w-full text-left bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md active:bg-gray-50 transition-all min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:bg-gray-900 dark:border-gray-700 dark:active:bg-gray-800 ${className}`}
      >
        {cardContent}
      </button>
    )
  }

  return (
    <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm ${className}`}>
      {cardContent}
    </div>
  )
}

/**
 * Empty state component for mobile card views
 */
interface AdminCardsEmptyStateProps {
  message?: string
  submessage?: string
}

export function AdminCardsEmptyState({
  message = 'No items found',
  submessage,
}: AdminCardsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-gray-500">
      <p className="font-medium text-gray-700">{message}</p>
      {submessage && <p className="text-sm mt-1">{submessage}</p>}
    </div>
  )
}
