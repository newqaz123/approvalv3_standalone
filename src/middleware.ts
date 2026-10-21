import { auth } from "@/lib/auth-config";
import { NextResponse } from "next/server";

export default auth((req) => {
	const { pathname } = req.nextUrl;
	const user = req.auth?.user;

	/*
	 * Redirects built here must stay origin-safe for the browser. In
	 * next dev the middleware adapter rewrites any Location whose host
	 * matches the request (after NextURL's 127.0.0.1 → localhost
	 * normalization) to a synthesized localhost origin, and throws on
	 * relative Locations, so middleware redirects cannot be made
	 * host-stable when the server and the browser disagree about the host
	 * (e.g. tests browse http://127.0.0.1:<port> while the dev server was
	 * started with --hostname 127.0.0.1). Cookies are host-scoped, so a
	 * flipped host silently drops the session cookie.
	 *
	 * That is why ROLE-based denial of /admin/* is NOT redirected here:
	 * src/app/admin/layout.tsx performs the authoritative DB-backed role
	 * check and issues a server-side redirect(), which emits an
	 * origin-relative Location the browser resolves against the origin it
	 * is already on. Middleware still guards authentication.
	 */
	const origin = (() => {
		const host =
			req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
		const proto =
			req.headers.get("x-forwarded-proto") ??
			(host.startsWith("https") ? "https" : "http");
		return host ? `${proto}://${host}` : req.nextUrl.origin;
	})();
	const redirectTo = (path: string): NextResponse =>
		NextResponse.redirect(new URL(path, origin));

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
		return redirectTo(`/sign-in?callbackUrl=${callbackUrl}`);
	};
	const callbackUrl = req.nextUrl.searchParams.get("callbackUrl");
	const safeCallbackUrl =
		callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//")
			? callbackUrl
			: null;

	// Protect admin routes: authentication only. Non-admin ROLE denial is
	// handled by the admin layout's DB-backed redirect (see comment above).
	if (isAdminRoute) {
		if (!user) {
			return redirectToSignIn();
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
				return redirectTo("/engineering");
			}
			if (user.role === "admin") {
				return redirectTo("/admin");
			}
		}
	}

	// Redirect authenticated users from sign-in to appropriate dashboard
	if (isSignInRoute && user) {
		if (safeCallbackUrl) {
			return redirectTo(safeCallbackUrl);
		}
		return redirectTo(getRoleDashboard(user.role));
	}

	// Redirect authenticated users from root to appropriate dashboard
	if (pathname === "/" && user) {
		return redirectTo(getRoleDashboard(user.role));
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
