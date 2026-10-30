import { useCallback, useEffect, useState } from 'react'
import { useFetch } from '../../data'

// The one place the browser meets Facebook: the login popup, which has to be
// Facebook's own. The profile login hands back a short-lived token that goes
// straight to POST /facebook/connect; the system user login hands back a code
// that goes to POST /facebook/connect-system-user. Neither is kept, and every
// Graph call stays on the server.

const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js'

// what the dashboard needs to read and manage a profile's assets
const LOGIN_SCOPE =
  'public_profile,email,business_management,ads_management,ads_read,pages_read_engagement,pages_show_list,pages_manage_metadata'

interface LoginResponse {
  authResponse?: { accessToken?: string; code?: string } | null
}

// `scope` for a profile login; a Login for Business configuration otherwise.
// A system-user configuration must answer with a code, which the server
// swaps for the token, hence the response type override.
type LoginOptions = { scope: string } | { config_id: string; response_type: 'code'; override_default_response_type: true }

interface FacebookSdk {
  init: (options: { appId: string; version: string; cookie: boolean; xfbml: boolean }) => void
  login: (callback: (response: LoginResponse) => void, options: LoginOptions) => void
}

declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

interface Config {
  appId: string
  apiVersion: string
  // null when the server has no system user login configuration
  systemUserConfigId: string | null
}

let sdk: Promise<FacebookSdk> | undefined

function loadSdk(config: Config) {
  sdk ??= new Promise<FacebookSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      const fb = window.FB!
      fb.init({ appId: config.appId, version: config.apiVersion, cookie: false, xfbml: false })
      resolve(fb)
    }
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.crossOrigin = 'anonymous'
    script.onerror = () => {
      // a later visit to the page may try again
      sdk = undefined
      script.remove()
      reject(new Error('Could not load the Facebook login script. An ad blocker may be stopping it.'))
    }
    document.head.append(script)
  })
  return sdk
}

export interface FacebookLogin {
  ready: boolean
  // why the login cannot be used, when it cannot
  problem?: string
  // opens the popup; resolves with the short-lived token
  login: () => Promise<string>
  // false while the server has no system user login configuration
  systemUserReady: boolean
  // opens the system user popup; resolves with the code the server swaps for the token
  loginSystemUser: () => Promise<string>
}

// The script is loaded ahead of the click: a popup opened after waiting for it would be blocked
export function useFacebookLogin(): FacebookLogin {
  const config = useFetch<Config>('/facebook/config')
  const [loaded, setLoaded] = useState<FacebookSdk>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!config.data) return
    let stale = false
    loadSdk(config.data)
      .then((fb) => !stale && setLoaded(fb))
      .catch((err: Error) => !stale && setError(err.message))
    return () => {
      stale = true
    }
  }, [config.data])

  const login = useCallback(
    () =>
      new Promise<string>((resolve, reject) => {
        if (!loaded) {
          reject(new Error('The Facebook login is not ready yet.'))
          return
        }
        loaded.login(
          (response) => {
            const token = response.authResponse?.accessToken
            if (token) resolve(token)
            else reject(new Error('The Facebook login was cancelled or not authorised.'))
          },
          { scope: LOGIN_SCOPE },
        )
      }),
    [loaded],
  )

  const systemUserConfigId = config.data?.systemUserConfigId ?? null
  const loginSystemUser = useCallback(
    () =>
      new Promise<string>((resolve, reject) => {
        if (!loaded) {
          reject(new Error('The Facebook login is not ready yet.'))
          return
        }
        if (!systemUserConfigId) {
          reject(new Error('The system user login is not set up on the server.'))
          return
        }
        loaded.login(
          (response) => {
            const code = response.authResponse?.code
            if (code) resolve(code)
            else reject(new Error('The Facebook login was cancelled or not authorised.'))
          },
          { config_id: systemUserConfigId, response_type: 'code', override_default_response_type: true },
        )
      }),
    [loaded, systemUserConfigId],
  )

  return {
    ready: Boolean(loaded),
    problem: config.error?.message ?? error,
    login,
    systemUserReady: Boolean(loaded && systemUserConfigId),
    loginSystemUser,
  }
}

// what POST /facebook/connect answers
export interface ConnectResult {
  profileId: string
  fbUserId: string
  name: string
  tokenExpiresOn: string
  created: boolean
}

// what POST /facebook/connect-system-user answers
export interface SystemUserConnectResult {
  bmRecordId: string
  bmId: string
  bmName: string
  systemUserId: string
  systemUserName: string
  // null when the token never expires
  tokenExpiresOn: string | null
  scopes: string[]
  created: boolean
}
