import * as React from 'react'

import {
  containsRichTextHtml,
  richTextToPlainText,
  sanitizeRichText,
} from '@/lib/rich-text-sanitizer'
import { tokenizeFormattedText, truncateFormattedText } from '@/lib/formatted-text'
import { cn } from '@/lib/utils'

export type FormattedTextProps = {
  source?: string | null
  className?: string
  maxVisibleCharacters?: number
}

export function FormattedText({
  source,
  className,
  maxVisibleCharacters,
}: FormattedTextProps) {
  const text = source ?? ''

  // Authored rich HTML: sanitized before it may touch dangerouslySetInnerHTML.
  if (containsRichTextHtml(text)) {
    if (maxVisibleCharacters === undefined) {
      const html = { __html: sanitizeRichText(text) }
      if (className) {
        return <span className={cn(className)} dangerouslySetInnerHTML={html} />
      }
      return <span dangerouslySetInnerHTML={html} />
    }
    // Truncated contexts (tables, previews) show plain text so slicing can't
    // break tags mid-stream. truncateFormattedText returns tokens directly.
    const tokens = truncateFormattedText(
      richTextToPlainText(text),
      maxVisibleCharacters,
    )
    return <LegacyNodes tokens={tokens} className={className} />
  }

  const tokens =
    maxVisibleCharacters === undefined
      ? tokenizeFormattedText(text)
      : truncateFormattedText(text, maxVisibleCharacters)
  return <LegacyNodes tokens={tokens} className={className} />
}

function LegacyNodes({
  tokens,
  className,
}: {
  tokens: ReturnType<typeof tokenizeFormattedText>
  className?: string
}) {
  const nodes = tokens.map((token, index) => {
    if (token.type === 'lineBreak') {
      return <br key={`lb-${index}`} />
    }

    if (token.type === 'bold') {
      return <strong key={`b-${index}`}>{token.value}</strong>
    }

    return <React.Fragment key={`t-${index}`}>{token.value}</React.Fragment>
  })

  if (className) {
    return <span className={cn(className)}>{nodes}</span>
  }

  return <>{nodes}</>
}
