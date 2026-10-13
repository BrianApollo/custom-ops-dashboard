import { AlertDialog } from 'radix-ui'
import { useEffect, useRef, type ReactNode } from 'react'
import { ApiError } from '../../lib/api'
import { button } from '../ui'

// Facebook's objects as our API passes them on: Facebook's field names, money in cents as text
export interface FbCampaign {
  id: string
  name: string
  status: string
  daily_budget?: string
  lifetime_budget?: string
  objective?: string
  created_time?: string
}

export interface FbAdSet {
  id: string
  name: string
  status: string
  daily_budget?: string
  lifetime_budget?: string
  optimization_goal?: string
  promoted_object?: { pixel_id?: string }
}

export interface FbAd {
  id: string
  name: string
  adset_id: string
  status: string
  creative?: { id: string; thumbnail_url?: string; actor_id?: string; object_story_spec?: { page_id?: string } }
}

// GET /facebook/campaigns/{id}
export interface FbState {
  campaign: FbCampaign
  adSets: FbAdSet[]
  ads: FbAd[]
}

// GET /videos (kind=script or kind=ai)
export interface VideoRow {
  id: string
  name: string
  format: string | null
  status: string | null
  creativeLink: string | null
}

interface Named {
  id?: string
  name?: string
}

interface SnapshotMedia {
  succeeded?: { localId?: string; name?: string; adId?: string; thumbnailUrl?: string; imageUrl?: string }[]
  failed?: { name?: string; error?: string; failedAt?: string }[]
}

// What a launch stores in `Launched Data`. Older snapshots lack parts of it, so every key is optional.
export interface Snapshot {
  launchedAt?: string
  // rebuilt from Facebook for a campaign launched elsewhere, not written by a launch
  importedFromFacebook?: boolean
  config?: {
    campaignName?: string
    budgetCents?: number
    geo?: string[]
    startDate?: string
    startTime?: string
    websiteUrl?: string
    utms?: string
    ctaOverride?: string
    displayLink?: string
    launchStatus?: string
  }
  facebook?: {
    adAccount?: Named
    page?: Named
    pixel?: Named
    campaign?: Named
    profile?: Named
    systemUser?: { bmName?: string; bmId?: string }
    adSet?: Named
    adIds?: string[]
  }
  adPreset?: { name?: string; primaryTexts?: string[]; headlines?: string[]; descriptions?: string[]; callToAction?: string }
  redtrack?: { campaignId?: string; campaignName?: string }
  media?: { videos?: SnapshotMedia; images?: SnapshotMedia }
  result?: {
    partialSuccess?: boolean
    adsAttempted?: number
    adsCreated?: number
    adsFailed?: number
    errors?: { mediaName?: string; message?: string; stage?: string }[]
  }
}

// null when the campaign has no snapshot or it cannot be read
export function parseSnapshot(stored: unknown): Snapshot | null {
  if (stored && typeof stored === 'object') return stored as Snapshot
  if (typeof stored !== 'string' || !stored.trim()) return null
  try {
    const parsed: unknown = JSON.parse(stored)
    return parsed && typeof parsed === 'object' ? (parsed as Snapshot) : null
  } catch {
    return null
  }
}

export const dollars =(amount: number) => amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })

// ACTIVE -> Active, PENDING_REVIEW -> Pending review
export const title = (status: string) => status.charAt(0) + status.slice(1).toLowerCase().replaceAll('_', ' ')

// The message to show for a failed call. Our API passes Facebook's own wording through.
export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// The request was refused before anything was sent to Facebook, so sending it again in smaller pieces is safe
export const refusedUnsent = (error: unknown) => error instanceof ApiError && (error.status === 400 || error.status === 422)

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size))
}

// false once the component is gone, so a long-running flow stops touching it
export function useAlive() {
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  return alive
}

export const modal = {
  overlay: 'fixed inset-0 z-40 bg-black/40',
  content:
    'fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl',
  header: 'flex items-center justify-between gap-4 border-b border-neutral-200 px-6 py-4',
  footer: 'flex items-center justify-end gap-2 border-t border-neutral-200 px-6 py-4',
}

export const alertBox = 'rounded-md bg-red-50 px-3 py-2 text-sm text-red-800'
export const noteBox = 'rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'

export interface Confirmation {
  title: string
  body: ReactNode
  // the label of the button that goes ahead
  action: string
  // red button, for something that cannot be undone
  danger?: boolean
  run: () => void
}

// The question asked before anything that changes what a live campaign delivers or spends
export function Confirm({ confirmation, onClose }: { confirmation: Confirmation | null; onClose: () => void }) {
  return (
    <AlertDialog.Root open={confirmation !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl">
          <AlertDialog.Title className="text-base font-semibold">{confirmation?.title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-1 text-sm text-neutral-600">{confirmation?.body}</div>
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel className={button.secondary}>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={() => confirmation?.run()}
              className={confirmation?.danger ? `${button.primary} bg-red-700 hover:bg-red-800` : button.primary}
            >
              {confirmation?.action}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
