import { Minus, Plus, RefreshCw } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { useState } from 'react'
import { Link } from 'react-router'
import { DataTable, type Column } from '../components/DataTable'
import { ProductLogo } from '../components/ProductPicker'
import { button, StatusBadge, Tip } from '../components/ui'
import { useFetch, useWorkspace } from '../data'
import { EditorsTab } from './overview/EditorsTab'
import { ScriptsKpiTab } from './overview/ScriptsKpiTab'

// One row of GET /overview/products
interface Row {
  productId: string
  productName: string
  scriptsAssigned: number
  scriptsUnassigned: number
  videosTodo: number
  videosReview: number
  videosAvailable: number
  videosUsed: number
  imagesAvailable: number
  imagesUsed: number
}

type Count = Exclude<keyof Row, 'productId' | 'productName'>

// One column per count, under the heading it belongs to. `more` columns appear with Show More Columns.
const COUNTS: { key: Count; group: string; label: string; more?: boolean }[] = [
  { key: 'scriptsUnassigned', group: 'Scripts', label: 'Unassigned' },
  { key: 'scriptsAssigned', group: 'Scripts', label: 'Assigned', more: true },
  { key: 'videosTodo', group: 'Videos', label: 'To do', more: true },
  { key: 'videosReview', group: 'Videos', label: 'Review', more: true },
  { key: 'videosAvailable', group: 'Videos', label: 'Available' },
  { key: 'videosUsed', group: 'Videos', label: 'Used', more: true },
  { key: 'imagesAvailable', group: 'Images', label: 'Available' },
  { key: 'imagesUsed', group: 'Images', label: 'Used', more: true },
]

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'editors', label: 'Video Editors' },
  { value: 'scripts', label: 'Scripts' },
]

export function Overview() {
  const { products } = useWorkspace()
  const overview = useFetch<{ rows: Row[] }>('/overview/products')
  const [tab, setTab] = useState('overview')
  const [more, setMore] = useState(false)

  const columns: Column<Row>[] = [
    {
      header: 'Product',
      cell: (row) => {
        const product = products.find((p) => p.id === row.productId)
        return (
          <span className="flex items-center gap-2.5">
            <Link to={`/products?product=${row.productId}`} className="inline-flex items-center gap-2.5 hover:text-blue-800 hover:underline">
              <ProductLogo product={product} />
              {row.productName || 'Untitled'}
            </Link>
            {/* Active is the normal case and needs no label */}
            {product && product.status !== 'Active' && <StatusBadge status={product.status} />}
          </span>
        )
      },
    },
    ...COUNTS.filter((count) => more || !count.more).map(
      (count): Column<Row> => ({
        key: count.key,
        group: count.group,
        header: count.label,
        cell: (row) => <span className="tabular-nums">{row[count.key].toLocaleString()}</span>,
      }),
    ),
  ]

  return (
    <Tabs.Root value={tab} onValueChange={setTab}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <Tabs.List aria-label="Overview sections" className="flex gap-1 rounded-lg bg-neutral-200/60 p-1">
          {TABS.map((item) => (
            <Tabs.Trigger
              key={item.value}
              value={item.value}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-700 data-[state=active]:bg-white data-[state=active]:text-blue-800 data-[state=active]:shadow-sm"
            >
              {item.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {/* these two act on the product table only */}
        {tab === 'overview' && (
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setMore(!more)} aria-pressed={more} className={button.secondary}>
              {more ? <Minus className="size-4" /> : <Plus className="size-4" />}
              {more ? 'Show Fewer Columns' : 'Show More Columns'}
            </button>
            <Tip label="Refresh">
              <button onClick={overview.reload} disabled={overview.loading} aria-label="Refresh" className={button.icon}>
                <RefreshCw className={`size-4 ${overview.loading ? 'animate-spin' : ''}`} />
              </button>
            </Tip>
          </div>
        )}
      </div>

      <Tabs.Content value="overview" className="pt-5 outline-none">
        <DataTable
          columns={columns}
          rows={overview.data?.rows ?? []}
          rowKey={(row) => row.productId}
          empty={overview.error ? `Could not load the overview: ${overview.error.message}` : overview.data ? 'No products yet.' : 'Loading…'}
          emptyIsError={Boolean(overview.error)}
        />
      </Tabs.Content>
      <Tabs.Content value="editors" className="pt-5 outline-none">
        <EditorsTab />
      </Tabs.Content>
      <Tabs.Content value="scripts" className="pt-5 outline-none">
        <ScriptsKpiTab />
      </Tabs.Content>
    </Tabs.Root>
  )
}
