import { useFetch } from '../../data'
import { withCred } from '../../lib/facebook'

// The launcher's own Facebook lists. `lib/facebook.ts` reads them for a profile only;
// here the token can also be a business manager's system user, so the lists take a `cred`.
export interface Asset {
  // Facebook's own id, e.g. `act_123` for an ad account
  id: string
  name: string
  // shown after the name in a dropdown, e.g. whether an ad account is active
  state?: string
}

export interface AdAccount extends Asset {
  // the id without `act_`
  accountId: string
  // Facebook's account_status: 1 is active
  accountStatus?: number
  currency?: string
  // the zone Facebook reads the ad set's start time in
  timezoneName?: string
}

export interface AssetList<T> {
  // undefined until loaded
  items?: T[]
  loading: boolean
  error?: string
}

export interface Assets {
  accounts: AssetList<AdAccount>
  pages: AssetList<Asset>
  pixels: AssetList<Asset>
}

// Every ad account is listed, marked Active or Unknown: Facebook has several codes for an
// account that is not active (disabled, unsettled, in review…) and they are not told apart here.
// Active ones come first.
const withState = (accounts: AdAccount[]) =>
  accounts
    .map((account) => ({ ...account, state: account.accountStatus === 1 ? 'Active' : 'Unknown' }))
    .sort((a, b) => Number(b.state === 'Active') - Number(a.state === 'Active'))

// Ad accounts and pages the token reaches, and the chosen ad account's pixels.
// Nothing is asked for until a token is chosen.
export function useAssets(cred: string, adAccountId: string): Assets {
  const accounts = useFetch<{ adAccounts: AdAccount[] }>(cred ? withCred('/facebook/ad-accounts', cred) : null)
  const pages = useFetch<Asset[]>(cred ? withCred('/facebook/pages', cred) : null)
  const pixels = useFetch<Asset[]>(
    cred && /^(act_)?\d+$/.test(adAccountId) ? withCred(`/facebook/ad-accounts/${encodeURIComponent(adAccountId)}/pixels`, cred) : null,
  )
  return {
    accounts: { items: accounts.data && withState(accounts.data.adAccounts), loading: accounts.loading, error: accounts.error?.message },
    pages: { items: pages.data, loading: pages.loading, error: pages.error?.message },
    pixels: { items: pixels.data, loading: pixels.loading, error: pixels.error?.message },
  }
}

// A template or an older record may name an asset by its id, its id without `act_`, or its name
export function findAsset<T extends Asset>(items: T[] | undefined, wanted: string): T | undefined {
  const value = wanted.trim()
  if (!value) return undefined
  return items?.find((item) => item.id === value || item.id === `act_${value}` || item.name === value)
}
