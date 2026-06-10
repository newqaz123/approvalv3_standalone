'use server'

import { auth } from '@/lib/auth-config'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import nodemailer from 'nodemailer'

// Initialize SMTP transporter if configured
const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  : null

type NotificationRequestLinkInput = {
  type: string
  requestId?: string
}

type RequestEmailDetails = {
  id: string
  title: string
  description: string
  status: string
  createdAt: Date
  requesterName: string
  requesterEmail: string
  departmentName: string
  projectEstimateCost: number | null
  engineeringCostEstimate: number | null
  latestSolutionEstimate: number | null
  latestSolutionCurrency: string | null
}

function buildNotificationRequestPath(notification: NotificationRequestLinkInput) {
  if (!notification.requestId) {
    return '/requests'
  }

  const requestId = encodeURIComponent(notification.requestId)
  if (notification.type === 'approval_needed' || notification.type === 'final_approval_needed') {
    return `/requests/my-actions?requestId=${requestId}`
  }

  return `/requests?requestId=${requestId}`
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatMoney(value: number | null, currency = 'THB') {
  if (value === null || !Number.isFinite(value)) {
    return 'Not set'
  }

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString()}`
  }
}

function formatRequestStatus(status: string) {
  return status
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}...`
}

async function getNotificationRequestDetails(requestId?: string): Promise<RequestEmailDetails | null> {
  if (!requestId) {
    return null
  }

  const request = await prisma.requests.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      createdAt: true,
      projectEstimateCost: true,
      engineeringCostEstimate: true,
      requester: {
        select: {
          name: true,
          email: true,
        },
      },
      department: {
        select: {
          name: true,
        },
      },
      solutions: {
        select: {
          costEstimate: true,
          currency: true,
        },
        orderBy: {
          submittedAt: 'desc',
        },
        take: 1,
      },
    },
  })

  if (!request) {
    return null
  }

  const latestSolution = request.solutions[0] ?? null

  return {
    id: request.id,
    title: request.title,
    description: request.description,
    status: request.status,
    createdAt: request.createdAt,
    requesterName: request.requester.name,
    requesterEmail: request.requester.email,
    departmentName: request.department.name,
    projectEstimateCost: request.projectEstimateCost === null ? null : Number(request.projectEstimateCost),
    engineeringCostEstimate: request.engineeringCostEstimate === null ? null : Number(request.engineeringCostEstimate),
    latestSolutionEstimate: latestSolution ? Number(latestSolution.costEstimate) : null,
    latestSolutionCurrency: latestSolution?.currency ?? null,
  }
}

function buildDetailRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 13px; width: 38%;">${escapeHtml(label)}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; color: #111827; font-size: 13px; font-weight: 600;">${escapeHtml(value)}</td>
    </tr>
  `
}

function resolveEmailCostEstimate(details: RequestEmailDetails) {
  if (details.latestSolutionEstimate !== null) {
    return formatMoney(details.latestSolutionEstimate, details.latestSolutionCurrency ?? 'THB')
  }

  if (details.engineeringCostEstimate !== null) {
    return formatMoney(details.engineeringCostEstimate)
  }

  return formatMoney(details.projectEstimateCost)
}

function buildRequestDetailsHtml(details: RequestEmailDetails | null) {
  if (!details) {
    return ''
  }

  const rows = [
    buildDetailRow('Request topic', details.title),
    buildDetailRow('Requester', `${details.requesterName} (${details.requesterEmail})`),
    buildDetailRow('Department', details.departmentName),
    buildDetailRow('Status', formatRequestStatus(details.status)),
    buildDetailRow('Created', formatDate(details.createdAt)),
    buildDetailRow('Cost estimate', resolveEmailCostEstimate(details)),
    buildDetailRow('Description', truncateText(details.description, 280)),
  ]

  return `
    <section style="margin-top: 24px;">
      <h3 style="margin: 0 0 10px; color: #111827; font-size: 16px;">Request details</h3>
      <table role="presentation" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
        <tbody>
          ${rows.join('')}
        </tbody>
      </table>
    </section>
  `
}

function buildRequestDetailsText(details: RequestEmailDetails | null) {
  if (!details) {
    return ''
  }

  return `
