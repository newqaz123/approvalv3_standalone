import { auth } from '@/lib/auth-config'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const user = req.auth?.user

  // Define route patterns
  const isAdminRoute = pathname.startsWith('/admin')
  const isProtectedRoute = pathname.startsWith('/dashboard') || pathname.startsWith('/requests') || pathname.startsWith('/admin') || pathname.startsWith('/engineering')
  const isSignInRoute = pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up')

  // Protect admin routes
  if (isAdminRoute) {
    if (!user) {
      return NextResponse.redirect(new URL('/sign-in', req.url))
    }
    if (user.role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
  }

  // Protect dashboard/request/engineering routes
  if (isProtectedRoute) {
    if (!user) {
      return NextResponse.redirect(new URL('/sign-in', req.url))
    }

    // Role-based redirects from /dashboard
    if (pathname === '/dashboard') {
      if (user.role === 'engineering') {
        return NextResponse.redirect(new URL('/engineering', req.url))
      }
      if (user.role === 'admin') {
        return NextResponse.redirect(new URL('/admin', req.url))
      }
    }
  }

  // Redirect authenticated users from sign-in to appropriate dashboard
  if (isSignInRoute && user) {
    return NextResponse.redirect(new URL(getRoleDashboard(user.role), req.url))
  }

  // Redirect authenticated users from root to appropriate dashboard
  if (pathname === '/' && user) {
    return NextResponse.redirect(new URL(getRoleDashboard(user.role), req.url))
  }

  return NextResponse.next()
})

function getRoleDashboard(role: string): string {
  switch (role) {
    case 'engineering': return '/engineering'
    case 'admin': return '/admin'
    default: return '/dashboard'
  }
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, including HMR and RSC requests
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)|_rsc).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
