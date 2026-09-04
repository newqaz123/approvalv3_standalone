import { Skeleton } from '@/components/ui/skeleton'

const TOOLBAR_SLOT_COUNT = 12

/**
 * Placeholder that matches the live formatting toolbar + editor chrome so
 * lazy-load and TipTap `immediatelyRender: false` never flash the old Bold
 * textarea or a collapsed empty slot.
 */
export function RichTextEditorSkeleton({ minHeight = 160 }: { minHeight?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      <div className="rich-text-toolbar-wrapper flex flex-wrap items-center gap-1">
        {Array.from({ length: TOOLBAR_SLOT_COUNT }, (_, index) => (
          <Skeleton key={index} className="h-8 w-8 rounded-md" />
        ))}
      </div>
      <Skeleton className="w-full rounded-md" style={{ minHeight }} />
    </div>
  )
}
