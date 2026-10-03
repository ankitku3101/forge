import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  KeyRound,
  Loader2,
  MessageCircleQuestion,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Sparkles,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { RunInfo } from '@shared/types'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ActivityItem } from '@/hooks/use-run'
import { formatTime } from '@/lib/api'
import { cn } from '@/lib/utils'
import { StatusBadge } from './status-badge'

export function ActivityPanel({ run, items }: { run: RunInfo | null; items: ActivityItem[] }) {
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [items.length])

  return (
    <aside className="flex min-h-0 flex-1 flex-col border-l bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Activity</span>
        {run && (
          <>
            <StatusBadge status={run.status} className="ml-auto" />
            <span className="text-[11px] text-muted-foreground">{run.stepCount} steps</span>
          </>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ol className="space-y-1.5 p-3">
          {items.length === 0 && <li className="py-8 text-center text-muted-foreground">Every step the worker takes shows up here: tool, result, retries, approvals and verification.</li>}
          {items.map((item) => (
            <li key={item.id}>
              <Item item={item} />
            </li>
          ))}
        </ol>
        <div ref={bottom} />
      </ScrollArea>
    </aside>
  )
}

function Item({ item }: { item: ActivityItem }) {
  switch (item.kind) {
    case 'note':
      return (
        <div className="flex gap-2 px-1 py-1 text-[12px] text-muted-foreground italic">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          <span className="whitespace-pre-wrap">{item.text}</span>
        </div>
      )
    case 'fallback':
      return (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[12px]">
          <RefreshCw className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>
            Switched to fallback model <span className="font-mono">{item.to}</span> ({item.reason}).
          </span>
        </div>
      )
    case 'security':
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-[12px]">
          <div className="flex items-center gap-1.5 font-medium text-destructive">
            <ShieldAlert className="size-3.5" /> Possible prompt injection in {item.tool} result
          </div>
          <p className="mt-1 text-muted-foreground">Flagged as untrusted. The worker was warned, and values in this text can't be used as sources.</p>
          {item.snippets.map((s, i) => (
            <blockquote key={i} className="mt-1.5 border-l-2 border-destructive/40 pl-2 font-mono text-[11px] whitespace-pre-wrap">
              {s}
            </blockquote>
          ))}
        </div>
      )
    case 'verification':
      return <Verification item={item} />
    case 'end':
      return (
        <div className={cn('flex items-start gap-2 rounded-md px-2.5 py-2 font-medium', item.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>
          {item.ok ? <Check className="mt-0.5 size-4 shrink-0" /> : <X className="mt-0.5 size-4 shrink-0" />}
          <span>{item.text}</span>
        </div>
      )
    case 'step':
      return <Step item={item} />
  }
}

const WAIT_ICON = { approval: ShieldQuestion, question: MessageCircleQuestion, credentials: KeyRound, captcha: KeyRound }
const WAIT_TEXT = { approval: 'Waiting for your approval', question: 'Waiting for your answer', credentials: 'Waiting for sign-in', captcha: 'Waiting for captcha' }

function Step({ item }: { item: Extract<ActivityItem, { kind: 'step' }> }) {
  const [open, setOpen] = useState(false)
  const WaitIcon = item.waitingFor ? WAIT_ICON[item.waitingFor] : Clock
  return (
    <div className={cn('rounded-md border bg-background', item.status === 'error' && 'border-destructive/40', item.status === 'waiting' && 'border-warning/60')}>
      <button className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left" onClick={() => setOpen(!open)}>
        <StepIcon status={item.status} />
        <span className="font-mono text-[12px] font-medium">{item.tool}</span>
        {item.risk === 'financial' && <span className="rounded bg-warning/15 px-1 text-[10px] text-warning">financial</span>}
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{summarizeInput(item.input)}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {item.policy && (
        <div className="flex items-start gap-1.5 border-t px-2.5 py-1 text-[11px] text-muted-foreground">
          <Scale className="mt-px size-3 shrink-0" />
          <span>
            {item.policy.decision === 'auto' ? 'Auto-approved' : item.policy.decision === 'approval' ? 'Needs approval' : 'Denied'}: {item.policy.reason}
            {item.policy.warning && <span className="block text-warning">{item.policy.warning}</span>}
          </span>
        </div>
      )}
      {item.retries.map((r) => (
        <div key={r.attempt} className="flex items-center gap-1.5 border-t px-2.5 py-1 text-[11px] text-warning">
          <RefreshCw className="size-3" /> Retry {r.attempt - 1}: {r.message}
        </div>
      ))}
      {item.status === 'waiting' && item.waitingFor && (
        <div className="flex items-center gap-1.5 border-t px-2.5 py-1 text-[11px] text-warning">
          <WaitIcon className="size-3" /> {WAIT_TEXT[item.waitingFor]}
        </div>
      )}
      {item.response && <div className="border-t px-2.5 py-1 text-[11px] text-muted-foreground">You: {item.response}</div>}
      {item.error && (
        <div className="border-t px-2.5 py-1 text-[11px] text-destructive">
          <span className="font-mono">{item.error.code}</span> {item.error.message}
        </div>
      )}
      {open && (
        <div className="space-y-2 border-t px-2.5 py-2 text-[11px]">
          <Meta label="Step" value={`${item.step} · ${formatTime(item.at)}${item.durationMs ? ` · ${item.durationMs} ms` : ''}${item.model ? ` · ${item.model}` : ''}`} />
          <Json label="Input" value={item.input} />
          {item.output !== undefined && <Json label="Result" value={item.output} />}
        </div>
      )}
    </div>
  )
}

function StepIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
  if (status === 'ok') return <Check className="size-3.5 shrink-0 text-success" />
  if (status === 'error') return <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
  if (status === 'waiting') return <CircleDot className="size-3.5 shrink-0 text-warning" />
  return null
}

function Verification({ item }: { item: Extract<ActivityItem, { kind: 'verification' }> }) {
  const { status, checks } = item.result
  const Icon = status === 'verified' ? ShieldCheck : status === 'mismatch' ? ShieldX : ShieldQuestion
  return (
    <div className={cn('rounded-md border px-2.5 py-2', status === 'verified' ? 'border-success/40 bg-success/5' : status === 'mismatch' ? 'border-destructive/40 bg-destructive/5' : '')}>
      <div className="flex items-center gap-2 font-medium">
        <Icon className={cn('size-4', status === 'verified' ? 'text-success' : status === 'mismatch' ? 'text-destructive' : 'text-muted-foreground')} />
        Independent verification <StatusBadge status={status} className="ml-auto" />
      </div>
      <ul className="mt-1.5 space-y-1 text-[11.5px]">
        {checks.map((c, i) => (
          <li key={i} className="flex gap-1.5">
            <StatusBadge status={c.status} className="shrink-0" />
            <span>
              <span className="font-medium">{CHECK_LABELS[c.kind]}</span> · {c.target}: <span className="text-muted-foreground">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const CHECK_LABELS = { write: 'Write', provenance: 'Provenance', outcome: 'Ground truth (sandbox)' } as const

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      {value}
    </div>
  )
}

function Json({ label, value }: { label: string; value: unknown }) {
  const text = typeof value === 'object' && value !== null && 'snapshot' in value ? { ...(value as object), snapshot: '(page snapshot, see Workspace)' } : value
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <pre className="mt-0.5 max-h-48 overflow-auto rounded bg-muted p-1.5 font-mono text-[10.5px] whitespace-pre-wrap">{JSON.stringify(text, null, 2)}</pre>
    </div>
  )
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  return Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ')
    .slice(0, 120)
}
