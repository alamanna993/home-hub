// Per-device time-format preference (kitchen tablet may differ from a phone)
export function getUse24(): boolean {
  return localStorage.getItem('hh_24h') === '1'
}

export function setUse24(v: boolean) {
  localStorage.setItem('hh_24h', v ? '1' : '0')
}

/** "13:45" -> "1:45 PM" (or unchanged in 24h mode). Tolerates any minutes. */
export function formatTime(hhmm: string, use24: boolean): string {
  if (use24 || !/^\d{2}:\d{2}/.test(hhmm)) return hhmm
  const h = parseInt(hhmm.slice(0, 2), 10)
  const m = hhmm.slice(3, 5)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${ampm}`
}

/** All 96 quarter-hour slots of a day as "HH:MM". */
export const QUARTER_HOURS: string[] = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4)
  const m = (i % 4) * 15
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
})
