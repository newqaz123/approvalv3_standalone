'use client'

import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface BudgetSearchInputProps {
  value: string
  placeholder: string
  options: Array<{ value: string; label: string; meta?: string }>
  onChange: (value: string) => void
}

export function BudgetSearchInput({ value, placeholder, options, onChange }: BudgetSearchInputProps) {
  const [open, setOpen] = useState(false)
  const trimmedValue = value.trim().toLowerCase()
  const filteredOptions = useMemo(() => {
    return options
      .filter((option) =>
        `${option.label} ${option.meta ?? ''}`.toLowerCase().includes(trimmedValue)
      )
      .slice(0, 8)
  }, [options, trimmedValue])

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <Input
        className="pl-9"
        placeholder={placeholder}
        value={value}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onFocus={() => setOpen(value.trim().length > 0)}
        onChange={(event) => {
          const nextValue = event.target.value
          onChange(nextValue)
          setOpen(nextValue.trim().length > 0)
        }}
      />
      {open && trimmedValue.length > 0 && filteredOptions.length > 0 ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-64 overflow-y-auto rounded-md border bg-white p-1 shadow-lg">
          {filteredOptions.map((option) => (
            <button
              key={`${option.value}-${option.label}`}
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-gray-100"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              <Check className={`h-4 w-4 ${value === option.value ? 'opacity-100' : 'opacity-0'}`} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.meta ? <span className="max-w-28 truncate text-xs text-gray-500">{option.meta}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
