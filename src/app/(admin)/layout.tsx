import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Navbar } from '@/components/navigation/navbar'
import { MobileNav } from '@/components/mobile/mobile-nav'
import prisma from '@/lib/prisma'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()

  if (!userId) {
    redirect('/sign-in')
  }

  // Check if user is admin (database check for server-side rendering)
  const user = await prisma.user.findUnique({
    where: { id: userId },
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
      <main className="mx-auto px-4 pt-20 md:pt-8 pb-8 md:py-8 sm:px-6 lg:px-8 max-w-full md:max-w-7xl">
        {children}
      </main>
    </div>
  )
}
