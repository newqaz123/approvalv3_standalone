import type { Prisma } from '@prisma/client'
import { notificationDisplayTemplates } from './i18n/catalogs/notifications'
import type { Locale } from './i18n/locale'
import { interpolateMessage } from './i18n/messages'

export type NotificationDisplayKey = keyof typeof notificationDisplayTemplates
export type NotificationDisplay = {
  key: NotificationDisplayKey
  values: Readonly<Record<string, string | number>>
}

export function notificationDisplayFields(display: NotificationDisplay): {
  displayKey: NotificationDisplayKey
  displayValues: Prisma.InputJsonObject
} {
  return { displayKey: display.key, displayValues: { ...display.values } }
}

export function renderNotificationDisplay(locale: Locale, row: {
  title: string
  message: string
  displayKey: string | null
  displayValues: unknown
}): { title: string; message: string } {
  const { title, message, displayKey, displayValues } = row
  if (!displayKey || !Object.hasOwn(notificationDisplayTemplates, displayKey) ||
      !displayValues || typeof displayValues !== 'object' || Array.isArray(displayValues)) {
    return { title, message }
  }

  const [titleTemplate, messageTemplate] = notificationDisplayTemplates[displayKey as NotificationDisplayKey][locale]
  const values: Record<string, string> = {}
  // All current fields are text (Request/Solution titles, reasons and raw Status values).
  for (const [, key] of `${titleTemplate}\n${messageTemplate}`.matchAll(/\{(\w+)\}/g)) {
    const value = (displayValues as Record<string, unknown>)[key]
    if (!Object.hasOwn(displayValues, key) || typeof value !== 'string') return { title, message }
    values[key] = value
  }
  return {
    title: interpolateMessage(titleTemplate, values),
    message: interpolateMessage(messageTemplate, values),
  }
}
