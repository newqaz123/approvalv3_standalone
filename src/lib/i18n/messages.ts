import { account } from './catalogs/account'
import { admin } from './catalogs/admin'
import { common } from './catalogs/common'
import { insights } from './catalogs/insights'
import { notifications } from './catalogs/notifications'
import { requests } from './catalogs/requests'
import type { Locale } from './locale'

const messages = {
  en: { ...common.en, ...account.en, ...requests.en, ...insights.en, ...admin.en, ...notifications.en },
  th: { ...common.th, ...account.th, ...requests.th, ...insights.th, ...admin.th, ...notifications.th },
}

export type MessageKey = keyof typeof messages.en

export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === 'string' && Object.hasOwn(messages.en, value)
}

type InterpolationValues = Readonly<Record<string, string | number>>
export type Translator = (key: MessageKey, values?: InterpolationValues) => string

export function interpolateMessage(message: string, values: InterpolationValues): string {
  return message.replace(/\{(\w+)\}/g, (token, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : token,
  )
}

export function createTranslator(locale: Locale): Translator {
  return (key, values) => {
    const message = messages[locale][key]
    return values ? interpolateMessage(message, values) : message
  }
}

export function inlineImageBlockingKey(reason: 'upload' | 'image-edit' | null): MessageKey | null {
  if (reason === 'upload') return 'requests.waitForImages'
  if (reason === 'image-edit') return 'requests.finishImageEdit'
  return null
}
