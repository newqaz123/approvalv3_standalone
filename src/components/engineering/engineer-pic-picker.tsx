'use client'

import { useState, useTransition } from 'react'
import { Check, Users, Loader2 } from 'lucide-react'
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
import { assignEngineers } from '@/server-actions/requests'
import { toast } from 'sonner'

interface EngineerUser {
  id: string
  name: string
  email: string
  level: number | null
}

interface EngineerPicPickerProps {
  requestId: string
  engineeringUsers: EngineerUser[]
  initialAssignedIds: string[]
  currentUserId: string
}

export function EngineerPicPicker({
  requestId,
  engineeringUsers,
  initialAssignedIds,
  currentUserId,
}: EngineerPicPickerProps) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>(initialAssignedIds)
  const [isPending, startTransition] = useTransition()

  const selectedUsers = selectedIds
    .map((id) => engineeringUsers.find((user) => user.id === id))
    .filter((user): user is EngineerUser => user !== undefined)

  const handleToggleUser = (userId: string) => {
    setSelectedIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    )
  }

  const handleSave = () => {
    startTransition(async () => {
      try {
        const result = await assignEngineers(requestId, selectedIds)

        if (result.success) {
          toast.success(
            selectedIds.length === 0
              ? 'PICs cleared successfully'
              : `${selectedIds.length} PIC(s) assigned successfully`
          )
          setOpen(false)
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to assign PICs'
        )
      }
    })
  }

  const filteredUsers = engineeringUsers.filter(
    (user) =>
      user.name.toLowerCase().includes(searchValue.toLowerCase()) ||
      user.email.toLowerCase().includes(searchValue.toLowerCase())
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 h-auto min-h-[36px] justify-start"
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Users className="h-4 w-4 text-gray-400" />
          )}
          {selectedUsers.length === 0 ? (
            <span className="text-sm text-gray-500">Assign PIC</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {selectedUsers.map((user) => (
                <Badge
                  key={user.id}
                  variant="secondary"
                  className="text-xs font-normal"
                >
                  {user.name.split(' ')[0]}
                </Badge>
              ))}
            </div>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start" side="bottom">
        <Command>
          <CommandInput
            placeholder="Search engineers..."
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandEmpty>No engineers found.</CommandEmpty>
          <CommandGroup className="max-h-[300px] overflow-y-auto">
            {filteredUsers.map((user) => {
              const isSelected = selectedIds.includes(user.id)
              return (
                <CommandItem
                  key={user.id}
                  value={user.id}
                  onSelect={() => handleToggleUser(user.id)}
                  className="cursor-pointer"
                >
                  <div
                    className={cn(
                      'mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'opacity-50 [&_svg]:invisible'
                    )}
                  >
                    <Check className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{user.name}</span>
                      {user.level !== null && (
                        <Badge variant="outline" className="text-xs ml-2">
                          L{user.level}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                </CommandItem>
              )
            })}
          </CommandGroup>
        </Command>
        <div className="border-t p-3 flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {selectedIds.length} selected
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
