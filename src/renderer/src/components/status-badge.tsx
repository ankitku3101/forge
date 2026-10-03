import type { RecordStatus, RunStatus, VerificationStatus } from '@shared/types'
import { cn } from '@/lib/utils'

const TONE: Record<string, string> = {
  paid: 'bg-success/10 text-success',
  unpaid: 'bg-warning/12 text-warning',
  overdue: 'bg-destructive/10 text-destructive',
  running: 'bg-primary/10 text-primary',
  awaiting_user: 'bg-warning/12 text-warning',
  completed: 'bg-success/10 text-success',
  failed: 'bg-destructive/10 text-destructive',
  verified: 'bg-success/10 text-success',
  mismatch: 'bg-destructive/10 text-destructive',
  unverifiable: 'bg-secondary text-muted-foreground',
}

const LABEL: Record<string, string> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  overdue: 'Overdue',
  running: 'Running',
  awaiting_user: 'Needs you',
  completed: 'Completed',
  failed: 'Failed',
  verified: 'Verified',
  mismatch: 'Mismatch',
  unverifiable: 'Unverified',
}

export function StatusBadge({ status, className }: { status: RecordStatus | RunStatus | VerificationStatus; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center rounded-sm px-2 text-2xs font-medium', TONE[status], className)}>{LABEL[status] ?? status}</span>
  )
}
