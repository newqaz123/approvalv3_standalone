'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface BudgetGroupOption {
  id: string
  label: string
  code: string
}

/**
 * Searchable combobox for assigning a request to a budget group.
 * Replaces the native <select> when there are many budget codes:
 * type to filter by name or code, arrow keys + Enter to choose,
 * Unassigned is always the first row.
 */
export function BudgetGroupCombobox({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
}: {
  value: string
  options: BudgetGroupOption[]
  onChange: (budgetCodeId: string) => void
  'aria-label'?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selected = options.find((option) => option.id === value)

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (option) => option.label.toLowerCase().includes(q) || option.code.toLowerCase().includes(q)
    )
  }, [options, query])

  function commit(nextId: string) {
    setOpen(false)
    if (nextId !== value) onChange(nextId)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          className="h-8 w-full justify-between px-2 font-normal"
        >
          <span className={cn('min-w-0 truncate text-sm', !selected && 'text-muted-foreground')}>
            {selected ? `${selected.label} · ${selected.code}` : 'Unassigned'}
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,var(--radix-popover-trigger-width))] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search group name or code…"
              className="h-8 flex-1 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <CommandList>
            <CommandEmpty>No matching group.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__unassigned__" onSelect={() => commit('')}>
                <Check className={cn('mr-2 h-4 w-4', value === '' ? 'opacity-100' : 'opacity-0')} />
                Unassigned
              </CommandItem>
              {filtered.map((option) => (
                <CommandItem key={option.id} value={option.id} onSelect={() => commit(option.id)}>
                  <Check className={cn('mr-2 h-4 w-4', value === option.id ? 'opacity-100' : 'opacity-0')} />
                  <span className="min-w-0 truncate">{option.label}</span>
                  <span className="ml-auto pl-2 font-mono text-xs text-muted-foreground">{option.code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
