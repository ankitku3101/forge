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
}

export function Header({ app, busy, onState, onOverlay }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<AppState>) => {
    setResetting(true)
    setError(null)
    try {
      onState(await fn())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setResetting(false)
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-4">
      <Bot className="size-5 text-primary" />
      <div className="font-semibold">Autonomous AI Worker</div>
      <span className="text-muted-foreground">at Arcus Inc.</span>

      <div className="ml-auto flex items-center gap-2">
        {error && <span className="text-[12px] text-destructive">{error}</span>}
        <span className="text-[12px] text-muted-foreground">Scenario</span>
        <Select
          value={app.scenario}
          disabled={busy || resetting}
          onOpenChange={onOverlay}
          onValueChange={(v) => run(() => api.invoke('app:setScenario', { scenario: v as ScenarioId }))}
        >
          <SelectTrigger size="sm" className="w-52" title={SCENARIO_INFO[app.scenario].description}>
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
        <Button size="sm" variant="outline" disabled={busy || resetting} onClick={() => run(() => api.invoke('sandbox:reset'))} title="Rebuild the sandbox from fixtures">
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
          <DialogDescription>Keys are encrypted with your OS keychain (Electron safeStorage) and override .env.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="groq">Groq API key (primary, {app.model})</Label>
            <Input id="groq" type="password" placeholder={app.hasPrimaryKey ? 'Configured. Enter to replace' : 'gsk_…'} value={groq} onChange={(e) => setGroq(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="google">Google API key (fallback, {app.fallbackModel})</Label>
            <Input id="google" type="password" placeholder={app.hasFallbackKey ? 'Configured. Enter to replace' : 'Optional'} value={google} onChange={(e) => setGoogle(e.target.value)} />
          </div>
          {error && <div className="text-[12px] text-destructive">{error}</div>}
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
