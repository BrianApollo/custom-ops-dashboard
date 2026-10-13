import { ArrowLeft, CircleAlert, CircleCheck, CircleDashed, ExternalLink, RefreshCw, Rocket } from 'lucide-react'
import { Link } from 'react-router'
import { DataTable, type Column } from '../../components/DataTable'
import { button, Tip } from '../../components/ui'
import { adsManagerUrl, onFacebook, retryLaunch, retryRecord, stopLaunch, type ItemState, type LaunchItem, type LaunchRun, type Step, type StepState } from './launch'

interface Props {
  run: LaunchRun
  // where the campaign list for this product is
  campaignsPath: string
  // back to the form, offered when the campaign did not launch
  onBack: () => void
}

const STEPS: { step: Step; label: string }[] = [
  { step: 'library', label: 'Library check' },
  { step: 'upload', label: 'Video upload' },
  { step: 'campaign', label: 'Campaign' },
  { step: 'adSet', label: 'Ad set' },
  { step: 'ads', label: 'Ads' },
]

const STEP_WORD: Record<StepState, string> = { pending: 'Not started', active: 'In progress', done: 'Done', error: 'Failed', skipped: 'Not needed' }

const ITEM: Record<ItemState, { label: string; tone: string }> = {
  queued: { label: 'Waiting to upload', tone: 'bg-neutral-100 text-neutral-700 ring-neutral-500/20' },
  uploading: { label: 'Uploading', tone: 'bg-blue-50 text-blue-800 ring-blue-600/20' },
  processing: { label: 'Processing on Facebook', tone: 'bg-amber-50 text-amber-800 ring-amber-600/20' },
  ready: { label: 'Ready for its ad', tone: 'bg-blue-50 text-blue-800 ring-blue-600/20' },
  creating: { label: 'Creating ad', tone: 'bg-blue-50 text-blue-800 ring-blue-600/20' },
  done: { label: 'Ad created', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20' },
  failed: { label: 'Failed', tone: 'bg-red-50 text-red-800 ring-red-600/20' },
}

// finished first, then by how far along, so what needs attention is not buried
const ORDER: ItemState[] = ['failed', 'creating', 'ready', 'processing', 'uploading', 'queued', 'done']

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <CircleCheck className="size-5 text-emerald-600" />
  if (state === 'error') return <CircleAlert className="size-5 text-red-600" />
  if (state === 'active') return <RefreshCw className="size-5 animate-spin text-blue-700" />
  return <CircleDashed className="size-5 text-neutral-400" />
}

