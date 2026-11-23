'use client'

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from 'react'
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

type SelectorPlacement = 'menu' | 'public'

type FailedSelection = { pathname: string; locale: Locale; placement: SelectorPlacement }

const LanguageSelectionContext = createContext<{
  pending: boolean
  failed: boolean
  selectLanguage: (locale: Locale, placement: SelectorPlacement) => void
  setMenuMounted: (mounted: boolean) => void
} | null>(null)

function restoreAvatarFocus(retryButton: HTMLButtonElement | null) {
  if (!retryButton || document.activeElement !== retryButton) return
  // Both shells are mounted; focus the laid-out trigger and let the browser scroll it into view.
  const triggers = document.querySelectorAll<HTMLButtonElement>('[data-language-menu-trigger]')
  Array.from(triggers).find(trigger => trigger.getClientRects().length > 0)?.focus()
}

// Work stays in flight even if the menu closes or the viewport changes shells.
// The selected locale itself always comes from the server's LocaleProvider.
export function LanguageSelectionProvider({ children }: { children: ReactNode }) {
  const locale = useLocale()
  const t = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()
  const [failedSelection, setFailedSelection] = useState<FailedSelection | null>(null)
  const [menuMounted, setMenuMounted] = useState(false)
  const saving = useRef(false)
  const retryButton = useRef<HTMLButtonElement>(null)
  const failure = failedSelection?.pathname === pathname ? failedSelection : null

  // A different refresh can confirm a write whose response never arrived.
  useLayoutEffect(() => {
    if (failedSelection?.locale === locale) {
      restoreAvatarFocus(retryButton.current)
      setFailedSelection(null)
    }
  }, [failedSelection, locale])

  function selectLanguage(next: Locale, placement: SelectorPlacement, retry = false) {
    if (saving.current || pending || next === locale) return
    saving.current = true
    if (!retry) setFailedSelection(null)
    const attemptedSelection = { pathname, locale: next, placement }
    startTransition(async () => {
      try {
        const result = await saveLanguage(next)
        if (result.ok) {
          if (retry) {
            restoreAvatarFocus(retryButton.current)
            setFailedSelection(null)
          }
          router.refresh()
        } else {
          setFailedSelection(attemptedSelection)
        }
      } catch {
        setFailedSelection(attemptedSelection)
      } finally {
        saving.current = false
      }
    })
  }

  return (
    <LanguageSelectionContext.Provider value={{ pending, failed: failure !== null, selectLanguage, setMenuMounted }}>
      {children}
      {failure?.placement === 'menu' && !menuMounted && (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md flex-wrap items-center gap-x-4 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm text-red-700 shadow-lg">
          <div className="flex-1">
            <p role="alert">{!pending && t('common.languageSaveFailed')}</p>
            {pending && <p role="status">{t('common.saving')}</p>}
          </div>
          <button
            ref={retryButton}
            type="button"
            className="min-h-[44px] rounded px-2 font-semibold underline focus-visible:outline focus-visible:outline-2 aria-disabled:opacity-50"
            aria-disabled={pending || undefined}
            onClick={() => selectLanguage(failure.locale, 'menu', true)}
          >
            {t('common.languageRetry')}
          </button>
        </div>
      )}
    </LanguageSelectionContext.Provider>
  )
}

export function LanguageSelector({ placement }: { placement: SelectorPlacement }) {
  const locale = useLocale()
  const t = useTranslations()
  const id = useId()
  const selection = useContext(LanguageSelectionContext)
  const setMenuMounted = selection?.setMenuMounted

  // Radix hides page content from assistive technology while its modal portal is mounted.
  useEffect(() => {
    if (placement !== 'menu' || !setMenuMounted) return
    setMenuMounted(true)
    return () => setMenuMounted(false)
  }, [placement, setMenuMounted])

  if (!selection) throw new Error('LanguageSelector requires LanguageSelectionProvider')
  const { pending, failed, selectLanguage } = selection
  const failure = failed && !pending ? <p role="alert" className="px-2 py-1 text-sm text-red-700">{t('common.languageSaveFailed')}</p> : null

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
                selectLanguage(option.locale, placement)
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
              onChange={() => selectLanguage(option.locale, placement)}
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
