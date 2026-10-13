import { useCallback, useEffect, useState } from 'react'
import { useFetch } from '../../data'

// The one place the browser meets Facebook: the login popup, which has to be
// Facebook's own. It hands back a short-lived token that goes straight to
// POST /facebook/connect and is not kept. Every Graph call stays on the server.

const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js'

// what the dashboard needs to read and manage a profile's assets
const LOGIN_SCOPE =
  'public_profile,email,business_management,ads_management,ads_read,pages_read_engagement,pages_show_list,pages_manage_metadata'

interface LoginResponse {
  authResponse?: { accessToken?: string } | null
}

interface FacebookSdk {
  init: (options: { appId: string; version: string; cookie: boolean; xfbml: boolean }) => void
  login: (callback: (response: LoginResponse) => void, options: { scope: string }) => void
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

  return { ready: Boolean(loaded), problem: config.error?.message ?? error, login }
}

// what POST /facebook/connect answers
export interface ConnectResult {
  profileId: string
  fbUserId: string
  name: string
  tokenExpiresOn: string
  created: boolean
}
