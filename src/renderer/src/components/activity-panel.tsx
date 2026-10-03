import {
  AlertTriangle,
  Check,
  ChevronDown,
  Circle,
  CircleDot,
  CircleSlash,
  Hourglass,
  KeyRound,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  MessageSquareText,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { RunInfo, WorkItem } from '@shared/types'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ActivityItem } from '@/hooks/use-run'
import { formatTime } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PanelHeader } from './panel-header'
import { StatusBadge } from './status-badge'

export function ActivityPanel({ run, items, worklist }: { run: RunInfo | null; items: ActivityItem[]; worklist: WorkItem[] }) {
  const bottom = useRef<HTMLDivElement>(null)
  // Braces matter: scrollIntoView returns a Promise in current Chromium, which must not become the effect's cleanup.
  useEffect(() => {
    void bottom.current?.scrollIntoView({ block: 'end' })
  }, [items.length])

  return (
    <aside className="flex min-h-0 flex-1 flex-col border-l bg-card">
      <PanelHeader title="Activity">
        {run && (
          <>
            <span className="text-2xs text-muted-foreground tabular-nums">
              {run.stepCount} {run.stepCount === 1 ? 'step' : 'steps'}
            </span>
            <StatusBadge status={run.status} />
          </>
        )}
      </PanelHeader>
      {worklist.length > 0 && <WorkItems items={worklist} />}
      <ScrollArea className="min-h-0 flex-1 bg-background">
        <ol className="space-y-2 p-4">
          {items.length === 0 && (
            <li className="space-y-2 py-12 text-center">
              <ListChecks className="mx-auto size-6 text-muted-foreground" />
              <p className="text-muted-foreground">Every step the worker takes appears here: the tool, its result, retries, approvals and verification.</p>
            </li>
          )}
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

/** Shared card shell: same radius, border and padding for every activity entry. */
function Card({ tone = 'plain', children }: { tone?: 'plain' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card',
        tone === 'success' && 'border-success/40',
        tone === 'warning' && 'border-warning/50',
        tone === 'danger' && 'border-destructive/40',
      )}
    >
      {children}
    </div>
  )
}

/** A detail line under a card's header row. */
function Line({ icon: Icon, tone, children }: { icon: typeof Scale; tone?: 'muted' | 'warning' | 'danger'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 border-t px-3 py-2 text-xs',
        (tone ?? 'muted') === 'muted' && 'text-muted-foreground',
        tone === 'warning' && 'text-warning',
        tone === 'danger' && 'text-destructive',
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1 wrap-break-word">{children}</div>
    </div>
  )
}

