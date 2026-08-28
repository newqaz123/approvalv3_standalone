import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FormattedText } from '@/components/ui/formatted-text'
import {
  renderDescriptionHtml,
  renderDescriptionPlainText,
} from '@/lib/formatted-text'
import { sanitizeRichText } from '@/lib/rich-text-sanitizer'
import {
  pdfInlineImageOwnerWhere,
  resolveInlineImagesForPdf,
  type PdfInlineImageAsset,
  type PdfInlineImageOwner,
  type ResolveInlineImagesForPdfDeps,
} from '@/lib/inline-images/pdf'

const read = (path: string) => readFileSync(path, 'utf8')

const REQ_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_REQ_ID = '33333333-3333-4333-8333-333333333333'
const SOL_ID = '22222222-2222-4222-8222-222222222222'
const IMG_REQUEST = '123e4567-e89b-42d3-a456-426614174000'
const IMG_SOLUTION = '123e4567-e89b-42d3-a456-426614174001'
const IMG_OTHER_REQUEST = '123e4567-e89b-42d3-a456-426614174002'
const IMG_TAMPERED = '123e4567-e89b-42d3-a456-426614174003'
const IMG_MISSING_BYTES = '123e4567-e89b-42d3-a456-426614174004'

const src = (id: string) => `/api/inline-images/${id}`
const requestOwner: PdfInlineImageOwner = { kind: 'request', id: REQ_ID }

function descriptionHtml(...ids: Array<{ id: string; alt?: string }>): string {
  const images = ids
    .map(({ id, alt }) => `<img src="${src(id)}" alt="${alt ?? ''}">`)
    .join('')
  return `<p>before ${images} after</p>`
}

/** Mirrors the production `references: { some: pdfInlineImageOwnerWhere(owner) }` scope. */
type FakeAsset = PdfInlineImageAsset & {
  referencedBy: Array<{ kind: 'request' | 'solution' | 'template'; id: string }>
}

function asset(id: string, referencedBy: FakeAsset['referencedBy'], fileType = 'image/png'): FakeAsset {
  return { id, fileType, filePath: `inline-images/user1/${id}-a.png`, referencedBy }
}

function fakeDeps(
  assets: FakeAsset[],
  options: {
    missingPaths?: Set<string>
    bytes?: Map<string, Buffer>
    queryError?: boolean
  } = {},
) {
  const queries: Array<{ imageIds: string[]; owner: PdfInlineImageOwner }> = []
  const readPaths: string[] = []
  const deps: ResolveInlineImagesForPdfDeps = {
    findImages: async ({ imageIds, owner }) => {
      queries.push({ imageIds: [...imageIds], owner })
      if (options.queryError) throw new Error('database unavailable')
      return assets.filter(
        (candidate) =>
          imageIds.includes(candidate.id)
          && candidate.referencedBy.some(
            (reference) => reference.kind === owner.kind && reference.id === owner.id,
          ),
      )
    },
    readFile: async (filePath) => {
      readPaths.push(filePath)
      if (options.missingPaths?.has(filePath)) {
        throw Object.assign(new Error('no such file'), { code: 'ENOENT' })
      }
      return options.bytes?.get(filePath) ?? Buffer.from(`bytes:${filePath}`)
    },
  }
  return { deps, queries, readPaths }
}

describe('application inline image rendering', () => {
  it('keeps canonical internal images with alignment in sanitized output', () => {
    const out = sanitizeRichText(
      `<p>x <img src="${src(IMG_REQUEST)}" alt="floor plan" data-align="left" onerror="alert(1)" style="width:9px"> y</p>`,
    )
    assert.ok(out.includes(`<img src="${src(IMG_REQUEST)}"`), 'canonical src must survive')
    assert.ok(out.includes('alt="floor plan"'))
    assert.ok(out.includes('data-align="left"'))
    assert.ok(!out.includes('onerror'))
    assert.ok(!out.includes('style='))
  })

  it('shares responsive and aligned image CSS for rich-text output', () => {
    const css = read('src/app/globals.css')
    assert.match(css, /\.rich-text img \{[^}]*display:\s*block/)
    assert.match(css, /\.rich-text img \{[^}]*max-width:\s*100%/)
    assert.match(css, /\.rich-text img \{[^}]*height:\s*auto/)
    assert.match(css, /\.rich-text img\[data-align='left'\] \{[^}]*margin-right:\s*auto/)
    assert.match(css, /\.rich-text img\[data-align='center'\] \{[^}]*margin-inline:\s*auto/)
    assert.match(css, /\.rich-text img\[data-align='right'\] \{[^}]*margin-left:\s*auto/)
  })

  it('converts truncated app previews to alt placeholders instead of dropping images', () => {
    const html = renderToStaticMarkup(createElement(FormattedText, {
      source: `<p>before <img src="${src(IMG_REQUEST)}" alt="floor plan"> after</p>`,
      maxVisibleCharacters: 8,
    }))

    assert.equal(
      html,
      '<span class="rich-text"><p>before [Image: floor plan] </p></span>',
    )
    assert.doesNotMatch(html, /<img|\/api\/inline-images/i)
  })
})

