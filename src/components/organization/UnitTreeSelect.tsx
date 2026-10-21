'use client'

import React, { useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import {
  UNIT_PATH_SEPARATOR,
  searchUnitRows,
  unitDepthIndent,
  unitPathRows,
} from '@/lib/organization/unit-tree'

/**
 * Searchable, depth-indented unit tree select for the assign-person panel
 * (owner-approved). The trigger shows the selected unit's full tree path;
 * the panel is a search box plus a flat option list where each option is
 * indented by its depth and searchable by its own OR any ancestor name
 * ("Production" finds "Factory › Production Division › Engineering
 * Department"). It is a plain option list — not a second flowchart. The
 * accessible name of an option stays the clean unit name so tests and screen
 * readers target "Section A", not the path string.
 */
export function UnitTreeSelect({
  units,
  value,
  onChange,
  triggerId,
  placeholder = 'Select unit',
}: {
  units: ReadonlyArray<OrganizationUnitNode>
  value: string | null
  onChange: (unitId: string) => void
  triggerId?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const rows = useMemo(() => unitPathRows(units), [units])
  const filtered = useMemo(() => searchUnitRows(rows, search), [rows, search])
  const selected = rows.find((row) => row.unit.id === value) ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          id={triggerId}
          data-testid="assignment-unit-select"
          className="h-9 min-h-11 w-full justify-between px-3 py-2 text-left font-normal"
        >
          <span className="min-w-0 truncate">
            {selected ? selected.path : <span className="text-muted-foreground">{placeholder}</span>}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            data-testid="assignment-unit-search"
            placeholder="Search units…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No unit found</CommandEmpty>
            <CommandGroup>
              {filtered.map((row) => (
                <CommandItem
                  key={row.unit.id}
                  value={row.path}
                  aria-label={row.unit.name}
                  onSelect={() => {
                    onChange(row.unit.id)
                    setOpen(false)
                    setSearch('')
                  }}
                  className="items-start"
                >
                  <Check
                    className={`mr-2 mt-0.5 h-4 w-4 shrink-0 ${
                      row.unit.id === value ? 'opacity-100' : 'opacity-0'
                    }`}
                    aria-hidden="true"
                  />
                  <span
                    className="flex min-w-0 flex-col gap-0.5"
                    style={{ paddingLeft: `${unitDepthIndent(row.depth)}px` }}
                  >
                    <span className="truncate text-sm font-medium">{row.unit.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{row.path}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { UNIT_PATH_SEPARATOR }
