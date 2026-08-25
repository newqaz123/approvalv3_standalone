import { readdir, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import type { UploadVolumeUsage } from './storage-dashboard'

async function sumDirectoryBytes(root: string): Promise<number> {
  const entries = await readdir(root, { withFileTypes: true })
  let total = 0

  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      total += await sumDirectoryBytes(path)
      continue
    }
    if (entry.isFile()) {
      const info = await stat(path)
      total += info.size
    }
  }

  return total
}

export async function measureUploadVolume(root: string): Promise<UploadVolumeUsage> {
  try {
    const [uploadDirBytes, volume] = await Promise.all([
      sumDirectoryBytes(root),
      statfs(root).catch(() => null),
    ])

    return {
      uploadDirBytes,
      uploadDirError: null,
      diskTotalBytes: volume ? Number(volume.bsize) * Number(volume.blocks) : null,
      diskFreeBytes: volume ? Number(volume.bsize) * Number(volume.bavail) : null,
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : ''
    const message = error instanceof Error ? error.message : 'Could not read uploads folder'

    return {
      uploadDirBytes: null,
      uploadDirError: code === 'ENOENT' ? 'Upload folder not found' : message,
      diskTotalBytes: null,
      diskFreeBytes: null,
    }
  }
}
