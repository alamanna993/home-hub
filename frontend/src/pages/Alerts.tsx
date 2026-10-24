import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { getItems, Item } from '../lib/api'
import { Badge, Button, DataTable, EmptyState, Page, PageHeader, Panel, Skeleton, type Column } from '../components/ui'
import { EmeraldMark } from '../components/EmeraldMark'
import { useEmeraldChat } from '../hooks/useEmeraldChat'

// Date-only strings must not go through new Date(iso) — UTC parsing can shift them a day
const fmtDay = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const where = (i: Item) => i.location ? i.location.name + (i.location.sublocation ? ` / ${i.location.sublocation}` : '') : 'No location'

const itemCell = (i: Item) => (
  <span className="flex items-center gap-2.5">
    <span className="w-5 text-center leading-none" aria-hidden>{i.category?.icon || '📦'}</span>
    <span className="font-medium text-ink">{i.name}</span>
  </span>
)

export default function Alerts() {
  const { openPanel } = useEmeraldChat()
  const [low, setLow] = useState<Item[] | null>(null)
  const [expiring, setExpiring] = useState<Item[] | null>(null)

  useEffect(() => {
    getItems({ low_stock_only: true }).then(setLow).catch(() => setLow([]))
    getItems({ expiring_only: true }).then(setExpiring).catch(() => setExpiring([]))
  }, [])

  const expiringCols: Column<Item>[] = [
    { key: 'item', header: 'Food', sortValue: i => i.name.toLowerCase(), cell: itemCell },
    { key: 'where', header: 'Location', sortValue: where, cell: i => <span className="text-muted">{where(i)}</span> },
    {
      key: 'date', header: 'Use by', width: '10rem', sortValue: i => i.expiration_date ?? null,
      cell: i => <Badge tone={i.is_expired ? 'danger' : 'warn'}>{i.is_expired ? 'Expired' : 'Use by'} {fmtDay(i.expiration_date!)}</Badge>,
    },
  ]
  const lowCols: Column<Item>[] = [
    { key: 'item', header: 'Item', sortValue: i => i.name.toLowerCase(), cell: itemCell },
    { key: 'where', header: 'Location', hideBelow: 'lg', sortValue: where, cell: i => <span className="text-muted">{where(i)}</span> },
    {
      key: 'qty', header: 'Left', width: '11rem', numeric: true, sortValue: i => i.effective_quantity ?? i.quantity ?? 0,
      cell: i => (
        <span className="block text-right">
          <span className="font-medium text-warn">{i.quantity ?? 0}{i.unit ? ` ${i.unit}` : ''}</span>
          {i.open_label && <span className="block text-xs text-muted">{i.open_label}</span>}
        </span>
      ),
    },
    {
      key: 'at', header: 'Warns at', width: '7rem', numeric: true,
      cell: i => <span className="text-muted">{i.low_stock_threshold ?? 'Last one'}</span>,
    },
  ]

  const loading = low === null || expiring === null
  const clear = !loading && low!.length === 0 && expiring!.length === 0

  return (
    <Page>
      <PageHeader title="Alerts" description="Food that's expiring and things that need restocking."
        actions={!clear && !loading && (
          <Button onClick={() => openPanel('Make me a shopping list of everything running low')}>
            <EmeraldMark size={16} className="text-emerald" />Shopping list from Emerald
          </Button>
        )} />

      {loading ? (
        <Skeleton className="h-48 rounded-panel" />
      ) : clear ? (
        <Panel padded={false}>
          <EmptyState icon={CheckCircle2} title="Nothing needs attention" description="Nothing is running low or about to expire." />
        </Panel>
      ) : (
        <div className="space-y-6">
          {expiring!.length > 0 && (
            <Panel title="Expiring food" description={`${expiring!.length} item${expiring!.length === 1 ? '' : 's'}`} padded={false}>
              <DataTable columns={expiringCols} rows={expiring!} rowKey={i => i.id} initialSort={{ key: 'date', dir: 'asc' }} caption="Expiring food" />
            </Panel>
          )}
          {low!.length > 0 && (
            <Panel title="Running low" description={`${low!.length} item${low!.length === 1 ? '' : 's'}`} padded={false}>
              <DataTable columns={lowCols} rows={low!} rowKey={i => i.id} initialSort={{ key: 'qty', dir: 'asc' }} caption="Running low" />
            </Panel>
          )}
        </div>
      )}
    </Page>
  )
}