describe('notification email alt placeholders', () => {
  const imageDescription = `<p>text <img src="${src(IMG_REQUEST)}" alt="floor plan" data-align="center"> end</p>`

  it('plain-text output replaces approved images with [Image: alt]', () => {
    const plain = renderDescriptionPlainText(imageDescription)
    assert.ok(plain.includes('[Image: floor plan]'), plain)
    assert.ok(!plain.includes('/api/inline-images'), 'no private URL in plain email')
    assert.ok(!plain.includes('data:'), 'no bytes in plain email')
  })

  it('truncated plain-text output keeps the placeholder inside the budget', () => {
    const plain = renderDescriptionPlainText(imageDescription, 280)
    assert.ok(plain.includes('[Image: floor plan]'))
    assert.ok(plain.length <= 280 || plain.length < 300)
  })

  it('empty alt text renders the decorative [Image] placeholder', () => {
    const plain = renderDescriptionPlainText(
      `<p><img src="${src(IMG_REQUEST)}" alt="" data-align="left"></p>`,
    )
    assert.ok(plain.includes('[Image]'))
    assert.ok(!plain.includes('[Image:'))
  })

  it('HTML email keeps safe formatting but never emits private img URLs', () => {
    const html = renderDescriptionHtml(
      `<p><strong>bold</strong> <img src="${src(IMG_REQUEST)}" alt="floor plan" data-align="right"> tail</p>`,
      280,
    )
    assert.ok(html.includes('<strong>bold</strong>'), 'formatting preserved')
    assert.ok(html.includes('[Image: floor plan]'), 'placeholder present')
    assert.ok(!/<img\b/i.test(html), 'no img tag in email HTML')
    assert.ok(!html.includes('/api/inline-images'), 'no private URL in email HTML')
    assert.ok(!html.includes('data:'), 'no bytes in email HTML')
  })

  it('over-budget HTML email keeps balanced formatting without private images', () => {
    const long = `<p><strong>${'word '.repeat(100)}</strong><img src="${src(IMG_REQUEST)}" alt="floor plan"></p>`
    const html = renderDescriptionHtml(long, 40)
    assert.match(html, /^<p><strong>/)
    assert.match(html, /<\/strong><\/p>$/)
    assert.equal(html.replace(/<[^>]+>/g, '').length, 40)
    assert.doesNotMatch(html, /<img|\/api\/inline-images|data:/i)
  })

  it('legacy descriptions keep their existing rendering without placeholders', () => {
    assert.equal(renderDescriptionPlainText('a **b**'), 'a b')
    assert.ok(renderDescriptionHtml('a **b**').includes('<strong>b</strong>'))
  })
})

