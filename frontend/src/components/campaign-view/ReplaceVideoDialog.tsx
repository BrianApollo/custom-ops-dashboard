import { Check, X } from 'lucide-react'
import { Checkbox, Dialog, Label } from 'radix-ui'
import { useEffect, useState } from 'react'
import { useAuth } from '../../auth'
import { useFetch } from '../../data'
import { api, ApiError } from '../../lib/api'
import { withCred } from '../../lib/facebook'
import { checkbox } from '../DataTable'
import { button, Combobox, input, Select } from '../ui'
import { alertBox, Confirm, messageOf, modal, noteBox, sleep, useAlive, type Confirmation, type FbAd, type VideoRow } from './shared'

interface Props {
  ad: FbAd
  // with or without `act_`
  adAccountId: string
  cred: string
  productId?: string
  onClose: () => void
  // something on Facebook changed, so the page should read it again
  onChanged: () => void
}

const ALL = '1000'
const POLL_MS = 5000
// what happens to the ad being replaced once the new one exists
const AFTERWARDS = [
  { value: 'pause', label: 'Paused' },
  { value: 'delete', label: 'Deleted' },
  { value: 'keep', label: 'Left as it is' },
]

interface Job {
  status: 'processing' | 'done' | 'failed'
  adId: string | null
  error: string | null
}

interface Run {
  phase: 'form' | 'working' | 'done' | 'failed'
  step: string
  startedAt: number
  // what went wrong, or what could not be finished after the new ad was made
  problems: string[]
  newAdId?: string
}

