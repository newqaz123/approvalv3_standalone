import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Editor, type JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import {
  RichTableKit,
  appendTableColumn,
  appendTableRow,
  dragTargetsSameTable,
  moveTableRowTo,
  normalizeTableVerticalAlign,
  pointerInTableGraceZone,
} from '../../src/components/rich-text/rich-table-extensions'
import { sanitizeRichText } from '../../src/lib/rich-text-sanitizer'

function paragraph(text?: string): JSONContent {
  return {
    type: 'paragraph',
    ...(text ? { content: [{ type: 'text', text }] } : {}),
  } as unknown as JSONContent
}

function cell(kind: 'tableCell' | 'tableHeader', text?: string): JSONContent {
  return { type: kind, attrs: {}, content: [paragraph(text)] } as unknown as JSONContent
}

function sampleTableDoc(): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [cell('tableHeader', 'H1'), cell('tableHeader', 'H2')],
          },
          {
            type: 'tableRow',
            content: [cell('tableCell', 'a'), cell('tableCell', 'b')],
          },
        ],
      },
      paragraph(),
    ],
  }
}

function createTableEditor(): Editor {
  return new Editor({
    element: null,
    extensions: [StarterKit, RichTableKit],
    content: sampleTableDoc(),
  })
}

function createThreeByThreeEditor(): Editor {
  const row = (): JSONContent => ({
    type: 'tableRow',
    content: [cell('tableCell'), cell('tableCell'), cell('tableCell')],
  } as unknown as JSONContent)
  return new Editor({
    element: null,
    extensions: [StarterKit, RichTableKit],
    content: {
      type: 'doc',
      content: [
        { type: 'table', content: [row(), row(), row()] },
        paragraph(),
      ],
    } as unknown as JSONContent,
  })
}

/** Cell texts per table row ('' for empty cells). */
function rowTexts(editor: Editor): string[][] {
  const rows: string[][] = []
  editor.state.doc.nodeAt(0)?.descendants((node) => {
    if (node.type.name === 'tableRow') {
      rows.push(
        Array.from({ length: node.childCount }, (_, index) =>
          node.child(index)?.textContent ?? '',
        ),
      )
    }
    return true
  })
  return rows
}

function cellPositions(editor: Editor): number[] {
  const positions: number[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      positions.push(pos)
    }
    return true
  })
  return positions
}

function findFirstNode(
  root: ProseMirrorNode | null | undefined,
  typeName: string,
): ProseMirrorNode | null {
  let found: ProseMirrorNode | null = null
  root?.descendants((node) => {
    if (found === null && node.type.name === typeName) {
      found = node
      return false
    }
    return true
  })
  return found
}

describe('RichTableKit vertical align schema', () => {
  it('enables column resizing so stored colwidths persist', () => {
    const source = readFileSync(
      'src/components/rich-text/rich-table-extensions.ts',
      'utf8',
    )
    assert.match(source, /Table\.configure\(\{ resizable: true \}\)/)
  })

  it('normalizes only the curated vertical align tokens', () => {
    assert.equal(normalizeTableVerticalAlign('middle'), 'middle')
    assert.equal(normalizeTableVerticalAlign('top'), 'top')
    assert.equal(normalizeTableVerticalAlign('bottom'), 'bottom')
    assert.equal(normalizeTableVerticalAlign('center'), null)
    assert.equal(normalizeTableVerticalAlign(null), null)
    assert.equal(normalizeTableVerticalAlign(undefined), null)
  })

  it('serializes the vertical align attribute into whitelisted markup', () => {
    const editor = createTableEditor()
    try {
      const firstCell = cellPositions(editor)[0]!
      editor.commands.setTextSelection(firstCell + 2)
      assert.equal(editor.commands.setCellAttribute('verticalAlign', 'middle'), true)

      const table = editor.state.doc.nodeAt(0)
      const headerCell = findFirstNode(table, 'tableHeader')
      assert.equal(headerCell?.attrs?.verticalAlign, 'middle')

      // The curated attribute is registered on both cell node schemas.
      const headerAttrs = editor.schema.nodes.tableHeader?.spec.attrs as
        | Record<string, { default: unknown }>
        | undefined
      const cellAttrs = editor.schema.nodes.tableCell?.spec.attrs as
        | Record<string, { default: unknown }>
        | undefined
      assert.ok(headerAttrs?.verticalAlign)
      assert.ok(cellAttrs?.verticalAlign)
      assert.equal(headerAttrs.verticalAlign.default, null)
      assert.equal(cellAttrs.verticalAlign.default, null)

      // And the sanitizer keeps that attribute on the serialized markup.
      const html = '<table><tbody><tr><th data-vertical-align="bottom">H</th></tr></tbody></table>'
      assert.equal(sanitizeRichText(html), html)
    } finally {
      editor.destroy()
    }
  })

  it('keeps unset vertical align out of the document attrs', () => {
    const editor = createTableEditor()
    try {
      const bodyCell = findFirstNode(editor.state.doc.nodeAt(0), 'tableCell')
      assert.equal(bodyCell?.attrs?.verticalAlign, null)
    } finally {
      editor.destroy()
    }
  })
})

