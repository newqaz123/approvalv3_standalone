import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

it('template admin form uses the rich text editor for descriptions', () => {
  const source = read('src/components/admin/template-form.tsx')

  assert.match(source, /RichTextEditor/)
  assert.match(source, /from ['"]@\/components\/rich-text\/rich-text-editor-lazy['"]/)
  assert.doesNotMatch(source, /<Textarea[^>]*placeholder="Provide detailed description content/)
})

it('template server actions reuse the shared description schema', () => {
  const source = read('src/server-actions/templates.ts')

  assert.match(source, /import \{ descriptionSchema \} from ['"]@\/lib\/schemas\/solution-schemas['"]/)
  assert.doesNotMatch(source, /description: z\.string\(\)\.min\(1, ['"]Description is required['"]\)/)
  assert.match(source, /description: descriptionSchema/)
})
