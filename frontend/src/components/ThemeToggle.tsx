import { Monitor, Moon, Sun } from 'lucide-react'
import { IconButton, Menu, type MenuEntry } from './ui'
import { useTheme, type ThemePref } from '../hooks/useTheme'

const OPTIONS: { pref: ThemePref; label: string; icon: typeof Sun }[] = [
  { pref: 'system', label: 'Match device', icon: Monitor },
  { pref: 'light', label: 'Light', icon: Sun },
  { pref: 'dark', label: 'Dark', icon: Moon },
]

/** Radio items for a theme picker, reused by the user menu on phones */
export function useThemeMenuItems(): MenuEntry[] {
  const { pref, setPref } = useTheme()
  return OPTIONS.map(o => ({ label: o.label, icon: o.icon, checked: pref === o.pref, onSelect: () => setPref(o.pref) }))
}

export default function ThemeToggle() {
  const { pref, resolved } = useTheme()
  const items = useThemeMenuItems()
  const Icon = pref === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun
  return (
    <Menu
      label="Theme"
      items={[{ heading: 'Theme' }, ...items]}
      trigger={<IconButton icon={Icon} label={`Theme: ${OPTIONS.find(o => o.pref === pref)!.label}`} />}
    />
  )
}
