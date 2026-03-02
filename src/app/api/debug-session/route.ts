import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const { sessionClaims, userId } = await auth()

  return NextResponse.json({
    userId,
    sessionClaims,
    publicMetadata: sessionClaims?.publicMetadata,
    role: (sessionClaims?.publicMetadata as any)?.role,
  }, { status: 200 })
}
