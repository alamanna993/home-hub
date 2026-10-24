import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
interface ThemeContext {
  pref: ThemePref
  resolved: 'light' | 'dark'
  setPref: (p: ThemePref) => void
}

const KEY = 'hh_theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')
const Ctx = createContext<ThemeContext | null>(null)

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* storage blocked — follow the device */ }
  return 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref)
  const [systemDark, setSystemDark] = useState(() => media().matches)

  useEffect(() => {
    const mq = media()
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])

  function setPref(p: ThemePref) {
    setPrefState(p)
    try { localStorage.setItem(KEY, p) } catch { /* not persisted; still applies this session */ }
  }

  return <Ctx.Provider value={{ pref, resolved, setPref }}>{children}</Ctx.Provider>
}

export function useTheme() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be inside ThemeProvider')
  return ctx
}
