"use client"

import { useState, useEffect } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { AuditExportButton } from "@/components/admin/audit-export-button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Check, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface Request {
  id: string
  title: string
  status: string
  department: {
    name: string | null
  } | null
  requester: {
    name: string | null
    email: string | null
  } | null
  createdAt: string
}

export function RequestExportCard() {
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null)
  const [requests, setRequests] = useState<Request[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [open, setOpen] = useState(false)

  // Fetch requests when search query changes
  useEffect(() => {
    if (searchQuery.length >= 2) {
      fetchRequests()
    } else {
      setRequests([])
    }
  }, [searchQuery])

  const fetchRequests = async () => {
    try {
      setIsLoading(true)
      const response = await fetch(`/api/requests?search=${encodeURIComponent(searchQuery)}&take=20`)
      if (!response.ok) throw new Error('Failed to fetch requests')
      
      const data = await response.json()
      setRequests(data || [])
    } catch (error) {
      console.error('Error fetching requests:', error)
      toast.error('Failed to fetch requests')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectRequest = (request: Request) => {
    setSelectedRequest(request)
    setOpen(false)
    setSearchQuery("")
  }

  const handleClearSelection = () => {
    setSelectedRequest(null)
    setSearchQuery("")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export by Request</CardTitle>
        <CardDescription>
          Search and select a request to export its audit trail
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="requestSearch">Search Request</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full justify-between h-auto p-3"
              >
                {selectedRequest ? (
                  <div className="flex flex-col items-start">
                    <span className="font-medium">{selectedRequest.title}</span>
                    <div className="flex gap-2 text-sm text-muted-foreground mt-1">
                      <span>ID: {selectedRequest.id}</span>
                      {selectedRequest.department?.name && (
                        <span>• {selectedRequest.department.name}</span>
                      )}
                      {selectedRequest.requester?.name && (
                        <span>• {selectedRequest.requester.name}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center text-muted-foreground">
                    <Search className="mr-2 h-4 w-4" />
                    Search by title, ID, or requester name...
                  </div>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0" align="start" onPointerDownOutside={(e) => {
    // Prevent closing when clicking inside the command input
    if (e.target && (e.target as HTMLElement).closest('[cmdk-input]')) {
      e.preventDefault()
    }
  }}>
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Type to search requests..."
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  className="border-0 focus:ring-0"
                />
                <CommandList>
                  {isLoading ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading...</div>
                  ) : requests.length === 0 && searchQuery.length >= 2 ? (
                    <CommandEmpty>No requests found.</CommandEmpty>
                  ) : searchQuery.length < 2 ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      Type at least 2 characters to search...
                    </div>
                  ) : (
                    <CommandGroup>
                      {requests.map((request) => (
                        <CommandItem
                          key={request.id}
                          onSelect={() => handleSelectRequest(request)}
                          className="p-3 cursor-pointer"
                        >
                          <div className="flex flex-col items-start w-full">
                            <div className="flex items-center w-full">
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedRequest?.id === request.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <span className="font-medium">{request.title}</span>
                            </div>
                            <div className="flex gap-2 text-sm text-muted-foreground ml-6 mt-1">
                              <span>ID: {request.id}</span>
                              {request.department?.name && (
                                <span>• {request.department.name}</span>
                              )}
                              {request.requester?.name && (
                                <span>• {request.requester.name}</span>
                              )}
                              <span>• {request.status}</span>
                            </div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        
        {selectedRequest && (
          <div className="flex items-center gap-2">
            <AuditExportButton
              requestId={selectedRequest.id}
              disabled={false}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearSelection}
            >
              Clear
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
