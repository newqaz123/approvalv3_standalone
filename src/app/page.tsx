import { currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function Home() {
  const user = await currentUser()

  // Redirect authenticated users to dashboard
  if (user) {
    redirect('/dashboard')
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Approval App V2</h1>
      <p className="mt-4 text-lg text-gray-600">
        Internal document approval workflow system
      </p>
      <div className="mt-8 flex gap-4">
        <Link
          href="/sign-in"
          className="rounded-md bg-blue-600 px-6 py-3 text-white hover:bg-blue-700 transition-colors"
        >
          Sign In
        </Link>
        <Link
          href="/sign-up"
          className="rounded-md border border-gray-300 px-6 py-3 hover:bg-gray-50 transition-colors"
        >
          Sign Up
        </Link>
      </div>
    </main>
  );
}
