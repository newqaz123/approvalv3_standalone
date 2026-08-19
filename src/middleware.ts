import { auth } from "@/lib/auth-config";
import { NextResponse } from "next/server";

export default auth((req) => {
	const { pathname } = req.nextUrl;
	const user = req.auth?.user;

	/*
	 * Build the origin from request headers. Next dev synthesizes
	 * req.url's origin as localhost:<default port> regardless of the actual
	 * port, which once bounced unauthenticated users to a different local
	 * app. Proxies also require the forwarded headers to keep redirects
	 * on-host.
	 */
	const origin = (() => {
		const host =
			req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
		const proto =
			req.headers.get("x-forwarded-proto") ??
			(host.startsWith("https") ? "https" : "http");
		return host ? `${proto}://${host}` : req.nextUrl.origin;
	})();
	const absolute = (path: string) => new URL(path, origin);

	// Define route patterns
	const isAdminRoute = pathname.startsWith("/admin");
	const isProtectedRoute =
		pathname.startsWith("/dashboard") ||
		pathname.startsWith("/requests") ||
		pathname.startsWith("/admin") ||
		pathname.startsWith("/engineering");
	const isSignInRoute =
		pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");
	const redirectToSignIn = () => {
		const callbackUrl = encodeURIComponent(
			req.nextUrl.pathname + req.nextUrl.search,
		);
		return NextResponse.redirect(absolute(`/sign-in?callbackUrl=${callbackUrl}`));
	};
	const callbackUrl = req.nextUrl.searchParams.get("callbackUrl");
	const safeCallbackUrl =
		callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//")
			? callbackUrl
			: null;

	// Protect admin routes
	if (isAdminRoute) {
		if (!user) {
			return redirectToSignIn();
		}
		if (user.role !== "admin") {
			return NextResponse.redirect(absolute(getRoleDashboard(user.role)));
		}
	}

	// Protect dashboard/request/engineering routes
	if (isProtectedRoute) {
		if (!user) {
			return redirectToSignIn();
		}

		// Role-based redirects from /dashboard
		if (pathname === "/dashboard") {
			if (user.role === "engineering") {
				return NextResponse.redirect(absolute("/engineering"));
			}
			if (user.role === "admin") {
				return NextResponse.redirect(absolute("/admin"));
			}
		}
	}

	// Redirect authenticated users from sign-in to appropriate dashboard
	if (isSignInRoute && user) {
		if (safeCallbackUrl) {
			return NextResponse.redirect(absolute(safeCallbackUrl));
		}
		return NextResponse.redirect(absolute(getRoleDashboard(user.role)));
	}

	// Redirect authenticated users from root to appropriate dashboard
	if (pathname === "/" && user) {
		return NextResponse.redirect(absolute(getRoleDashboard(user.role)));
	}

	return NextResponse.next();
});

function getRoleDashboard(role: string): string {
	switch (role) {
		case "engineering":
			return "/engineering";
		case "admin":
			return "/admin";
		default:
			return "/requests/my-actions";
	}
}

export const config = {
	matcher: [
		// Skip Next.js internals and all static files, including HMR and RSC requests
		"/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)|_rsc).*)",
		// Always run for API routes
		"/(api|trpc)(.*)",
	],
};
