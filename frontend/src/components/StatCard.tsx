import { motion } from 'framer-motion'
import { cn } from '../lib/utils'

interface Props {
  label: string
  value: string | number
  icon: string
  color?: string
  sub?: string
  alert?: boolean
}

export default function StatCard({ label, value, icon, color = '#6366f1', sub, alert }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'bg-surface-card border border-surface-border rounded-2xl p-5 shadow-card flex items-start gap-4',
        alert && 'border-orange-500/40 shadow-[0_0_20px_rgba(249,115,22,0.1)]'
      )}
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
        style={{ background: `${color}22` }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-surface-muted text-xs font-medium uppercase tracking-wider">{label}</p>
        <p className="text-white text-2xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-surface-muted text-xs mt-0.5">{sub}</p>}
      </div>
    </motion.div>
  )
}
