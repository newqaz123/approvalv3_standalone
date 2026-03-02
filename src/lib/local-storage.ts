import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

export interface UploadedFile {
  url: string
  filename: string
  size: number
  mimetype: string
}

const UPLOAD_DIR = './public/uploads'

// Ensure upload directory exists
async function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }
}

export async function uploadFile(file: File, subfolder?: string): Promise<UploadedFile> {
  await ensureUploadDir()
  
  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  
  // Create unique filename
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 9)
  const filename = `${timestamp}-${random}-${file.name}`
  
  // Create subfolder if specified
  const targetDir = subfolder ? join(UPLOAD_DIR, subfolder) : UPLOAD_DIR
  if (!existsSync(targetDir)) {
    await mkdir(targetDir, { recursive: true })
  }
  
  const filepath = join(targetDir, filename)
  
  // Write file
  await writeFile(filepath, buffer)
  
  // Return public URL
  const relativePath = subfolder ? `uploads/${subfolder}/${filename}` : `uploads/${filename}`
  const url = `/${relativePath}`
  
  return {
    url,
    filename,
    size: file.size,
    mimetype: file.type
  }
}

export async function deleteFile(url: string): Promise<void> {
  try {
    // Extract file path from URL
    const filepath = url.startsWith('/') ? url.slice(1) : url
    const fullPath = join(process.cwd(), 'public', filepath)
    
    if (existsSync(fullPath)) {
      await import('fs/promises').then(fs => fs.unlink(fullPath))
    }
  } catch (error) {
    console.error('Failed to delete file:', error)
  }
}

export function getPublicUrl(filename: string, subfolder?: string): string {
  const path = subfolder ? `uploads/${subfolder}/${filename}` : `uploads/${filename}`
  return `/${path}`
}
