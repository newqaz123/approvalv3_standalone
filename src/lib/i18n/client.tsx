'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Locale } from './locale'
import { createTranslator, type Translator } from './messages'

const LocaleContext = createContext<Locale>('en')

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

export function useLocale(): Locale {
  return useContext(LocaleContext)
}

export function useTranslations(): Translator {
  const locale = useLocale()
  return useMemo(() => createTranslator(locale), [locale])
}
