import { FileText, Globe, Inbox, Landmark, MousePointerClick, Paperclip, Pencil, Save, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FileContent, FinanceRecord, FocusTarget, RecordStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { useSandboxData } from '@/hooks/use-sandbox'
import { api, formatDate, formatMoney } from '@/lib/api'
import { cn } from '@/lib/utils'
import { StatusBadge } from './status-badge'

interface Props {
  view: FocusTarget
  /** Increments on every worker focus change so highlights replay. */
  pulse: number
  following: boolean
  readOnly: boolean
  hidePortal: boolean
}

export function Workspace({ view, pulse, following, readOnly, hidePortal }: Props) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b bg-card px-4">
        <ViewTitle view={view} />
        {following && (
          <span className="ml-auto flex shrink-0 items-center gap-2 text-xs font-medium text-primary">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-40 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            Following the worker
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {view.kind === 'none' && <EmptyWorkspace />}
        {view.kind === 'file' && <FileView key={view.path} path={view.path} readOnly={readOnly} />}
        {view.kind === 'mail' && <MailView id={view.id} />}
        {(view.kind === 'record' || view.kind === 'records') && (
          <RecordsView selectedId={view.kind === 'record' ? view.id : null} changed={view.kind === 'record' ? view.changed : undefined} pulse={pulse} readOnly={readOnly} />
        )}
        {view.kind === 'portal' && <PortalSlot hidden={hidePortal} />}
      </div>
    </section>
  )
}

function ViewTitle({ view }: { view: FocusTarget }) {
  const [Icon, kind, detail] =
    view.kind === 'file'
      ? [FileText, 'File', view.path]
      : view.kind === 'mail'
        ? [Inbox, 'Mail', null]
        : view.kind === 'record' || view.kind === 'records'
          ? [Landmark, 'Finance', 'Ledger']
          : view.kind === 'portal'
            ? [Globe, 'Portal', 'Live page']
            : [MousePointerClick, 'Workspace', null]
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="label-caps">{kind}</span>
      {detail && <span className="truncate font-mono text-xs text-foreground">{detail}</span>}
    </div>
  )
}

function EmptyWorkspace() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-xs space-y-2 text-center">
        <MousePointerClick className="mx-auto size-6 text-muted-foreground" />
        <p className="text-base font-semibold">Nothing open yet</p>
        <p className="text-muted-foreground">Open a file, email or record on the left, or give the worker a task. Whatever it touches appears here.</p>
      </div>
    </div>
  )
}

/** Thin toolbar under the workspace header, shared by every document view. */
function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-card px-4">{children}</div>
}

// ---------------------------------------------------------------------------------------------

function FileView({ path, readOnly }: { path: string; readOnly: boolean }) {
  const { data, error } = useSandboxData<FileContent>('files', () => api.invoke('files:read', { path }), [path])
  const [mode, setMode] = useState<'doc' | 'text'>('doc')
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const pdfUrl = useMemo(() => {
    if (data?.kind !== 'pdf') return null
    const bytes = Uint8Array.from(atob(data.dataBase64), (c) => c.charCodeAt(0))
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  }, [data])
  useEffect(() => () => void (pdfUrl && URL.revokeObjectURL(pdfUrl)), [pdfUrl])

  if (error) return <p className="p-6 text-destructive">{error}</p>
  if (!data) return null

  if (data.kind === 'binary') return <p className="p-6 text-muted-foreground">Binary file ({data.size} bytes). It can't be previewed.</p>

  if (data.kind === 'pdf') {
    return (
      <div className="flex h-full flex-col">
        <Toolbar>
          <div className="flex rounded-md bg-secondary p-1">
            {(
              [
                ['doc', 'Document'],
                ['text', 'What the worker reads'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn('h-7 rounded-sm px-3 text-xs font-medium text-muted-foreground transition-colors', mode === m && 'bg-card text-foreground shadow-xs')}
              >
                {label}
              </button>
            ))}
          </div>
        </Toolbar>
        {mode === 'doc' && pdfUrl ? (
          <iframe title={path} src={pdfUrl} className="min-h-0 w-full flex-1 bg-white" />
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <pre className="mx-auto max-w-3xl px-8 py-6 font-mono text-xs leading-6 whitespace-pre-wrap">{data.text}</pre>
          </ScrollArea>
        )}
      </div>
    )
  }

  const editing = draft !== null
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        {!editing ? (
          <Button size="sm" variant="outline" disabled={readOnly} onClick={() => setDraft(data.text)} title={readOnly ? 'Read-only while the worker runs' : undefined}>
            <Pencil /> Edit
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                try {
                  await api.invoke('files:write', { path, text: draft })
                  setDraft(null)
                } finally {
                  setSaving(false)
                }
              }}
            >
              <Save /> {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </>
        )}
      </Toolbar>
      {editing ? (
        <Textarea
          className="min-h-0 flex-1 resize-none rounded-none border-0 px-8 py-6 font-mono text-xs leading-6 shadow-none focus-visible:ring-0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <pre className="mx-auto max-w-3xl px-8 py-6 font-mono text-xs leading-6 whitespace-pre-wrap">{data.text}</pre>
        </ScrollArea>
      )}
    </div>
  )
}

