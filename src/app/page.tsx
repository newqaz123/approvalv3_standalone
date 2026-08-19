import { auth } from "@/lib/auth-config";
import { redirect } from "next/navigation";

export default async function Home() {
	const session = await auth();

	// Everyone gets routed: authenticated users to their role landing,
	// everyone else straight to the sign-in form (no marketing page).
	if (session?.user) {
		redirect("/requests/my-actions");
	}
	redirect("/sign-in");
}
