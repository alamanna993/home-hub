import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** The server sends UTC timestamps without a 'Z'; add it so every device reads the same moment. */
export function utcDate(dateStr: string) {
  return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(dateStr) ? dateStr : dateStr + 'Z')
}

export function timeAgo(dateStr: string) {
  const diff = Date.now() - utcDate(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
