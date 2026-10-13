import { Check, Clapperboard, CloudUpload, FolderSearch, Image, RefreshCw, Search, Shuffle } from 'lucide-react'
import { Checkbox, DropdownMenu, Tabs } from 'radix-ui'
import { useState } from 'react'
import { checkbox } from '../../components/DataTable'
import { button, Select, StatusBadge, Tip } from '../../components/ui'
import type { Creative, Draft } from './draft'
import { useLibrary, type LibraryEntry } from './useLibrary'

const FILTERS = ['Not used', 'Used', 'All']
const RANDOM_SIZES = [10, 15, 20, 25, 30, 50]

type Kind = 'videos' | 'images'

interface View {
  search: string
  filter: string
}

interface Props {
  draft: Draft
  onChange: (changes: Partial<Draft>) => void
  // undefined while loading
  videos?: Creative[]
  images?: Creative[]
  error?: string
  // whose Facebook token to use, '' until one is chosen
  cred: string
}

const LIBRARY: Record<LibraryEntry['state'], { label: string; tone: string }> = {
  ready: { label: 'In library', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20' },
  processing: { label: 'Processing', tone: 'bg-amber-50 text-amber-800 ring-amber-600/20' },
  uploading: { label: 'Uploading', tone: 'bg-blue-50 text-blue-800 ring-blue-600/20' },
  missing: { label: 'Not in library', tone: 'bg-neutral-100 text-neutral-700 ring-neutral-500/20' },
  failed: { label: 'Upload failed', tone: 'bg-red-50 text-red-800 ring-red-600/20' },
}

// Where a video stands in the ad account's library, once it has been checked
function LibraryChip({ entry }: { entry: LibraryEntry }) {
  const { label, tone } = LIBRARY[entry.state]
  const chip = (
    <span tabIndex={entry.error ? 0 : undefined} className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${tone}`}>
      {label}
    </span>
  )
  return entry.error ? <Tip label={entry.error}>{chip}</Tip> : chip
}

// What the search and the Not used / Used / All filter leave
function matching(items: Creative[] | undefined, view: View) {
  const term = view.search.trim().toLowerCase()
  return (items ?? []).filter(
    (item) => item.name.toLowerCase().includes(term) && (view.filter === 'All' || (view.filter === 'Used') === (item.status === 'Used')),
  )
}

interface ListProps {
  items?: Creative[]
  chosen: Set<string>
  onChosen: (ids: Set<string>) => void
  noun: string
  view: View
  onView: (view: View) => void
  // by video name; only videos have one
  library?: Map<string, LibraryEntry>
}

function CreativeList({ items, chosen, onChosen, noun, view, onView, library }: ListProps) {
  const matches = new Set(matching(items, view).map((item) => item.id))
  const term = view.search.trim().toLowerCase()
  // a ticked item stays in sight when the filter would hide it, so nothing is chosen unseen
  const shown = (items ?? []).filter((item) => matches.has(item.id) || (chosen.has(item.id) && item.name.toLowerCase().includes(term)))
  const shownChosen = shown.filter((item) => chosen.has(item.id)).length

  function set(ids: string[], on: boolean) {
    const next = new Set(chosen)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    onChosen(next)
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            aria-label={`Search ${noun}`}
            placeholder={`Search ${noun}…`}
            value={view.search}
            onChange={(e) => onView({ ...view, search: e.target.value })}
            className="block h-8 w-full rounded-md border border-neutral-300 bg-white pr-2 pl-8 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
          />
        </div>
        <Select label={`Show ${noun}`} value={view.filter} options={FILTERS} onValueChange={(filter) => onView({ ...view, filter })} />
      </div>

      {shown.length > 0 && (
        <label className="flex items-center gap-3 border-b border-neutral-200 px-4 py-2 text-sm text-neutral-600">
          <Checkbox.Root
            checked={shownChosen === 0 ? false : shownChosen === shown.length ? true : 'indeterminate'}
            onCheckedChange={(on) => set(shown.map((item) => item.id), on === true)}
            className={checkbox}
          >
            <Checkbox.Indicator>
              <Check className="size-3" />
            </Checkbox.Indicator>
          </Checkbox.Root>
          {shownChosen ? `${shownChosen} of ${shown.length} selected` : `Select all ${shown.length}`}
        </label>
      )}

      <ul className="min-h-0 flex-1 divide-y divide-neutral-100 overflow-y-auto">
        {shown.map((item) => (
          <li key={item.id}>
            <label className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm ${chosen.has(item.id) ? 'bg-blue-50/60' : 'hover:bg-neutral-50'}`}>
              <Checkbox.Root checked={chosen.has(item.id)} onCheckedChange={(on) => set([item.id], on === true)} className={`${checkbox} shrink-0`}>
                <Checkbox.Indicator>
                  <Check className="size-3" />
                </Checkbox.Indicator>
              </Checkbox.Root>
              <span className="min-w-0 flex-1 truncate" title={item.name}>
                {item.name}
              </span>
              {library?.has(item.name) && <LibraryChip entry={library.get(item.name)!} />}
              <StatusBadge status={item.status} />
            </label>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-neutral-500">
            {!items ? 'Loading…' : items.length === 0 ? `This product has no ${noun} yet.` : `No ${noun} match.`}
          </li>
        )}
      </ul>
    </>
  )
}

