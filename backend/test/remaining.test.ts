import { describe, expect, it } from 'vitest'
import { groupRemaining, type RemainingRow } from '../src/lib/remaining'

const row = (over: Partial<RemainingRow>): RemainingRow => ({
  editorId: 'e1',
  editorName: 'Ann',
  productId: 'p1',
  productName: 'Alpha',
  scriptId: 's1',
  scriptName: 'Alpha - Script 1',
  baseScriptNumber: 1,
  todo: 1,
  oldestTodo: '2026-11-01T00:00:00.000Z',
  ...over,
})

describe('groupRemaining', () => {
  it('groups editor -> product -> script and counts scripts, not videos', () => {
    const out = groupRemaining([
      row({ todo: 3 }),
      row({ scriptId: 's2', scriptName: 'Alpha - Script 2', baseScriptNumber: 2, todo: 1, oldestTodo: null }),
      row({ productId: 'p2', productName: 'Beta', scriptId: 's3', scriptName: 'Beta - Script 9', baseScriptNumber: 9 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].totalScripts).toBe(3)
    expect(out[0].todoVideos).toBe(5)
    expect(out[0].products.map((p) => p.productName)).toEqual(['Alpha', 'Beta'])
    expect(out[0].products[0].scripts.map((s) => [s.scriptId, s.todoVideos, s.oldestTodo])).toEqual([
      ['s1', 3, '2026-11-01T00:00:00.000Z'],
      ['s2', 1, null],
    ])
  })

  it('puts the editor with the most remaining scripts first and leaves out editors with none', () => {
    const out = groupRemaining([
      row({ editorId: 'e1', editorName: 'Ann' }),
      row({ editorId: 'e2', editorName: 'Bob', scriptId: 'a' }),
      row({ editorId: 'e2', editorName: 'Bob', scriptId: 'b' }),
      row({ editorId: 'e3', editorName: 'Cy', todo: 0 }),
    ])
    expect(out.map((e) => [e.editorName, e.totalScripts])).toEqual([
      ['Bob', 2],
      ['Ann', 1],
    ])
  })

  it('merges a script seen twice and keeps the oldest date', () => {
    const out = groupRemaining([row({ todo: 1, oldestTodo: '2026-11-05' }), row({ todo: 2, oldestTodo: '2026-11-02' })])
    expect(out[0].products[0].scripts).toEqual([
      { scriptId: 's1', scriptName: 'Alpha - Script 1', scriptNumber: 1, todoVideos: 3, oldestTodo: '2026-11-02' },
    ])
  })

  it('orders scripts by number, then name, with unnumbered last', () => {
    const out = groupRemaining([
      row({ scriptId: 'x', scriptName: 'No number', baseScriptNumber: null }),
      row({ scriptId: 'b', scriptName: 'Ten', baseScriptNumber: 10 }),
      row({ scriptId: 'a', scriptName: 'Two', baseScriptNumber: 2 }),
    ])
    expect(out[0].products[0].scripts.map((s) => s.scriptId)).toEqual(['a', 'b', 'x'])
  })
})
