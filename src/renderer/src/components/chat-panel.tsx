import { ArrowUp, KeyRound, Loader2, Lock, ShieldCheck, ShieldQuestion, Square, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppState, PendingRequest, RunInfo, UserResponse } from '@shared/types'
import { EXAMPLE_TASKS } from '@shared/examples'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ChatItem } from '@/hooks/use-run'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { StatusBadge } from './status-badge'

interface Props {
  app: AppState
  run: RunInfo | null
  items: ChatItem[]
  onStarted: (runId: string) => void
  onShowPortal: () => void
}

export function ChatPanel({ app, run, items, onStarted, onShowPortal }: Props) {
  const bottom = useRef<HTMLDivElement>(null)
  const active = run && (run.status === 'running' || run.status === 'awaiting_user')
  // Braces matter: scrollIntoView returns a Promise in current Chromium, which must not become the effect's cleanup.
  useEffect(() => {
    void bottom.current?.scrollIntoView({ block: 'end' })
  }, [items.length, run?.pending])

  const respond = async (response: UserResponse) => {
    if (run) await api.invoke('run:respond', { runId: run.id, response })
  }

  return (
    <section className="flex min-h-0 flex-col border-t bg-card">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl space-y-4 px-6 py-4">
          {items.length === 0 && <Welcome app={app} />}
          {items.map((item) => (
            <Message key={item.id} item={item} />
          ))}
          {run?.status === 'awaiting_user' && run.pending && (
            <PendingCard key={run.pending.toolCallId + run.pending.kind} pending={run.pending} runId={run.id} onRespond={respond} onShowPortal={onShowPortal} />
          )}
          <div ref={bottom} />
        </div>
      </ScrollArea>
      <div className="mx-auto w-full max-w-3xl px-6 pb-4">{active ? <Working run={run} /> : <Composer app={app} onStarted={onStarted} />}</div>
    </section>
  )
}

function Welcome({ app }: { app: AppState }) {
  return (
    <div className="space-y-2 pt-2">
      <p className="text-base font-semibold">What should the worker do?</p>
      <p className="max-w-prose text-muted-foreground">
        Give it a task inside Arcus. It plans, uses the apps on the left, asks you before anything financial or any sign-in, and has its work verified independently.
      </p>
      {!app.hasPrimaryKey && (
        <p className="flex items-center gap-2 text-warning">
          <TriangleAlert className="size-4 shrink-0" /> Add a Groq API key in Settings, or set GROQ_API_KEY in .env, before starting a task.
        </p>
      )}
    </div>
  )
}

/** Role label above a message: one quiet line, no avatars. */
function Who({ children, tone }: { children: ReactNode; tone?: 'success' | 'danger' }) {
  return <div className={cn('mb-1 text-2xs font-semibold text-muted-foreground', tone === 'success' && 'text-success', tone === 'danger' && 'text-destructive')}>{children}</div>
}

function Message({ item }: { item: ChatItem }) {
  if (item.kind === 'task' || item.kind === 'user') {
    return (
      <div className="flex flex-col items-end">
        <Who>{item.kind === 'task' ? 'Your task' : 'You'}</Who>
        <div className="max-w-[80%] rounded-lg bg-secondary px-4 py-2 text-secondary-foreground">{item.text}</div>
      </div>
    )
  }
  if (item.kind === 'worker') {
    return (
      <div>
        <Who>Worker</Who>
        <div className="max-w-[80%]">{item.text}</div>
      </div>
    )
  }
  if (item.kind === 'failure') {
    return (
      <div>
        <Who tone="danger">Worker · stopped</Who>
        <div className="max-w-[85%] rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 wrap-break-word">{item.text}</div>
      </div>
    )
  }
  const passed = item.verification.checks.filter((c) => c.status === 'verified').length
  return (
    <div>
      <Who tone="success">Worker · done</Who>
      <div className="max-w-[85%] overflow-hidden rounded-lg border">
        <div className="px-4 py-3 leading-6 whitespace-pre-wrap">{item.text}</div>
        <div className="flex items-center gap-2 border-t bg-secondary px-4 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Verification
          <StatusBadge status={item.verification.status} />
          <span className="tabular-nums">
            {passed} of {item.verification.checks.length} checks passed
          </span>
        </div>
      </div>
    </div>
  )
}

