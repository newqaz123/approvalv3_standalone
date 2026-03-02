import { S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'

// Initialize S3 client with environment credentials
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
})

/**
 * Generate presigned URL for file upload
 * URL expires in 15 minutes (900 seconds)
 */
export async function generateUploadUrl({
  key,
  contentType,
  contentLength,
}: {
  key: string
  contentType: string
  contentLength: number
}) {
  if (!process.env.AWS_S3_BUCKET) {
    throw new Error('AWS_S3_BUCKET environment variable is not set')
  }

  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  })

  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 900, // 15 minutes
  })

  return signedUrl
}

/**
 * Generate presigned URL for file download
 * URL expires in 1 hour (3600 seconds)
 */
export async function generateDownloadUrl(key: string) {
  if (!process.env.AWS_S3_BUCKET) {
    throw new Error('AWS_S3_BUCKET environment variable is not set')
  }

  const command = new GetObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET,
    Key: key,
  })

  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 3600, // 1 hour
  })

  return signedUrl
}

export { s3Client }
