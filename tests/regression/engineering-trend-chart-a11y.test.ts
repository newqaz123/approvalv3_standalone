import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

describe('engineering resolution trend chart accessibility', () => {
  it('enables the Recharts accessibility layer', () => {
    const chart = read('src/components/analytics/engineering-resolution-trend-chart.tsx')
    assert.match(chart, /accessibilityLayer/)
  })

  it('exposes an accessible title and description for screen readers', () => {
    const chart = read('src/components/analytics/engineering-resolution-trend-chart.tsx')
    assert.match(chart, /aria-labelledby=/)
    assert.match(chart, /sr-only/)
    assert.match(chart, /Engineering Resolution Trend/)
    assert.match(
      chart,
      /Open engineering backlog at period end versus requests resolved by Engineering during each period\./,
    )
  })

  it('provides a visually hidden tabular data equivalent for every period', () => {
    const chart = read('src/components/analytics/engineering-resolution-trend-chart.tsx')
    // The table lives inside an sr-only clipping wrapper: a bare sr-only
    // table still lays out at its min-content width and overflows mobile
    // viewports.
    assert.match(chart, /<div className="sr-only">\s*<table>/)
    assert.match(chart, /<caption>/)
    // Column headers for period, unresolved, and resolved values.
    assert.match(chart, /<th scope="col">Period<\/th>/)
    assert.match(chart, /<th scope="col">Engineering unresolved<\/th>/)
    assert.match(chart, /<th scope="col">Resolved by Engineering<\/th>/)
    // One row per data point, keyed by period, with row headers.
    assert.match(chart, /data\.map\(\(point\) => \(/)
    assert.match(chart, /<th scope="row">\{point\.period\}<\/th>/)
    assert.match(chart, /<td>\{point\.engineeringUnresolved\}<\/td>/)
    assert.match(chart, /<td>\{point\.resolvedByEngineering\}<\/td>/)
  })
})

describe('engineering resolution trend low-vision distinction', () => {
  const chart = read('src/components/analytics/engineering-resolution-trend-chart.tsx')
  const resolvedLine = chart.match(/dataKey="resolvedByEngineering"[\s\S]*?\/>/)?.[0] ?? ''
  const unresolvedLine = chart.match(/dataKey="engineeringUnresolved"[\s\S]*?\/>/)?.[0] ?? ''

  // WCAG 2.x relative luminance / contrast ratio helpers.
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const luminance = (rgb: [number, number, number]) =>
    0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
  const contrast = (a: [number, number, number], b: [number, number, number]) => {
    const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (l1 + 0.05) / (l2 + 0.05)
  }
  const hex = (h: string): [number, number, number] => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]
  const hsl = (h: number, s: number, l: number): [number, number, number] => {
    // CSS Color 4 hsl() to sRGB (s and l in 0..1 fractions, h in degrees).
    const sat = s / 100
    const lig = l / 100
    const f = (n: number) => {
      const k = (n + h / 30) % 12
      const a = sat * Math.min(lig, 1 - lig)
      return Math.round(255 * (lig - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))))
    }
    return [f(0), f(8), f(4)]
  }

  it('renders the resolved series in a darker green with >=3:1 non-text contrast on the chart card background', () => {
    assert.ok(resolvedLine, 'resolved series Line must exist')
    const stroke = resolvedLine.match(/stroke="(#[0-9a-fA-F]{6})"/)?.[1]
    assert.ok(stroke, 'resolved series must declare a hex stroke')
    assert.notEqual(
      stroke!.toLowerCase(),
      '#22c55e',
      'the old #22c55e green fails 3:1 against light card backgrounds',
    )
    assert.doesNotMatch(
      `${resolvedLine}\n${unresolvedLine}`,
      /22c55e/i,
      'no #22c55e remnant may remain in either rendered series',
    )

    // The chart sits on the card token: assert the ratio against every
    // --card value declared in the theme (light and dark).
    const globals = read('src/app/globals.css')
    const cards = [...globals.matchAll(/--card:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)].map((m) =>
      hsl(Number(m[1]), Number(m[2]), Number(m[3])),
    )
    assert.ok(cards.length >= 2, 'expected light and dark --card tokens')
    const resolved = hex(stroke!)
    for (const [i, card] of cards.entries()) {
      const ratio = contrast(resolved, card)
      assert.ok(
        ratio >= 3,
        `resolved green ${stroke} contrast ${ratio.toFixed(2)}:1 against --card #${i} must be >= 3:1`,
      )
    }
  })

  it('encodes the resolved series non-color: dashed line, distinct from the solid unresolved line', () => {
    assert.ok(resolvedLine && unresolvedLine, 'both series Lines must exist')
    assert.match(resolvedLine, /strokeDasharray=/, 'resolved line must be dashed')
    assert.doesNotMatch(
      unresolvedLine,
      /strokeDasharray=/,
      'unresolved line must stay solid so the dash is a differentiator',
    )
  })

  it('gives the two series distinct legend marker shapes, not one global shape', () => {
    const legend = chart.match(/<Legend[\s\S]*?\/>/)?.[0] ?? ''
    assert.ok(legend, 'Legend must exist')
    assert.doesNotMatch(
      legend,
      /iconType=/,
      'a global Legend iconType would force one shape on both series',
    )
    assert.match(unresolvedLine, /legendType="circle"/)
    assert.match(resolvedLine, /legendType="plainline"/, 'resolved legend marker echoes the dashed encoding')
  })
})

describe('engineering resolution trend card composition', () => {
  it('stacks the long subtitle beneath the title, aligned with the icon', () => {
    const page = read('src/components/analytics/analytics-page.tsx')
    const header = page.match(/<div className="flex[^"]*border-b[^"]*">[\s\S]*?<\/div>\s*<\/div>/)
    assert.ok(header, 'SectionCard header must exist')

    // Icon aligns to the first line (title), text block may wrap.
    assert.match(header[0], /items-start/)
    // Title and subtitle live in a stacked block (subtitle below the title),
    // not side by side in the header's flex row.
    const stacked = header[0].match(/<div className="min-w-0">\s*<h2[^>]*>\{title\}<\/h2>\s*\{subtitle && \(/)
    assert.ok(
      stacked,
      'title and subtitle must be stacked inside a min-w-0 block so long subtitles wrap instead of squeezing the row',
    )
    assert.match(header[0], /<p className="mt-0\.5[^"]*text-xs[^"]*">\{subtitle\}<\/p>/)
  })
})
