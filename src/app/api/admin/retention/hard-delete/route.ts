import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { hardDeleteArchivedRequests } from '@/lib/retention-hard-delete'

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin()
  if (!adminId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let requestIds: unknown
  try {
    const body = await request.json()
    requestIds = body.requestIds
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(requestIds)) {
    return NextResponse.json({ error: 'Select at least one archived request' }, { status: 400 })
  }

  const result = await hardDeleteArchivedRequests(requestIds.filter((id): id is string => typeof id === 'string'))
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true, deleted: result.deleted, fileWarnings: result.fileWarnings })
}
