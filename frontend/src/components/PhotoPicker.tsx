import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Camera, Image as ImageIcon, Link2, Trash2, type LucideIcon } from 'lucide-react'
import { Button, Input } from './ui'
import { errorText, mediaUrl, photoFromLink, uploadPhoto } from '../lib/api'
import { cn } from '../lib/utils'

/** Shrink a phone photo before it leaves the device (a 4000px photo is 5 MB for no benefit).
 *  Falls back to the original file when the browser cannot decode it (the server handles HEIC). */
export async function downscale(file: File, max = 1600): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 1_500_000) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b ?? file), 'image/jpeg', 0.85))
  } catch {
    return file
  }
}

interface Props {
  value?: string | null
  onChange: (url: string | null) => void
  label?: string
  /** 'wide' for recipe and item photos, 'round' for people */
  shape?: 'wide' | 'round'
  className?: string
}

/** Take a photo, choose one, or paste a link. The picture is stored on the server and
 *  `onChange` receives its /media/ path (or null when removed). */
export default function PhotoPicker({ value, onChange, label = 'Photo', shape = 'wide', className }: Props) {
  const camera = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(false)
  const [link, setLink] = useState('')

  async function run(job: () => Promise<string>) {
    setBusy(true)
    try { onChange(await job()); setLinking(false); setLink('') }
    catch (e) { toast.error(errorText(e, "Couldn't use that picture")) }
    finally { setBusy(false) }
  }

  async function pick(file?: File) {
    if (!file) return
    await run(async () => uploadPhoto(await downscale(file), file.name.replace(/\.\w+$/, '') + '.jpg'))
  }

  const src = mediaUrl(value)
  const btn = (icon: LucideIcon, text: string, onClick: () => void) => (
    <Button size="sm" icon={icon} onClick={onClick} disabled={busy}>{text}</Button>
  )

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span className="text-ui font-medium text-ink">{label}</span>
      <div className={cn('flex gap-3', shape === 'wide' ? 'flex-col sm:flex-row sm:items-center' : 'items-center')}>
        <div
          className={cn(
            'relative shrink-0 overflow-hidden border border-line bg-canvas',
            shape === 'wide' ? 'aspect-[4/3] w-full rounded-control sm:w-44' : 'h-20 w-20 rounded-full',
          )}
        >
          {src
            ? <img src={src} alt="" className="h-full w-full object-cover" />
            : <div className="flex h-full w-full items-center justify-center text-muted"><ImageIcon size={26} aria-hidden /></div>}
          {busy && <div className="absolute inset-0 flex items-center justify-center bg-surface/70 text-xs font-medium text-ink">Saving…</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          {btn(Camera, 'Take photo', () => camera.current?.click())}
          {btn(ImageIcon, 'Choose', () => files.current?.click())}
          {btn(Link2, 'Link', () => setLinking(v => !v))}
          {value && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onChange(null)} disabled={busy}>Remove</Button>}
        </div>
      </div>

      {linking && (
        <form
          className="flex gap-2"
          onSubmit={e => { e.preventDefault(); if (link.trim()) run(() => photoFromLink(link.trim())) }}
        >
          <Input
            type="url" inputMode="url" placeholder="Paste a picture link" aria-label="Picture link"
            value={link} onChange={e => setLink(e.target.value)} autoFocus
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!link.trim()}>Use</Button>
        </form>
      )}

      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
      <input ref={files} type="file" accept="image/*" hidden onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}
