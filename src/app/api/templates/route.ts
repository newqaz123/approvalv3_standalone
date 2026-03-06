import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function GET() {
  try {
    const templates = await prisma.templates.findMany({
      where: {
        isActive: true,
      },
      orderBy: [
        { isDefault: 'desc' },
        { name: 'asc' },
      ],
      select: {
        id: true,
        name: true,
        title: true,
        description: true,
        isDefault: true,
      },
    })

    return NextResponse.json(templates)
  } catch (error) {
    console.error('Failed to fetch templates:', error)
    return NextResponse.json(
      { error: 'Failed to fetch templates' },
      { status: 500 }
    )
  }
}
