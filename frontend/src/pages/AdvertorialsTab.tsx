import { Check, Eye, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../auth'
import { AdvertorialDialog } from '../components/AdvertorialDialog'
import type { Column } from '../components/DataTable'
import { RecordList } from '../components/RecordList'
import { button, StatusBadge, Tip } from '../components/ui'
import type { Product } from '../data'
import { api, text, type ApiRecord } from '../lib/api'

interface Props {
  product?: Product
  // with every product shown, each row says which product it belongs to
  productColumn: Column<ApiRecord>[]
}

const isApproved = (record: ApiRecord) => Boolean(record.fields['Advertorial Checked'])

function ApproveButton({ record, onDone }: { record: ApiRecord; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function approve() {
    setBusy(true)
    setError(undefined)
    try {
      await api(`/data/advertorials/${record.id}`, { method: 'PATCH', body: { fields: { 'Advertorial Checked': true } } })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Tip label={error ? `Could not approve: ${error}` : 'Mark as approved'}>
      <button
        onClick={approve}
        disabled={busy}
        className={`${button.secondary} mr-1 h-8 ${error ? 'border-red-300 text-red-700' : 'border-emerald-600/40 text-emerald-800 hover:bg-emerald-50'}`}
      >
        <Check className="size-4" />
        {busy ? 'Approving…' : error ? 'Retry' : 'Approve'}
      </button>
    </Tip>
  )
}

export function AdvertorialsTab({ product, productColumn }: Props) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  // the advertorial open in the dialog; no record while adding one
  const [open, setOpen] = useState<{ record?: ApiRecord; editing: boolean } | null>(null)
  // bumped after a save, so the list remounts and refetches
  const [version, setVersion] = useState(0)

  return (
    <>
      <RecordList
        key={version}
        table="advertorials"
        noun={['advertorial', 'advertorials']}
        name={(record) => text(record, 'Advertorial Name') || 'Untitled'}
        fields={['Advertorial Name', 'Product', 'Advertorial Text', 'Final Advertorial Link', 'Advertorial Checked']}
        product={product}
        statusOf={(record) => (isApproved(record) ? 'Approved' : 'Pending')}
        toolbar={
          isAdmin && (
            <Tip label={product ? 'Add an advertorial to this product' : 'Select a product first'}>
              {/* a disabled button fires no pointer events, so the span carries the tooltip */}
              <span tabIndex={product ? undefined : 0}>
                <button disabled={!product} onClick={() => setOpen({ editing: true })} className={button.primary}>
                  <Plus className="size-4" />
                  Add Advertorial
                </button>
              </span>
            </Tip>
          )
        }
        // View is always last, so it lines up down the column; what a pending row adds sits to its left
        rowActions={(record, reload) => (
          <>
            {isAdmin && !isApproved(record) && (
              <>
                <ApproveButton record={record} onDone={reload} />
                <Tip label="Edit">
                  <button aria-label="Edit" onClick={() => setOpen({ record, editing: true })} className={button.icon}>
                    <Pencil className="size-4" />
                  </button>
                </Tip>
              </>
            )}
            <Tip label="View">
              <button aria-label="View" onClick={() => setOpen({ record, editing: false })} className={button.icon}>
                <Eye className="size-4" />
              </button>
            </Tip>
          </>
        )}
        columns={[
          { header: 'Advertorial', cell: (record) => text(record, 'Advertorial Name') || 'Untitled' },
          ...productColumn,
          {
            header: 'Text',
            cell: (record) => <span className="block max-w-xs truncate">{text(record, 'Advertorial Text')}</span>,
          },
          {
            header: 'Final link',
            cell: (record) => {
              const url = text(record, 'Final Advertorial Link')
              return /^https?:\/\//.test(url) ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block max-w-xs truncate text-blue-700 underline-offset-2 hover:underline"
                >
                  {url.replace(/^https?:\/\//, '')}
                </a>
              ) : (
                url
              )
            },
          },
          { header: 'Status', cell: (record) => <StatusBadge status={isApproved(record) ? 'Approved' : 'Pending'} /> },
        ]}
      />

      {open && (
        <AdvertorialDialog
          record={open.record}
          product={product}
          editing={open.editing}
          canEdit={isAdmin && Boolean(open.record) && !isApproved(open.record!)}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null)
            setVersion((v) => v + 1)
          }}
        />
      )}
    </>
  )
}
