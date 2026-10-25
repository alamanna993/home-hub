import { Key, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, MoreHorizontal } from 'lucide-react'
import { cn } from '../../lib/utils'
import { IconButton } from './Button'
import { Menu, MenuEntry } from './Menu'
import { Skeleton } from './Skeleton'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** Makes the column sortable; return null to sort the row last */
  sortValue?: (row: T) => string | number | null | undefined
  /** Right-aligned with tabular figures */
  numeric?: boolean
  /** CSS width, e.g. '8rem' or '20%' */
  width?: string
  /** Hide on narrower desktop widths (the phone list is separate) */
  hideBelow?: 'lg' | 'xl'
  className?: string
}

export type SortState = { key: string; dir: 'asc' | 'desc' }

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => Key
  onRowClick?: (row: T) => void
  /** Items for a per-row "More actions" menu */
  rowActions?: (row: T) => MenuEntry[]
  initialSort?: SortState
  /** Controlled sort (optional) */
  sort?: SortState
  onSortChange?: (s: SortState) => void
  loading?: boolean
  /** Shown instead of the table when there are no rows (and not loading) */
  empty?: ReactNode
  /** Phone layout for one row. Defaults to the first column as the title and the rest as label/value lines. */
  mobileRow?: (row: T) => ReactNode
  /** Cap the height and scroll inside the table (the header sticks inside it). Without it the header sticks to the page. */
  maxHeight?: string
  /** Accessible table caption */
  caption?: string
  /** Turn on row checkboxes: the selected row keys, and a setter */
  selected?: Set<Key>
  onSelectedChange?: (keys: Set<Key>) => void
  className?: string
}

