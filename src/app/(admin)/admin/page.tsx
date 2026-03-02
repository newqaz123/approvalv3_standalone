import Link from 'next/link'
import { Users, Building2, FileText, Trash2, ClipboardList, LayoutTemplate } from 'lucide-react'
import prisma from '@/lib/prisma'

async function getStats() {
  const [userCount, deptCount, requestCount, deletedCount] = await Promise.all([
    prisma.user.count(),
    prisma.department.count(),
    prisma.request.count({ where: { isDeleted: false } }),
    prisma.request.count({ where: { isDeleted: true } }),
  ])

  return { userCount, deptCount, requestCount, deletedCount }
}

export default async function AdminPage() {
  const stats = await getStats()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Manage users, departments, and system settings
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-sm font-medium text-muted-foreground">Total Users</h3>
          </div>
          <p className="text-3xl font-bold mt-2">{stats.userCount}</p>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-sm font-medium text-muted-foreground">Departments</h3>
          </div>
          <p className="text-3xl font-bold mt-2">{stats.deptCount}</p>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-sm font-medium text-muted-foreground">Active Requests</h3>
          </div>
          <p className="text-3xl font-bold mt-2">{stats.requestCount}</p>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-sm font-medium text-muted-foreground">Deleted Requests</h3>
          </div>
          <p className="text-3xl font-bold mt-2">{stats.deletedCount}</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/admin/users"
            className="rounded-lg border bg-card p-6 hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Manage Users</h3>
                <p className="text-sm text-muted-foreground">
                  Create, edit, and manage user accounts
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/departments"
            className="rounded-lg border bg-card p-6 hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Manage Departments</h3>
                <p className="text-sm text-muted-foreground">
                  Create and manage departments
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/deleted-requests"
            className="rounded-lg border bg-card p-6 hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-destructive/10 p-3">
                <Trash2 className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <h3 className="font-semibold">Deleted Requests</h3>
                <p className="text-sm text-muted-foreground">
                  View and restore deleted requests
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/audit"
            className="rounded-lg border bg-card p-6 hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <ClipboardList className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Audit Trail Export</h3>
                <p className="text-sm text-muted-foreground">
                  Export audit logs in CSV or JSON format
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/admin/templates"
            className="rounded-lg border bg-card p-6 hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <LayoutTemplate className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Request Templates</h3>
                <p className="text-sm text-muted-foreground">
                  Create and manage request templates
                </p>
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* Phase Status */}
      <div className="rounded-lg border bg-muted/50 p-6">
        <h2 className="text-lg font-semibold mb-2">System Status</h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span>Phase 1: Authentication & User Management - ✅ Complete</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span>Phase 2: Request Workflow - ✅ Complete</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span>Phase 3: Approval Engine - ✅ Complete</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-yellow-500" />
            <span>Phase 4: Engineering Solutions - 🚧 Pending</span>
          </div>
        </div>
      </div>
    </div>
  )
}
