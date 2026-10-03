import { Bot, KeyRound, Loader2, Lock, Play, ShieldCheck, ShieldQuestion, Square, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AppState, PendingRequest, RunInfo, UserResponse } from '@shared/types'
import { EXAMPLE_TASKS } from '@shared/examples'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
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
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [items.length, run?.pending])

  const respond = async (response: UserResponse) => {
    if (run) await api.invoke('run:respond', { runId: run.id, response })
  }

  return (
    <section className="flex min-h-0 flex-col border-t bg-card">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl space-y-2.5 px-4 py-3">
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
      <div className="mx-auto w-full max-w-3xl px-4 pb-3">
        {active ? <Working run={run} /> : <Composer app={app} onStarted={onStarted} />}
      </div>
    </section>
  )
}

function Welcome({ app }: { app: AppState }) {
  return (
    <div className="py-2 text-muted-foreground">
      Give the worker a task inside Arcus. It plans, uses the apps on the left, asks you when it needs approval or a sign-in, and verifies its work.
      {!app.hasPrimaryKey && <div className="mt-2 text-warning">No Groq API key yet. Add one in Settings (gear icon) or in .env.</div>}
    </div>
  )
}

function Message({ item }: { item: ChatItem }) {
  if (item.kind === 'task' || item.kind === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <div className={cn('max-w-[80%] rounded-lg px-3 py-2', item.kind === 'task' ? 'bg-primary text-primary-foreground' : 'bg-secondary')}>{item.text}</div>
        <User className="mt-2 size-4 shrink-0 text-muted-foreground" />
      </div>
    )
  }
  if (item.kind === 'worker') {
    return (
      <div className="flex gap-2">
        <Bot className="mt-2 size-4 shrink-0 text-primary" />
        <div className="max-w-[80%] rounded-lg border bg-background px-3 py-2">{item.text}</div>
      </div>
    )
  }
  if (item.kind === 'failure') {
    return (
      <div className="flex gap-2">
        <Bot className="mt-2 size-4 shrink-0 text-destructive" />
        <div className="max-w-[85%] rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">{item.text}</div>
      </div>
    )
  }
  return (
    <div className="flex gap-2">
      <Bot className="mt-2 size-4 shrink-0 text-success" />
      <div className="max-w-[85%] rounded-lg border bg-background px-3 py-2">
        <div className="whitespace-pre-wrap">{item.text}</div>
        <div className="mt-2 flex items-center gap-2 border-t pt-2 text-[12px] text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Verification <StatusBadge status={item.verification.status} />
          <span>
            {item.verification.checks.filter((c) => c.status === 'verified').length}/{item.verification.checks.length} checks passed
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
    <div className="ml-6 rounded-lg border-2 border-warning/50 bg-background p-3">
      {pending.kind === 'approval' && <ApprovalForm pending={pending} busy={busy} onSend={send} />}
      {pending.kind === 'question' && <QuestionForm pending={pending} busy={busy} onSend={send} />}
      {pending.kind === 'credentials' && <CredentialsForm site={pending.site} busy={busy} onSend={send} onShowPortal={onShowPortal} />}
      {pending.kind === 'captcha' && <CaptchaForm runId={runId} busy={busy} onSend={send} onShowPortal={onShowPortal} />}
      {error && <div className="mt-2 text-[12px] text-destructive">{error}</div>}
    </div>
  )
}

type FormProps<K extends PendingRequest['kind']> = { pending: Extract<PendingRequest, { kind: K }>; busy: boolean; onSend: (r: UserResponse) => void }

