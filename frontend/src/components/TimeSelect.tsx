import { cn } from '../lib/utils'
import { controlBase } from './ui'

interface Props {
  value: string            // 'HH:MM' (24h) or '' = unset
  onChange: (v: string) => void
  use24: boolean
  emptyLabel: string
  disabled?: boolean
}

const MINUTES = ['00', '15', '30', '45']

/** Compact quarter-hour picker: hour + minutes (+ AM/PM taps in 12h mode). */
export default function TimeSelect({ value, onChange, use24, emptyLabel, disabled }: Props) {
  const hour24 = value ? parseInt(value.slice(0, 2), 10) : null
  const minute = value ? value.slice(3, 5) : '00'
  const isPM = hour24 != null && hour24 >= 12

  const compose = (h24: number, m: string) =>
    onChange(`${String(h24).padStart(2, '0')}:${m}`)

  const selectCls = cn(controlBase, 'h-10 w-auto px-2 lg:h-9')

  function pickHour(raw: string) {
    if (raw === '') { onChange(''); return }
    const h = parseInt(raw, 10)
    if (use24) { compose(h, minute); return }
    // 12h: keep current AM/PM (default AM when starting fresh)
    const pm = hour24 != null ? isPM : false
    compose((h % 12) + (pm ? 12 : 0), minute)
  }

  const hourOptions = use24
    ? Array.from({ length: 24 }, (_, i) => ({ v: String(i), label: String(i).padStart(2, '0') }))
    : [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(h => ({ v: String(h), label: String(h) }))

  const hourValue = hour24 == null ? '' : use24 ? String(hour24) : String(hour24 % 12 === 0 ? 12 : hour24 % 12)

  return (
    <div className="flex items-center gap-1">
      <select aria-label="Hour" className={selectCls} value={hourValue} onChange={e => pickHour(e.target.value)} disabled={disabled}>
        <option value="">{emptyLabel}</option>
        {hourOptions.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
      <span className="text-sm text-muted" aria-hidden>:</span>
      <select aria-label="Minutes" className={selectCls} value={minute} disabled={disabled || hour24 == null}
        onChange={e => hour24 != null && compose(hour24, e.target.value)}>
        {MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      {!use24 && (
        <div className="flex overflow-hidden rounded-control border border-line">
          {(['AM', 'PM'] as const).map(p => (
            <button key={p} type="button" disabled={disabled || hour24 == null}
              onClick={() => hour24 != null && compose((hour24 % 12) + (p === 'PM' ? 12 : 0), minute)}
              aria-pressed={hour24 != null && (p === 'PM') === isPM}
              className={cn('h-10 px-2.5 text-xs font-medium transition-colors disabled:opacity-40 lg:h-9',
                hour24 != null && (p === 'PM') === isPM
                  ? 'bg-action text-action-on'
                  : 'bg-surface text-muted hover:text-ink')}>
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
