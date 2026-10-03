import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The one header used by every panel: same height, padding and label style. */
export function PanelHeader({ title, icon, children, className }: { title: ReactNode; icon?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-11 shrink-0 items-center gap-2 border-b px-4', className)}>
      {icon}
      <h2 className="label-caps min-w-0 truncate">{title}</h2>
      {children && <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}
