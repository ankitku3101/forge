import { Eye, FileText, Globe, Inbox, Landmark, Paperclip, Pencil, Save, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
    <section className="flex min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
        <ViewTitle view={view} />
        {following && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-primary">
            <Eye className="size-3.5" /> Following the worker
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
  const [Icon, text] =
    view.kind === 'file'
      ? [FileText, view.path]
      : view.kind === 'mail'
        ? [Inbox, 'Mail']
        : view.kind === 'record' || view.kind === 'records'
          ? [Landmark, 'Finance ledger']
          : view.kind === 'portal'
            ? [Globe, 'Arcus Vendor Portal (live)']
            : [Eye, 'Workspace']
  return (
    <div className="flex min-w-0 items-center gap-2 font-medium">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{text}</span>
    </div>
  )
}

function EmptyWorkspace() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-sm text-center text-muted-foreground">
        <p className="text-sm text-foreground">Nothing open yet</p>
        <p className="mt-1">Pick a file, email or record on the left, or give the worker a task. Whatever it touches will appear here.</p>
      </div>
    </div>
  )
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

  if (error) return <p className="p-4 text-destructive">{error}</p>
  if (!data) return null

  if (data.kind === 'binary') return <p className="p-4 text-muted-foreground">Binary file ({data.size} bytes).</p>

  if (data.kind === 'pdf') {
    return (
      <div className="flex h-full flex-col">
        <div className="flex gap-1 border-b px-3 py-1.5">
          <Button size="sm" variant={mode === 'doc' ? 'secondary' : 'ghost'} onClick={() => setMode('doc')}>
            Document
          </Button>
          <Button size="sm" variant={mode === 'text' ? 'secondary' : 'ghost'} onClick={() => setMode('text')}>
            Extracted text (what the worker reads)
          </Button>
        </div>
        {mode === 'doc' && pdfUrl ? (
          <iframe title={path} src={pdfUrl} className="min-h-0 w-full flex-1 bg-white" />
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <pre className="p-4 font-mono text-[12px] whitespace-pre-wrap">{data.text}</pre>
          </ScrollArea>
        )}
      </div>
    )
  }

  const editing = draft !== null
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        {!editing ? (
          <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => setDraft(data.text)}>
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
              <Save /> Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              <X /> Cancel
            </Button>
          </>
        )}
      </div>
      {editing ? (
        <Textarea className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-[12px] focus-visible:ring-0" value={draft} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <pre className="p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">{data.text}</pre>
        </ScrollArea>
      )}
    </div>
  )
}

