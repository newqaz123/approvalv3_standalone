import { notFound } from 'next/navigation'
import { HierarchyPickerHarnessClient } from './hierarchy-picker-harness-client'

export const dynamic = 'force-dynamic'

export default function HierarchyPickerHarnessPage() {
  if (process.env.E2E_UI_HARNESS !== '1') notFound()
  return <HierarchyPickerHarnessClient />
}
