import { z } from 'zod'
import type { ToolSpec } from '../llm/types'
import { browserTools } from './browser'
import { fileTools } from './files'
import { financeTools } from './finance'
import { mailTools } from './mail'
import type { ToolDefinition } from './types'
import { workerTools } from './worker'

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>()

  constructor(defs: ToolDefinition[]) {
    for (const d of defs) {
      if (this.tools.has(d.name)) throw new Error(`Duplicate tool ${d.name}`)
      this.tools.set(d.name, d)
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()]
  }

  /** The only view of the environment the model gets. */
  specs(): ToolSpec[] {
    return this.list().map((t) => ({ name: t.name, description: t.description, parameters: toParameters(t.input) }))
  }
}

function toParameters(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  delete json.$schema
  return json
}

export function createRegistry(): ToolRegistry {
  return new ToolRegistry([...fileTools, ...mailTools, ...financeTools, ...browserTools, ...workerTools])
}
