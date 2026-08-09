import * as React from 'react'

import { tokenizeFormattedText } from '@/lib/formatted-text'
import { cn } from '@/lib/utils'

export type FormattedTextProps = {
  source?: string | null
  className?: string
}

export function FormattedText({ source, className }: FormattedTextProps) {
  const tokens = tokenizeFormattedText(source ?? '')
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
