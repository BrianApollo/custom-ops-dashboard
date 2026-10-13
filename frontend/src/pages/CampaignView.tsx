import { ArrowLeft, ExternalLink, Plus, RefreshCw, Rocket } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../auth'
import { AddAdsDialog } from '../components/campaign-view/AddAdsDialog'
import { LaunchData } from '../components/campaign-view/LaunchData'
import { LiveState } from '../components/campaign-view/LiveState'
import { MediaUsed } from '../components/campaign-view/MediaUsed'
import { Performance } from '../components/campaign-view/Performance'
import { parseSnapshot, type FbState } from '../components/campaign-view/shared'
import { button, Select, StatusBadge, Tip } from '../components/ui'
import { useFetch, useRecords, useWorkspace } from '../data'
import { text, type ApiRecord } from '../lib/api'
import { profileCred, withCred } from '../lib/facebook'

// the Select cannot hold an empty value, so this stands for the Master Profile
const MASTER = 'master'

const TABS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'performance', label: 'Performance' },
  { value: 'settings', label: 'Settings and launch' },
  { value: 'media', label: 'Media' },
]

function View({ record, reload }: { record: ApiRecord; reload: () => void }) {
  const { products } = useWorkspace()
  const profiles = useRecords('profiles', { fields: 'Profile Name,Profile ID,Hidden' })
  const masters = useRecords('master_profile', { fields: 'Profile Record' })
  // null until the user picks; the profile then applies to this visit only
  const [choice, setChoice] = useState<string | null>(null)
  const [tab, setTab] = useState(TABS[0].value)
  // the ad set Add Ads was opened on
  const [adding, setAdding] = useState<string | null>(null)

  const productId = (record.fields.Product as string[] | undefined)?.[0]
  const product = products.find((p) => p.id === productId)
  const fbCampaignId = text(record, 'FB Campaign ID')
  const adAccountId = text(record, 'FB Ad Account ID') || text(record, 'Ad Acc Used')
  const launchProfileId = text(record, 'Launch Profile ID')
  const bmId = text(record, 'System User BM ID')
  const snapshot = parseSnapshot(record.fields['Launched Data'])
  // Added from the Manage page for a campaign made elsewhere: its snapshot was read from
  // Facebook, or, when Facebook could not be read, a note stands where the snapshot would be
  const launchedElsewhere =
    snapshot?.importedFromFacebook === true || /^This campaign is launched without/.test(text(record, 'Launched Data'))

  // As the page has always chosen: the Master Profile when one is set, else the profile that launched the campaign
  const settled = masters.records !== undefined || masters.error !== undefined
  const selected = choice ?? (settled ? (masters.records?.length || !launchProfileId ? MASTER : launchProfileId) : null)
  const cred = selected === null ? null : selected === MASTER ? '' : selected.startsWith('bm:') ? selected : profileCred(selected)
  const fb = useFetch<FbState>(fbCampaignId && cred !== null ? withCred(`/facebook/campaigns/${fbCampaignId}`, cred) : null)

  const profileNames = new Map((profiles.records ?? []).map((profile) => [profile.id, text(profile, 'Profile Name') || text(profile, 'Profile ID')]))
  const profileOptions = [
    { value: MASTER, label: 'Master profile' },
    ...(profiles.records ?? [])
      .filter((profile) => !profile.fields.Hidden || profile.id === launchProfileId)
      .map((profile) => ({
        value: profile.id,
        label: `${profileNames.get(profile.id) || profile.id}${profile.id === launchProfileId ? ' (launched this)' : ''}`,
      })),
    // a campaign launched as a system user can be read with that system user's token
    ...(bmId ? [{ value: `bm:${bmId}`, label: 'System user of the launch BM' }] : []),
  ]

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <Tip label="Back to campaigns">
        <Link to={productId ? `/products?product=${productId}` : '/products'} aria-label="Back to campaigns" className={button.icon}>
          <ArrowLeft className="size-4" />
        </Link>
      </Tip>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold tracking-tight">{text(record, 'Name') || 'Untitled campaign'}</h1>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-600">
          <StatusBadge status={text(record, 'Status')} />
          {launchedElsewhere && (
            <Tip label="Added from the Manage page. Its settings were read from Facebook, not saved by the launcher.">
              <span
                tabIndex={0}
                className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800 ring-1 ring-amber-600/20 ring-inset"
              >
                Not launched from this dashboard
              </span>
            </Tip>
          )}
          {product ? (
            <Link to={`/products?product=${product.id}`} className="hover:text-blue-800 hover:underline">
              {product.name}
            </Link>
          ) : (
            'No product'
          )}
          {fbCampaignId && (
            <span>
              · Facebook campaign <span className="tabular-nums">{fbCampaignId}</span>
            </span>
          )}
        </p>
      </div>
      {fbCampaignId && (
        <>
          <div className="flex items-center gap-2 text-sm text-neutral-600">
            Profile
            <Select
              label="Profile"
              value={selected ?? ''}
              options={profileOptions}
              placeholder="Loading…"
              disabled={selected === null}
              onValueChange={setChoice}
              className="h-9.5 w-52"
            />
            <Tip label="Refresh from Facebook">
              <button
                aria-label="Refresh"
                onClick={() => {
                  fb.reload()
                  reload()
                }}
                className={button.icon}
              >
                <RefreshCw className="size-4" />
              </button>
            </Tip>
          </div>
          {adAccountId && (
            <a
              href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${adAccountId.replace(/^act_/, '')}&selected_campaign_ids=${fbCampaignId}`}
              target="_blank"
              rel="noreferrer"
              className={button.secondary}
            >
              Ads Manager
              <ExternalLink className="size-4" />
            </a>
          )}
          <Tip label={adAccountId ? 'Add more of the product’s videos and images as ads' : 'No ad account is stored on this campaign'}>
            {/* a disabled button fires no pointer events, so the span carries the tooltip */}
            <span tabIndex={adAccountId ? undefined : 0}>
              <button onClick={() => setAdding('')} disabled={!adAccountId || cred === null} className={button.primary}>
                <Plus className="size-4" />
                Add ads
              </button>
            </span>
          </Tip>
        </>
      )}
    </div>
  )

  const launchData = (
    <LaunchData record={record} snapshot={snapshot} productName={product?.name} profileNames={profileNames} cred={cred ?? ''} onSynced={reload} />
  )

  if (!fbCampaignId) {
    return (
      <>
        {header}
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">
          <p className="flex-1">This campaign has not been launched yet, so there is nothing on Facebook to show.</p>
          <Link to={`/campaigns/${record.id}/launch`} className={button.primary}>
            <Rocket className="size-4" />
            Launch campaign
          </Link>
        </div>
        <div className="mt-4">{launchData}</div>
      </>
    )
  }

  const trigger =
    'border-b-2 border-transparent px-1 py-2.5 text-sm font-medium whitespace-nowrap text-neutral-600 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-700 data-[state=active]:border-blue-700 data-[state=active]:text-blue-800'

  return (
    <>
      {header}
      <Tabs.Root value={tab} onValueChange={setTab} className="mt-5">
        <Tabs.List aria-label="Campaign sections" className="flex gap-5 overflow-x-auto border-b border-neutral-200">
          {TABS.map((item) => (
            <Tabs.Trigger key={item.value} value={item.value} className={trigger}>
              {item.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="facebook" className="mt-5 outline-none">
          {cred === null ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : (
            <LiveState
              record={record}
              fbCampaignId={fbCampaignId}
              adAccountId={adAccountId}
              cred={cred}
              productId={productId}
              fb={fb}
              savedAdAccountName={snapshot?.facebook?.adAccount?.name}
              savedPage={{ id: snapshot?.facebook?.page?.id || text(record, 'Page Used'), name: snapshot?.facebook?.page?.name ?? '' }}
              savedPixel={{ id: snapshot?.facebook?.pixel?.id || text(record, 'Pixel Used'), name: snapshot?.facebook?.pixel?.name ?? '' }}
              onRecordChanged={reload}
              onAddAds={adAccountId ? setAdding : undefined}
            />
          )}
        </Tabs.Content>
        <Tabs.Content value="performance" className="mt-5 outline-none">
          <Performance redtrackId={text(record, 'RedTrack Campaign Id')} />
        </Tabs.Content>
        <Tabs.Content value="settings" className="mt-5 outline-none">
          {launchData}
        </Tabs.Content>
        <Tabs.Content value="media" className="mt-5 outline-none">
          <MediaUsed campaignId={record.id} />
        </Tabs.Content>
      </Tabs.Root>

      {adding !== null && cred !== null && (
        <AddAdsDialog
          fbCampaignId={fbCampaignId}
          fbAdAccountId={adAccountId}
          cred={cred}
          campaignId={record.id}
          adSetId={adding || undefined}
          onClose={() => setAdding(null)}
          onAdded={() => {
            fb.reload()
            reload()
          }}
        />
      )}
    </>
  )
}

export function CampaignView() {
  const { id } = useParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const campaign = useFetch<ApiRecord>(isAdmin && id ? `/data/campaigns/${encodeURIComponent(id)}` : null)

  if (!isAdmin) return <p className="text-sm text-neutral-600">Only admins can view and manage a campaign.</p>
  if (campaign.error) {
    return (
      <>
        <p className="text-sm text-red-700">Could not load this campaign: {campaign.error.message}</p>
        <Link to="/products" className={`${button.secondary} mt-4`}>
          <ArrowLeft className="size-4" />
          Back to products
        </Link>
      </>
    )
  }
  if (!campaign.data) return <p className="text-sm text-neutral-500">Loading…</p>
  // fresh state for each campaign
  return <View key={campaign.data.id} record={campaign.data} reload={campaign.reload} />
}