function MailView({ id }: { id: number }) {
  const { data, error } = useSandboxData('mail', () => api.invoke('mail:get', { id }), [id])
  if (error) return <p className="p-4 text-destructive">{error}</p>
  if (!data) return null
  return (
    <ScrollArea className="h-full">
      <article className="mx-auto max-w-2xl p-6">
        <h2 className="text-lg font-semibold">{data.subject}</h2>
        <div className="mt-2 flex flex-wrap gap-x-4 text-muted-foreground">
          <span>
            From <span className="text-foreground">{data.fromName}</span> &lt;{data.fromAddress}&gt;
          </span>
          <span>To {data.toAddress}</span>
          <span>{formatDate(data.receivedAt)}</span>
        </div>
        <div className="mt-5 text-[13.5px] leading-relaxed whitespace-pre-wrap">{data.body}</div>
        {data.attachments.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {data.attachments.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1">
                <Paperclip className="size-3.5 text-muted-foreground" />
                {a.filename}
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

function RecordsView({ selectedId, changed, pulse, readOnly }: { selectedId: number | null; changed?: string[]; pulse: number; readOnly: boolean }) {
  const { data } = useSandboxData('finance', () => api.invoke('finance:list'))
  const [editing, setEditing] = useState<number | null>(null)
  const selectedRef = useRef<HTMLTableRowElement>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, data])

  if (!data) return null
  const flashAll = changed?.includes('*')
  return (
    <ScrollArea className="h-full">
      <table className="w-full text-left">
        <thead className="sticky top-0 bg-background text-[11px] tracking-wide text-muted-foreground uppercase">
          <tr className="border-b">
            <th className="px-4 py-2 font-medium">Vendor</th>
            <th className="px-2 py-2 font-medium">Invoice no.</th>
            <th className="px-2 py-2 text-right font-medium">Amount</th>
            <th className="px-2 py-2 font-medium">Issued</th>
            <th className="px-2 py-2 font-medium">Due</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Notes</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {data.records.map((r) => {
            const selected = r.id === selectedId
            const flash = (f: string) => (selected && (flashAll || changed?.includes(f)) ? `flash-${pulse}` : '')
            return editing === r.id ? (
              <EditRow key={r.id} record={r} onDone={() => setEditing(null)} />
            ) : (
              <tr key={r.id} ref={selected ? selectedRef : undefined} className={cn('border-b', selected && 'bg-accent/60', flashAll && selected && 'flash')}>
                <td className="px-4 py-2 font-medium">{r.vendorName}</td>
                <td className="px-2 py-2 font-mono text-[12px]">{r.invoiceNumber}</td>
                <Cell flashKey={flash('amount')} className="text-right font-mono tabular-nums">
                  {formatMoney(r.amount, r.currency)}
                </Cell>
                <td className="px-2 py-2 text-muted-foreground">{r.issueDate ?? '—'}</td>
                <Cell flashKey={flash('dueDate')}>{r.dueDate ?? <span className="text-warning">none</span>}</Cell>
                <Cell flashKey={flash('status')}>
                  <StatusBadge status={r.status} />
                </Cell>
                <Cell flashKey={flash('notes')} className="max-w-[220px] truncate text-muted-foreground">
                  {r.notes}
                </Cell>
                <td className="px-2">
                  <Button size="icon" variant="ghost" className="size-7" disabled={readOnly} title="Edit record" onClick={() => setEditing(r.id)}>
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
function Cell({ flashKey, className, children }: { flashKey: string; className?: string; children: React.ReactNode }) {
  return (
    <td key={flashKey} className={cn('px-2 py-2', flashKey && 'flash', className)}>
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
    if (!Number.isFinite(n) || n < 0) return setErr('Invalid amount')
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return setErr('Due date must be YYYY-MM-DD')
    try {
      await api.invoke('finance:update', { id: record.id, patch: { amount: n, dueDate: dueDate || null, status, notes } })
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <tr className="border-b bg-muted/50">
      <td className="px-4 py-2 font-medium">{record.vendorName}</td>
      <td className="px-2 py-2 font-mono text-[12px]">{record.invoiceNumber}</td>
      <td className="px-2 py-1">
        <Input className="h-7 text-right font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </td>
      <td className="px-2 py-2 text-muted-foreground">{record.issueDate ?? '—'}</td>
      <td className="px-2 py-1">
        <Input className="h-7 w-28" placeholder="YYYY-MM-DD" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </td>
      <td className="px-2 py-1">
        <select className="h-7 rounded-md border bg-background px-1" value={status} onChange={(e) => setStatus(e.target.value as RecordStatus)}>
          <option value="unpaid">unpaid</option>
          <option value="paid">paid</option>
          <option value="overdue">overdue</option>
        </select>
      </td>
      <td className="px-2 py-1">
        <Input className="h-7" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {err && <div className="mt-1 text-[11px] text-destructive">{err}</div>}
      </td>
      <td className="px-2">
        <div className="flex gap-1">
          <Button size="icon" className="size-7" title="Save" onClick={save}>
            <Save className="size-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="size-7" title="Cancel" onClick={onDone}>
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
    <div ref={ref} className="flex h-full items-center justify-center bg-muted/40 text-muted-foreground">
      {hidden && 'Portal view hidden while a dialog is open'}
    </div>
  )
}
