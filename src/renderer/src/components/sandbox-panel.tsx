import { ChevronRight, ExternalLink, FileText, FileType2, Folder, Globe, Inbox, Landmark, Lock, Paperclip } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { FileEntry, FocusTarget } from '@shared/types'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSandboxData } from '@/hooks/use-sandbox'
import { api, formatDate, formatMoney } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PanelHeader } from './panel-header'
import { StatusBadge } from './status-badge'

interface Props {
  view: FocusTarget
  onOpen: (target: FocusTarget) => void
  readOnly: boolean
  portalUrl: string
}

const TABS = [
  { value: 'files', label: 'Files', icon: Folder },
  { value: 'mail', label: 'Mail', icon: Inbox },
  { value: 'finance', label: 'Finance', icon: Landmark },
  { value: 'portal', label: 'Portal', icon: Globe },
] as const

export function SandboxPanel({ view, onOpen, readOnly, portalUrl }: Props) {
  return (
    <aside className="flex min-h-0 flex-1 flex-col border-r bg-card">
      <PanelHeader title="Arcus sandbox">
        {readOnly && (
          <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground" title="The sandbox is read-only while the worker runs a task">
            <Lock className="size-3" /> Read-only
          </span>
        )}
      </PanelHeader>
      <Tabs defaultValue="files" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="mx-3 mt-3 grid w-auto shrink-0 grid-cols-4 p-1 group-data-[orientation=horizontal]/tabs:h-auto">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="h-12 flex-col gap-1 text-2xs">
              <Icon className="size-4" />
              {label}
            </TabsTrigger>
          ))}
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
        <TabsContent value="portal" className="min-h-0 flex-1">
          <PortalCard onOpen={onOpen} portalUrl={portalUrl} active={view.kind === 'portal'} />
        </TabsContent>
      </Tabs>
    </aside>
  )
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-2">
      <span className="label-caps">{children}</span>
      {action}
    </div>
  )
}

/** One row style for every list in the sandbox. */
function Row({ active, onClick, children, className }: { active?: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'block w-full border-l-2 border-transparent px-4 py-2 text-left transition-colors hover:bg-accent/60',
        active && 'border-primary bg-accent hover:bg-accent',
        className,
      )}
    >
      {children}
    </button>
  )
}

function FilesList({ view, onOpen }: Pick<Props, 'view' | 'onOpen'>) {
  const { data } = useSandboxData('files', () => api.invoke('files:list'))
  return (
    <ScrollArea className="h-full">
      <SectionLabel>Shared drive</SectionLabel>
      <div className="pb-4">{data?.map((e) => <TreeNode key={e.path} entry={e} depth={0} view={view} onOpen={onOpen} />)}</div>
    </ScrollArea>
  )
}

function TreeNode({ entry, depth, view, onOpen }: { entry: FileEntry; depth: number } & Pick<Props, 'view' | 'onOpen'>) {
  const [open, setOpen] = useState(true)
  const indent = { paddingLeft: 16 + depth * 16 }
  if (entry.type === 'dir') {
    return (
      <div>
        <button className="flex h-8 w-full items-center gap-2 pr-4 text-left hover:bg-accent/60" style={indent} onClick={() => setOpen(!open)}>
          <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{entry.name}</span>
          <span className="ml-auto text-2xs text-muted-foreground tabular-nums">{entry.children?.length || ''}</span>
        </button>
        {open && entry.children?.map((c) => <TreeNode key={c.path} entry={c} depth={depth + 1} view={view} onOpen={onOpen} />)}
      </div>
    )
  }
  const active = view.kind === 'file' && view.path === entry.path
  const Icon = entry.name.endsWith('.pdf') ? FileType2 : FileText
  return (
    <button
      className={cn(
        'flex h-8 w-full items-center gap-2 border-l-2 border-transparent pr-4 text-left hover:bg-accent/60',
        active && 'border-primary bg-accent text-accent-foreground hover:bg-accent',
      )}
      style={{ paddingLeft: 36 + depth * 16 }}
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
      <SectionLabel>AP inbox</SectionLabel>
      <div className="divide-y pb-4">
        {data?.map((m) => (
          <Row key={m.id} active={view.kind === 'mail' && view.id === m.id} onClick={() => onOpen({ kind: 'mail', id: m.id })}>
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{m.fromName}</span>
              {m.hasAttachments && <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-label="Has attachment" />}
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatDate(m.receivedAt)}</span>
            </div>
            <div className="truncate text-xs text-muted-foreground">{m.subject}</div>
          </Row>
        ))}
      </div>
    </ScrollArea>
  )
}

function FinanceList({ view, onOpen }: Pick<Props, 'view' | 'onOpen'>) {
  const { data } = useSandboxData('finance', () => api.invoke('finance:list'))
  return (
    <ScrollArea className="h-full">
      <SectionLabel
        action={
          <button className="text-xs font-medium text-primary hover:underline" onClick={() => onOpen({ kind: 'records' })}>
            Open ledger
          </button>
        }
      >
        Ledger
      </SectionLabel>
      <div className="divide-y pb-4">
        {data?.records.map((r) => (
          <Row key={r.id} active={view.kind === 'record' && view.id === r.id} onClick={() => onOpen({ kind: 'record', id: r.id })}>
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{r.vendorName}</span>
              <span className="ml-auto font-mono text-xs">{formatMoney(r.amount, r.currency)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{r.invoiceNumber}</span>
              <StatusBadge status={r.status} className="ml-auto" />
            </div>
          </Row>
        ))}
      </div>
    </ScrollArea>
  )
}

function PortalCard({ onOpen, portalUrl, active }: { onOpen: Props['onOpen']; portalUrl: string; active: boolean }) {
  return (
    <div className="space-y-4 p-4">
      <div className="space-y-2">
        <h3 className="text-base font-semibold">Arcus Vendor Portal</h3>
        <p className="text-muted-foreground">Where vendors post invoices to Arcus. A real local website; the worker reaches it only through a browser.</p>
      </div>
      <button
        className={cn(
          'flex h-9 w-full items-center justify-center gap-2 rounded-md border font-medium transition-colors hover:bg-accent',
          active && 'border-primary text-primary',
        )}
        onClick={() => onOpen({ kind: 'portal' })}
      >
        <Globe className="size-4" />
        {active ? 'Showing in workspace' : 'Open in workspace'}
      </button>
      <dl className="space-y-2 rounded-md bg-secondary p-3 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Address</dt>
          <dd className="truncate font-mono">{portalUrl.replace('http://', '')}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Demo login</dt>
          <dd className="font-mono">demo · demo123</dd>
        </div>
      </dl>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
        The address also works in any browser on this machine.
      </p>
    </div>
  )
}
