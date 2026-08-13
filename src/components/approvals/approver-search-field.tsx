'use client'

import { useId, type Ref } from 'react'
import { Search } from 'lucide-react'
import { CommandInput } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface ApproverSearchFieldProps {
  value: string
  onChange: (value: string) => void
  resultCount: number
  inputRef?: Ref<HTMLInputElement>
  autoFocus?: boolean
  className?: string
  inputKind?: 'input' | 'command'
}

export function ApproverSearchField({
  value,
  onChange,
  resultCount,
  inputRef,
  autoFocus,
  className,
  inputKind = 'input',
}: ApproverSearchFieldProps) {
  const inputId = useId()
  const countLabel = resultCount === 1 ? '1 approver' : `${resultCount} approvers`

  return (
    <div className={cn('space-y-2', className)}>
      <label htmlFor={inputId} className="sr-only">
        Search approvers
      </label>
      {inputKind === 'command' ? (
        <CommandInput
          id={inputId}
          ref={inputRef}
          autoFocus={autoFocus}
          value={value}
          onValueChange={onChange}
          placeholder="Search by name, email, role, or level"
          className="min-h-11 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={inputId}
            ref={inputRef}
            autoFocus={autoFocus}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Search by name, email, role, or level"
            className="min-h-11 pl-9 focus-visible:ring-1"
          />
        </div>
      )}
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {countLabel}
      </p>
    </div>
  )
}
