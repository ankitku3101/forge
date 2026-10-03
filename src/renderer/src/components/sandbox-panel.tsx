import { ChevronRight, FileText, FileType2, Folder, Globe, Inbox, Landmark, Lock, Paperclip } from 'lucide-react'
import { useState } from 'react'
import type { FileEntry, FocusTarget } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSandboxData } from '@/hooks/use-sandbox'
import { api, formatDate, formatMoney } from '@/lib/api'
import { cn } from '@/lib/utils'
import { StatusBadge } from './status-badge'

interface Props {
  view: FocusTarget
  onOpen: (target: FocusTarget) => void
  readOnly: boolean
  portalUrl: string
}

export function SandboxPanel({ view, onOpen, readOnly, portalUrl }: Props) {
  return (
    <aside className="flex min-h-0 flex-1 flex-col border-r bg-card">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Arcus sandbox</span>
        {readOnly && (
          <Badge variant="secondary" className="gap-1 font-normal">
            <Lock className="size-3" /> Read-only during task
          </Badge>
        )}
      </div>
      <Tabs defaultValue="files" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="mx-2 mt-2 grid w-auto grid-cols-4">
          <TabsTrigger value="files" title="Files">
            <Folder className="size-4" />
          </TabsTrigger>
          <TabsTrigger value="mail" title="Mail">
            <Inbox className="size-4" />
          </TabsTrigger>
          <TabsTrigger value="finance" title="Finance">
            <Landmark className="size-4" />
          </TabsTrigger>
          <TabsTrigger value="portal" title="Vendor Portal">
            <Globe className="size-4" />
          </TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="min-h-0 flex-1">
          <FilesList view={view} onOpen={onOpen} />
        </TabsContent>
        <TabsContent value="mail" className="min-h-0 flex-1">
          <MailList view={view} onOpen={onOpen} />
        </TabsContent>
        <TabsContent value="finance" className="min-h-0 flex-1">
          <FinanceList view={view} onOpen={onOpen} />
        </TabsContent>
        <TabsContent value="portal" className="min-h-0 flex-1 p-3">
          <PortalCard onOpen={onOpen} portalUrl={portalUrl} active={view.kind === 'portal'} />
        </TabsContent>
      </Tabs>
    </aside>
  )
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</div>
}

function FilesList({ view, onOpen }: Pick<Props, 'view' | 'onOpen'>) {
  const { data } = useSandboxData('files', () => api.invoke('files:list'))
  return (
    <ScrollArea className="h-full">
      <PanelTitle>Shared drive</PanelTitle>
      <div className="px-1 pb-3">{data?.map((e) => <TreeNode key={e.path} entry={e} depth={0} view={view} onOpen={onOpen} />)}</div>
    </ScrollArea>
  )
}

function TreeNode({ entry, depth, view, onOpen }: { entry: FileEntry; depth: number } & Pick<Props, 'view' | 'onOpen'>) {
  const [open, setOpen] = useState(true)
  const pad = { paddingLeft: 8 + depth * 14 }
  if (entry.type === 'dir') {
    return (
      <div>
        <button className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-muted" style={pad} onClick={() => setOpen(!open)}>
          <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <Folder className="size-4 text-muted-foreground" />
          <span>{entry.name}</span>
          <span className="ml-auto text-[11px] text-muted-foreground">{entry.children?.length || ''}</span>
        </button>
        {open && entry.children?.map((c) => <TreeNode key={c.path} entry={c} depth={depth + 1} view={view} onOpen={onOpen} />)}
      </div>
    )
  }
  const active = view.kind === 'file' && view.path === entry.path
  const Icon = entry.name.endsWith('.pdf') ? FileType2 : FileText
  return (
    <button
      className={cn('flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-muted', active && 'bg-accent text-accent-foreground')}
      style={{ paddingLeft: 26 + depth * 14 }}
      onClick={() => onOpen({ kind: 'file', path: entry.path })}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{entry.name}</span>
    </button>
  )
}

function MailList({ view, onOpen }: Pick<Props, 'view' | 'onOpen'>) {
  const { data } = useSandboxData('mail', () => api.invoke('mail:list'))
  return (
    <ScrollArea className="h-full">
      <PanelTitle>AP inbox</PanelTitle>
      <div className="pb-3">
        {data?.map((m) => (
          <button
            key={m.id}
            onClick={() => onOpen({ kind: 'mail', id: m.id })}
            className={cn('block w-full border-b px-3 py-2 text-left hover:bg-muted', view.kind === 'mail' && view.id === m.id && 'bg-accent')}
          >
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{m.fromName}</span>
              {m.hasAttachments && <Paperclip className="size-3 shrink-0 text-muted-foreground" />}
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatDate(m.receivedAt)}</span>
            </div>
            <div className="truncate text-muted-foreground">{m.subject}</div>
          </button>
        ))}
      </div>
    </ScrollArea>
  )
}

function FinanceList({ view, onOpen }: Pick<Props, 'view' | 'onOpen'>) {
  const { data } = useSandboxData('finance', () => api.invoke('finance:list'))
  return (
    <ScrollArea className="h-full">
      <div className="flex items-center justify-between pr-3">
        <PanelTitle>Ledger</PanelTitle>
        <button className="pt-2 text-[11px] text-primary hover:underline" onClick={() => onOpen({ kind: 'records' })}>
          Open table
        </button>
      </div>
      <div className="pb-3">
        {data?.records.map((r) => (
          <button
            key={r.id}
            onClick={() => onOpen({ kind: 'record', id: r.id })}
            className={cn('block w-full border-b px-3 py-2 text-left hover:bg-muted', view.kind === 'record' && view.id === r.id && 'bg-accent')}
          >
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{r.vendorName}</span>
              <span className="ml-auto font-mono text-[12px] tabular-nums">{formatMoney(r.amount, r.currency)}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="font-mono text-[12px]">{r.invoiceNumber}</span>
              <StatusBadge status={r.status} className="ml-auto" />
            </div>
          </button>
        ))}
      </div>
    </ScrollArea>
  )
}

function PortalCard({ onOpen, portalUrl, active }: { onOpen: Props['onOpen']; portalUrl: string; active: boolean }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-3">
        <div className="font-medium">Arcus Vendor Portal</div>
        <p className="mt-1 text-muted-foreground">Where vendors post invoices to Arcus. A real local website; the worker uses it through a browser.</p>
        <div className="mt-2 font-mono text-[12px] break-all text-muted-foreground">{portalUrl}</div>
        <button
          className={cn('mt-3 w-full rounded-md border px-3 py-1.5 text-center hover:bg-muted', active && 'border-primary text-primary')}
          onClick={() => onOpen({ kind: 'portal' })}
        >
          {active ? 'Showing in workspace' : 'Open in workspace'}
        </button>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Demo login: <span className="font-mono">demo</span> / <span className="font-mono">demo123</span>. You can also open the URL in any browser.
      </p>
    </div>
  )
}
