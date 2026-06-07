import { ProfileForm } from '@/components/profile/profile-form'
import { getCurrentUserProfile } from '@/server-actions/users'

export default async function ProfilePage() {
  const profile = await getCurrentUserProfile()

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="mt-2 text-sm text-gray-600">
          Manage your display name and review your account details.
        </p>
      </div>

      <ProfileForm profile={profile} />
    </div>
  )
}