describe('resolveInlineImagesForPdf', () => {
  it('embeds only IDs referenced by the supplied owner, never an arbitrary canonical ID', async () => {
    const pngBytes = Buffer.from('request-owned-png-bytes')
    const { deps, queries, readPaths } = fakeDeps(
      [
        asset(IMG_REQUEST, [{ kind: 'request', id: REQ_ID }]),
        asset(IMG_OTHER_REQUEST, [{ kind: 'request', id: OTHER_REQ_ID }]),
      ],
      { bytes: new Map([['inline-images/user1/123e4567-e89b-42d3-a456-426614174000-a.png', pngBytes]]) },
    )

    const out = await resolveInlineImagesForPdf(
      {
        html: descriptionHtml(
          { id: IMG_REQUEST, alt: 'owned plan' },
          { id: IMG_OTHER_REQUEST, alt: 'other request plan' },
        ),
        owner: requestOwner,
      },
      deps,
    )

    const dataUri = `src="data:image/png;base64,${pngBytes.toString('base64')}"`
    assert.ok(out.includes(dataUri), 'owner-referenced image must embed as a data URI')
    assert.ok(!out.includes(src(IMG_REQUEST)), 'internal URL must be replaced')
    assert.ok(out.includes('[Image: other request plan]'), 'unowned canonical ID must become alt text')
    assert.ok(!out.includes(src(IMG_OTHER_REQUEST)))

    // The owner constraint is the authorization boundary: prove it reached the query.
    assert.equal(queries.length, 1)
    assert.deepEqual(queries[0]!.owner, requestOwner)
    assert.deepEqual(queries[0]!.imageIds, [IMG_REQUEST, IMG_OTHER_REQUEST])
    // Bytes are read only for the owner-authorized asset.
    assert.deepEqual(readPaths, ['inline-images/user1/123e4567-e89b-42d3-a456-426614174000-a.png'])
  })

  it('authorizes by solution owner, not merely by canonical ID presence', async () => {
    const { deps, readPaths } = fakeDeps([
      asset(IMG_REQUEST, [{ kind: 'request', id: REQ_ID }]),
      asset(IMG_SOLUTION, [{ kind: 'solution', id: SOL_ID }]),
    ])

    const out = await resolveInlineImagesForPdf(
      {
        html: descriptionHtml({ id: IMG_REQUEST }, { id: IMG_SOLUTION, alt: 'solution sketch' }),
        owner: { kind: 'solution', id: SOL_ID },
      },
      deps,
    )

    const embeds = out.match(/data:image\/png;base64,/g) ?? []
    assert.equal(embeds.length, 1, 'only the solution-owned image may embed')
    assert.ok(out.includes('[Image]'), 'empty-alt request image becomes a placeholder')
    assert.deepEqual(readPaths, ['inline-images/user1/123e4567-e89b-42d3-a456-426614174001-a.png'])
  })

  it('falls back to escaped alt text when stored bytes are missing', async () => {
    const missing = asset(IMG_MISSING_BYTES, [{ kind: 'request', id: REQ_ID }])
    const { deps } = fakeDeps([missing], {
      missingPaths: new Set([missing.filePath]),
    })

    const out = await resolveInlineImagesForPdf(
      { html: descriptionHtml({ id: IMG_MISSING_BYTES, alt: 'lost photo' }), owner: requestOwner },
      deps,
    )

    assert.ok(out.includes('[Image: lost photo]'), out)
    assert.ok(!out.includes('data:'))
    assert.ok(!out.includes('/api/inline-images'))
  })

  it('rejects tampered MIME types instead of embedding them', async () => {
    const { deps, readPaths } = fakeDeps([
      asset(IMG_TAMPERED, [{ kind: 'request', id: REQ_ID }], 'image/svg+xml'),
    ])

    const out = await resolveInlineImagesForPdf(
      { html: descriptionHtml({ id: IMG_TAMPERED, alt: 'svg' }), owner: requestOwner },
      deps,
    )

    assert.ok(!out.includes('data:image/svg'), 'SVG must never be embedded')
    assert.ok(out.includes('[Image: svg]'))
    assert.deepEqual(readPaths, [], 'tampered MIME must not read private bytes')
  })

  it('replaces duplicate references with embedded bytes read once', async () => {
    const { deps, readPaths } = fakeDeps([asset(IMG_REQUEST, [{ kind: 'request', id: REQ_ID }])])

    const out = await resolveInlineImagesForPdf(
      {
        html: descriptionHtml({ id: IMG_REQUEST, alt: 'one' }, { id: IMG_REQUEST, alt: 'two' }),
        owner: requestOwner,
      },
      deps,
    )

    const occurrences = out.match(/data:image\/png;base64,/g)?.length ?? 0
    assert.equal(occurrences, 2, 'both references embed')
    assert.equal(readPaths.length, 1, 'bytes are read once per asset')
  })

  it('sanitizes hostile markup before resolving and keeps valid internal images', async () => {
    const { deps, queries } = fakeDeps([asset(IMG_REQUEST, [{ kind: 'request', id: REQ_ID }])])

    const out = await resolveInlineImagesForPdf(
      {
        html: `<p><img src="https://evil.example/x.png" alt="evil"><script>alert(1)</script><img src="${src(IMG_REQUEST)}" alt="ok" onclick="x"></p>`,
        owner: requestOwner,
      },
      deps,
    )

    assert.ok(!out.includes('evil.example'))
    assert.ok(!out.includes('<script'))
    assert.ok(!out.includes('onclick'))
    assert.ok(out.includes('data:image/png;base64,'))
    assert.deepEqual(queries[0]!.imageIds, [IMG_REQUEST], 'only canonical internal IDs are queried')
  })

  it('continues with placeholders when the reference query itself fails', async () => {
    const { deps } = fakeDeps([], { queryError: true })

    const out = await resolveInlineImagesForPdf(
      { html: descriptionHtml({ id: IMG_REQUEST, alt: 'plan' }), owner: requestOwner },
      deps,
    )

    assert.ok(out.includes('[Image: plan]'))
    assert.ok(!out.includes('data:'))
  })

  it('returns sanitized rich HTML untouched when no images are referenced', async () => {
    const { deps, queries } = fakeDeps([])

    const out = await resolveInlineImagesForPdf(
      { html: '<p>plain <strong>rich</strong> only</p>', owner: requestOwner },
      deps,
    )

    assert.equal(out, '<p>plain <strong>rich</strong> only</p>')
    assert.equal(queries.length, 0)
  })

  it('renders legacy **bold** descriptions without touching private storage', async () => {
    const { deps, queries } = fakeDeps([])

    const out = await resolveInlineImagesForPdf(
      { html: 'legacy **bold** text', owner: requestOwner },
      deps,
    )

    assert.ok(out.includes('<strong>bold</strong>'))
    assert.ok(!out.includes('inline-images/'))
    assert.equal(queries.length, 0)
  })

  it('keeps alignment attributes on embedded images', async () => {
    const { deps } = fakeDeps([asset(IMG_REQUEST, [{ kind: 'request', id: REQ_ID }])])

    const out = await resolveInlineImagesForPdf(
      {
        html: `<p><img src="${src(IMG_REQUEST)}" alt="a" data-align="right"></p>`,
        owner: requestOwner,
      },
      deps,
    )

    assert.match(out, /data:image\/png;base64,[^"]*" alt="a" data-align="right"/)
  })
})

describe('PDF resolver authorization scope', () => {
  it('builds owner-scoped reference filters for the database query', () => {
    assert.deepEqual(pdfInlineImageOwnerWhere({ kind: 'request', id: REQ_ID }), { requestId: REQ_ID })
    assert.deepEqual(pdfInlineImageOwnerWhere({ kind: 'solution', id: SOL_ID }), { solutionId: SOL_ID })
  })

  it('constrains the production query to owner references and reads only matching paths', () => {
    const source = read('src/lib/inline-images/pdf.ts')
    assert.match(source, /references:\s*\{\s*some:\s*pdfInlineImageOwnerWhere\(owner\)/)
    assert.match(source, /readInlineImageFile/)
    // The resolver is read-only: data URIs must never reach the database.
    assert.doesNotMatch(source, /prisma\.inline_description_images\.(create|update|delete|upsert)/)
    assert.doesNotMatch(source, /prisma\.inline_description_image_references\.(create|update|delete|upsert)/)
  })

  it('verifies the stored MIME type before embedding bytes', () => {
    const source = read('src/lib/inline-images/pdf.ts')
    assert.match(source, /INLINE_IMAGE_MIMES\.has/)
  })
})

describe('PDF evidence rendering wiring', () => {
  it('resolves request and solution descriptions against their owner IDs', async () => {
    const source = read('src/lib/pdf.ts')
    assert.match(
      source,
      /resolveInlineImagesForPdf\(\{\s*html: data\.description,\s*owner: \{ kind: ['"]request['"], id: data\.id \},?\s*\}\)/,
    )
    assert.match(
      source,
      /resolveInlineImagesForPdf\(\{\s*html: data\.solution\.description,\s*owner: \{ kind: ['"]solution['"], id: data\.solution\.id \},?\s*\}\)/,
    )
    assert.match(source, /await renderRequestEvidenceHTML\(data\)/)
  })

  it('requires request and solution owner IDs in RequestPDFData', () => {
    const source = read('src/lib/pdf.ts')
    assert.match(source, /export interface RequestPDFData \{\s*\n\tid: string;/)
    assert.match(source, /solution\?: \{\s*\n\t\tid: string;/)
  })

  it('supplies the solution owner id from the export data builder', () => {
    const source = read('src/server-actions/reports.ts')
    assert.match(source, /id: solution\.id,/)
  })

  it('prints responsive images that avoid page splitting', () => {
    const source = read('src/lib/pdf.ts')
    assert.match(source, /\.description img \{[^}]*max-width:\s*100%/)
    assert.match(source, /\.description img \{[^}]*break-inside:\s*avoid/)
    assert.match(source, /\.description img \{[^}]*page-break-inside:\s*avoid/)
    assert.match(source, /\.description img\[data-align='left'\]/)
    assert.match(source, /\.description img\[data-align='right'\]/)
  })
})
