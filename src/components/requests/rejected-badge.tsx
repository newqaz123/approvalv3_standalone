import { XCircle } from 'lucide-react'

interface RejectedBadgeProps {
  size?: 'sm' | 'md' | 'lg'
  showText?: boolean
}

export function RejectedBadge({ size = 'md', showText = true }: RejectedBadgeProps) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  }

  const iconSizes = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 font-medium ${sizeClasses[size]}`}
    >
      <XCircle className={iconSizes[size]} />
      {showText && 'Rejected'}
    </span>
  )
}