function MailView({ id }: { id: number }) {
  const { data, error } = useSandboxData('mail', () => api.invoke('mail:get', { id }), [id])
  if (error) return <p className="p-6 text-destructive">{error}</p>
  if (!data) return null
  return (
    <ScrollArea className="h-full">
      <article className="mx-auto max-w-2xl px-8 py-8">
        <h1 className="text-xl font-semibold tracking-tight">{data.subject}</h1>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">From</dt>
          <dd>
            <span className="font-medium">{data.fromName}</span> <span className="font-mono text-muted-foreground">{data.fromAddress}</span>
          </dd>
          <dt className="text-muted-foreground">To</dt>
          <dd className="font-mono">{data.toAddress}</dd>
          <dt className="text-muted-foreground">Received</dt>
          <dd>{formatDate(data.receivedAt)}</dd>
        </dl>
        <div className="mt-6 border-t pt-6 leading-6 whitespace-pre-wrap">{data.body}</div>
        {data.attachments.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {data.attachments.map((a) => (
              <span key={a.id} className="inline-flex h-8 items-center gap-2 rounded-md border bg-card px-3 text-xs">
                <Paperclip className="size-3.5 text-muted-foreground" />
                <span className="font-mono">{a.filename}</span>
                <span className="text-muted-foreground">{Math.ceil(a.size / 1024)} KB</span>
              </span>
            ))}
          </div>
        )}
      </article>
    </ScrollArea>
  )
}

// ---------------------------------------------------------------------------------------------

const TH = 'h-10 px-3 text-left align-middle whitespace-nowrap label-caps'
const TD = 'h-12 px-3 align-middle whitespace-nowrap'

