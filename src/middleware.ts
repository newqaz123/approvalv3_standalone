import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isAdminRoute = createRouteMatcher(['/admin(.*)'])
const isProtectedRoute = createRouteMatcher(['/dashboard(.*)', '/requests(.*)', '/admin(.*)'])
const isSignInRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)'])

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth()

  // Debug logging to understand the flow
  console.log('===== MIDDLEWARE DEBUG =====')
  console.log('🔍 URL:', req.url)
  console.log('🔍 Path:', req.nextUrl.pathname)
  console.log('🔍 userId:', userId)
  console.log('🔍 isSignInRoute:', isSignInRoute(req))

  // Protect admin routes - only users with 'admin' role can access
  if (isAdminRoute(req)) {
    if (!userId) {
      const signInUrl = new URL('/sign-in', req.url)
      return NextResponse.redirect(signInUrl)
    }

    // For admin routes, we rely on the server-side layout check
    // which does a database query. Middleware just ensures authentication.
    // This is because publicMetadata is not included in JWT by default.
    console.log('✅ Admin route access - authenticated, layout will verify admin role')
  }

  // Protect dashboard routes - must be authenticated
  if (isProtectedRoute(req)) {
    const { redirectToSignIn } = await auth()
    const isAuthenticated = await auth().then(a => a.isAuthenticated)
    if (!isAuthenticated) {
      return redirectToSignIn()
    }

    // Role-based redirect: if user is on /dashboard but their role suggests they should be elsewhere
    if (req.nextUrl.pathname === '/dashboard' && userId) {
      console.log('🎯 User on /dashboard, checking role...')
      const { sessionClaims } = await auth()
      let role = (sessionClaims as any)?.metadata?.role as string | undefined
      console.log('📋 Role from Clerk metadata:', role)

      // If role is not set in Clerk metadata, fall back to API endpoint
      if (!role) {
        console.log('⚠️ No role in Clerk metadata, calling API for userId:', userId)
        try {
          const apiUrl = new URL('/api/user/role', req.url)
          // Pass cookies to maintain auth context
          const cookieHeader = req.headers.get('cookie')
          const response = await fetch(apiUrl.toString(), {
            headers: {
              ...(cookieHeader && { cookie: cookieHeader })
            }
          })
          if (response.ok) {
            const data = await response.json()
            role = data.role
            console.log('📋 Role from API:', role, 'for user:', userId)
          } else {
            console.error('❌ API returned error:', response.status)
          }
        } catch (error) {
          console.error('❌ Error calling API for role:', error)
        }
      }

      // Redirect engineering users to /engineering
      if (role === 'engineering') {
        console.log('✅ Engineering user on /dashboard, redirecting to /engineering')
        return NextResponse.redirect(new URL('/engineering', req.url))
      }

      // Redirect admin users to /admin
      if (role === 'admin') {
        console.log('✅ Admin user on /dashboard, redirecting to /admin')
        return NextResponse.redirect(new URL('/admin', req.url))
      }

      // general_dept users stay on /dashboard
      console.log('✅ General dept user on /dashboard, allowing access')
    }
  }

  // Role-based redirect after sign-in completion
  // When authenticated user visits sign-in page (which happens after login),
  // redirect them to their appropriate dashboard based on role
  if (isSignInRoute(req) && userId) {
    console.log('✅ Sign-in route detected with authenticated user - checking role')
    const { sessionClaims } = await auth()
    let role = (sessionClaims as any)?.metadata?.role as string | undefined

    console.log('✅ User role from Clerk metadata:', role)

    // If role is not set in Clerk metadata, fall back to API endpoint
    if (!role) {
      console.log('⚠️ Role not in Clerk metadata, calling API...')
      try {
        const apiUrl = new URL('/api/user/role', req.url)
        const cookieHeader = req.headers.get('cookie')
        const response = await fetch(apiUrl.toString(), {
          headers: {
            ...(cookieHeader && { cookie: cookieHeader })
          }
        })
        if (response.ok) {
          const data = await response.json()
          role = data.role
          console.log('✅ User role from API:', role)
        }
      } catch (error) {
        console.error('❌ Error calling API for role:', error)
      }
    }

    // Redirect based on role
    if (role === 'engineering') {
      const engineeringUrl = new URL('/engineering', req.url)
      console.log('✅ Redirecting to /engineering')
      return NextResponse.redirect(engineeringUrl)
    } else if (role === 'admin') {
      const adminUrl = new URL('/admin', req.url)
      console.log('✅ Redirecting to /admin')
      return NextResponse.redirect(adminUrl)
    }
    // Default to dashboard for general_dept and unknown roles
    const dashboardUrl = new URL('/dashboard', req.url)
    console.log('✅ Redirecting to /dashboard')
    return NextResponse.redirect(dashboardUrl)
  }

  // Check if user is landing on root URL after sign-in
  if (req.nextUrl.pathname === '/' && userId) {
    console.log('✅ Root URL detected with authenticated user - redirecting based on role')
    const { sessionClaims } = await auth()
    let role = (sessionClaims as any)?.metadata?.role as string | undefined

    console.log('✅ User role from Clerk metadata:', role)

    // If role is not set in Clerk metadata, fall back to API endpoint
    if (!role) {
      console.log('⚠️ Role not in Clerk metadata, calling API...')
      try {
        const apiUrl = new URL('/api/user/role', req.url)
        const cookieHeader = req.headers.get('cookie')
        const response = await fetch(apiUrl.toString(), {
          headers: {
            ...(cookieHeader && { cookie: cookieHeader })
          }
        })
        if (response.ok) {
          const data = await response.json()
          role = data.role
          console.log('✅ User role from API:', role)
        }
      } catch (error) {
        console.error('❌ Error calling API for role:', error)
      }
    }

    if (role === 'engineering') {
      const engineeringUrl = new URL('/engineering', req.url)
      console.log('✅ Redirecting to /engineering')
      return NextResponse.redirect(engineeringUrl)
    } else if (role === 'admin') {
      const adminUrl = new URL('/admin', req.url)
      console.log('✅ Redirecting to /admin')
      return NextResponse.redirect(adminUrl)
    }
    const dashboardUrl = new URL('/dashboard', req.url)
    console.log('✅ Redirecting to /dashboard')
    return NextResponse.redirect(dashboardUrl)
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
