'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Save } from 'lucide-react'
import { updateOwnDisplayName, type CurrentUserProfile } from '@/server-actions/users'

function formatRole(role: string) {
  return role
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function ProfileForm({ profile }: { profile: CurrentUserProfile }) {
  const router = useRouter()
  const { update } = useSession()
  const [displayName, setDisplayName] = useState(profile.name)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isPending, startTransition] = useTransition()

  const hasChanges = displayName.trim().replace(/\s+/g, ' ') !== profile.name

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')

    startTransition(async () => {
      try {
        const updatedProfile = await updateOwnDisplayName(displayName)
        setDisplayName(updatedProfile.name)
        await update({ name: updatedProfile.name })
        router.refresh()
        setSuccess('Profile updated')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update profile')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border bg-white p-6 shadow-sm">
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-md bg-green-50 p-4 text-sm text-green-700">
          {success}
        </div>
      )}

      <div>
        <label htmlFor="displayName" className="block text-sm font-medium text-gray-700">
          Display Name
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          minLength={2}
          maxLength={100}
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value)
            setSuccess('')
          }}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={profile.email}
            readOnly
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-gray-700 shadow-sm sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="department" className="block text-sm font-medium text-gray-700">
            Department
          </label>
          <input
            id="department"
            type="text"
            value={profile.department?.name || 'No department assigned'}
            readOnly
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-gray-700 shadow-sm sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="role" className="block text-sm font-medium text-gray-700">
            Role
          </label>
          <input
            id="role"
            type="text"
            value={formatRole(profile.role)}
            readOnly
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-gray-700 shadow-sm sm:text-sm"
          />
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !hasChanges}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {isPending ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </form>
  )
}
