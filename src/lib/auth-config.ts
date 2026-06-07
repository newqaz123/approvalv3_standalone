/**
 * NextAuth.js v5 Configuration
 *
 * Split architecture:
 * - auth-config.ts (this file): Full config with Credentials provider (Node.js runtime)
 * - Middleware uses auth() export which handles JWT validation (Edge-compatible)
 *
 * The authorize() callback runs server-side only (not in Edge middleware).
 * Middleware only reads/validates the JWT token, which is Edge-safe.
 */
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import type { NextAuthConfig } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: string
      departmentId: string | null
      forcePasswordChange: boolean
    }
  }

  interface User {
    id: string
    email: string
    name: string
    role: string
    departmentId: string | null
    forcePasswordChange: boolean
  }
}

declare module 'next-auth' {
  interface JWT {
    id: string
    role: string
    departmentId: string | null
    forcePasswordChange: boolean
  }
}

const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        // Dynamic imports to avoid Edge Runtime issues in middleware
        const { compare } = await import('bcryptjs')
        const prisma = (await import('@/lib/prisma')).default

        const email = credentials.email as string
        const password = credentials.password as string

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            passwordHash: true,
            role: true,
            departmentId: true,
            isActive: true,
            forcePasswordChange: true,
          },
        })

        if (!user || !user.isActive || !user.passwordHash) {
          return null
        }

        const isPasswordValid = await compare(password, user.passwordHash)
        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          departmentId: user.departmentId,
          forcePasswordChange: user.forcePasswordChange,
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  pages: {
    signIn: '/sign-in',
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        token.name = user.name
        token.role = user.role
        token.departmentId = user.departmentId
        token.forcePasswordChange = user.forcePasswordChange
      }

      // Allow session updates (e.g., after password change)
      if (trigger === 'update' && session) {
        if (session.name) token.name = session.name
        if (session.role) token.role = session.role
        if (session.departmentId !== undefined) token.departmentId = session.departmentId
        if (session.forcePasswordChange !== undefined) token.forcePasswordChange = session.forcePasswordChange
      }

      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        session.user.name = token.name as string
        session.user.role = token.role as string
        session.user.departmentId = token.departmentId as string | null
        session.user.forcePasswordChange = token.forcePasswordChange as boolean
      }
      return session
    },
    async authorized({ auth, request }) {
      const { pathname } = request.nextUrl
      const isLoggedIn = !!auth?.user

      // Public routes
      if (pathname === '/' || pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up')) {
        return true
      }

      // API auth routes are always accessible
      if (pathname.startsWith('/api/auth')) {
        return true
      }

      // Health check is public
      if (pathname === '/api/health') {
        return true
      }

      // Everything else requires authentication
      return isLoggedIn
    },
  },
  trustHost: true,
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