function PendingCard({ pending, runId, onRespond, onShowPortal }: { pending: PendingRequest; runId: string; onRespond: (r: UserResponse) => Promise<void>; onShowPortal: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const send = async (r: UserResponse) => {
    setBusy(true)
    setError(null)
    try {
      await onRespond(r)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <div className="overflow-hidden rounded-lg border border-warning/50 bg-card shadow-xs">
      {pending.kind === 'approval' && <ApprovalForm pending={pending} busy={busy} onSend={send} />}
      {pending.kind === 'question' && <QuestionForm pending={pending} busy={busy} onSend={send} />}
      {pending.kind === 'credentials' && <CredentialsForm site={pending.site} busy={busy} onSend={send} onShowPortal={onShowPortal} />}
      {pending.kind === 'captcha' && <CaptchaForm runId={runId} busy={busy} onSend={send} onShowPortal={onShowPortal} />}
      {error && <div className="border-t px-4 py-2 text-xs text-destructive">{error}</div>}
    </div>
  )
}

function CardHead({ icon: Icon, children }: { icon: typeof KeyRound; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b bg-warning/8 px-4 py-2 font-medium">
      <Icon className="size-4 shrink-0 text-warning" />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

type FormProps<K extends PendingRequest['kind']> = { pending: Extract<PendingRequest, { kind: K }>; busy: boolean; onSend: (r: UserResponse) => void }

function ApprovalForm({ pending, busy, onSend }: FormProps<'approval'>) {
  const [note, setNote] = useState('')
  const { Policy: policy, ...fields } = pending.details
  return (
    <div>
      <CardHead icon={ShieldQuestion}>Approval needed · {pending.title}</CardHead>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 px-4 py-3 text-xs">
        {Object.entries(fields).map(([k, raw]) => {
          // Values arrive as "value  ← source"; show the source on its own muted line.
          const [value, source] = String(raw).split('  ← ')
          return (
            <div key={k} className="contents">
              <dt className="pt-px text-muted-foreground">{k}</dt>
              <dd className="min-w-0">
                <span className="font-mono">{value}</span>
                {source && <span className="block text-2xs text-muted-foreground">from {source}</span>}
              </dd>
            </div>
          )
        })}
      </dl>
      {policy !== undefined && <p className="border-t px-4 py-2 text-xs text-muted-foreground">{String(policy)}</p>}
      <div className="flex gap-2 border-t bg-secondary px-4 py-3">
        <Input placeholder="Optional note if rejecting" value={note} onChange={(e) => setNote(e.target.value)} className="h-9 bg-card" />
        <Button disabled={busy} onClick={() => onSend({ kind: 'approval', approved: true })}>
          Approve
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => onSend({ kind: 'approval', approved: false, ...(note ? { note } : {}) })}>
          Reject
        </Button>
      </div>
    </div>
  )
}

function QuestionForm({ pending, busy, onSend }: FormProps<'question'>) {
  const [text, setText] = useState('')
  return (
    <div>
      <CardHead icon={ShieldQuestion}>{pending.question}</CardHead>
      <div className="space-y-3 px-4 py-3">
        {pending.options && (
          <div className="flex flex-wrap gap-2">
            {pending.options.map((o) => (
              <Button key={o} size="sm" variant="outline" disabled={busy} onClick={() => onSend({ kind: 'answer', text: o })}>
                {o}
              </Button>
            ))}
          </div>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) onSend({ kind: 'answer', text: text.trim() })
          }}
        >
          <Input className="h-9" placeholder="Type an answer" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <Button disabled={busy || !text.trim()}>Send</Button>
        </form>
      </div>
    </div>
  )
}

function SecureFooter({ busy, onSend, onShowPortal }: { busy: boolean; onSend: (r: UserResponse) => void; onShowPortal: () => void }) {
  return (
    <div className="space-y-1 border-t bg-secondary px-4 py-2 text-xs text-muted-foreground">
      <p className="flex items-center gap-2">
        <Lock className="size-3.5 shrink-0" /> Typed straight into the portal page. Never shown to the AI, logged or stored.
      </p>
      <p>
        Or{' '}
        <button type="button" className="font-medium text-primary hover:underline" onClick={onShowPortal}>
          type it into the live page
        </button>
        , then{' '}
        <button type="button" disabled={busy} className="font-medium text-primary hover:underline" onClick={() => onSend({ kind: 'done_in_page' })}>
          tell the worker you're done
        </button>
        .
      </p>
    </div>
  )
}

function CredentialsForm({ site, busy, onSend, onShowPortal }: { site: string; busy: boolean; onSend: (r: UserResponse) => void; onShowPortal: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSend({ kind: 'credentials', username, password })
      }}
    >
      <CardHead icon={KeyRound}>Sign in to {site}</CardHead>
      <div className="flex gap-2 px-4 py-3">
        <Input className="h-9" placeholder="Username" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <Input className="h-9" type="password" placeholder="Password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button disabled={busy || !username || !password}>Sign in</Button>
      </div>
      <SecureFooter busy={busy} onSend={onSend} onShowPortal={onShowPortal} />
    </form>
  )
}

