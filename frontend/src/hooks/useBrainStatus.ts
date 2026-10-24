import { useEffect, useSyncExternalStore } from 'react'
import { getBrainStatus, type BrainStatus } from '../lib/api'

/** ok: primary brain answering · degraded: primary down, backup answering ·
 *  down: nothing reachable · unknown: server doesn't report status (yet) */
export type BrainState = 'loading' | 'ok' | 'degraded' | 'down' | 'unknown'

interface Snapshot { status: BrainStatus | null; state: BrainState; checkedAt: number }

const POLL_MS = 60_000
const RETRY_UNSUPPORTED_MS = 10 * 60_000

// One shared poller for every component that shows brain status.
let snap: Snapshot = { status: null, state: 'loading', checkedAt: 0 }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined
let inFlight = false

function emit(next: Snapshot) {
  snap = next
  listeners.forEach(l => l())
}

const paused = (until: number | null | undefined) => until != null && until * 1000 > Date.now()

export function deriveState(s: BrainStatus | null): BrainState {
  if (!s?.primary) return 'unknown'
  if (s.primary.ready && !paused(s.primary.paused_until)) return 'ok'
  return s.backup?.ready ? 'degraded' : 'down'
}

async function poll() {
  if (inFlight) return
  inFlight = true
  let delay = POLL_MS
  try {
    const status = await getBrainStatus()
    emit({ status, state: deriveState(status), checkedAt: Date.now() })
  } catch (e: unknown) {
    const code = (e as { response?: { status?: number } }).response?.status
    // 404/405: this server doesn't have the endpoint yet — say nothing, check rarely
    if (code === 404 || code === 405) delay = RETRY_UNSUPPORTED_MS
    emit({ status: null, state: 'unknown', checkedAt: Date.now() })
  } finally {
    inFlight = false
    if (listeners.size) timer = setTimeout(poll, delay)
  }
}

function subscribe(l: () => void) {
  listeners.add(l)
  if (listeners.size === 1 && !timer && !inFlight) poll()
  return () => {
    listeners.delete(l)
    if (!listeners.size && timer) { clearTimeout(timer); timer = undefined }
  }
}

export function refreshBrainStatus() {
  if (timer) { clearTimeout(timer); timer = undefined }
  return poll()
}

const brainName = (b?: { provider: string; label?: string; model?: string | null } | null) =>
  b ? (b.label || b.model?.split(':')[0] || b.provider) : undefined

export function useBrainStatus() {
  const s = useSyncExternalStore(subscribe, () => snap)
  // Re-check when the tab comes back into view
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && Date.now() - snap.checkedAt > POLL_MS) refreshBrainStatus() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const primaryLabel = brainName(s.status?.primary)
  const backupLabel = brainName(s.status?.backup)
  let summary: string | undefined
  if (s.state === 'ok') summary = backupLabel ? `${primaryLabel} (backup: ${backupLabel})` : primaryLabel
  else if (s.state === 'degraded') summary = `Using backup ${backupLabel}; ${primaryLabel} unavailable`
  else if (s.state === 'down') summary = 'No brain reachable'

  return { ...s, primaryLabel, backupLabel, summary, refresh: refreshBrainStatus }
}