// Left panel: the product's videos and images, ticked to go into the campaign
export function MediaPanel({ draft, onChange, videos, images, error, cred }: Props) {
  const [tab, setTab] = useState<Kind>('videos')
  const [views, setViews] = useState<Record<Kind, View>>({
    videos: { search: '', filter: FILTERS[0] },
    images: { search: '', filter: FILTERS[0] },
  })
  const library = useLibrary(cred, draft.adAccountId)

  // The library buttons act on the ticked videos, or on every video shown when none is ticked
  const tickedVideos = (videos ?? []).filter((video) => draft.videoIds.has(video.id))
  const inScope = tickedVideos.length ? tickedVideos : matching(videos, views.videos)
  const scopeChecked = inScope.some((video) => library.entries.has(video.name))
  // only what a check found missing is uploaded, so a video already there is never sent twice
  const toUpload = inScope.filter((video) => video.url && library.entries.get(video.name)?.state === 'missing')
  const some = tickedVideos.length ? 'ticked ' : ''

  let checkTip = `Check which of the ${inScope.length.toLocaleString()} ${some}videos are already in the ad account's video library`
  let uploadTip = `Upload ${toUpload.length.toLocaleString()} ${some}video${toUpload.length === 1 ? '' : 's'} missing from the library, ahead of the launch`
  if (!library.ready) checkTip = uploadTip = 'Choose a Facebook token and an ad account first'
  else if (!scopeChecked) uploadTip = 'Check the library first, so nothing is uploaded twice'
  else if (!toUpload.length) uploadTip = `No ${some}video is known to be missing from the library`

  const lists = {
    videos: { items: videos, chosen: draft.videoIds, choose: (videoIds: Set<string>) => onChange({ videoIds }) },
    images: { items: images, chosen: draft.imageIds, choose: (imageIds: Set<string>) => onChange({ imageIds }) },
  }
  const pool = matching(lists[tab].items, views[tab])

  // Replaces the tab's selection with `size` items drawn at random from what the search and filter show
  function pickRandom(size: number) {
    const ids = pool.map((item) => item.id)
    // Fisher-Yates, stopping once the first `size` places are settled
    for (let i = 0; i < Math.min(size, ids.length); i++) {
      const j = i + Math.floor(Math.random() * (ids.length - i))
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
    }
    lists[tab].choose(new Set(ids.slice(0, size)))
  }

  const trigger =
    'inline-flex items-center gap-1.5 border-b-2 border-transparent px-2 py-2.5 text-sm font-medium whitespace-nowrap text-neutral-600 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-700 data-[state=active]:border-blue-700 data-[state=active]:text-blue-800'
  const count = (chosen: number, all?: Creative[]) => (chosen ? `${chosen}/${all?.length ?? '…'}` : (all?.length ?? '…'))
  const list = (kind: Kind) => (
    <Tabs.Content value={kind} className="flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden">
      <CreativeList
        items={lists[kind].items}
        chosen={lists[kind].chosen}
        onChosen={lists[kind].choose}
        noun={kind}
        view={views[kind]}
        onView={(view) => setViews({ ...views, [kind]: view })}
        library={kind === 'videos' ? library.entries : undefined}
      />
    </Tabs.Content>
  )

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(value) => setTab(value as Kind)}
      className="flex min-h-0 flex-col rounded-lg border border-neutral-200 bg-white xl:h-[calc(100vh-9rem)]"
    >
      <div className="flex flex-wrap items-center gap-x-3 border-b border-neutral-200 px-4">
        <h2 className="text-sm font-semibold">Media sources</h2>
        <div className="flex items-center">
          <DropdownMenu.Root>
            <Tip label={`Select ${tab} at random`}>
              <DropdownMenu.Trigger disabled={pool.length === 0} aria-label={`Select ${tab} at random`} className={button.icon}>
                <Shuffle className="size-4" />
              </DropdownMenu.Trigger>
            </Tip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={4}
                className="z-50 min-w-36 rounded-md border border-neutral-200 bg-white p-1 text-sm shadow-lg"
              >
                <DropdownMenu.Label className="px-2 py-1.5 text-xs text-neutral-500">
                  From the {pool.length.toLocaleString()} {tab} shown
                </DropdownMenu.Label>
                {RANDOM_SIZES.map((size) => (
                  <DropdownMenu.Item
                    key={size}
                    // asking for more than there are would just select everything
                    disabled={size > pool.length}
                    onSelect={() => pickRandom(size)}
                    className="cursor-default rounded px-2 py-1.5 outline-none data-disabled:text-neutral-400 data-highlighted:bg-neutral-100"
                  >
                    Select {size}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {tab === 'videos' && (
            <>
              <Tip label={checkTip}>
                {/* a disabled button fires no pointer events, so the span carries the tooltip */}
                <span tabIndex={library.ready ? undefined : 0}>
                  <button
                    type="button"
                    aria-label="Check Facebook video library"
                    disabled={!library.ready || Boolean(library.busy) || inScope.length === 0}
                    onClick={() => void library.check(inScope.map((video) => video.name))}
                    className={button.icon}
                  >
                    {library.busy === 'checking' ? <RefreshCw className="size-4 animate-spin" /> : <FolderSearch className="size-4" />}
                  </button>
                </span>
              </Tip>
              <Tip label={uploadTip}>
                <span tabIndex={toUpload.length ? undefined : 0}>
                  <button
                    type="button"
                    aria-label="Upload videos to the Facebook video library"
                    disabled={!library.ready || Boolean(library.busy) || toUpload.length === 0}
                    onClick={() => void library.upload(toUpload.map((video) => ({ name: video.name, url: video.url })))}
                    className={button.icon}
                  >
                    {library.busy === 'uploading' ? <RefreshCw className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
                  </button>
                </span>
              </Tip>
              {library.processing > 0 && (
                <span role="status" className="ml-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800 ring-1 ring-amber-600/20 ring-inset">
                  {library.processing} processing
                </span>
              )}
            </>
          )}
        </div>
        <Tabs.List aria-label="Media type" className="-mb-px ml-auto flex gap-2">
          <Tabs.Trigger value="videos" className={trigger}>
            <Clapperboard className="size-4" />
            Videos ({count(draft.videoIds.size, videos)})
          </Tabs.Trigger>
          <Tabs.Trigger value="images" className={trigger}>
            <Image className="size-4" />
            Images ({count(draft.imageIds.size, images)})
          </Tabs.Trigger>
        </Tabs.List>
      </div>

      <label className="flex items-center gap-3 border-b border-neutral-200 px-4 py-2.5 text-sm text-neutral-700">
        <Checkbox.Root
          checked={draft.reuseCreatives}
          onCheckedChange={(on) => onChange({ reuseCreatives: on === true })}
          className={`${checkbox} shrink-0`}
        >
          <Checkbox.Indicator>
            <Check className="size-3" />
          </Checkbox.Indicator>
        </Checkbox.Root>
        Use existing creatives if already in the ad account
      </label>
      {library.error && (
        <p role="alert" className="border-b border-neutral-200 px-4 py-2 text-xs text-red-700">
          {library.error}
        </p>
      )}

      {error ? (
        <p className="px-4 py-10 text-center text-sm text-red-700">Could not load media: {error}</p>
      ) : (
        <>
          {list('videos')}
          {list('images')}
        </>
      )}
    </Tabs.Root>
  )
}
