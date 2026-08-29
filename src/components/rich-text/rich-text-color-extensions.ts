import { Mark } from '@tiptap/core'
import {
  HIGHLIGHT_COLOR_VALUES,
  TEXT_COLOR_VALUES,
  isHighlightColorToken,
  isTextColorToken,
  type HighlightColorToken,
  type TextColorToken,
} from '@/lib/rich-text-palette'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColorToken: {
      setTextColorToken: (token: TextColorToken) => ReturnType
      unsetTextColorToken: () => ReturnType
    }
    highlightColorToken: {
      setHighlightColorToken: (token: HighlightColorToken) => ReturnType
      unsetHighlightColorToken: () => ReturnType
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function parseBrowserNormalizedColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized.toUpperCase()

  const rgb = normalized.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/)
    ?? normalized.match(/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*1(?:\.0*)?\s*\)$/)
  if (!rgb) return null

  const channels = rgb.slice(1, 4).map(Number)
  if (channels.some((channel) => channel > 255)) return null
  return `rgb(${channels.join(',')})`
}

function tokenForCssColor<Token extends string>(
  value: unknown,
  palette: Readonly<Record<Token, string>>,
): Token | null {
  const normalized = parseBrowserNormalizedColor(value)
  if (!normalized) return null

  for (const [token, hex] of Object.entries(palette) as Array<[Token, string]>) {
    if (normalized === hex.toUpperCase()) return token
    const rgb = hexToRgb(hex)
    if (normalized === `rgb(${rgb.join(',')})`) return token
  }
  return null
}

export const TextColorTokenMark = Mark.create({
  name: 'textColorToken',

  addAttributes() {
    return { token: { default: null, rendered: false } }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-text-color]',
        getAttrs: (element) => {
          const token = element.getAttribute('data-text-color')
          return isTextColorToken(token) ? { token } : false
        },
      },
      {
        style: 'color',
        getAttrs: (value) => {
          const token = tokenForCssColor(value, TEXT_COLOR_VALUES)
          return token ? { token } : false
        },
      },
    ]
  },

  renderHTML({ mark }) {
    if (!isTextColorToken(mark.attrs.token)) return ['span', {}, 0]
    return ['span', {
      'data-text-color': mark.attrs.token,
      style: `color:${TEXT_COLOR_VALUES[mark.attrs.token]}`,
    }, 0]
  },

  addCommands() {
    return {
      setTextColorToken: (token) => ({ commands }) => (
        isTextColorToken(token) && commands.setMark(this.name, { token })
      ),
      unsetTextColorToken: () => ({ commands }) => commands.unsetMark(this.name),
    }
  },
})

export const HighlightColorTokenMark = Mark.create({
  name: 'highlightColorToken',

  addAttributes() {
    return { token: { default: null, rendered: false } }
  },

  parseHTML() {
    return [
      {
        tag: 'mark[data-highlight]',
        getAttrs: (element) => {
          const token = element.getAttribute('data-highlight')
          return isHighlightColorToken(token) ? { token } : false
        },
      },
      {
        style: 'background-color',
        getAttrs: (value) => {
          const token = tokenForCssColor(value, HIGHLIGHT_COLOR_VALUES)
          return token ? { token } : false
        },
      },
    ]
  },

  renderHTML({ mark }) {
    if (!isHighlightColorToken(mark.attrs.token)) return ['span', {}, 0]
    return ['mark', {
      'data-highlight': mark.attrs.token,
      style: `background-color:${HIGHLIGHT_COLOR_VALUES[mark.attrs.token]}`,
    }, 0]
  },

  addCommands() {
    return {
      setHighlightColorToken: (token) => ({ commands }) => (
        isHighlightColorToken(token) && commands.setMark(this.name, { token })
      ),
      unsetHighlightColorToken: () => ({ commands }) => commands.unsetMark(this.name),
    }
  },
})
