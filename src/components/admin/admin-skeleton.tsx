import { Skeleton } from '@/components/ui/skeleton'

export function AdminTableSkeleton() {
  return (
    <div className="border rounded-md">
      {/* Header */}
      <div className="flex items-center gap-4 p-4 border-b bg-muted/50">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
      </div>
      {/* Rows */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 border-b last:border-0">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-20 ml-auto" />
        </div>
      ))}
    </div>
  )
}

export function AdminCardsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-card border rounded-lg p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function AdminPageSkeleton() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      {/* Content */}
      <div className="hidden md:block">
        <AdminTableSkeleton />
      </div>
      <div className="md:hidden">
        <AdminCardsSkeleton />
      </div>
    </div>
  )
}
