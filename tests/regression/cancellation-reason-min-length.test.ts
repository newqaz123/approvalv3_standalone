import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CANCELLATION_REASON_MAX_LENGTH,
  CANCELLATION_REASON_MIN_LENGTH,
  cancellationReasonSchema,
} from '@/lib/schemas/cancellation-schemas'

const read = (path: string) => readFileSync(path, 'utf8')

describe('cancellation reason minimum length (5 characters)', () => {
  it('exposes the approved 5/500 bounds', () => {
    assert.equal(CANCELLATION_REASON_MIN_LENGTH, 5)
    assert.equal(CANCELLATION_REASON_MAX_LENGTH, 500)
  })

  it('accepts a 5-character reason and rejects 4 characters', () => {
    assert.equal(cancellationReasonSchema.safeParse('abcde').success, true)
    assert.equal(cancellationReasonSchema.safeParse('abcd').success, false)
  })

  it('rejects whitespace-only input', () => {
    assert.equal(cancellationReasonSchema.safeParse('     ').success, false)
    assert.equal(cancellationReasonSchema.safeParse('\n\t  \n').success, false)
  })

  it('trims surrounding whitespace before enforcing the minimum', () => {
    const result = cancellationReasonSchema.safeParse('  valid  ')
    assert.equal(result.success, true)
    if (result.success) {
      assert.equal(result.data, 'valid')
    }
  })

  it('keeps the 500-character maximum', () => {
    assert.equal(cancellationReasonSchema.safeParse('a'.repeat(500)).success, true)
    assert.equal(cancellationReasonSchema.safeParse('a'.repeat(501)).success, false)
  })

  it('shares one schema between the client dialog and the server action (no drift)', () => {
    const dialog = read('src/components/requests/cancel-request-dialog.tsx')
    assert.match(dialog, /cancellationReasonSchema/, 'dialog must use the shared cancellation schema')
    assert.doesNotMatch(dialog, /\.min\(10/, 'dialog must not keep the old 10-character minimum')

    const serverAction = read('src/server-actions/requests.ts')
    assert.match(
      serverAction,
      /reason: cancellationReasonSchema/,
      'cancelRequestSchema must use the shared cancellation schema',
    )
  })

  it('shows persistent helper text "Minimum 5 characters." beneath the cancellation field', () => {
    const dialog = read('src/components/requests/cancel-request-dialog.tsx')
    assert.match(dialog, /Minimum 5 characters\./)
    // Persistent helper text lives in FormDescription (always rendered),
    // not only inside the error-gated FormMessage.
    assert.match(dialog, /<FormDescription[^>]*>\s*Minimum 5 characters\./)
  })

  it('leaves the admin delete-request reason policy untouched', () => {
    const serverAction = read('src/server-actions/requests.ts')
    assert.match(
      serverAction,
      /const deleteRequestSchema = z\.object\(\{\s*requestId: z\.string\(\)\.min\(1, 'Request ID is required'\),\s*reason: z\.string\(\)\.min\(10, 'Reason must be at least 10 characters'\)/,
      'delete-request policy is out of scope and must stay at 10 characters',
    )
  })

  it('validates on change so 4 characters stay blocked and 5 enable submission', () => {
    const dialog = read('src/components/requests/cancel-request-dialog.tsx')
    // React Hook Form's default onSubmit mode only refreshes isValid after a
    // submit attempt, so the submit button would not track typing.
    assert.match(
      dialog,
      /useForm<CancelFormValues>\(\{[\s\S]*?mode: 'onChange',\s*resolver: zodResolver\(cancelSchema\),/,
      'the form must validate on change with the shared schema resolver',
    )
    assert.match(
      dialog,
      /disabled=\{isSubmitting \|\| !form\.formState\.isValid\}/,
      'the submit button must stay gated on live validity',
    )
  })
})
