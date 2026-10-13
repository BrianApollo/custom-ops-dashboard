import { useFetch } from '../data'

// Everything from Facebook comes through our API. The browser names whose
// token to use (`cred`) and never sees the token or talks to Facebook itself.
//
//   GET /facebook/ad-accounts?cred=…&activeOnly=1   -> { adAccounts: [{ id, name, … }] }
//   GET /facebook/ad-accounts/{id}/pixels?cred=…    -> [{ id, name, … }]
//   GET /facebook/pages?cred=…                      -> [{ id, name, … }]
export interface FacebookAsset {
  // Facebook's own id, e.g. `act_123` for an ad account
  id: string
  name: string
}

// `profile:rec…` uses that profile's token; '' uses the Master Profile's
export const profileCred = (profileId: string) => (profileId ? `profile:${profileId}` : '')

export const withCred = (path: string, cred: string, params: Record<string, string> = {}) => {
  const query = new URLSearchParams(cred ? { cred, ...params } : params).toString()
  return query ? `${path}?${query}` : path
}

export type FacebookKind = 'ad-accounts' | 'pages' | 'pixels'

// `source` is null while something the list depends on has not been chosen yet.
// Pixels belong to an ad account, so they need its id as well as the profile.
export function useFacebookAssets(kind: FacebookKind, source: { profileId: string; adAccountId?: string } | null) {
  let path: string | null = null
  if (source) {
    const cred = profileCred(source.profileId)
    if (kind === 'ad-accounts') path = withCred('/facebook/ad-accounts', cred, { activeOnly: '1' })
    else if (kind === 'pages') path = withCred('/facebook/pages', cred)
    else if (source.adAccountId) path = withCred(`/facebook/ad-accounts/${encodeURIComponent(source.adAccountId)}/pixels`, cred)
  }
  const { data, error, loading } = useFetch<FacebookAsset[] | { adAccounts: FacebookAsset[] }>(path)
  return { assets: Array.isArray(data) ? data : data?.adAccounts, loading, error: error?.message }
}