function Item({ item }: { item: ActivityItem }) {
  switch (item.kind) {
    case 'note': {
      const waiting = item.text.startsWith('Waiting ')
      const Icon = waiting ? Hourglass : MessageSquareText
      return (
        <div className={cn('flex gap-2 px-1 py-1 text-xs', waiting ? 'text-muted-foreground' : 'text-foreground')}>
          <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 wrap-break-word whitespace-pre-wrap">{item.text}</span>
        </div>
      )
    }
    case 'fallback':
      return (
        <Card tone="warning">
          <Line icon={RefreshCw} tone="warning">
            Switched to the fallback model <span className="font-mono">{item.to}</span> ({item.reason}).
          </Line>
        </Card>
      )
    case 'security':
      return (
        <Card tone="danger">
          <div className="flex items-center gap-2 px-3 py-2 font-medium text-destructive">
            <ShieldAlert className="size-4 shrink-0" />
            Possible prompt injection
          </div>
          <Line icon={ShieldAlert}>
            Text in the <span className="font-mono">{item.tool}</span> result tried to instruct the worker. It was flagged as untrusted, and no value inside it can be used as a source.
          </Line>
          {item.snippets.map((s, i) => (
            <blockquote key={i} className="border-t bg-destructive/5 px-3 py-2 font-mono text-2xs leading-4 wrap-break-word whitespace-pre-wrap">
              {s}
            </blockquote>
          ))}
        </Card>
      )
    case 'verification':
      return <Verification item={item} />
    case 'end':
      return (
        <div className={cn('flex items-start gap-2 rounded-lg px-3 py-2 font-medium', item.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>
          {item.ok ? <Check className="mt-0.5 size-4 shrink-0" /> : <X className="mt-0.5 size-4 shrink-0" />}
          <span className="min-w-0 wrap-break-word">{item.text}</span>
        </div>
      )
    case 'step':
      return <Step item={item} />
  }
}

const WAIT_ICON = { approval: ShieldQuestion, question: MessageCircleQuestion, credentials: KeyRound, captcha: KeyRound }
const WAIT_TEXT = { approval: 'Waiting for your approval', question: 'Waiting for your answer', credentials: 'Waiting for you to sign in', captcha: 'Waiting for the captcha' }
const DECISION = { auto: 'Auto-approved', approval: 'Needs approval', deny: 'Denied' }

function Step({ item }: { item: Extract<ActivityItem, { kind: 'step' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <Card tone={item.status === 'error' ? 'danger' : item.status === 'waiting' ? 'warning' : 'plain'}>
      <button className="flex h-9 w-full items-center gap-2 px-3 text-left hover:bg-accent/40" onClick={() => setOpen(!open)} aria-expanded={open}>
        <StepIcon status={item.status} />
        <span className="shrink-0 font-mono text-xs font-medium">{item.tool}</span>
        {item.risk === 'financial' && <span className="shrink-0 rounded-sm bg-warning/12 px-1.5 text-2xs font-medium text-warning">Financial</span>}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summarizeInput(item.input)}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {item.policy && (
        <Line icon={Scale}>
          <span className="font-medium text-foreground">{DECISION[item.policy.decision]}.</span> {item.policy.reason}
          {item.policy.warning && <span className="mt-1 block text-warning">{item.policy.warning}</span>}
        </Line>
      )}
      {item.retries.map((r) => (
        <Line key={r.attempt} icon={RefreshCw} tone="warning">
          Retry {r.attempt - 1}: {r.message}
        </Line>
      ))}
      {item.status === 'waiting' && item.waitingFor && (
        <Line icon={WAIT_ICON[item.waitingFor]} tone="warning">
          {WAIT_TEXT[item.waitingFor]}
        </Line>
      )}
      {item.response && <Line icon={Check}>You: {item.response}</Line>}
      {item.error && (
        <Line icon={AlertTriangle} tone="danger">
          <span className="font-mono">{item.error.code}</span> · {item.error.message}
        </Line>
      )}
      {open && (
        <div className="space-y-3 border-t px-3 py-3 text-xs">
          <p className="text-muted-foreground">
            Step {item.step} · {formatTime(item.at)}
            {item.durationMs ? ` · ${item.durationMs} ms` : ''}
            {item.model ? ` · ${item.model}` : ''}
          </p>
          <Json label="Input" value={item.input} />
          {item.output !== undefined && <Json label="Result" value={item.output} />}
        </div>
      )}
    </Card>
  )
}

function StepIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
  if (status === 'ok') return <Check className="size-3.5 shrink-0 text-success" />
  if (status === 'error') return <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
  if (status === 'waiting') return <CircleDot className="size-3.5 shrink-0 text-warning" />
  if (status === 'stopped') return <CircleSlash className="size-3.5 shrink-0 text-muted-foreground" aria-label="Stopped" />
  return null
}

const CHECK_LABELS = { write: 'Write', provenance: 'Provenance', outcome: 'Ground truth', item: 'Item' } as const
const CHECK_HINTS = { outcome: 'Compared with the sandbox fixtures. Only available in the sandbox.' } as Partial<Record<keyof typeof CHECK_LABELS, string>>

function Verification({ item }: { item: Extract<ActivityItem, { kind: 'verification' }> }) {
  const { status, checks } = item.result
  const Icon = status === 'verified' ? ShieldCheck : status === 'mismatch' ? ShieldX : ShieldQuestion
  return (
    <Card tone={status === 'verified' ? 'success' : status === 'mismatch' ? 'danger' : 'plain'}>
      <div className="flex h-9 items-center gap-2 px-3 font-medium">
        <Icon className={cn('size-4 shrink-0', status === 'verified' ? 'text-success' : status === 'mismatch' ? 'text-destructive' : 'text-muted-foreground')} />
        Independent verification
        <StatusBadge status={status} className="ml-auto" />
      </div>
      <ul className="divide-y border-t">
        {checks.map((c, i) => (
          <li key={i} className="space-y-1 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="shrink-0 font-medium" title={CHECK_HINTS[c.kind]}>
                {CHECK_LABELS[c.kind]}
              </span>
              <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">{c.target}</span>
              <StatusBadge status={c.status} className="ml-auto" />
            </div>
            {c.kind === 'provenance' && c.detail.includes(' ← ') ? (
              // "amount ← Downloads/x.pdf; due date ← …" reads better as one line per field.
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                {c.detail.split('; ').map((pair) => {
                  const [field, source] = pair.split(' ← ')
                  return (
                    <div key={pair} className="contents">
                      <dt className="text-muted-foreground">{field}</dt>
                      <dd className="min-w-0 truncate font-mono text-2xs leading-4.5" title={source}>
                        {source}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            ) : (
              <p className="wrap-break-word text-muted-foreground">{c.detail}</p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function WorkItems({ items }: { items: WorkItem[] }) {
  const done = items.filter((i) => i.status !== 'pending').length
  return (
    <div className="shrink-0 space-y-3 border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <ListChecks className="size-4 text-muted-foreground" />
        <span className="label-caps">Work items</span>
        <span className="ml-auto text-2xs text-muted-foreground tabular-nums">
          {done} of {items.length} resolved
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <ul className="space-y-1 text-xs">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-2">
            {i.status === 'done' ? (
              <Check className="size-3.5 shrink-0 text-success" />
            ) : i.status === 'skipped' ? (
              <X className="size-3.5 shrink-0 text-warning" />
            ) : (
              <Circle className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="font-mono">{i.key}</span>
            <span className="min-w-0 truncate text-muted-foreground" title={i.reason ?? i.description}>
              {i.reason ?? i.description}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Json({ label, value }: { label: string; value: unknown }) {
  const text = typeof value === 'object' && value !== null && 'snapshot' in value ? { ...(value as object), snapshot: '(page snapshot, shown in the Workspace)' } : value
  return (
    <div className="space-y-1">
      <div className="label-caps">{label}</div>
      <pre className="max-h-48 overflow-auto rounded-md bg-secondary p-2 font-mono text-2xs leading-4 whitespace-pre-wrap">{JSON.stringify(text, null, 2)}</pre>
    </div>
  )
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  return Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
    .slice(0, 120)
}
