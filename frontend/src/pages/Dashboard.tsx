import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { Package, AlertTriangle, Clock, TrendingUp } from 'lucide-react'
import { getStats, Stats } from '../lib/api'
import StatCard from '../components/StatCard'
import { timeAgo } from '../lib/utils'

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setError(null)
    getStats().then(setStats).catch(e => {
      setError(e?.response?.data?.detail || e?.message || 'Could not load stats')
    })
  }
  useEffect(() => { load() }, [])

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-surface-card border border-red-500/30 rounded-2xl p-6 max-w-md mx-auto mt-16 text-center space-y-3">
          <p className="text-3xl">⚠️</p>
          <p className="text-white font-medium text-sm">Couldn't load the dashboard</p>
          <p className="text-surface-muted text-xs">{error}</p>
          <button onClick={load}
            className="bg-accent hover:bg-accent-hover text-white text-sm font-medium px-5 py-2 rounded-lg transition-all">
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const pieData = stats.by_category.filter(c => c.count > 0).map(c => ({
    name: c.name, value: c.count, color: c.color || '#6366f1', icon: c.icon,
  }))

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-white text-2xl font-bold">Dashboard</h2>
        <p className="text-surface-muted text-sm mt-1">Your home inventory at a glance</p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total Items" value={stats.total_items} icon="📦" color="#6366f1" />
        <StatCard label="Categories" value={stats.by_category.length} icon="🏷️" color="#22c55e" />
        <StatCard
          label="Low Stock" value={stats.low_stock_count} icon="⚠️" color="#f59e0b"
          alert={stats.low_stock_count > 0}
          sub={stats.low_stock_count > 0 ? 'needs attention' : 'all good'}
        />
        <StatCard label="Updated Today" value={stats.recent_activity.filter(a => {
          const d = new Date(a.at); const now = new Date()
          return d.toDateString() === now.toDateString()
        }).length} icon="✏️" color="#ec4899" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="bg-surface-card border border-surface-border rounded-2xl p-5 shadow-card">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-accent" /> By Category
          </h3>
          {pieData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={72}
                    dataKey="value" strokeWidth={0}>
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: 8, color: '#fff' }}
                    formatter={(v: number, n: string) => [v, n]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 flex-1 min-w-0">
                {pieData.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
                    <span className="text-surface-muted truncate">{c.icon} {c.name}</span>
                    <span className="text-white font-medium ml-auto">{c.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-surface-muted text-sm">No items yet — add some to see the breakdown.</p>
          )}
        </motion.div>

        {/* Recent Activity */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-surface-card border border-surface-border rounded-2xl p-5 shadow-card">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Clock size={16} className="text-accent" /> Recent Activity
          </h3>
          {stats.recent_activity.length > 0 ? (
            <div className="space-y-3">
              {stats.recent_activity.map((a, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 text-base">
                    {a.action === 'created' ? '✅' : a.action === 'updated' ? '✏️' : '🗑️'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-medium truncate">{a.item}</p>
                    <p className="text-surface-muted text-xs">{a.details}</p>
                  </div>
                  <span className="text-surface-muted text-xs flex-shrink-0 mt-0.5">{timeAgo(a.at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-surface-muted text-sm">No activity yet.</p>
          )}
        </motion.div>
      </div>

      {/* Low Stock Alert Banner */}
      {stats.low_stock_count > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle size={20} className="text-orange-400 flex-shrink-0" />
          <div>
            <p className="text-orange-300 font-medium text-sm">
              {stats.low_stock_count} item{stats.low_stock_count > 1 ? 's are' : ' is'} running low
            </p>
            <p className="text-orange-400/70 text-xs mt-0.5">Check the Low Stock page or ask the bot to see what needs restocking.</p>
          </div>
        </motion.div>
      )}
    </div>
  )
}
