import type { RecordStatus, RunStatus, VerificationStatus } from '@shared/types'
import { cn } from '@/lib/utils'

const STYLES: Record<string, string> = {
  paid: 'bg-success/12 text-success',
  unpaid: 'bg-warning/15 text-warning',
  overdue: 'bg-destructive/12 text-destructive',
  running: 'bg-primary/12 text-primary',
  awaiting_user: 'bg-warning/15 text-warning',
  completed: 'bg-success/12 text-success',
  failed: 'bg-destructive/12 text-destructive',
  verified: 'bg-success/12 text-success',
  mismatch: 'bg-destructive/12 text-destructive',
  unverifiable: 'bg-muted text-muted-foreground',
}

const LABELS: Record<string, string> = { awaiting_user: 'waiting for you' }

export function StatusBadge({ status, className }: { status: RecordStatus | RunStatus | VerificationStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] leading-none font-medium', STYLES[status], className)}>
      {LABELS[status] ?? status}
    </span>
  )
}
