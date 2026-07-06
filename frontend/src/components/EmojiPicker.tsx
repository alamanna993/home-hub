import { useEffect, useRef, useState } from 'react'

export const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'Rooms & Places', emojis: [
    '🏠','🏡','🛋️','🛏️','🍳','🚿','🛁','🚽','🧺','🚗','🏚️','🌳','⛺','🚪','🪜','🏢','🅿️','🌡️','❄️','🔥',
  ]},
  { label: 'Storage', emojis: [
    '📦','🗄️','🗃️','🧰','🎒','👜','🧳','🛒','🗑️','🪣','🏺','🫙','🥡','🗳️',
  ]},
  { label: 'Food & Kitchen', emojis: [
    '🍎','🥫','🥖','🥩','🧀','🥚','🥛','🧊','🍝','🍚','🌶️','🧂','🍯','☕','🍵','🍷','🍺','🥤','🍪','🍫','🥣','🍴','🔪','🥘',
  ]},
  { label: 'Tech & Office', emojis: [
    '💻','🖥️','📱','⌨️','🖱️','🖨️','📷','🎧','🔌','🔋','💾','📡','🛜','🎮','🕹️','📺','⏰','🧮','✏️','📎','📄','📁','✂️','📐',
  ]},
  { label: 'Tools & Garage', emojis: [
    '🔧','🔨','🪛','🪚','⚙️','🪝','🔩','📏','🪫','🔦','⚡','🧲','⛏️','🪓','🚲','🛞','⛽','🪤',
  ]},
  { label: 'Books & Media', emojis: [
    '📚','📖','📕','📗','📘','📙','📀','💿','📼','🎞️','🎵','🎸','🎹','🎻','🥁','🎤','🎬','🗞️','📰',
  ]},
  { label: 'Household', emojis: [
    '🧹','🧼','🧽','🧴','🪥','🧻','🕯️','💡','🔑','🗝️','🧯','🩹','💊','🌡️','🪞','🪟','🖼️','🪴','🌱','💐','🧸','🪆',
  ]},
  { label: 'Clothes & Personal', emojis: [
    '👕','👖','👗','🧥','🧦','👟','👞','👢','🧢','👒','🧤','🧣','💍','⌚','👓','🕶️','💄','🎀',
  ]},
  { label: 'Fun & Outdoors', emojis: [
    '⚽','🏀','🎾','🏈','⛳','🎣','🏕️','🎿','🛹','🛼','🎲','🧩','🪁','🎨','🧶','🪡','🏊','🚣','🏋️','🥾',
  ]},
  { label: 'Pets & Misc', emojis: [
    '🐕','🐈','🐟','🐹','🦜','🦴','💰','🎁','🎄','🎃','🎂','📌','⭐','❤️','✨','🏷️',
  ]},
]

interface Props {
  value: string
  onChange: (emoji: string) => void
  buttonClassName?: string
}

export default function EmojiPicker({ value, onChange, buttonClassName }: Props) {
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Flip the panel to the right edge when 288px (w-72) would run off-screen
    const r = ref.current?.getBoundingClientRect()
    setAlignRight(!!r && r.left + 288 > window.innerWidth - 8)
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        title="Pick an icon"
        className={buttonClassName || 'w-12 h-9 bg-surface border border-surface-border rounded-lg text-xl hover:border-accent transition-all flex items-center justify-center'}>
        {value || '📦'}
      </button>
      {open && (
        <div className={`absolute z-50 mt-1 ${alignRight ? 'right-0' : 'left-0'} w-72 max-w-[calc(100vw-1rem)] max-h-72 overflow-y-auto bg-surface-card border border-surface-border rounded-xl shadow-card p-3 space-y-2`}>
          <input
            className="w-full bg-surface border border-surface-border rounded-lg px-2 py-1.5 text-white text-sm text-center focus:outline-none focus:border-accent"
            placeholder="…or type/paste any emoji"
            value={value}
            onChange={e => onChange(e.target.value)}
          />
          {EMOJI_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-surface-muted text-[10px] font-medium uppercase tracking-wide mb-1">{group.label}</p>
              <div className="grid grid-cols-8 gap-0.5">
                {group.emojis.map(e => (
                  <button key={e} type="button"
                    onClick={() => { onChange(e); setOpen(false) }}
                    className={`w-8 h-8 rounded-lg text-lg flex items-center justify-center hover:bg-white/10 transition-all ${value === e ? 'bg-accent/20 ring-1 ring-accent' : ''}`}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
