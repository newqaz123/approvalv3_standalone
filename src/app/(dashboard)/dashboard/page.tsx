import { createTranslator } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";
import { FollowUpDashboard } from "@/components/dashboard/follow-up-dashboard";
import { getFollowUpDashboard } from "@/server-actions/dashboard";

export default async function DashboardPage() {
	const data = await getFollowUpDashboard().catch((error) => {
		console.error("Failed to load dashboard:", error);
		return null;
	});

	if (!data) {
		const t = createTranslator(await getRequestLocale());
		return (
			<div className="space-y-2 py-4">
				<h1 className="text-2xl font-bold">{t("nav.dashboard")}</h1>
				<p role="alert" className="text-destructive">{t("dashboard.error.initialLoad")}</p>
			</div>
		);
	}

	return (
		<div className="w-full py-4">
			<FollowUpDashboard data={data} />
		</div>
	);
}
