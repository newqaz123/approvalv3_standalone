import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

// Simple user type for standalone auth
export interface User {
  id: string
  email: string
  name: string
  role: string
  departmentId?: string
}

// Mock user database - in production, this would be in your database
const mockUsers: User[] = [
  {
    id: '1',
    email: 'admin@example.com',
    name: 'Admin User',
    role: 'admin'
  },
  {
    id: '2', 
    email: 'user@example.com',
    name: 'Regular User',
    role: 'user',
    departmentId: '1'
  }
]

// Simple session management
const SESSION_COOKIE = 'standalone-session'

export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value

  if (!sessionToken) {
    return null
  }

  // In production, validate session token against database
  // For now, return a mock user
  const user = mockUsers.find(u => u.id === sessionToken)
  return user || null
}

export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/sign-in')
  }
  return user
}

export async function requireAdmin(): Promise<User> {
  const user = await requireAuth()
  if (user.role !== 'admin') {
    redirect('/dashboard')
  }
  return user
}

export async function signIn(email: string, password: string): Promise<User | null> {
  // Simple mock authentication - in production, verify against database
  const user = mockUsers.find(u => u.email === email)
  if (user && password === 'password') { // Simple password check
    return user
  }
  return null
}

export async function signOut(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}

export function createSession(user: User): void {
  const cookieStore = cookies()
  cookieStore.then(store => {
    store.set(SESSION_COOKIE, user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7 // 7 days
    })
  })
}
