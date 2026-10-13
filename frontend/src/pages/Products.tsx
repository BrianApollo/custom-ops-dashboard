import { Plus, Rocket, X } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../auth'
import { AddCampaignDialog } from '../components/AddCampaignDialog'
import { CreateProductDialog } from '../components/CreateProductDialog'
import type { Column } from '../components/DataTable'
import { ProductPicker } from '../components/ProductPicker'
import { RecordList } from '../components/RecordList'
import { button, StatusBadge, Tip } from '../components/ui'
import { useWorkspace } from '../data'
import { AdvertorialsTab } from './AdvertorialsTab'
import { ImagesTab } from './ImagesTab'
import { ScriptsTab } from './ScriptsTab'
import { SetupTab } from './SetupTab'
import { VideosTab } from './VideosTab'
import { text, type ApiRecord } from '../lib/api'

// The API leaves out any count the role may not see
const STATS = [
  { key: 'unassignedScripts', label: 'Scripts', hint: 'Unassigned' },
  { key: 'availableVideos', label: 'Videos', hint: 'Available' },
  { key: 'availableImages', label: 'Images', hint: 'Available' },
  { key: 'activeCampaigns', label: 'Campaigns', hint: 'Active' },
]

const TABS = [
  { value: 'campaigns', label: 'Campaigns' },
  { value: 'scripts', label: 'Scripts' },
  { value: 'videos', label: 'Videos' },
  { value: 'images', label: 'Images' },
  { value: 'advertorials', label: 'Advertorials' },
  { value: 'setup', label: 'Setup' },
]

const linked = (record: ApiRecord, field: string) => (record.fields[field] as string[] | undefined) ?? []

const status = (record: ApiRecord) => text(record, 'Status') || 'No status'

export function Products() {
  const { user } = useAuth()
  const { products, counts, reload } = useWorkspace()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const [addingCampaign, setAddingCampaign] = useState(false)

  const product = products.find((p) => p.id === params.get('product'))
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab')! : 'campaigns'
  const productName = (record: ApiRecord) => products.find((p) => p.id === linked(record, 'Product')[0])?.name ?? ''

  // the product and tab live in the URL, so a view can be reloaded or shared
  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next)
  }

  const productColumn: Column<ApiRecord>[] = product ? [] : [{ header: 'Product', cell: productName }]
  const stats = STATS.filter((stat) => stat.key in counts.total)
  const content = 'pt-4 outline-none'

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          <ProductPicker
            products={products}
            selected={product}
            onSelect={(id) => update({ product: id })}
            onCreate={user?.role === 'admin' ? () => setCreating(true) : undefined}
          />
          {product && (
            <Tip label="Show all products">
              <button aria-label="Show all products" onClick={() => update({ product: null })} className={button.icon}>
                <X className="size-4" />
              </button>
            </Tip>
          )}
        </div>
        <dl className="flex flex-wrap gap-2">
          {stats.map((stat) => (
            <div key={stat.key} className="flex items-center gap-3 rounded-md border border-neutral-200 bg-white px-3 py-1.5">
              <dt className="text-xs leading-tight">
                <span className="block font-medium text-neutral-800">{stat.label}</span>
                <span className="block text-neutral-500">{stat.hint}</span>
              </dt>
              <dd className="text-base font-semibold tabular-nums">
                {((product ? counts.byProduct[product.id]?.[stat.key] : counts.total[stat.key]) ?? 0).toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <Tabs.Root value={tab} onValueChange={(value) => update({ tab: value === 'campaigns' ? null : value })} className="mt-6">
        <Tabs.List aria-label="Product sections" className="flex gap-1 overflow-x-auto border-b border-neutral-200">
          {TABS.map((t) => (
            <Tabs.Trigger
              key={t.value}
              value={t.value}
              className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-700 data-[state=active]:border-blue-700 data-[state=active]:text-blue-800"
            >
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="campaigns" className={content}>
          <RecordList
            table="campaigns"
            noun={['campaign', 'campaigns']}
            name={(record) => text(record, 'Name') || 'Untitled'}
            fields={['Name', 'Product', 'Status', 'Platform']}
            product={product}
            statusOf={status}
            statuses={['Preparing', 'Launched', 'Cancelled']}
            defaultStatus="Launched"
            toolbar={
              user?.role === 'admin' && (
                <Tip label={product ? 'Create a campaign for this product' : 'Select a product first'}>
                  {/* a disabled button fires no pointer events, so the span carries the tooltip */}
                  <span tabIndex={product ? undefined : 0}>
                    <button disabled={!product} onClick={() => setAddingCampaign(true)} className={button.primary}>
                      <Plus className="size-4" />
                      Add Campaign
                    </button>
                  </span>
                </Tip>
              )
            }
            rowActions={(record) => (
              <>
                {user?.role === 'admin' && text(record, 'Status') === 'Preparing' && (
                  <Link to={`/campaigns/${record.id}/launch`} className={`${button.secondary} mr-1`}>
                    <Rocket className="size-4" />
                    Open launcher
                  </Link>
                )}
                <Link to={`/campaigns/${record.id}`} className={button.secondary}>
                  View
                </Link>
              </>
            )}
            columns={[
              { header: 'Campaign', cell: (record) => text(record, 'Name') || 'Untitled' },
              ...productColumn,
              { header: 'Platform', cell: (record) => text(record, 'Platform') },
              { header: 'Status', cell: (record) => <StatusBadge status={text(record, 'Status')} /> },
            ]}
          />
        </Tabs.Content>

        <Tabs.Content value="scripts" className={content}>
          <ScriptsTab product={product} productColumn={productColumn} />
        </Tabs.Content>

        <Tabs.Content value="videos" className={content}>
          <VideosTab product={product} productColumn={productColumn} />
        </Tabs.Content>

        <Tabs.Content value="images" className={content}>
          <ImagesTab product={product} />
        </Tabs.Content>

        <Tabs.Content value="advertorials" className={content}>
          <AdvertorialsTab product={product} productColumn={productColumn} />
        </Tabs.Content>

        <Tabs.Content value="setup" className={content}>
          <SetupTab product={product} />
        </Tabs.Content>
      </Tabs.Root>

      {addingCampaign && product && (
        <AddCampaignDialog
          product={product}
          onClose={() => setAddingCampaign(false)}
          onCreated={(id) => navigate(`/campaigns/${id}/launch`)}
        />
      )}

      <CreateProductDialog
        open={creating}
        onOpenChange={setCreating}
        statuses={[...new Set(products.map((p) => p.status).filter(Boolean))].sort(
          (a, b) => Number(b === 'Active') - Number(a === 'Active') || a.localeCompare(b),
        )}
        onCreated={async (id) => {
          await reload()
          setCreating(false)
          update({ product: id })
        }}
      />
    </>
  )
}
