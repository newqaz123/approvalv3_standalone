import * as React from 'react'

import {
  containsRichTextHtml,
  sanitizeRichText,
} from '@/lib/rich-text-sanitizer'
import { tokenizeFormattedText, truncateFormattedText } from '@/lib/formatted-text'
import { inlineImageAltPlaceholder } from '@/lib/inline-images/policy'
import {
  materializeRichTextForApp,
  truncateSanitizedRichTextHtml,
} from '@/lib/rich-text-presentation'
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

  // Authored rich HTML crosses the storage sanitizer boundary before trusted,
  // output-only palette and crop presentation is generated.
  if (containsRichTextHtml(text)) {
    const rendered = maxVisibleCharacters === undefined
      ? materializeRichTextForApp(text)
      : materializeRichTextForApp(
          inlineImageAltPlaceholder(
            truncateSanitizedRichTextHtml(sanitizeRichText(text), maxVisibleCharacters),
          ),
        )
    const html = { __html: rendered }
    return <span className={cn(className, 'rich-text')} dangerouslySetInnerHTML={html} />
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
