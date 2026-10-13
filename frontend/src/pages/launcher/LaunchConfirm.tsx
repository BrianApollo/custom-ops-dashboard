import { TriangleAlert } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { button } from '../../components/ui'
import { countryLabel } from './draft'
import type { LaunchPlan } from './launch'

interface Props {
  plan: LaunchPlan
  // reasons the launch cannot go ahead; the Launch button stays off while there are any
  blockers: string[]
  // a Facebook campaign an earlier attempt left on this record
  existing?: string
  onClose: () => void
  // saves the draft and starts the launch; resolves to a message when it could not start
  onConfirm: () => Promise<string | undefined>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-2">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

const plural = (n: number, noun: string) => `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`

// The last look before real money is committed: where, how much, when and how many
export function LaunchConfirm({ plan, blockers, existing, onClose, onConfirm }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const videos = plan.media.filter((item) => item.kind !== 'image').length
  const images = plan.media.length - videos
  const [date, time] = plan.start.split('T')
  const startsAt = new Date(plan.startTime * 1000)
  const passed = startsAt.getTime() <= Date.now()
  const active = plan.status === 'ACTIVE'

  async function confirm() {
    setBusy(true)
    setError(undefined)
    const problem = await onConfirm()
    if (problem) {
      setError(problem)
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Launch “{plan.name}”?</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600">
            This creates a campaign, an ad set and {plural(plan.media.length, 'ad')} on a live ad account.
          </Dialog.Description>

          <dl className="mt-4 divide-y divide-neutral-100 text-sm">
            <Row label="Ad account">
              <span className="font-medium">{plan.adAccount.name}</span> <span className="text-neutral-500">({plan.adAccount.id})</span>
            </Row>
            <Row label="Budget">
              <span className="font-medium">
                {plan.budget.toFixed(2)} {plan.adAccount.currency}
              </span>{' '}
              per day, on the campaign
            </Row>
            <Row label="Start time">
              <span className="font-medium">
                {date} {time}
              </span>{' '}
              in the ad account's time zone, {plan.adAccount.timezoneName}
              <span className="block text-neutral-500">
                {passed ? 'That time has passed, so delivery can begin at once.' : `${startsAt.toLocaleString()} on this computer's clock.`}
              </span>
            </Row>
            <Row label="Ads">
              <span className="font-medium">{plural(plan.media.length, 'ad')}</span>, one per creative ({plural(videos, 'video')}, {plural(images, 'image')})
            </Row>
            <Row label="Status">
              {active ? (
                <>
                  <span className="font-medium">Active.</span> The ads spend from the start time without further action.
                </>
              ) : (
                <>
                  <span className="font-medium">Paused.</span> Nothing spends until the campaign is switched on.
                </>
              )}
            </Row>
            <Row label="Countries">{plan.countries.map(countryLabel).join(', ')}</Row>
            <Row label="Page">
              {plan.page.name} <span className="text-neutral-500">({plan.page.id})</span>
            </Row>
            <Row label="Pixel">
              {plan.pixel.name} <span className="text-neutral-500">({plan.pixel.id})</span>
            </Row>
            <Row label="Website URL">
              <span className="break-all">{plan.websiteUrl}</span>
            </Row>
            <Row label="Token">
              {plan.token.kind === 'bm' ? 'System user of ' : 'Profile '}
              {plan.token.name}
            </Row>
          </dl>

          {existing && (
            <p className="mt-4 flex gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                An earlier attempt already created Facebook campaign {existing} for this record. Launching makes another one; pause or delete the earlier
                campaign in Ads Manager if it should not run.
              </span>
            </p>
          )}
          {blockers.map((blocker) => (
            <p key={blocker} role="alert" className="mt-4 flex gap-2 rounded-md bg-red-50 p-3 text-sm text-red-800">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {blocker}
            </p>
          ))}
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={onClose} className={button.secondary}>
              Cancel
            </button>
            <button type="button" disabled={busy || blockers.length > 0} onClick={() => void confirm()} className={button.primary}>
              {busy ? 'Starting…' : `Launch ${plural(plan.media.length, 'ad')}`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
