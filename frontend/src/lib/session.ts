import axios from 'axios'

/** What the server returns when a device is signed in */
export interface SignedIn { access_token: string; username: string; role?: string }

export function storeSession(data: SignedIn) {
  localStorage.setItem('hh_token', data.access_token)
  localStorage.setItem('hh_user', data.username)
  localStorage.setItem('hh_role', data.role || 'admin')
  axios.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`
}

export function clearSession() {
  localStorage.removeItem('hh_token')
  localStorage.removeItem('hh_user')
  localStorage.removeItem('hh_role')
  delete axios.defaults.headers.common['Authorization']
}

let inFlight: Promise<SignedIn | null | 'offline'> | null = null

/** Ask the server for a fresh token for this device (its session cookie, or the stored token).
 *  null = this device is signed out; 'offline' = the server couldn't be reached, so keep what we have.
 *  Uses fetch, not axios, so the 401 handler can call it without looping. */
export function resumeSession(): Promise<SignedIn | null | 'offline'> {
  if (inFlight) return inFlight
  const token = localStorage.getItem('hh_token')
  inFlight = fetch('/api/auth/resume', {
    method: 'POST',
    credentials: 'same-origin',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then(async r => {
      if (r.ok) {
        const data = (await r.json()) as SignedIn
        storeSession(data)
        return data
      }
      return r.status === 401 ? null : 'offline' as const
    })
    .catch(() => 'offline' as const)
    .finally(() => { setTimeout(() => { inFlight = null }, 0) })
  return inFlight
}