Request details
- Request topic: ${details.title}
- Requester: ${details.requesterName} (${details.requesterEmail})
- Department: ${details.departmentName}
- Status: ${formatRequestStatus(details.status)}
- Created: ${formatDate(details.createdAt)}
- Cost estimate: ${resolveEmailCostEstimate(details)}
- Description: ${truncateText(details.description, 280)}
`
}

function buildNotificationEmailHtml(input: {
  heading: string
  message: string
  requestLink: string
  requestDetails: RequestEmailDetails | null
}) {
  return `
    <div style="margin: 0; padding: 24px; background: #f3f4f6; font-family: Arial, sans-serif;">
      <div style="max-width: 680px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
        <header style="background: #111827; color: #ffffff; padding: 24px;">
          <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #93c5fd;">Approval System</div>
          <h1 style="margin: 8px 0 0; font-size: 22px; line-height: 1.3;">${escapeHtml(input.heading)}</h1>
        </header>
        <main style="padding: 24px;">
          <p style="margin: 0; color: #374151; font-size: 15px; line-height: 1.6;">${escapeHtml(input.message)}</p>
          ${buildRequestDetailsHtml(input.requestDetails)}
          <p style="margin: 24px 0 0;">
            <a href="${escapeHtml(input.requestLink)}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 700;">View Request</a>
          </p>
        </main>
        <footer style="padding: 16px 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 13px;">
          This is an automated notification from the Approval System.
        </footer>
      </div>
    </div>
  `
}

function buildNotificationEmailText(input: {
  heading: string
  message: string
  requestLink: string
  requestDetails: RequestEmailDetails | null
}) {
  return `Approval System
${input.heading}

${input.message}
${buildRequestDetailsText(input.requestDetails)}
View Request: ${input.requestLink}
`
}

/**
 * Get notifications for a user
 */
export async function getNotifications(userId: string, limit: number = 20) {
  const { user: _authUser } = (await auth()) ?? {}; const currentUserId = _authUser?.id
  if (!currentUserId || currentUserId !== userId) {
    throw new Error('Unauthorized')
  }

  const notifications = await prisma.notifications.findMany({
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
  const { user: _authUser } = (await auth()) ?? {}; const currentUserId = _authUser?.id
  if (!currentUserId || currentUserId !== userId) {
    throw new Error('Unauthorized')
  }

  const count = await prisma.notifications.count({
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
  const { user: _authUser } = (await auth()) ?? {}; const userId = _authUser?.id
  if (!userId) {
    throw new Error('Unauthorized')
  }

  // Verify ownership
  const notification = await prisma.notifications.findUnique({
    where: { id: notificationId },
    select: { userId: true },
  })

  if (!notification || notification.userId !== userId) {
    throw new Error('Notification not found or unauthorized')
  }

  await prisma.notifications.update({
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
  const { user: _authUser } = (await auth()) ?? {}; const currentUserId = _authUser?.id
  if (!currentUserId || currentUserId !== userId) {
    throw new Error('Unauthorized')
  }

  const result = await prisma.notifications.updateMany({
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
  const notification = await prisma.notifications.create({
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
    select: { id: true, email: true },
  })

  if (users.length > 0) {
    await prisma.notifications.createMany({
      data: users.map(user => ({
        userId: user.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        requestId: notification.requestId,
      })),
    })
  }

  const emailRecipients = [
    ...new Set(users.map(user => user.email).filter((email): email is string => Boolean(email))),
  ]

  if (emailRecipients.length > 0) {
    await sendEmailNotification(notification, emailRecipients).catch((error) => {
      // Log error but don't fail the notification creation
      console.error('Failed to send department email notification:', error)
    })
  }

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
  userEmail: string | string[]
) {
  // Skip if SMTP is not configured
  if (!transporter) {
    console.warn('Email notification skipped: SMTP_HOST not configured')
    return { success: false, error: 'Email not configured' }
  }

  // Also skip if from email is not configured
  const fromEmail = process.env.SMTP_FROM
  if (!fromEmail) {
    console.warn('Email notification skipped: SMTP_FROM not configured')
    return { success: false, error: 'From email not configured' }
  }

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  const requestLink = `${baseUrl}${buildNotificationRequestPath(notification)}`
  const requestDetails = await getNotificationRequestDetails(notification.requestId)
  const requestTitle = requestDetails?.title || notification.title

  // Build email content based on type
  let subject = notification.title
  let heading = notification.title
  switch (notification.type) {
    case 'solution_ready':
      subject = `Solution Ready: ${requestTitle}`
      heading = 'Solution is Ready'
      break

    case 'final_approval_needed':
      subject = `Final Approval Needed: ${requestTitle}`
      heading = 'Final Approval Needed'
      break

    case 'approval_needed':
      subject = `Approval Needed: ${requestTitle}`
      heading = 'Approval Needed'
      break

    case 'approval_rejected':
      subject = `Rejected: ${requestTitle}`
      heading = 'Approval Rejected'
      break

    default:
      heading = notification.title
  }

  try {
    await transporter.sendMail({
      from: fromEmail,
      to: userEmail,
      subject,
      html: buildNotificationEmailHtml({
        heading,
        message: notification.message,
        requestLink,
        requestDetails,
      }),
      text: buildNotificationEmailText({
        heading,
        message: notification.message,
        requestLink,
        requestDetails,
      }),
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to send email:', error)
    return { success: false, error: String(error) }
  }
}
