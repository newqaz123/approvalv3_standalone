import { auth } from '@clerk/nextjs/server'

export default async function DebugPage() {
  const { userId, sessionClaims } = await auth()

  const metadata = sessionClaims?.metadata as { role?: string } | undefined

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4">User Debug Info</h1>
      <div className="bg-gray-100 p-4 rounded">
        <p><strong>User ID:</strong> {userId || 'Not signed in'}</p>
        <p><strong>Role:</strong> {metadata?.role || 'Not set'}</p>
        <p><strong>All Metadata:</strong></p>
        <pre className="bg-white p-2 rounded mt-2">
          {JSON.stringify(metadata, null, 2)}
        </pre>
      </div>
    </div>
  )
}
