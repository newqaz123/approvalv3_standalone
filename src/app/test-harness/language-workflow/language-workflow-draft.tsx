'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SubmitterModal } from '@/components/requests/submitter-modal'

export function LanguageWorkflowDraft() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open fixture draft</button>
      <SubmitterModal mode="request" open={open} onOpenChange={setOpen} />
      {/* Test only: ask the server for new props without interacting through the modal. */}
      <button type="button" id="reconcile-workflow-locale" hidden onClick={() => router.replace('?locale=th')} />
    </>
  )
}