// Facebook cannot swap the video inside an existing ad. Replacing one means a
// new ad that copies the old ad's text, link and page with the new video in it,
// after which the old ad is paused or deleted. The old dashboard stopped after
// the first half and called it an edit; here both halves happen and are named.
export function ReplaceVideoDialog({ ad, adAccountId, cred, productId, onClose, onChanged }: Props) {
  const { expire } = useAuth()
  const alive = useAlive()
  const [videoId, setVideoId] = useState('')
  const [name, setName] = useState('')
  const [utm, setUtm] = useState('')
  const [afterwards, setAfterwards] = useState('pause')
  // the new ad takes over from a running one; a paused ad's replacement stays paused
  const [start, setStart] = useState(ad.status === 'ACTIVE')
  const [confirming, setConfirming] = useState<Confirmation | null>(null)
  const [run, setRun] = useState<Run>({ phase: 'form', step: '', startedAt: 0, problems: [] })
  const [now, setNow] = useState(0)

  const byProduct = productId ? new URLSearchParams({ productId, limit: ALL, sort: 'name' }) : null
  const videos = useFetch<{ records: VideoRow[] }>(byProduct && `/videos?${byProduct}`)
  const aiVideos = useFetch<{ records: VideoRow[] }>(byProduct && `/videos?kind=ai&${byProduct}`)
  // only a finished file in our storage can be handed to Facebook
  const usable = [...(videos.data?.records ?? []), ...(aiVideos.data?.records ?? [])].filter(
    (video) => video.creativeLink && !/youtube/i.test(video.format ?? ''),
  )
  const video = usable.find((candidate) => candidate.id === videoId)
  const loadError = videos.error ?? aiVideos.error
  const working = run.phase === 'working'

  // the clock beside the progress message
  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [working])

  const elapsed = Math.max(0, Math.floor((now - run.startedAt) / 1000))
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`

  async function replace() {
    if (!video?.creativeLink || !ad.creative) return
    const step = (message: string) => alive.current && setRun((current) => ({ ...current, step: message }))
    const problems: string[] = []
    let newAdId: string | undefined
    setNow(Date.now())
    setRun({ phase: 'working', step: 'Sending the video to Facebook…', startedAt: Date.now(), problems: [] })

    try {
      const { jobId } = await api<{ jobId: string }>('/facebook/ads/replace-video', {
        method: 'POST',
        body: {
          cred,
          adAccountId,
          adSetId: ad.adset_id,
          templateCreativeId: ad.creative.id,
          videoUrl: video.creativeLink,
          name: name.trim(),
          utm: utm.trim() || undefined,
        },
      })

      // each check also moves the job on, so it only advances while this window is open
      step('Facebook is processing the video…')
      let job: Job = { status: 'processing', adId: null, error: null }
      let misses = 0
      while (job.status === 'processing') {
        await sleep(POLL_MS)
        if (!alive.current) return
        try {
          job = await api<Job>(`/facebook/jobs/${jobId}`)
          misses = 0
        } catch (error) {
          // a single failed check is not the end; three in a row is
          if ((error instanceof ApiError && error.status === 401) || ++misses >= 3) throw error
        }
      }
      if (job.status === 'failed' || !job.adId) throw new Error(job.error ?? 'Facebook did not create the new ad')
      newAdId = job.adId

      // the new ad is made paused; from here each step is reported by itself, because the ad already exists
      if (start) {
        step('Turning the new ad on…')
        await api(`/facebook/ads/${newAdId}`, { method: 'PATCH', body: { cred, status: 'ACTIVE' } }).catch((error: Error) =>
          problems.push(`The new ad could not be turned on and is still paused: ${error.message}`),
        )
      }
      // the old ad keeps running if its replacement is not, so delivery never stops by surprise
      if (start && problems.length) {
        problems.push('The current ad was left as it is.')
      } else if (afterwards === 'pause' && ad.status === 'ACTIVE') {
        step('Pausing the current ad…')
        await api(`/facebook/ads/${ad.id}`, { method: 'PATCH', body: { cred, status: 'PAUSED' } }).catch((error: Error) =>
          problems.push(`The current ad could not be paused: ${error.message}`),
        )
      } else if (afterwards === 'delete') {
        step('Deleting the current ad…')
        await api(withCred(`/facebook/ads/${ad.id}`, cred), { method: 'DELETE' }).catch((error: Error) =>
          problems.push(`The current ad could not be deleted: ${error.message}`),
        )
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return expire()
      problems.push(messageOf(error))
    }
    if (!alive.current) return
    if (newAdId) onChanged()
    setRun((current) => ({ ...current, phase: newAdId ? 'done' : 'failed', step: '', problems, newAdId }))
  }

  const summary = [
    `A new ad named “${name.trim()}” is created in the same ad set with this ad's text, link and page.`,
    start ? 'It is turned on as soon as Facebook has processed the video.' : 'It is created paused.',
    afterwards === 'delete'
      ? 'The current ad is then deleted, which cannot be undone.'
      : afterwards === 'pause'
        ? 'The current ad is then paused.'
        : 'The current ad is not touched.',
  ].join(' ')

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !working && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={modal.overlay} />
        <Dialog.Content aria-describedby={undefined} className={`${modal.content} max-w-lg`}>
          <div className={modal.header}>
            <Dialog.Title className="min-w-0 truncate text-base font-semibold">Replace video: {ad.name}</Dialog.Title>
            <Dialog.Close aria-label="Close" disabled={working} className={button.icon}>
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4 text-sm">
            {working ? (
              <div role="status" className="py-8 text-center">
                <p className="font-medium">
                  {run.step} <span className="font-normal text-neutral-500 tabular-nums">{clock}</span>
                </p>
                <p className="mt-1 text-neutral-500">Keep this window open until it finishes. Facebook can take up to 15 minutes.</p>
              </div>
            ) : run.phase === 'done' ? (
              <div role="status" className="space-y-3">
                <p className="font-medium text-emerald-800">
                  The new ad was created{run.problems.length ? '' : start ? ' and turned on' : ' and is paused'}.
                  <span className="block font-normal text-neutral-600 tabular-nums">Ad ID {run.newAdId}</span>
                </p>
                {run.problems.length > 0 && (
                  <ul className={`${noteBox} space-y-1`}>
                    {run.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <>
                {run.phase === 'failed' && (
                  <p role="alert" className={alertBox}>
                    The video was not replaced: {run.problems.join(' ')}
                  </p>
                )}
                <p className="text-neutral-600">
                  Facebook cannot change the video inside an ad. This makes a new ad with the chosen video that copies this ad's text, link and
                  page, then deals with the current ad as you choose below.
                </p>
                <div>
                  <Label.Root htmlFor="replace-video" className="font-medium">
                    New video
                  </Label.Root>
                  {loadError ? (
                    <p role="alert" className="mt-1.5 text-red-700">
                      Could not load the product's videos: {loadError.message}
                    </p>
                  ) : (
                    <Combobox
                      id="replace-video"
                      value={videoId}
                      options={usable.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
                      placeholder={!productId ? 'This campaign has no product' : videos.data && aiVideos.data ? 'Choose a video' : 'Loading…'}
                      noun="videos"
                      onValueChange={(next) => {
                        setVideoId(next)
                        // the video's own name is how it is found in the ad account's library later
                        setName(usable.find((candidate) => candidate.id === next)?.name ?? '')
                      }}
                      className="mt-1.5 h-9.5"
                    />
                  )}
                </div>
                <div>
                  <Label.Root htmlFor="replace-name" className="font-medium">
                    Name of the new ad
                  </Label.Root>
                  <input id="replace-name" value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1.5`} />
                </div>
                <div>
                  <Label.Root htmlFor="replace-utm" className="font-medium">
                    Tracking parameters <span className="font-normal text-neutral-500">(optional)</span>
                  </Label.Root>
                  <input
                    id="replace-utm"
                    value={utm}
                    onChange={(e) => setUtm(e.target.value)}
                    placeholder="Leave empty to keep this ad's"
                    className={`${input} mt-1.5`}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">Afterwards, the current ad is</span>
                  <Select label="Afterwards, the current ad is" value={afterwards} options={AFTERWARDS} onValueChange={setAfterwards} className="w-40" />
                </div>
                <label className="flex items-center gap-3 text-neutral-700">
                  <Checkbox.Root checked={start} onCheckedChange={(on) => setStart(on === true)} className={`${checkbox} shrink-0`}>
                    <Checkbox.Indicator>
                      <Check className="size-3" />
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                  Turn the new ad on when it is ready (otherwise it stays paused)
                </label>
              </>
            )}
          </div>

          <div className={modal.footer}>
            {run.phase === 'done' ? (
              <button onClick={onClose} className={button.primary}>
                Done
              </button>
            ) : (
              <>
                <button onClick={onClose} disabled={working} className={button.secondary}>
                  Cancel
                </button>
                <button
                  disabled={working || !video || !name.trim()}
                  onClick={() =>
                    setConfirming({
                      title: 'Replace this ad’s video?',
                      body: summary,
                      action: 'Replace video',
                      danger: afterwards === 'delete',
                      run: () => void replace(),
                    })
                  }
                  className={button.primary}
                >
                  {working ? 'Working…' : 'Replace video'}
                </button>
              </>
            )}
          </div>

          <Confirm confirmation={confirming} onClose={() => setConfirming(null)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
