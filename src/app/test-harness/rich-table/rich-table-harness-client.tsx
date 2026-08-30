"use client";

import { useState } from "react";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor-lazy";

const TABLE_HTML =
  '<table><tbody><tr><th>H1</th><th>H2</th><th>H3</th></tr>' +
  '<tr><td>r2c1</td><td>r2c2</td><td>r2c3</td></tr>' +
  '<tr><td>r3c1</td><td>r3c2</td><td>r3c3</td></tr>' +
  '<tr><td>r4c1</td><td>r4c2</td><td>r4c3</td></tr></tbody></table>';

export default function RichTableHarnessClient() {
  const [value, setValue] = useState(TABLE_HTML);

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-lg font-bold">Rich table harness</h1>
      <RichTextEditor value={value} onChange={setValue} minHeight={200} />
      <div className="rounded border bg-slate-50 p-2">
        <p className="mb-1 text-xs font-semibold text-slate-500">Serialized HTML</p>
        <pre className="max-h-40 overflow-auto text-xs" data-testid="serialized-html">
          {value}
        </pre>
      </div>
    </main>
  );
}