describe('RichTableKit merge and split commands', () => {
  it('merges a two-cell selection into one spanning cell and splits it back', () => {
    const editor = createTableEditor()
    try {
      const positions = cellPositions(editor)
      assert.equal(positions.length, 4)

      assert.equal(
        editor.commands.setCellSelection({
          anchorCell: positions[0]!,
          headCell: positions[1]!,
        }),
        true,
      )
      assert.equal(editor.commands.mergeCells(), true)

      const headerRow = editor.state.doc.nodeAt(0)?.child(0)
      assert.equal(headerRow?.childCount, 1)
      assert.equal(Number(headerRow?.child(0)?.attrs?.colspan ?? 1), 2)

      // The caret now sits inside the merged cell; split restores both cells.
      assert.equal(editor.commands.splitCell(), true)
      const restored = editor.state.doc.nodeAt(0)?.child(0)
      assert.equal(restored?.childCount, 2)
      assert.equal(Number(restored?.child(0)?.attrs?.colspan ?? 1), 1)
    } finally {
      editor.destroy()
    }
  })

  it('keeps vertical align cell attributes through a row move', () => {
    const editor = createTableEditor()
    try {
      // Mark every cell as middle-aligned, then move the header row below the
      // body row; the attribute must survive the reorder.
      for (const position of cellPositions(editor)) {
        editor.commands.setTextSelection(position + 2)
        editor.commands.setCellAttribute('verticalAlign', 'middle')
      }

      assert.equal(moveTableRowTo(editor, 0, 0, 1), true)

      // prosemirror-tables keeps the header row on top and converts the moved
      // header cells to body cells; the custom attribute must survive both the
      // reorder and the type conversion.
      const table = editor.state.doc.nodeAt(0)
      const movedBodyRow = table?.child(1)
      assert.equal(movedBodyRow?.child(0)?.type.name, 'tableCell')
      assert.equal(movedBodyRow?.child(0)?.attrs?.verticalAlign, 'middle')
      assert.equal(movedBodyRow?.child(1)?.attrs?.verticalAlign, 'middle')
      assert.equal(table?.child(0)?.child(0)?.type.name, 'tableHeader')
    } finally {
      editor.destroy()
    }
  })

  it('moves rows even when the editor selection is outside the table', () => {
    const editor = createTableEditor()
    try {
      // Caret in the trailing paragraph, far from the table.
      editor.commands.setTextSelection(editor.state.doc.content.size - 1)
      assert.equal(moveTableRowTo(editor, 0, 0, 1), true)

      // prosemirror-tables keeps the header row on top: the moved body row
      // takes its place (converted to header), the old header lands below.
      const table = editor.state.doc.nodeAt(0)
      assert.equal(
        table?.child(0)?.child(0)?.type.name,
        'tableHeader',
        'a header row always stays first',
      )
      assert.notEqual(table?.child(1)?.child(0)?.type.name, 'tableHeader')
    } finally {
      editor.destroy()
    }
  })

  it('appends rows at the table end even when hovering a middle row', () => {
    const editor = createThreeByThreeEditor()
    try {
      const before = rowTexts(editor)
      assert.equal(before.length, 3)

      // Hover the FIRST row but append: the new row must land after the LAST.
      const firstCell = cellPositions(editor)[0]!
      assert.equal(
        appendTableRow(editor, {
          tableStart: 0,
          cellStart: firstCell,
          row: 0,
          col: 0,
          width: 3,
          height: 3,
        }),
        true,
      )

      const after = rowTexts(editor)
      assert.equal(after.length, 4)
      assert.deepEqual(after.slice(0, 3), before)
      assert.equal(after[3]?.join(','), ',,')
    } finally {
      editor.destroy()
    }
  })

  it('appends columns at the table end even when hovering a middle column', () => {
    const editor = createThreeByThreeEditor()
    try {
      const before = rowTexts(editor)

      // Hover the FIRST column but append: the new column must land last.
      const firstCell = cellPositions(editor)[0]!
      assert.equal(
        appendTableColumn(editor, {
          tableStart: 0,
          cellStart: firstCell,
          row: 0,
          col: 0,
          width: 3,
          height: 3,
        }),
        true,
      )

      const after = rowTexts(editor)
      assert.equal(after[0]?.length, 4)
      for (let index = 0; index < before.length; index++) {
        assert.deepEqual(after[index]?.slice(0, 3), before[index])
      }
    } finally {
      editor.destroy()
    }
  })
})

