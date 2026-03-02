import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import prisma from '@/lib/prisma'
import { saveFile, generateFilePath } from '@/lib/files'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/gif',
]

export async function POST(request: NextRequest) {
  const { userId } = await auth()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const requestId = formData.get('requestId') as string

    if (!file || !requestId) {
      return NextResponse.json(
        { error: 'File and requestId are required' },
        { status: 400 }
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` },
        { status: 400 }
      )
    }

    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'File type not allowed. Allowed types: PDF, Word, Excel, Images' },
        { status: 400 }
      )
    }

    // Verify request exists and user owns it or is an engineering user
    // For engineering solutions: any engineering user can upload files to SentToEngineer requests
    // Fetch user role and request in a single query to minimize connection time
    const [dbRequest, user] = await Promise.all([
      prisma.request.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          requesterId: true,
          status: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      }),
    ])

    console.log('[/api/upload] Authorization check:', {
      requestId,
      userId,
      requestFound: !!dbRequest,
      requesterId: dbRequest?.requesterId,
      status: dbRequest?.status,
      userRole: user?.role,
    })

    if (!dbRequest) {
      return NextResponse.json(
        { error: 'Request not found or unauthorized' },
        { status: 404 }
      )
    }

    // Check if user is the requester
    const isRequester = dbRequest.requesterId === userId

    // For engineering users: check if this is a request in engineering workflow
    // Any engineering user can upload files to SentToEngineer status requests
    const isEngineeringUser = user?.role === 'engineering'
    const isEngineeringRequest = dbRequest.status === 'SentToEngineer'
    const canEngineerUpload = isEngineeringUser && isEngineeringRequest

    if (!isRequester && !canEngineerUpload) {
      return NextResponse.json(
        { error: 'Request not found or unauthorized' },
        { status: 404 }
      )
    }

    // Generate file path
    const filePath = generateFilePath(requestId, file.name)

    // Convert file to buffer and save
    // Note: This operation is slow for large files but doesn't hold DB connection
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await saveFile(filePath, buffer)

    // Generate file ID
    const fileId = crypto.randomUUID()

    return NextResponse.json({
      success: true,
      fileId,
      filePath,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    })
  } catch (error) {
    console.error('File upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    )
  }
}
