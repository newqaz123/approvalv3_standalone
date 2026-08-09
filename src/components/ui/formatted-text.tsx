import * as React from 'react'

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
  const tokens =
    maxVisibleCharacters === undefined
      ? tokenizeFormattedText(source ?? '')
      : truncateFormattedText(source ?? '', maxVisibleCharacters)
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
