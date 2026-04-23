import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle } from 'lucide-react'
import { getItems, Item } from '../lib/api'

export default function Alerts() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getItems({ low_stock_only: true }).then(i => { setItems(i); setLoading(false) })
  }, [])

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-white text-2xl font-bold">Low Stock</h2>
        <p className="text-surface-muted text-sm mt-1">Items that need restocking</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center justify-center py-24 text-center">
          <CheckCircle size={48} className="text-green-400 mb-4" />
          <p className="text-white font-semibold text-lg">All stocked up!</p>
          <p className="text-surface-muted text-sm mt-1">Nothing is running low right now.</p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <motion.div key={item.id}
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-surface-card border border-orange-500/30 rounded-2xl p-4 flex items-center gap-4 shadow-card">
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={18} className="text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium">{item.name}</p>
                <p className="text-surface-muted text-xs mt-0.5">
                  {item.location ? `${item.location.name}${item.location.sublocation ? ` — ${item.location.sublocation}` : ''}` : 'No location'}
                  {item.category && ` · ${item.category.icon} ${item.category.name}`}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-orange-400 font-bold text-lg">
                  {item.quantity ?? 0} <span className="text-sm font-normal">{item.unit || ''}</span>
                </p>
                <p className="text-surface-muted text-xs">alert ≤ {item.low_stock_threshold}</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
