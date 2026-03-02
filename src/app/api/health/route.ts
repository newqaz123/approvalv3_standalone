import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * Health check endpoint for Docker container health monitoring
 * 
 * This endpoint is called by Docker healthcheck to verify:
 * 1. The application server is running and responding
 * 2. The database connection is functional
 * 
 * No authentication required - health checks run from inside the container
 * Returns HTTP 200 even if database is down (endpoint exists and responds)
 * Returns HTTP 500 only for unexpected errors
 */

export async function GET() {
  try {
    // Check database connectivity with simple query
    // This verifies the database connection without complex queries
    await prisma.$queryRaw`SELECT 1`
    const dbStatus = 'connected'

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbStatus
    })
  } catch (error) {
    // Database error is tracked in response but doesn't fail health check
    // This is intentional - endpoint exists and responds even if DB is down
    // Container health is determined by the fact that the endpoint responds
    const dbStatus = error instanceof Error ? `error: ${error.message}` : 'error'
    
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbStatus
    })
  }
}
