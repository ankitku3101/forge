import type { Risk } from '@shared/types'

export type PolicyDecision = 'auto' | 'approval' | 'deny'

/** read → auto · write → auto · financial → approval · destructive → disabled. */
export function decide(tool: { risk: Risk; requiresApproval: boolean }): PolicyDecision {
  switch (tool.risk) {
    case 'destructive':
      return 'deny'
    case 'financial':
      return 'approval'
    case 'read':
    case 'write':
      return tool.requiresApproval ? 'approval' : 'auto'
  }
}
