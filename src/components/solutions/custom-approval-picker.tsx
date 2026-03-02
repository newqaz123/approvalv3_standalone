'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown, User, Plus, X, ChevronUp, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface User {
  id: string
  name: string
  email: string
  level: number | null
}

interface CustomApprovalPickerProps {
  users: User[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  currentUserId: string
  disabled?: boolean
}

export function CustomApprovalPicker({
  users,
  selectedIds,
  onChange,
  currentUserId,
  disabled = false,
}: CustomApprovalPickerProps) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')

  // Filter out current user and already selected users
  const availableUsers = users.filter(
    (user) => user.id !== currentUserId && !selectedIds.includes(user.id)
  )

  const selectedUsers = selectedIds
    .map((id) => users.find((user) => user.id === id))
    .filter((user): user is User => user !== undefined)

  const handleSelectUser = (userId: string) => {
    onChange([...selectedIds, userId])
    setOpen(false)
    setSearchValue('')
  }

  const handleRemoveUser = (userId: string) => {
    onChange(selectedIds.filter((id) => id !== userId))
  }

  const handleMoveUp = (index: number) => {
    console.log('handleMoveUp called for index:', index, 'selectedIds:', selectedIds)
    if (index <= 0) {
      console.log('handleMoveUp: index <= 0, returning')
      return
    }
    const newIds = [...selectedIds]
    ;[newIds[index - 1], newIds[index]] = [newIds[index], newIds[index - 1]]
    console.log('handleMoveUp: newIds after swap:', newIds)
    onChange(newIds)
  }

  const handleMoveDown = (index: number) => {
    console.log('handleMoveDown called for index:', index, 'selectedIds:', selectedIds)
    if (index >= selectedIds.length - 1 || index < 0) {
      console.log('handleMoveDown: index out of bounds, returning')
      return
    }
    const newIds = [...selectedIds]
    ;[newIds[index], newIds[index + 1]] = [newIds[index + 1], newIds[index]]
    console.log('handleMoveDown: newIds after swap:', newIds)
    onChange(newIds)
  }

  const filteredUsers = availableUsers.filter(
    (user) =>
      user.name.toLowerCase().includes(searchValue.toLowerCase()) ||
      user.email.toLowerCase().includes(searchValue.toLowerCase())
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Custom Approval Chain</label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || availableUsers.length === 0}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Approver
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0" align="start" side="bottom">
            <Command>
              <CommandInput
                placeholder="Search users..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandEmpty>No users found.</CommandEmpty>
              <CommandGroup>
                {filteredUsers.map((user) => (
                  <CommandItem
                    key={user.id}
                    value={user.id}
                    onSelect={() => handleSelectUser(user.id)}
                  >
                    <User className="mr-2 h-4 w-4" />
                    <span className="flex-1">{user.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {user.email}
                    </span>
                    <Check
                      className={cn(
                        'ml-2 h-4 w-4',
                        selectedIds.includes(user.id) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {selectedUsers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No custom approvers selected. Default engineering hierarchy will be used.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Approvals will proceed in this order:
          </p>
          <div className="space-y-2">
            {selectedUsers.map((user, index) => (
              <div
                key={user.id}
                className="flex items-center gap-3 p-3 border rounded-lg bg-card"
              >
                <Badge
                  variant="default"
                  className="bg-blue-500 hover:bg-blue-600 shrink-0"
                >
                  {index + 1}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user.email}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-9 w-9 p-0 cursor-pointer",
                      (index === 0 || disabled) && "hidden"
                    )}
                    onClick={() => handleMoveUp(index)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-9 w-9 p-0 cursor-pointer",
                      (index === selectedUsers.length - 1 || disabled) && "hidden"
                    )}
                    onClick={() => handleMoveDown(index)}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    onClick={() => handleRemoveUser(user.id)}
                    disabled={disabled}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