function ApprovalForm({ pending, busy, onSend }: FormProps<'approval'>) {
  const [note, setNote] = useState('')
  return (
    <div>
      <div className="flex items-center gap-2 font-medium">
        <ShieldQuestion className="size-4 text-warning" /> Approval needed: {pending.title}
      </div>
      <dl className="mt-2 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
        {Object.entries(pending.details).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-mono">{String(v)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex gap-2">
        <Input placeholder="Optional note if rejecting" value={note} onChange={(e) => setNote(e.target.value)} className="h-8" />
        <Button size="sm" disabled={busy} onClick={() => onSend({ kind: 'approval', approved: true })}>
          Approve
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onSend({ kind: 'approval', approved: false, ...(note ? { note } : {}) })}>
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
      <div className="font-medium">{pending.question}</div>
      {pending.options && (
        <div className="mt-2 flex flex-wrap gap-2">
          {pending.options.map((o) => (
            <Button key={o} size="sm" variant="outline" disabled={busy} onClick={() => onSend({ kind: 'answer', text: o })}>
              {o}
            </Button>
          ))}
        </div>
      )}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) onSend({ kind: 'answer', text: text.trim() })
        }}
      >
        <Input className="h-8" placeholder="Type an answer" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <Button size="sm" disabled={busy || !text.trim()}>
          Send
        </Button>
      </form>
    </div>
  )
}

function SecureNote() {
  return (
    <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <Lock className="size-3" /> Entered straight into the portal page. Never shown to the AI, logged or stored.
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
      <div className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4 text-warning" /> Sign in to {site}
      </div>
      <div className="mt-2 flex gap-2">
        <Input className="h-8" placeholder="Username" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <Input className="h-8" type="password" placeholder="Password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button size="sm" disabled={busy || !username || !password}>
          Sign in
        </Button>
      </div>
      <SecureNote />
      <DoneInPage busy={busy} onSend={onSend} onShowPortal={onShowPortal} />
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
      <div className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4 text-warning" /> Solve the portal captcha
      </div>
      <div className="mt-2 flex items-center gap-2">
        {svg ? (
          <img alt="captcha" className="h-12 rounded border bg-[#f7f2e7]" src={`data:image/svg+xml;base64,${btoa(svg)}`} />
        ) : (
          <span className="text-muted-foreground">Loading captcha…</span>
        )}
        <Input className="h-8 w-36 font-mono" placeholder="Characters" autoComplete="off" value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus />
        <Button size="sm" disabled={busy || !answer}>
          Submit
        </Button>
      </div>
      <SecureNote />
      <DoneInPage busy={busy} onSend={onSend} onShowPortal={onShowPortal} />
    </form>
  )
}

function DoneInPage({ busy, onSend, onShowPortal }: { busy: boolean; onSend: (r: UserResponse) => void; onShowPortal: () => void }) {
  return (
    <div className="mt-1 text-[11.5px] text-muted-foreground">
      Or{' '}
      <button type="button" className="text-primary hover:underline" onClick={onShowPortal}>
        type it into the live portal page
      </button>
      , then{' '}
      <button type="button" disabled={busy} className="text-primary hover:underline" onClick={() => onSend({ kind: 'done_in_page' })}>
        tell the worker you're done
      </button>
      .
    </div>
  )
}

function Working({ run }: { run: RunInfo }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2">
      {run.status === 'running' ? (
        <>
          <Loader2 className="size-4 animate-spin text-primary" /> <span>Worker is on it… step {run.stepCount}</span>
        </>
      ) : (
        <span className="text-warning">The worker is waiting for you (see above).</span>
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
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {examples.map((e) => (
          <button key={e.label} className="rounded-full border px-2.5 py-0.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setTask(e.task)}>
            {e.label}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (task.trim()) void start(task.trim())
        }}
      >
        <Textarea
          rows={2}
          className="min-h-0 resize-none"
          placeholder="Describe a task, e.g. “Get the latest unpaid invoice from Acme Supplies on the vendor portal and add it to Finance.”"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (task.trim()) void start(task.trim())
            }
          }}
        />
        <Button className="h-auto" disabled={busy || !task.trim()}>
          <Play /> Start
        </Button>
      </form>
      {error && <div className="mt-1.5 text-[12px] text-destructive">{error}</div>}
    </div>
  )
}
