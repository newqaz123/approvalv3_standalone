import { FollowUpDashboard } from "@/components/dashboard/follow-up-dashboard";
import { getFollowUpDashboard } from "@/server-actions/dashboard";

export default async function DashboardPage() {
	const data = await getFollowUpDashboard();

	return (
		<div className="w-full py-4">
			<FollowUpDashboard data={data} />
		</div>
	);
}