function RecordsView({ selectedId, changed, pulse, readOnly }: { selectedId: number | null; changed?: string[]; pulse: number; readOnly: boolean }) {
  const { data } = useSandboxData('finance', () => api.invoke('finance:list'))
  const [editing, setEditing] = useState<number | null>(null)
  const selectedRef = useRef<HTMLTableRowElement>(null)

  useEffect(() => {
    void selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, data])

  if (!data) return null
  const flashAll = changed?.includes('*')
  return (
    <ScrollArea className="h-full">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b">
            <th className={cn(TH, 'pl-4')}>Vendor</th>
            <th className={TH}>Invoice</th>
            <th className={cn(TH, 'text-right')}>Amount</th>
            <th className={TH}>Issued</th>
            <th className={TH}>Due</th>
            <th className={TH}>Status</th>
            <th className={TH}>Notes</th>
            <th className="w-12" />
          </tr>
        </thead>
        <tbody>
          {data.records.map((r) => {
            const selected = r.id === selectedId
            const flash = (f: string) => (selected && (flashAll || changed?.includes(f)) ? `flash-${pulse}` : '')
            return editing === r.id ? (
              <EditRow key={r.id} record={r} onDone={() => setEditing(null)} />
            ) : (
              <tr
                key={r.id}
                ref={selected ? selectedRef : undefined}
                className={cn('border-b transition-colors hover:bg-accent/40', selected && 'bg-accent hover:bg-accent', flashAll && selected && 'flash')}
              >
                <td className={cn(TD, 'pl-4 font-medium')}>{r.vendorName}</td>
                <td className={cn(TD, 'font-mono text-xs')}>{r.invoiceNumber}</td>
                <Cell flashKey={flash('amount')} className="text-right font-mono text-xs">
                  {formatMoney(r.amount, r.currency)}
                </Cell>
                <td className={cn(TD, 'font-mono text-xs text-muted-foreground')}>{r.issueDate ?? '—'}</td>
                <Cell flashKey={flash('dueDate')} className="font-mono text-xs">
                  {r.dueDate ?? <span className="font-sans text-warning">Not set</span>}
                </Cell>
                <Cell flashKey={flash('status')}>
                  <StatusBadge status={r.status} />
                </Cell>
                <Cell flashKey={flash('notes')} className="w-full max-w-0 truncate text-xs text-muted-foreground">
                  <span title={r.notes}>{r.notes}</span>
                </Cell>
                <td className="pr-3 text-right">
                  <Button size="icon" variant="ghost" className="size-8" disabled={readOnly} title={readOnly ? 'Read-only while the worker runs' : 'Edit record'} onClick={() => setEditing(r.id)}>
                    <Pencil className="size-3.5" />
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </ScrollArea>
  )
}

/** A table cell that briefly highlights when the worker changes it. Remounts on each pulse to replay. */
function Cell({ flashKey, className, children }: { flashKey: string; className?: string; children: ReactNode }) {
  return (
    <td key={flashKey} className={cn(TD, flashKey && 'flash', className)}>
      {children}
    </td>
  )
}

function EditRow({ record, onDone }: { record: FinanceRecord; onDone: () => void }) {
  const [amount, setAmount] = useState(String(record.amount))
  const [dueDate, setDueDate] = useState(record.dueDate ?? '')
  const [status, setStatus] = useState<RecordStatus>(record.status)
  const [notes, setNotes] = useState(record.notes)
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    const n = Number(amount)
    if (!Number.isFinite(n) || n < 0) return setErr('Enter a valid amount.')
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return setErr('Use YYYY-MM-DD for the due date.')
    try {
      await api.invoke('finance:update', { id: record.id, patch: { amount: n, dueDate: dueDate || null, status, notes } })
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <tr className="border-b bg-secondary">
      <td className={cn(TD, 'pl-4 font-medium')}>{record.vendorName}</td>
      <td className={cn(TD, 'font-mono text-xs')}>{record.invoiceNumber}</td>
      <td className={TD}>
        <Input className="h-8 text-right font-mono text-xs" aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </td>
      <td className={cn(TD, 'font-mono text-xs text-muted-foreground')}>{record.issueDate ?? '—'}</td>
      <td className={TD}>
        <Input className="h-8 w-32 font-mono text-xs" aria-label="Due date" placeholder="YYYY-MM-DD" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </td>
      <td className={TD}>
        <select
          aria-label="Status"
          className="h-8 rounded-md border border-input bg-card px-2 text-xs"
          value={status}
          onChange={(e) => setStatus(e.target.value as RecordStatus)}
        >
          <option value="unpaid">Unpaid</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
      </td>
      <td className={TD}>
        <Input className="h-8 text-xs" aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {err && <div className="mt-1 text-2xs text-destructive">{err}</div>}
      </td>
      <td className="pr-3">
        <div className="flex justify-end gap-1">
          <Button size="icon" className="size-8" title="Save" onClick={save}>
            <Save className="size-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="size-8" title="Cancel" onClick={onDone}>
            <X className="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------------------------

/** Reserves space for the native portal view and keeps its bounds in sync. */
function PortalSlot({ hidden }: { hidden: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const sync = () => {
      const r = el.getBoundingClientRect()
      void api.invoke('portal:setBounds', { bounds: hidden ? null : { x: r.x, y: r.y, width: r.width, height: r.height } })
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
      void api.invoke('portal:setBounds', { bounds: null })
    }
  }, [hidden])
  return (
    <div ref={ref} className="flex h-full items-center justify-center bg-secondary text-muted-foreground">
      {hidden && 'The live page is hidden while a dialog is open.'}
    </div>
  )
}
