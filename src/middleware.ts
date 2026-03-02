import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentUser } from './lib/standalone-auth'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Debug logging
  console.log('===== MIDDLEWARE DEBUG =====')
  console.log('🔍 URL:', req.url)
  console.log('🔍 Path:', pathname)

  // Get current user
  const user = await getCurrentUser()
  console.log('🔍 User:', user?.email || 'Not authenticated')

  // Define route patterns
  const isAdminRoute = pathname.startsWith('/admin')
  const isProtectedRoute = pathname.startsWith('/dashboard') || pathname.startsWith('/requests') || pathname.startsWith('/admin')
  const isSignInRoute = pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up')

  // Protect admin routes
  if (isAdminRoute) {
    if (!user) {
      const signInUrl = new URL('/sign-in', req.url)
      return NextResponse.redirect(signInUrl)
    }
    if (user.role !== 'admin') {
      const dashboardUrl = new URL('/dashboard', req.url)
      return NextResponse.redirect(dashboardUrl)
    }
    console.log('✅ Admin route access granted')
  }

  // Protect dashboard routes
  if (isProtectedRoute) {
    if (!user) {
      const signInUrl = new URL('/sign-in', req.url)
      return NextResponse.redirect(signInUrl)
    }
    console.log('✅ Protected route access granted')

    // Role-based redirects from /dashboard
    if (pathname === '/dashboard') {
      if (user.role === 'engineering') {
        console.log('✅ Engineering user, redirecting to /engineering')
        return NextResponse.redirect(new URL('/engineering', req.url))
      }
      if (user.role === 'admin') {
        console.log('✅ Admin user, redirecting to /admin')
        return NextResponse.redirect(new URL('/admin', req.url))
      }
      console.log('✅ General dept user staying on /dashboard')
    }
  }

  // Redirect authenticated users from sign-in to appropriate dashboard
  if (isSignInRoute && user) {
    console.log('✅ Authenticated user on sign-in page, redirecting based on role')
    
    if (user.role === 'engineering') {
      console.log('✅ Redirecting to /engineering')
      return NextResponse.redirect(new URL('/engineering', req.url))
    } else if (user.role === 'admin') {
      console.log('✅ Redirecting to /admin')
      return NextResponse.redirect(new URL('/admin', req.url))
    }
    
    // Default to dashboard
    console.log('✅ Redirecting to /dashboard')
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  // Redirect authenticated users from root to appropriate dashboard
  if (pathname === '/' && user) {
    console.log('✅ Authenticated user on root, redirecting based on role')
    
    if (user.role === 'engineering') {
      console.log('✅ Redirecting to /engineering')
      return NextResponse.redirect(new URL('/engineering', req.url))
    } else if (user.role === 'admin') {
      console.log('✅ Redirecting to /admin')
      return NextResponse.redirect(new URL('/admin', req.url))
    }
    
    console.log('✅ Redirecting to /dashboard')
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
