import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, LogOut, Monitor, Moon, Settings as SettingsIcon, Sun } from 'lucide-react'
import { Page, PageHeader } from '../components/ui'
import { HOUSEHOLD, DISPLAY_ITEM } from '../components/nav'
import { useAuth } from '../hooks/useAuth'
import { useTheme, type ThemePref } from '../hooks/useTheme'
import { cn } from '../lib/utils'

const THEMES: { pref: ThemePref; label: string; icon: typeof Sun }[] = [
  { pref: 'system', label: 'Auto', icon: Monitor },
  { pref: 'light', label: 'Light', icon: Sun },
  { pref: 'dark', label: 'Dark', icon: Moon },
]

/** Phone home for everything that is not on the tab bar. */
export default function More() {
  const { username, isAdmin, logout } = useAuth()
  const { pref, setPref } = useTheme()
  const navigate = useNavigate()
  const rows = [...HOUSEHOLD, DISPLAY_ITEM, ...(isAdmin ? [{ to: '/settings', label: 'Settings', icon: SettingsIcon }] : [])]

  return (
    <Page className="max-w-xl">
      <PageHeader title="More" description={username ? `Signed in as ${username}` : undefined} />

      <ul className="overflow-hidden rounded-panel border border-line bg-surface">
        {rows.map((r, i) => (
          <li key={r.to} className={cn(i > 0 && 'border-t border-line')}>
            <Link to={r.to} className="flex h-14 items-center gap-3 px-4 text-sm font-medium text-ink active:bg-ink/[0.05]">
              <r.icon size={20} aria-hidden className="text-muted" />
              <span className="flex-1">{r.label}</span>
              <ChevronRight size={18} aria-hidden className="text-muted" />
            </Link>
          </li>
        ))}
      </ul>

      <section aria-labelledby="theme-h" className="mt-6">
        <h2 id="theme-h" className="mb-2 text-xs font-medium text-muted">Appearance</h2>
        <div role="radiogroup" aria-label="Theme" className="flex gap-1 rounded-control bg-surface p-1 ring-1 ring-line">
          {THEMES.map(t => (
            <button
              key={t.pref}
              type="button"
              role="radio"
              aria-checked={pref === t.pref}
              onClick={() => setPref(t.pref)}
              className={cn(
                'flex h-11 flex-1 items-center justify-center gap-2 rounded-[8px] text-sm font-medium',
                pref === t.pref ? 'bg-action/[0.12] text-action' : 'text-muted',
              )}
            >
              <t.icon size={16} aria-hidden />{t.label}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => { logout(); navigate('/login', { replace: true }) }}
        className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-control border border-line bg-surface text-sm font-medium text-danger"
      >
        <LogOut size={16} aria-hidden /> Sign out
      </button>
    </Page>
  )
}
