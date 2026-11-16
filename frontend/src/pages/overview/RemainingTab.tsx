import { ChevronRight } from 'lucide-react'
import { Collapsible } from 'radix-ui'
import { useFetch } from '../../data'
import { plural } from './parts'

interface Script {
  scriptId: string
  scriptName: string
  scriptNumber: number | null
  todoVideos: number
  oldestTodo: string | null
}

interface Product {
  productId: string
  productName: string
  scripts: Script[]
}

interface Editor {
  editorId: string
  editorName: string | null
  totalScripts: number
  todoVideos: number
  products: Product[]
}

const trigger = 'group flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-blue-700'
const chevron = 'size-4 shrink-0 text-neutral-500 group-data-[state=open]:rotate-90'

const since = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso)) : ''

export function RemainingTab() {
  const { data, error } = useFetch<{ editors: Editor[] }>('/overview/remaining')

  if (error) return <p className="text-sm text-red-700">Could not load the remaining scripts: {error.message}</p>
  if (!data) return <p className="text-sm text-neutral-500">Loading…</p>

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">
        Scripts each editor still has a To Do video on. Active products only.
      </p>
      {data.editors.length === 0 && (
        <p className="rounded-lg border border-neutral-200 bg-white px-4 py-10 text-center text-sm text-neutral-500">No remaining scripts.</p>
      )}
      {data.editors.map((editor) => (
        <EditorCard key={editor.editorId} editor={editor} />
      ))}
    </div>
  )
}

function EditorCard({ editor }: { editor: Editor }) {
  return (
    <Collapsible.Root className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <Collapsible.Trigger className={`${trigger} px-4 py-3 text-sm`}>
        <ChevronRight className={chevron} />
        <span className="text-base font-semibold">{editor.editorName || 'Unnamed editor'}</span>
        <span className="text-neutral-600">{plural(editor.todoVideos, 'video')} to do</span>
        <span className="ml-auto text-neutral-600">
          Remaining <span className="font-semibold text-neutral-900 tabular-nums">{editor.totalScripts.toLocaleString()}</span>
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content className="space-y-2 border-t border-neutral-200 bg-neutral-50/60 p-3">
        {editor.products.map((product) => (
          <section key={product.productId} className="overflow-hidden rounded-md border border-neutral-200 bg-white">
            <header className="flex items-center gap-3 border-b border-neutral-200 px-3 py-2 text-sm">
              <span className="font-medium">{product.productName}</span>
              <span className="ml-auto text-neutral-600 tabular-nums">{plural(product.scripts.length, 'script')}</span>
            </header>
            <ul className="divide-y divide-neutral-100 text-sm">
              {product.scripts.map((script) => (
                <li key={script.scriptId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5">
                  <span className="min-w-0 flex-1 wrap-break-word">{script.scriptName}</span>
                  <span className="text-neutral-600 tabular-nums">{plural(script.todoVideos, 'video')} to do</span>
                  {script.oldestTodo && <span className="text-xs text-neutral-500">since {since(script.oldestTodo)}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
