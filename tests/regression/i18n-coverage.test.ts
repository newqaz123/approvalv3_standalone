import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { test } from 'node:test'
import { account } from '@/lib/i18n/catalogs/account'
import { admin } from '@/lib/i18n/catalogs/admin'
import { common } from '@/lib/i18n/catalogs/common'
import { insights } from '@/lib/i18n/catalogs/insights'
import { notifications } from '@/lib/i18n/catalogs/notifications'
import { requests } from '@/lib/i18n/catalogs/requests'
import { createTranslator, type MessageKey } from '@/lib/i18n/messages'
import { productionSurfaces } from '../support/i18n/production-surfaces'

function trackedProductionPagePatterns() {
  return execFileSync('git', ['ls-files', '-z', '--', 'src/app'], { encoding: 'utf8' })
    .split('\0')
    .filter(file => file.endsWith('/page.tsx') && statSync(file, { throwIfNoEntry: false })?.isFile())
    .map(file => '/' + file.split('/').slice(2, -1).filter(part => !/^\(.+\)$/.test(part)).join('/'))
    .filter(pattern => pattern !== '/sequential-stages-preview' && !pattern.startsWith('/test-harness/'))
    .sort()
}

test('the localization matrix covers every tracked production page', () => {
  assert.deepEqual(productionSurfaces.map(({ pattern }) => pattern).sort(), trackedProductionPagePatterns())
  assert.deepEqual(productionSurfaces.filter(({ heading }) => heading === 'redirect'), [
    { pattern: '/', path: '/', role: 'public', heading: 'redirect' },
  ])
  for (const { pattern, path, heading } of productionSurfaces) {
    const concretePattern = pattern.split('/').map(part => {
      if (part.startsWith('[[...')) return ''
      if (part.startsWith('[')) return '[^/]+'
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }).filter((part, index) => index === 0 || part !== '').join('/') || '/'
    assert.match(path, new RegExp(`^${concretePattern}$`), pattern)
    if (pattern === '/sign-in/[[...sign-in]]') {
      assert.deepEqual(heading, { en: 'Approval System', th: 'Approval System' })
    } else if (heading !== 'redirect') {
      assert.ok(heading.en.trim(), `${pattern} English heading`)
      assert.match(heading.th, /\p{Script=Thai}/u, `${pattern} Thai heading`)
    }
  }
})

// Exact shared strings only; Status and user or legacy data are not catalog copy.
const sharedMessages = {
  'common.languageLabel': 'ภาษา / Language',
  'common.languageThai': 'ไทย',
  'common.languageEnglish': 'English',
  'insights.request': 'Request',
  'admin.ownerRequest': 'Request',
  'admin.ownerSolution': 'Solution',
  'admin.routeEditorHeading': '{action} {name} — {phase}',
  'notifications.request': 'Request: {title}',
}

const thaiProductTerms: Record<string, string> = {
  'budget.requestMany': '{count} Request',
  'budget.requestOne': '{count} Request',
  'budget.requests': 'Request',
  'dashboard.drawer.sol': 'Solution',
}

const tokens = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()

test('all six catalog domains have unique keys, matching placeholders and deliberate shared copy', () => {
  const seen = new Set<string>()
  const shared: Record<string, string> = {}
  for (const [name, domain] of Object.entries({ common, account, requests, insights, admin, notifications })) {
    const en: Record<string, string> = domain.en
    const th: Record<string, string> = domain.th
    assert.deepEqual(Object.keys(en).sort(), Object.keys(th).sort(), name)
    for (const [key, english] of Object.entries(en)) {
      assert.ok(!seen.has(key), `Duplicate catalog key: ${key}`)
      seen.add(key)
      assert.ok(english.trim() && th[key].trim(), key)
      const placeholders = tokens(english)
      assert.deepEqual(tokens(th[key]), placeholders, key)
      if (english === th[key]) shared[key] = english
      else if (Object.hasOwn(thaiProductTerms, key)) assert.equal(th[key], thaiProductTerms[key], key)
      else assert.match(th[key], /\p{Script=Thai}/u, key)
      const values = Object.fromEntries(placeholders.map(token => [token, `<${token}> {literal} ชื่อเดิม`]))
      for (const locale of ['en', 'th'] as const) {
        const template = locale === 'en' ? english : th[key]
        assert.equal(createTranslator(locale)(key as MessageKey, values),
          template.replace(/\{(\w+)\}/g, (_, token) => values[token]), `${locale}: ${key}`)
      }
    }
  }
  assert.deepEqual(shared, sharedMessages)
})


test('the Admin position-holder count and conflict Step interpolate localized chrome only', () => {
  const t = createTranslator('th')
  assert.equal(t('admin.positionOneHolder'), '1 คนอยู่ในตำแหน่งนี้')
  assert.equal(t('admin.stepPosition', { order: 1, name: 'Director — ชื่อเดิม' }), 'ขั้นที่ 1 — Director — ชื่อเดิม')
})
