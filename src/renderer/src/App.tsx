import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppState, FocusTarget } from '@shared/types'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ActivityPanel } from '@/components/activity-panel'
import { ChatPanel } from '@/components/chat-panel'
import { ErrorBoundary } from '@/components/error-boundary'
import { Header } from '@/components/header'
import { SandboxPanel } from '@/components/sandbox-panel'
import { Workspace } from '@/components/workspace'
import { useRun } from '@/hooks/use-run'
import { api } from '@/lib/api'

export function App() {
  const [app, setApp] = useState<AppState | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [manualView, setManualView] = useState<FocusTarget>({ kind: 'none' })
  const [following, setFollowing] = useState(false)
  const [overlay, setOverlay] = useState(false)
  const run = useRun(runId)

  const refreshState = useCallback(async () => setApp(await api.invoke('app:state')), [])

  // Initial load: show the active run, or the most recent one.
  useEffect(() => {
    void (async () => {
      const [state, runs] = await Promise.all([api.invoke('app:state'), api.invoke('run:list')])
      setApp(state)
      setRunId(state.activeRunId ?? state.interruptedRunId ?? runs[0]?.id ?? null)
      if (state.activeRunId) setFollowing(true)
    })()
  }, [])

  useEffect(() => api.on('run:updated', () => void refreshState()), [refreshState])

  const active = run.info?.status === 'running' || run.info?.status === 'awaiting_user'

  // While following, the Workspace shows whatever the worker last touched; clicking anything takes over.
  const view = following && run.focus ? run.focus : manualView
  const pulse = useMemo(() => run.events.filter((e) => e.type === 'focus_changed').length, [run.events])

  const open = (target: FocusTarget) => {
    setManualView(target)
    setFollowing(false)
  }

  if (!app) return <div className="flex h-full items-center justify-center text-muted-foreground">Starting sandbox…</div>

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <Header app={app} busy={Boolean(app.activeRunId)} onState={setApp} onOverlay={setOverlay} />
        {app.interruptedRunId && !active && (
          <div className="flex items-center gap-3 border-b bg-warning/10 px-4 py-1.5 text-[12.5px]">
            A task was interrupted when the app closed.
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={async () => {
                setRunId(app.interruptedRunId)
                setFollowing(true)
                await api.invoke('run:resume', { runId: app.interruptedRunId! })
                await refreshState()
              }}
            >
              Resume it
            </Button>
          </div>
        )}
        <div className="grid min-h-0 flex-1 grid-cols-[272px_minmax(0,1fr)_360px] grid-rows-[minmax(0,1fr)_minmax(180px,34%)]">
          <div className="row-span-2 flex min-h-0 flex-col">
            <ErrorBoundary label="Sandbox">
              <SandboxPanel view={view} onOpen={open} readOnly={Boolean(app.activeRunId)} portalUrl={app.portalUrl} />
            </ErrorBoundary>
          </div>
          <div className="flex min-h-0 flex-col">
            <ErrorBoundary label="Workspace">
              <Workspace view={view} pulse={pulse} following={active && following} readOnly={Boolean(app.activeRunId)} hidePortal={overlay} />
            </ErrorBoundary>
            {active && !following && (
              <button className="border-t bg-accent py-1 text-[12px] text-accent-foreground hover:underline" onClick={() => setFollowing(true)}>
                Follow the worker again
              </button>
            )}
          </div>
          <div className="row-span-2 flex min-h-0 flex-col">
            <ErrorBoundary label="Activity">
              <ActivityPanel run={run.info} items={run.activity} worklist={run.worklist} />
            </ErrorBoundary>
          </div>
          <ErrorBoundary label="Chat">
          <ChatPanel
            app={app}
            run={run.info}
            items={run.chat}
            onStarted={(id) => {
              setRunId(id)
              setFollowing(true)
              void refreshState()
            }}
            onShowPortal={() => open({ kind: 'portal' })}
          />
          </ErrorBoundary>
        </div>
      </div>
    </TooltipProvider>
  )
}
