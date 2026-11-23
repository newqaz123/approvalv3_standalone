"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Save } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useTranslations } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import {
	updateOwnDisplayName,
	type CurrentUserProfile,
} from "@/server-actions/users";

export function ProfileForm({ profile }: { profile: CurrentUserProfile }) {
	const t = useTranslations();
	const router = useRouter();
	const { update } = useSession();
	const [displayName, setDisplayName] = useState(profile.name);
	const [error, setError] = useState<MessageKey | null>(null);
	const [success, setSuccess] = useState(false);
	const [isPending, startTransition] = useTransition();

	const hasChanges = displayName.trim().replace(/\s+/g, " ") !== profile.name;

	function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setSuccess(false);

		startTransition(async () => {
			try {
				const updatedProfile = await updateOwnDisplayName(displayName);
				if (updatedProfile.errorKey) {
					setError(updatedProfile.errorKey);
					return;
				}
				setDisplayName(updatedProfile.name);
				await update({ name: updatedProfile.name });
				router.refresh();
				setSuccess(true);
			} catch {
				setError("account.profileUpdateFailed");
			}
		});
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-4 rounded-lg border bg-white p-6 shadow-sm">
				<UserAvatar name={profile.name} size="xl" />
				<div className="min-w-0">
					<p className="text-lg font-bold text-gray-900">{profile.name}</p>
					<p className="mt-0.5 truncate text-sm text-gray-600">
						{profile.department?.name || t("account.noDepartment")} • {profile.email}
					</p>
					<span className="mt-2 inline-block rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
						{t(`account.role.${profile.role}`)}
					</span>
				</div>
			</div>

			<form
				onSubmit={handleSubmit}
				className="space-y-6 rounded-lg border bg-white p-6 shadow-sm"
			>
				{error && (
					<div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
						{t(error)}
					</div>
				)}

				{success && (
					<div role="status" className="rounded-md bg-green-50 p-4 text-sm text-green-700">
						{t("account.profileUpdated")}
					</div>
				)}

				<div>
					<label
						htmlFor="displayName"
						className="block text-sm font-medium text-gray-700"
					>
						{t("account.displayName")}
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
							setDisplayName(event.target.value);
							setSuccess(false);
						}}
						className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm"
					/>
				</div>

				<div className="grid gap-4 sm:grid-cols-2">
					<div>
						<label
							htmlFor="email"
							className="block text-sm font-medium text-gray-700"
						>
							{t("account.email")}
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
						<label
							htmlFor="department"
							className="block text-sm font-medium text-gray-700"
						>
							{t("account.department")}
						</label>
						<input
							id="department"
							type="text"
							value={profile.department?.name || t("account.noDepartmentAssigned")}
							readOnly
							className="mt-1 block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-gray-700 shadow-sm sm:text-sm"
						/>
					</div>

					<div>
						<label
							htmlFor="role"
							className="block text-sm font-medium text-gray-700"
						>
							{t("account.role")}
						</label>
						<input
							id="role"
							type="text"
							value={t(`account.role.${profile.role}`)}
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
						{t("common.cancel")}
					</button>
					<button
						type="submit"
						disabled={isPending || !hasChanges}
						className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					>
						<Save className="h-4 w-4" />
						{t(isPending ? "common.saving" : "account.saveProfile")}
					</button>
				</div>
			</form>
		</div>
	);
}
