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
        title="Pick an icon" aria-label="Pick an icon" aria-expanded={open}
        className={buttonClassName || 'flex h-10 w-12 items-center justify-center rounded-control border border-line bg-surface text-xl transition-colors hover:border-muted/50 lg:h-9'}>
        {value || '📦'}
      </button>
      {open && (
        <div className={`absolute z-50 mt-1 ${alignRight ? 'right-0' : 'left-0'} w-72 max-w-[calc(100vw-1rem)] max-h-72 overflow-y-auto rounded-panel border border-line bg-surface p-3 shadow-overlay space-y-2`}>
          <input
            aria-label="Type or paste any emoji"
            className="w-full rounded-control border border-line bg-canvas px-2 py-1.5 text-center text-sm text-ink focus:border-action focus:outline-none"
            placeholder="Or type or paste any emoji"
            value={value}
            onChange={e => onChange(e.target.value)}
          />
          {EMOJI_GROUPS.map(group => (
            <div key={group.label}>
              <p className="mb-1 text-xs font-medium text-muted">{group.label}</p>
              <div className="grid grid-cols-8 gap-0.5">
                {group.emojis.map(e => (
                  <button key={e} type="button"
                    onClick={() => { onChange(e); setOpen(false) }}
                    className={`w-8 h-8 rounded-lg text-lg flex items-center justify-center hover:bg-ink/[0.06] ${value === e ? 'bg-action/10 ring-1 ring-action' : ''}`}>
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
