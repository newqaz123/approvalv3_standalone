'use server'

import { auth } from '@clerk/nextjs/server'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { Resend } from 'resend'

// Initialize Resend if API key is available
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

/**
 * Get notifications for a user
 */
export async function getNotifications(userId: string, limit: number = 20) {
  const { userId: currentUserId } = await auth()
  if (!currentUserId || currentUserId !== userId) {
    throw new Error('Unauthorized')
  }

  const notifications = await prisma.notification.findMany({
    where: {
      userId,
    },
    include: {
      request: {
        select: {
          title: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
  })

  return notifications
}

/**
 * Get unread count for a user
 */
export async function getUnreadCount(userId: string) {
  const { userId: currentUserId } = await auth()
  if (!currentUserId || currentUserId !== userId) {
    throw new Error('Unauthorized')
  }

  const count = await prisma.notification.count({
    where: {
      userId,
      isRead: false,
    },
  })

  return count
}

/**
 * Mark a notification as read
 */
export async function markAsRead(notificationId: string) {
  const { userId } = await auth()
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Verify ownership
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: { userId: true },
  })

  if (!notification || notification.userId !== userId) {
    throw new Error('Notification not found or unauthorized')
  }

  await prisma.notification.update({
    where: { id: notificationId },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  })

  revalidatePath('/')
  return { success: true }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: string) {
  const { userId: currentUserId } = await auth()
  if (!currentUserId || currentUserId !== userId) {
    throw new Error('Unauthorized')
  }

  const result = await prisma.notification.updateMany({
    where: {
      userId,
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  })

  revalidatePath('/')
  return { success: true, count: result.count }
}

/**
 * Create a notification (helper function)
 */
export async function createNotification(data: {
  userId: string
  type: 'approval_needed' | 'approval_granted' | 'approval_rejected' | 'status_changed' | 'request_assigned' | 'solution_ready' | 'final_approval_needed'
  title: string
  message: string
  requestId?: string
}) {
  const notification = await prisma.notification.create({
    data,
  })

  // Optionally send email notification
  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { email: true },
  })

  if (user?.email) {
    await sendEmailNotification(
      { type: data.type, title: data.title, message: data.message, requestId: data.requestId },
      user.email
    ).catch((error) => {
      // Log error but don't fail the notification creation
      console.error('Failed to send email notification:', error)
    })
  }

  return notification
}

/**
 * Notify all users in a department (with optional exclusions)
 */
export async function notifyUsersInDepartment(
  departmentId: string,
  notification: {
    type: 'approval_needed' | 'approval_granted' | 'approval_rejected' | 'status_changed' | 'request_assigned' | 'solution_ready' | 'final_approval_needed'
    title: string
    message: string
    requestId?: string
  },
  excludeUserIds?: string[]
) {
  // Get all active users in the department
  const users = await prisma.user.findMany({
    where: {
      departmentId,
      isActive: true,
      ...(excludeUserIds && excludeUserIds.length > 0 ? {
        id: { notIn: excludeUserIds }
      } : {})
    },
    select: { id: true },
  })

  // Create notifications for each user
  await Promise.all(
    users.map(user =>
      createNotification({
        userId: user.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        requestId: notification.requestId,
      })
    )
  )

  return { notified: users.length }
}

/**
 * Send email notification
 */
async function sendEmailNotification(
  notification: {
    type: string
    title: string
    message: string
    requestId?: string
  },
  userEmail: string
) {
  // Skip if Resend is not configured
  if (!resend) {
    console.warn('Email notification skipped: RESEND_API_KEY not configured')
    return { success: false, error: 'Email not configured' }
  }

  // Also skip if from email is not configured
  const fromEmail = process.env.RESEND_FROM_EMAIL
  if (!fromEmail) {
    console.warn('Email notification skipped: RESEND_FROM_EMAIL not configured')
    return { success: false, error: 'From email not configured' }
  }

  // Build email content based on type
  let subject = notification.title
  let htmlContent = ''

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const requestLink = notification.requestId
    ? `${baseUrl}/requests/${notification.requestId}`
    : `${baseUrl}/requests`

  switch (notification.type) {
    case 'solution_ready':
      subject = `Solution Ready: ${notification.title}`
      htmlContent = `
        <h2>Solution is Ready</h2>
        <p>${notification.message}</p>
        <p><a href="${requestLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px;">View Request</a></p>
      `
      break

    case 'final_approval_needed':
      subject = `Final Approval Needed: ${notification.title}`
      htmlContent = `
        <h2>Your Approval is Needed</h2>
        <p>${notification.message}</p>
        <p><a href="${requestLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px;">View Request</a></p>
      `
      break

    case 'approval_needed':
      subject = `Approval Needed: ${notification.title}`
      htmlContent = `
        <h2>Approval Needed</h2>
        <p>${notification.message}</p>
        <p><a href="${requestLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px;">View Request</a></p>
      `
      break

    default:
      htmlContent = `
        <h2>${notification.title}</h2>
        <p>${notification.message}</p>
        <p><a href="${requestLink}">View Request</a></p>
      `
  }

  try {
    await resend.emails.send({
      from: fromEmail,
      to: userEmail,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          ${htmlContent}
          <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 14px;">
            This is an automated notification from the Approval System.
          </p>
        </div>
      `,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to send email:', error)
    return { success: false, error: String(error) }
  }
}