const COLUMNS: Column<LaunchItem>[] = [
  {
    header: 'Creative',
    cell: (item) => (
      <span className="block max-w-80 truncate" title={item.name}>
        {item.name}
      </span>
    ),
  },
  { header: 'Type', cell: (item) => (item.kind === 'image' ? 'Image' : item.kind === 'ai' ? 'AI video' : 'Video') },
  {
    header: 'Outcome',
    cell: (item) => (
      <div className="min-w-48">
        <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${ITEM[item.state].tone}`}>
          {ITEM[item.state].label}
        </span>
        {/* an error on an item still in progress is the reason it is being tried again */}
        {item.error && (
          <p className={`mt-1 text-xs break-words whitespace-normal ${item.state === 'failed' ? 'text-red-700' : 'text-neutral-500'}`}>
            {item.state === 'failed' ? item.error : `Trying again after: ${item.error}`}
          </p>
        )}
      </div>
    ),
  },
  { header: 'Facebook video', cell: (item) => <span className="font-mono text-xs">{item.fbVideoId ?? (item.kind === 'image' ? '' : '—')}</span> },
  { header: 'Ad', cell: (item) => <span className="font-mono text-xs">{item.adId ?? '—'}</span> },
]

const retryColumn = (campaignId: string): Column<LaunchItem> => ({
  header: 'Actions',
  align: 'right',
  cell: (item) =>
    item.state === 'failed' && (
      <Tip label="Checks Facebook for this ad first, then tries again in the same campaign">
        <button
          type="button"
          aria-label={`Retry ${item.name}`}
          onClick={() => retryLaunch(campaignId, item.id)}
          className={`${button.secondary} -my-1 h-8`}
        >
          <RefreshCw className="size-4" />
          Retry
        </button>
      </Tip>
    ),
})

// A launch as it happens and once it is over: each step, each ad, and what now exists on Facebook
export function LaunchProgress({ run, campaignsPath, onBack }: Props) {
  const { plan, items, steps, record } = run
  const over = run.phase === 'finished'
  const count = (state: ItemState) => items.filter((item) => item.state === state).length
  const done = count('done')
  const failed = count('failed')
  const videos = items.filter((item) => item.kind !== 'image')
  const inLibrary = videos.filter((item) => item.fbVideoId).length

  const detail: Record<Step, string> = {
    library: STEP_WORD[steps.library],
    upload: videos.length ? `${inLibrary} of ${videos.length} in the library` : STEP_WORD.skipped,
    campaign: run.fbCampaignId ?? STEP_WORD[steps.campaign],
    adSet: run.fbAdSetId ?? STEP_WORD[steps.adSet],
    ads: `${done} of ${items.length} created`,
  }

  let outcome = { tone: 'border-red-200 bg-red-50 text-red-900', text: 'Nothing was created on Facebook. The campaign is still Preparing.' }
  if (done === items.length) outcome = { tone: 'border-emerald-200 bg-emerald-50 text-emerald-900', text: `All ${done} ads were created.` }
  else if (done > 0) outcome = { tone: 'border-amber-200 bg-amber-50 text-amber-900', text: `${done} of ${items.length} ads were created; ${failed} failed.` }
  else if (run.fbCampaignId) {
    outcome = {
      tone: 'border-red-200 bg-red-50 text-red-900',
      text: 'A campaign was created on Facebook but it has no ads, so this campaign is not marked Launched.',
    }
  }

  const rows = [...items].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.name.localeCompare(b.name))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Tip label="Back to campaigns">
          <Link to={campaignsPath} aria-label="Back to campaigns" className={button.icon}>
            <ArrowLeft className="size-4" />
          </Link>
        </Tip>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-xl font-semibold tracking-tight">
            <Rocket className="size-5 shrink-0 text-blue-700" />
            {plan.name}
          </h1>
          <p className="text-sm text-neutral-600">
            {over ? 'The launch has ended.' : run.phase === 'stopping' ? 'Stopping after the call in progress…' : 'Launching.'} {plan.adAccount.name} ·{' '}
            {plan.budget.toFixed(2)} {plan.adAccount.currency} per day
          </p>
        </div>
        {!over && (
          <Tip label="Lets the call in progress finish, creates nothing more, and records what exists">
            <button type="button" disabled={run.phase === 'stopping'} onClick={() => stopLaunch(plan.campaignId)} className={button.secondary}>
              {run.phase === 'stopping' ? 'Stopping…' : 'Stop'}
            </button>
          </Tip>
        )}
      </div>

      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {STEPS.map(({ step, label }) => (
          <li key={step} className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-3">
            <StepIcon state={steps[step]} />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {label} <span className="sr-only">({STEP_WORD[steps[step]]})</span>
              </p>
              <p className="truncate text-xs text-neutral-600" title={detail[step]}>
                {detail[step]}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {!over && (
        <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p className="font-medium">{run.activity || 'Working…'}</p>
          <p className="mt-1 text-blue-800">
            Keep this browser tab open until the launch ends. You can use other pages of the dashboard in the meantime; videos can take several minutes to
            process, and the launch waits for them.
          </p>
        </div>
      )}

      {over && (
        <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${outcome.tone}`}>
          <p className="font-semibold">{outcome.text}</p>
          {run.error && <p className="mt-1">{run.error}</p>}
          <p className="mt-3 font-medium">On Facebook now:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {onFacebook(run).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {run.fbCampaignId && (
            <p className="mt-3">
              {record.state === 'saving' && 'Writing this to the campaign record…'}
              {record.state === 'saved' &&
                (record.launched
                  ? 'Recorded on the campaign, which is now Launched. The creatives with an ad are marked Used.'
                  : 'The Facebook ids are noted on the campaign, which stays Preparing.')}
              {record.state === 'failed' && (
                <span className="font-medium text-red-800">
                  This could not be written to the campaign record ({record.error}). Keep the ids above until it has been.{' '}
                  <button type="button" onClick={() => retryRecord(plan.campaignId)} className="underline">
                    Try again
                  </button>
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {over && (
        <div className="flex flex-wrap gap-2">
          {record.launched && (
            <Link to={`/campaigns/${plan.campaignId}`} className={button.primary}>
              View campaign
            </Link>
          )}
          {run.fbCampaignId && (
            <a href={adsManagerUrl(run)} target="_blank" rel="noreferrer" className={button.secondary}>
              <ExternalLink className="size-4" />
              Open in Ads Manager
            </a>
          )}
          {run.fbCampaignId && failed > 0 && (
            <Tip label="Looks on Facebook for what already exists, then tries only what is missing, in the same campaign">
              <button type="button" onClick={() => retryLaunch(plan.campaignId)} className={button.secondary}>
                <RefreshCw className="size-4" />
                Retry {failed} failed
              </button>
            </Tip>
          )}
          {!record.launched && record.state !== 'saving' && (
            <button type="button" onClick={onBack} className={button.secondary}>
              Back to the launcher
            </button>
          )}
          <Link to={campaignsPath} className={button.secondary}>
            Back to campaigns
          </Link>
        </div>
      )}

      <DataTable
        // once the launch is over and the campaign and ad set exist, a failed ad can be sent again on its own
        columns={over && run.fbCampaignId && run.fbAdSetId && failed > 0 ? [...COLUMNS, retryColumn(plan.campaignId)] : COLUMNS}
        rows={rows}
        rowKey={(item) => item.id}
        empty="No creatives in this launch."
      />
    </div>
  )
}
