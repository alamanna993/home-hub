import { QUARTER_HOURS, formatTime } from '../lib/time'

interface Props {
  value: string
  onChange: (v: string) => void
  use24: boolean
  emptyLabel: string
  disabled?: boolean
}

/** Quarter-hour time picker — big touch targets, no typing. */
export default function TimeSelect({ value, onChange, use24, emptyLabel, disabled }: Props) {
  return (
    <select
      className="bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accent disabled:opacity-40"
      value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
    >
      <option value="">{emptyLabel}</option>
      {QUARTER_HOURS.map(t => (
        <option key={t} value={t}>{formatTime(t, use24)}</option>
      ))}
    </select>
  )
}
