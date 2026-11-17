import { mediaUrl } from '../lib/api'
import { cn } from '../lib/utils'

/** A family member: their photo if there is one, otherwise their emoji, otherwise their initial. */
export default function PersonAvatar({ name, icon, photo, size = 28, className }: {
  name: string; icon?: string | null; photo?: string | null; size?: number; className?: string
}) {
  const src = mediaUrl(photo, true)
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.55 }}
      className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-honey/15 leading-none', className)}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : (icon || name.slice(0, 1).toUpperCase())}
    </span>
  )
}
