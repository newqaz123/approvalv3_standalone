import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as React from 'react'
import * as HoverCardPrimitive from '@radix-ui/react-hover-card'
import { HoverCardContent } from '../../src/components/ui/hover-card'

test('hover content escapes clipping containers through the Radix portal', () => {
  // Exercise the wrapper boundary without mocking Radix. Removing the portal
  // puts approval timelines back inside the table overflow container.
  const render = (HoverCardContent as unknown as React.ForwardRefExoticComponent<
    React.ComponentProps<typeof HoverCardContent>
  > & { render: React.ForwardRefRenderFunction<HTMLDivElement, React.ComponentProps<typeof HoverCardContent>> }).render
  const ref = React.createRef<HTMLDivElement>()
  const result = render({ children: 'Approval chain', className: 'w-72 p-0', side: 'bottom' }, ref) as React.ReactElement<{ children: React.ReactElement<React.ComponentProps<typeof HoverCardPrimitive.Content>> }>

  assert.equal(result.type, HoverCardPrimitive.Portal)
  const content = result.props.children
  assert.equal(content.type, HoverCardPrimitive.Content)
  assert.equal(content.props.children, 'Approval chain')
  assert.equal(content.props.side, 'bottom')
  assert.equal(content.props.ref, ref)
  assert.ok(content.props.className?.includes('w-72'))
})
