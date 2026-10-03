import { Bot, RotateCcw, Settings } from 'lucide-react'
import { useState } from 'react'
import { SCENARIO_INFO, SCENARIOS, type ScenarioId } from '@shared/scenarios'
import type { AppState } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'

interface Props {
  app: AppState
  busy: boolean
  onState: (s: AppState) => void
  onOverlay: (open: boolean) => void
  /** Called after the sandbox is rebuilt, so the panels can drop what they were showing. */
  onSandboxRebuilt: () => void
}

export function Header({ app, busy, onState, onOverlay, onSandboxRebuilt }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<AppState>) => {
    setResetting(true)
    setError(null)
    try {
      onState(await fn())
      onSandboxRebuilt()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setResetting(false)
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b bg-card px-4">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground" aria-hidden>
          <Bot className="size-4" />
        </span>
        <span className="font-semibold tracking-tight">Autonomous AI Worker</span>
        <span className="hidden text-muted-foreground lg:inline">· Arcus Inc. sandbox</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {error && <span className="max-w-72 truncate text-xs text-destructive" title={error}>{error}</span>}
        <span
          className="hidden items-center gap-2 text-xs text-muted-foreground xl:flex"
          title={app.hasPrimaryKey ? `Primary model: ${app.model}` : 'No Groq API key configured'}
        >
          <span className={app.hasPrimaryKey ? 'size-2 rounded-full bg-success' : 'size-2 rounded-full bg-destructive'} />
          <span className="font-mono">{app.model}</span>
        </span>
        <span className="mx-2 hidden h-5 w-px bg-border xl:block" />
        <label className="text-xs text-muted-foreground" htmlFor="scenario">
          Scenario
        </label>
        <Select
          value={app.scenario}
          disabled={busy || resetting}
          onOpenChange={onOverlay}
          onValueChange={(v) => run(() => api.invoke('app:setScenario', { scenario: v as ScenarioId }))}
        >
          <SelectTrigger id="scenario" size="sm" className="w-48" title={SCENARIO_INFO[app.scenario].description}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCENARIOS.map((s) => (
              <SelectItem key={s} value={s} title={SCENARIO_INFO[s].description}>
                {SCENARIO_INFO[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" disabled={busy || resetting} onClick={() => run(() => api.invoke('sandbox:reset'))}
          title={busy ? 'Stop the current task before resetting' : 'Rebuild the sandbox and clear task history. API keys are kept.'}
        >
          <RotateCcw className={resetting ? 'animate-spin' : ''} /> Reset
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          title="Settings"
          onClick={() => {
            setSettingsOpen(true)
            onOverlay(true)
          }}
        >
          <Settings />
        </Button>
      </div>
      <SettingsDialog
        open={settingsOpen}
        app={app}
        onState={onState}
        onOpenChange={(o) => {
          setSettingsOpen(o)
          onOverlay(o)
        }}
      />
    </header>
  )
}

function KeyField(props: { id: string; label: string; hint: string; configured: boolean; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={props.id}>{props.label}</Label>
        <span className={props.configured ? 'text-xs text-success' : 'text-xs text-muted-foreground'}>{props.configured ? 'Configured' : 'Not set'}</span>
      </div>
      <Input
        id={props.id}
        type="password"
        className="font-mono"
        placeholder={props.configured ? 'Enter a new key to replace it' : props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <p className="font-mono text-xs text-muted-foreground">{props.hint}</p>
    </div>
  )
}

function SettingsDialog({ open, app, onState, onOpenChange }: { open: boolean; app: AppState; onState: (s: AppState) => void; onOpenChange: (o: boolean) => void }) {
  const [groq, setGroq] = useState('')
  const [google, setGoogle] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    try {
      let s = app
      if (groq) s = await api.invoke('app:setApiKey', { provider: 'groq', key: groq })
      if (google) s = await api.invoke('app:setApiKey', { provider: 'google', key: google })
      onState(s)
      setGroq('')
      setGoogle('')
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Keys are encrypted with your system keychain and take priority over .env.</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <KeyField id="groq" label="Groq API key" hint={`Primary model · ${app.model}`} configured={app.hasPrimaryKey} placeholder="gsk_…" value={groq} onChange={setGroq} />
          <KeyField
            id="google"
            label="Google API key"
            hint={`Optional fallback · ${app.fallbackModel}`}
            configured={app.hasFallbackKey}
            placeholder="Optional"
            value={google}
            onChange={setGoogle}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!groq && !google}>
            Save keys
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