describe('table hover affordance predicates', () => {
  it('keeps hover alive within the grace zone and expires outside it', () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 }
    assert.equal(pointerInTableGraceZone({ x: 80, y: 70 }, rect, 48), true)
    assert.equal(pointerInTableGraceZone({ x: 200, y: 170 }, rect, 48), true)
    assert.equal(pointerInTableGraceZone({ x: 20, y: 70 }, rect, 48), false)
    assert.equal(pointerInTableGraceZone({ x: 200, y: 220 }, rect, 48), false)
  })

  it('binds drag gestures to their source table only', () => {
    assert.equal(dragTargetsSameTable(5, 5), true)
    assert.equal(dragTargetsSameTable(5, 9), false)
    assert.equal(dragTargetsSameTable(5, null), false)
    assert.equal(dragTargetsSameTable(5, undefined), false)
  })

  it('intercepts internal table drags before the editor drop handler', () => {
    // ProseMirror's own dragover/drop listeners on the editable DOM run in
    // the bubble phase; the overlay must capture its drags above them or the
    // payload is inserted as text instead of reordering. Pointer tracking
    // must be window-level because gutter buttons sit outside the container.
    const source = readFileSync(
      'src/components/rich-text/rich-text-table-hover-controls.tsx',
      'utf8',
    )
    assert.match(source, /window\.addEventListener\("dragover", onDragOverCapture, true\)/)
    assert.match(source, /window\.addEventListener\("drop", onDropCapture, true\)/)
    assert.match(source, /onDragOverCapture[\s\S]{0,600}stopPropagation\(\)/)
    assert.match(source, /onDropCapture[\s\S]{0,600}stopPropagation\(\)/)
    assert.match(source, /window\.addEventListener\("pointermove", onPointerMove\)/)
    assert.doesNotMatch(source, /container\.addEventListener\("dragover"/)
  })

  it('grip menus toggle: both grips tagged and excluded from outside-close', () => {
    // Clicking an open menu's own grip must toggle it closed: the capture
    // pointerdown listener has to skip both grip types, not just the row one.
    const source = readFileSync(
      'src/components/rich-text/rich-text-table-hover-controls.tsx',
      'utf8',
    )
    assert.match(source, /data-row-grip=""\s*\n[\s\S]{0,200}table-row/)
    assert.match(source, /data-col-grip=""\s*\n[\s\S]{0,200}table-column/)
    assert.match(
      source,
      /closest\("\[data-row-grip\], \[data-col-grip\]"\)/,
    )
  })

  it('keeps hover alive across the gutter travel distance and over the controls', () => {
    // Row gutter buttons start 62px left of the table edge; the grace margin
    // must cover that travel and hovering a control itself must never clear
    // the hover it depends on.
    const source = readFileSync(
      'src/components/rich-text/rich-text-table-hover-controls.tsx',
      'utf8',
    )
    assert.match(source, /const HOVER_GRACE_MARGIN = 64;/)
    assert.match(
      source,
      /controlsRef\.current[\s\S]{0,120}controlsRef\.current\.contains\(event\.target\)/,
    )
  })
})