const hide = { lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' }

export function DataTable<T>({
  columns, rows, rowKey, onRowClick, rowActions, initialSort, sort: sortProp, onSortChange,
  loading, empty, mobileRow, maxHeight, caption, className, selected, onSelectedChange,
}: DataTableProps<T>) {
  const selectable = Boolean(selected && onSelectedChange)
  const [sortState, setSortState] = useState<SortState | undefined>(initialSort)
  const sort = sortProp ?? sortState

  const sorted = useMemo(() => {
    const col = sort && columns.find(c => c.key === sort.key)
    if (!col?.sortValue) return rows
    const get = col.sortValue
    const mul = sort!.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * mul
    })
  }, [rows, sort, columns])

  function toggleSort(key: string) {
    const next: SortState = sort?.key === key && sort.dir === 'asc' ? { key, dir: 'desc' } : { key, dir: 'asc' }
    setSortState(next)
    onSortChange?.(next)
  }

  const keys = sorted.map(rowKey)
  const selectedHere = selectable ? keys.filter(k => selected!.has(k)).length : 0
  const allSelected = selectable && keys.length > 0 && selectedHere === keys.length

  function toggleRow(key: Key) {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onSelectedChange!(next)
  }
  function toggleAll() {
    const next = new Set(selected)
    if (allSelected) keys.forEach(k => next.delete(k))
    else keys.forEach(k => next.add(k))
    onSelectedChange!(next)
  }

  if (!loading && rows.length === 0 && empty) return <>{empty}</>

  const actionsMenu = (row: T) => rowActions && (
    <Menu
      label="Row actions"
      trigger={<IconButton icon={MoreHorizontal} label="More actions" size="sm" onClick={e => e.stopPropagation()} />}
      items={rowActions(row)}
    />
  )

  return (
    <div className={className}>
      {/* Desktop and tablet: table */}
      <div className={cn('hidden md:block', maxHeight && 'overflow-auto')} style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {selectable && (
                <th scope="col" className="sticky top-0 z-10 w-10 border-b border-line bg-surface pl-4">
                  <Checkbox checked={allSelected} indeterminate={selectedHere > 0 && !allSelected}
                    onChange={toggleAll} label={allSelected ? 'Clear selection' : 'Select all'} />
                </th>
              )}
              {columns.map(c => {
                const active = sort?.key === c.key
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={c.width ? { width: c.width } : undefined}
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn(
                      'sticky top-0 z-10 h-9 border-b border-line bg-surface px-3 text-left text-ui font-medium text-muted first:pl-4 last:pr-4',
                      c.numeric && 'text-right',
                      c.hideBelow && hide[c.hideBelow],
                    )}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={cn('-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-ink', active && 'text-ink', c.numeric && 'flex-row-reverse')}
                      >
                        {c.header}
                        {active
                          ? (sort!.dir === 'asc' ? <ArrowUp size={13} aria-hidden /> : <ArrowDown size={13} aria-hidden />)
                          : <ChevronsUpDown size={13} aria-hidden className="opacity-50" />}
                      </button>
                    ) : c.header}
                  </th>
                )
              })}
              {rowActions && <th scope="col" className="sticky top-0 z-10 w-12 border-b border-line bg-surface pr-2"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }, (_, i) => (
                  <tr key={i}>
                    {selectable && <td className="border-b border-line" />}
                    {columns.map(c => (
                      <td key={c.key} className={cn('h-11 border-b border-line px-3 first:pl-4 last:pr-4', c.hideBelow && hide[c.hideBelow])}>
                        <Skeleton className="w-3/4" />
                      </td>
                    ))}
                    {rowActions && <td className="border-b border-line" />}
                  </tr>
                ))
              : sorted.map(row => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn('group', onRowClick && 'cursor-pointer',
                      selectable && selected!.has(rowKey(row)) ? 'bg-action/[0.06]' : 'hover:bg-ink/[0.025]')}
                  >
                    {selectable && (
                      <td className="w-10 border-b border-line pl-4 group-last:border-b-0" onClick={e => e.stopPropagation()}>
                        <Checkbox checked={selected!.has(rowKey(row))} onChange={() => toggleRow(rowKey(row))} label="Select row" />
                      </td>
                    )}
                    {columns.map((c, ci) => (
                      <td
                        key={c.key}
                        className={cn(
                          'h-11 border-b border-line px-3 align-middle text-ink last:pr-4 group-last:border-b-0',
                          !selectable && 'first:pl-4',
                          c.numeric && 'text-right tnum',
                          c.hideBelow && hide[c.hideBelow],
                          c.className,
                        )}
                      >
                        {ci === 0 && onRowClick ? (
                          // Keyboard path to the row action: the first cell is a real button
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); onRowClick(row) }}
                            className="rounded text-left font-medium hover:underline"
                          >
                            {c.cell(row)}
                          </button>
                        ) : c.cell(row)}
                      </td>
                    ))}
                    {rowActions && (
                      <td className="border-b border-line pr-2 text-right group-last:border-b-0" onClick={e => e.stopPropagation()}>
                        {actionsMenu(row)}
                      </td>
                    )}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {/* Phones: list */}
      {selectable && keys.length > 0 && (
        <div className="flex items-center gap-3 border-b border-line px-4 py-2 md:hidden">
          <Checkbox checked={allSelected} indeterminate={selectedHere > 0 && !allSelected} onChange={toggleAll}
            label={allSelected ? 'Clear selection' : 'Select all'} />
          <span className="text-ui text-muted">{allSelected ? 'Clear selection' : 'Select all'}</span>
        </div>
      )}
      <ul className="divide-y divide-line md:hidden">
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="space-y-2 px-4 py-3"><Skeleton className="w-1/2" /><Skeleton className="w-3/4" /></li>
            ))
          : sorted.map(row => (
              <li key={rowKey(row)} className={cn('flex items-start gap-2 px-4 py-3', selectable && selected!.has(rowKey(row)) && 'bg-action/[0.06]')}>
                {selectable && (
                  <div className="pt-0.5"><Checkbox checked={selected!.has(rowKey(row))} onChange={() => toggleRow(rowKey(row))} label="Select" /></div>
                )}
                <div
                  className={cn('min-w-0 flex-1', onRowClick && 'cursor-pointer')}
                  role={onRowClick ? 'button' : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? e => { if (e.key === 'Enter') onRowClick(row) } : undefined}
                >
                  {mobileRow ? mobileRow(row) : <DefaultMobileRow row={row} columns={columns} />}
                </div>
                {rowActions && <div className="-mr-2 -mt-1">{actionsMenu(row)}</div>}
              </li>
            ))}
      </ul>
    </div>
  )
}

function DefaultMobileRow<T>({ row, columns }: { row: T; columns: Column<T>[] }) {
  const [first, ...rest] = columns
  return (
    <>
      <div className="font-medium text-ink">{first.cell(row)}</div>
      {rest.length > 0 && (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-ui">
          {rest.map(c => (
            <div key={c.key} className="contents">
              <dt className="text-muted">{c.header}</dt>
              <dd className={cn('min-w-0 text-ink', c.numeric && 'tnum')}>{c.cell(row)}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  )
}

/** Table checkbox with a real indeterminate state for 'some selected' */
function Checkbox({ checked, indeterminate = false, onChange, label }: {
  checked: boolean; indeterminate?: boolean; onChange: () => void; label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return (
    <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label}
      onClick={e => e.stopPropagation()}
      className="h-4 w-4 cursor-pointer align-middle accent-[rgb(var(--action))]" />
  )
}
