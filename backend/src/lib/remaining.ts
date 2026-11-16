// Remaining scripts per editor: the pure grouping behind GET /overview/remaining.
// A script is remaining for an editor while they still have a video on it in
// status To Do. Nothing here touches the database.

// One row of the grouped query: one editor's To Do videos on one script
export interface RemainingRow {
  editorId: string
  editorName: string | null
  productId: string
  productName: string | null
  scriptId: string
  scriptName: string | null
  baseScriptNumber: number | null
  todo: number
  // the oldest To Do video's created time, when there is one
  oldestTodo: string | null
}

export interface RemainingScript {
  scriptId: string
  scriptName: string
  scriptNumber: number | null
  todoVideos: number
  oldestTodo: string | null
}

export interface RemainingProduct {
  productId: string
  productName: string
  scripts: RemainingScript[]
}

export interface RemainingEditor {
  editorId: string
  editorName: string | null
  totalScripts: number
  todoVideos: number
  products: RemainingProduct[]
}

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })

// Editors with at least one remaining script, most remaining first; inside,
// products by name and scripts by number then name
export function groupRemaining(rows: RemainingRow[]): RemainingEditor[] {
  const editors = new Map<string, { editorName: string | null; products: Map<string, RemainingProduct> }>()
  for (const row of rows) {
    if (!row.editorId || !row.scriptId || !(row.todo > 0)) continue
    const editor = editors.get(row.editorId) ?? { editorName: row.editorName, products: new Map() }
    editors.set(row.editorId, editor)
    const product: RemainingProduct = editor.products.get(row.productId) ?? { productId: row.productId, productName: row.productName || 'Untitled', scripts: [] }
    editor.products.set(row.productId, product)
    const same = product.scripts.find((s) => s.scriptId === row.scriptId)
    if (same) {
      same.todoVideos += row.todo
      if (row.oldestTodo && (!same.oldestTodo || row.oldestTodo < same.oldestTodo)) same.oldestTodo = row.oldestTodo
      continue
    }
    product.scripts.push({
      scriptId: row.scriptId,
      scriptName: row.scriptName || 'Untitled script',
      scriptNumber: typeof row.baseScriptNumber === 'number' ? row.baseScriptNumber : null,
      todoVideos: row.todo,
      oldestTodo: row.oldestTodo || null,
    })
  }

  const out: RemainingEditor[] = []
  for (const [editorId, editor] of editors) {
    const products = [...editor.products.values()].sort((a, b) => byName(a.productName, b.productName))
    for (const product of products) {
      product.scripts.sort((a, b) => (a.scriptNumber ?? Infinity) - (b.scriptNumber ?? Infinity) || byName(a.scriptName, b.scriptName))
    }
    const scripts = products.flatMap((p) => p.scripts)
    out.push({
      editorId,
      editorName: editor.editorName,
      totalScripts: scripts.length,
      todoVideos: scripts.reduce((sum, s) => sum + s.todoVideos, 0),
      products,
    })
  }
  return out.sort((a, b) => b.totalScripts - a.totalScripts || byName(a.editorName ?? '', b.editorName ?? ''))
}
