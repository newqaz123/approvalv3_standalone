import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseLocale, persistLanguage, resolveLocale, type Locale } from '../../src/lib/i18n/locale'
import { common } from '../../src/lib/i18n/catalogs/common'
import { createTranslator, interpolateMessage } from '../../src/lib/i18n/messages'

function recordLanguageWrites(accountSaved = true) {
  const accountWrites: [string, Locale][] = []
  const anonymousWrites: Locale[] = []

  return {
    accountWrites,
    anonymousWrites,
    ports: {
      writeAccount: async (id: string, locale: Locale) => {
        accountWrites.push([id, locale])
        return accountSaved
      },
      writeAnonymous: async (locale: Locale) => {
        anonymousWrites.push(locale)
      },
    },
  }
}

describe('locale', () => {
  it('parses only exact, supported locale codes', () => {
    assert.equal(parseLocale('en'), 'en')
    assert.equal(parseLocale('th'), 'th')
    for (const invalid of ['TH', ' th ', 'th-TH', undefined, { locale: 'th' }]) {
      assert.equal(parseLocale(invalid), null)
    }
  })

  it('reads the anonymous locale only without a session user ID', () => {
    assert.equal(resolveLocale(undefined, undefined, 'th'), 'th')
    assert.equal(resolveLocale(undefined, 'th', 'TH'), 'en')
    assert.equal(resolveLocale('b', 'en', 'th'), 'en')
    assert.equal(resolveLocale('b', 'th', 'en'), 'th')
    assert.equal(resolveLocale('b', undefined, 'th'), 'en')
    assert.equal(resolveLocale('b', 'TH', 'th'), 'en')
  })
})

describe('persistLanguage', () => {
  it('writes only the session user ID and selected locale for an account', async () => {
    const { ports, accountWrites, anonymousWrites } = recordLanguageWrites()

    assert.deepEqual(await persistLanguage('th', 'session-user', ports), { ok: true, locale: 'th' })
    assert.deepEqual(accountWrites, [['session-user', 'th']])
    assert.deepEqual(anonymousWrites, [])
  })

  it('writes only the anonymous locale without a session user ID', async () => {
    const { ports, accountWrites, anonymousWrites } = recordLanguageWrites()

    assert.deepEqual(await persistLanguage('th', undefined, ports), { ok: true, locale: 'th' })
    assert.deepEqual(accountWrites, [])
    assert.deepEqual(anonymousWrites, ['th'])
  })

  it('performs no writes for invalid input, including a caller-supplied ID', async () => {
    const { ports, accountWrites, anonymousWrites } = recordLanguageWrites()

    assert.deepEqual(await persistLanguage({ id: 'other-user', locale: 'th' }, 'session-user', ports), {
      ok: false, code: 'invalid_locale',
    })
    assert.deepEqual(await persistLanguage('TH', undefined, ports), { ok: false, code: 'invalid_locale' })
    assert.deepEqual(accountWrites, [])
    assert.deepEqual(anonymousWrites, [])
  })

  it('does not fall through to an anonymous write when the account write finds no active user', async () => {
    const { ports, accountWrites, anonymousWrites } = recordLanguageWrites(false)

    assert.deepEqual(await persistLanguage('th', 'session-user', ports), { ok: false, code: 'save_failed' })
    assert.deepEqual(accountWrites, [['session-user', 'th']])
    assert.deepEqual(anonymousWrites, [])
  })

  it('returns save_failed on rejected writes without falling through to an anonymous write', async () => {
    const { ports, anonymousWrites } = recordLanguageWrites()
    const failWrite = async () => { throw new Error('write failed') }

    assert.deepEqual(await persistLanguage('th', 'session-user', { ...ports, writeAccount: failWrite }), {
      ok: false, code: 'save_failed',
    })
    assert.deepEqual(anonymousWrites, [])
    assert.deepEqual(await persistLanguage('th', undefined, { ...ports, writeAnonymous: failWrite }), {
      ok: false, code: 'save_failed',
    })
  })
})

describe('i18n messages', () => {
  it('uses fixed selector copy and translates the Status heading', () => {
    for (const locale of ['en', 'th'] as const) {
      const t = createTranslator(locale)
      assert.equal(t('common.languageLabel'), 'ภาษา / Language')
      assert.equal(t('common.languageThai'), 'ไทย')
      assert.equal(t('common.languageEnglish'), 'English')
    }
    assert.equal(createTranslator('en')('common.status'), 'Status')
    assert.equal(createTranslator('th')('common.status'), 'สถานะ')
  })

  it('uses the same catalog keys and interpolation tokens in both locales', () => {
    assert.deepEqual(Object.keys(common.th).sort(), Object.keys(common.en).sort())
    const tokens = (message: string) => [...new Set(message.match(/\{\w+\}/g))].sort()
    for (const key of Object.keys(common.en) as (keyof typeof common.en)[]) {
      assert.deepEqual(tokens(common.th[key]), tokens(common.en[key]), key)
    }
  })

  it('inserts text verbatim without evaluating inserted tokens or replacement syntax', () => {
    const name = '{count} $& <literal> ภาษาไทย'
    assert.equal(
      interpolateMessage('{name}: {count} / {name}', { name, count: 0 }),
      `${name}: 0 / ${name}`,
    )
  })
})
