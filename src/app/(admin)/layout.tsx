import { auth } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import { Navbar } from '@/components/navigation/navbar'
import { MobileNav } from '@/components/mobile/mobile-nav'
import prisma from '@/lib/prisma'

export default async function AdminLayout({
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
    redirect('/requests')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile navigation - visible only on small screens */}
      <MobileNav />

      {/* Desktop navigation - visible only on medium screens and up */}
      <div className="hidden md:block">
        <Navbar />
      </div>

      {/* Main content with top padding on mobile for fixed nav */}
      <main className="mx-auto px-6 pt-20 md:pt-12 pb-12 md:py-12 sm:px-8 lg:px-12 max-w-full md:max-w-7xl">
        <div className="space-y-8">
          {children}
        </div>
      </main>
    </div>
  )
}
