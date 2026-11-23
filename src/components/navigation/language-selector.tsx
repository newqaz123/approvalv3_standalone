'use client'

import { createContext, useContext, useId, useRef, useState, useTransition, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { RadioGroup } from '@radix-ui/react-dropdown-menu'
import { DropdownMenuLabel, DropdownMenuRadioItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import type { Locale } from '@/lib/i18n/locale'
import { saveLanguage } from '@/server-actions/language'

const options = [
  { locale: 'th', label: 'common.languageThai' },
  { locale: 'en', label: 'common.languageEnglish' },
] as const

const LanguageSelectionContext = createContext<{
  pending: boolean
  failed: boolean
  selectLanguage: (locale: Locale) => void
} | null>(null)

// Work stays in flight even if the menu closes or the viewport changes shells.
// The selected locale itself always comes from the server's LocaleProvider.
export function LanguageSelectionProvider({ children }: { children: ReactNode }) {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const saving = useRef(false)

  function selectLanguage(next: Locale) {
    if (saving.current || pending || next === locale) return
    saving.current = true
    setFailedPath(null)
    startTransition(async () => {
      try {
        const result = await saveLanguage(next)
        if (result.ok) router.refresh()
        else setFailedPath(pathname)
      } catch {
        setFailedPath(pathname)
      } finally {
        saving.current = false
      }
    })
  }

  return (
    <LanguageSelectionContext.Provider value={{ pending, failed: failedPath !== null && failedPath === pathname, selectLanguage }}>
      {children}
    </LanguageSelectionContext.Provider>
  )
}

export function LanguageSelector({ placement }: { placement: 'menu' | 'public' }) {
  const locale = useLocale()
  const t = useTranslations()
  const id = useId()
  const selection = useContext(LanguageSelectionContext)
  if (!selection) throw new Error('LanguageSelector requires LanguageSelectionProvider')
  const { pending, failed, selectLanguage } = selection
  const failure = failed ? <p role="alert" className="px-2 py-1 text-sm text-red-700">{t('common.languageSaveFailed')}</p> : null

  if (placement === 'menu') {
    return (
      <>
        <DropdownMenuSeparator />
        <RadioGroup value={locale} aria-labelledby={id}>
          <DropdownMenuLabel id={id}>{t('common.languageLabel')}</DropdownMenuLabel>
          {options.map(option => (
            <DropdownMenuRadioItem
              key={option.locale}
              value={option.locale}
              disabled={pending}
              onSelect={event => {
                event.preventDefault()
                selectLanguage(option.locale)
              }}
              className="min-h-[44px] cursor-pointer"
            >
              <span lang={option.locale}>{t(option.label)}</span>
            </DropdownMenuRadioItem>
          ))}
        </RadioGroup>
        {failure}
      </>
    )
  }

  return (
    <fieldset className="mb-5 border-b border-slate-100 pb-4">
      <legend className="text-sm font-semibold text-slate-700">{t('common.languageLabel')}</legend>
      <div className="flex flex-wrap gap-x-5">
        {options.map(option => (
          <label key={option.locale} className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name={id}
              checked={locale === option.locale}
              aria-disabled={pending || undefined}
              onChange={() => selectLanguage(option.locale)}
              className="h-4 w-4 accent-indigo-600"
            />
            <span lang={option.locale}>{t(option.label)}</span>
          </label>
        ))}
      </div>
      {failure}
    </fieldset>
  )
}
