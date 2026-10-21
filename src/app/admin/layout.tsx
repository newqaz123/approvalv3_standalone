import { auth } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import { Navbar } from '@/components/navigation/navbar'
import { MobileNav } from '@/components/mobile/mobile-nav'
import prisma from '@/lib/prisma'
import { AUTHENTICATED_SHELL_CLASS } from '@/lib/authenticated-shell'
import { cn } from '@/lib/utils'

export default async function AdminRouteLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user?.id) {
    redirect('/sign-in')
  }

  // Check if user is admin (database check for server-side rendering)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true }
  })

  if (!user || user.role !== 'admin') {
    // Role-aware denial landing: an authenticated Engineering-ROLE user
    // (UserRole.engineering — organization membership alone does NOT
    // qualify) lands on their engineering dashboard; every other
    // non-admin keeps the prior /requests destination. Bare relative
    // path so the browser resolves it against the origin it is on.
    redirect(user?.role === 'engineering' ? '/engineering' : '/requests')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile navigation - visible only on small screens */}
      <MobileNav />

      {/* Desktop navigation - visible only on large screens and up */}
      <div className="hidden lg:block">
        <Navbar />
      </div>

      {/* Main content with top padding on mobile for fixed nav */}
      <main data-auth-shell className={cn(AUTHENTICATED_SHELL_CLASS, 'pb-12 pt-20 lg:py-12')}>
        <div className="space-y-8">
          {children}
        </div>
      </main>
    </div>
  )
}