function CaptchaForm({ runId, busy, onSend, onShowPortal }: { runId: string; busy: boolean; onSend: (r: UserResponse) => void; onShowPortal: () => void }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  useEffect(() => {
    void api.invoke('run:captcha', { runId }).then((r) => setSvg(r.svg))
  }, [runId])
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSend({ kind: 'captcha', answer })
      }}
    >
      <CardHead icon={KeyRound}>Solve the portal captcha</CardHead>
      <div className="flex items-center gap-2 px-4 py-3">
        {svg ? (
          // The captcha keeps the portal's own paper colour so its contrast stays as designed.
          <img alt="captcha" className="h-12 rounded-md border bg-white" src={`data:image/svg+xml;base64,${btoa(svg)}`} />
        ) : (
          <span className="text-muted-foreground">Loading captcha…</span>
        )}
        <Input className="h-9 w-40 font-mono" placeholder="Characters" autoComplete="off" value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus />
        <Button disabled={busy || !answer}>Submit</Button>
      </div>
      <SecureFooter busy={busy} onSend={onSend} onShowPortal={onShowPortal} />
    </form>
  )
}

function Working({ run }: { run: RunInfo }) {
  const waiting = run.status === 'awaiting_user'
  return (
    <div className="flex h-12 items-center gap-3 rounded-lg border bg-background px-4">
      {waiting ? (
        <span className="flex items-center gap-2 font-medium text-warning">
          <ShieldQuestion className="size-4" /> Waiting for you, see the card above
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-primary" />
          Working · step <span className="tabular-nums">{run.stepCount}</span>
        </span>
      )}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => api.invoke('run:cancel', { runId: run.id })}>
        <Square className="size-3.5" /> Stop
      </Button>
    </div>
  )
}

function Composer({ app, onStarted }: { app: AppState; onStarted: (id: string) => void }) {
  const [task, setTask] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const start = async (t: string) => {
    setBusy(true)
    setError(null)
    try {
      const { runId } = await api.invoke('run:start', { task: t })
      setTask('')
      onStarted(runId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const examples = EXAMPLE_TASKS.filter((e) => !e.scenarios || e.scenarios.includes(app.scenario))
  return (
    <div className="space-y-2">
      <form
        className="rounded-lg border border-input bg-background shadow-xs transition-colors focus-within:border-ring"
        onSubmit={(e) => {
          e.preventDefault()
          if (task.trim()) void start(task.trim())
        }}
      >
        <textarea
          rows={2}
          className="block w-full resize-none bg-transparent px-4 pt-3 outline-none placeholder:text-muted-foreground"
          placeholder="Describe a task for the worker…"
          aria-label="Task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (task.trim()) void start(task.trim())
            }
          }}
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {examples.map((e) => (
              <button
                key={e.label}
                type="button"
                title={e.task}
                className="h-7 shrink-0 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={() => setTask(e.task)}
              >
                {e.label}
              </button>
            ))}
          </div>
          <Button size="sm" disabled={busy || !task.trim()} aria-label="Start">
            Start <ArrowUp />
          </Button>
        </div>
      </form>
      {error && <p className="px-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
