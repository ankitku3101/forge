import type { ChatMessage } from '../llm/types'

/**
 * Value provenance: every value the worker writes must be traceable to something it actually
 * observed in this run (a document, page, email or record) or to something the user said.
 * Derived from persisted history, so it is resumable and works on any data, not just the sandbox.
 */

export interface Source {
  id: string
  label: string
  /** Said by the user (the task or an answer). Authoritative on its own. */
  fromUser: boolean
  /** Normalized text used for matching. */
  text: string
}

export function collectSources(messages: ChatMessage[]): Source[] {
  const sources: Source[] = []
  const firstUser = messages.find((m) => m.role === 'user')
  if (firstUser?.role === 'user') sources.push({ id: 'task', label: 'your task', fromUser: true, text: normalize(firstUser.content) })

  for (const m of messages) {
    if (m.role !== 'tool') continue
    let obs: { ok?: boolean; data?: unknown }
    try {
      obs = JSON.parse(m.content) as typeof obs
    } catch {
      continue // truncated observation: not a trustworthy source
    }
    if (!obs.ok || obs.data === undefined) continue
    const data = obs.data as Record<string, unknown>
    if (m.name === 'ask_user') {
      sources.push({ id: m.toolCallId, label: 'your answer', fromUser: true, text: normalize(String(data.answer ?? '')) })
      continue
    }
    sources.push({ id: m.toolCallId, label: labelFor(m.name, data), fromUser: false, text: normalize(leaves(data).join('\n')) })
  }
  return sources
}

function labelFor(tool: string, data: Record<string, unknown>): string {
  if (typeof data.path === 'string') return data.path
  if (typeof data.url === 'string') return `portal page ${new URL(data.url).pathname}`
  if (tool === 'open_mail' && typeof data.subject === 'string') return `email "${data.subject}"`
  if (tool === 'get_record' && typeof data.id === 'number') return `Finance record ${data.id}`
  return `${tool} result`
}

function leaves(v: unknown): string[] {
  if (v === null || v === undefined) return []
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return [String(v)]
  if (Array.isArray(v)) return v.flatMap(leaves)
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).flatMap(leaves)
  return []
}

/** Lowercase, collapse whitespace, drop thousands separators so "$4,812.50" reads as "$4812.50". */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/\s+/g, ' ')
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Regexes that find an amount as it might be printed: 4812.5 → 4812.50 / 4812.5; 120 → 120 / 120.00. */
function amountPattern(amount: number): RegExp {
  const cents = Math.round(amount * 100)
  const whole = Math.trunc(cents / 100)
  const frac = cents % 100
  const body = frac === 0 ? `${whole}(?:\\.00?)?` : frac % 10 === 0 ? `${whole}\\.${frac / 10}0?` : `${whole}\\.${String(frac).padStart(2, '0')}`
  return new RegExp(`(?<![\\d.])${body}(?![\\d]|\\.\\d)`)
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** An ISO date as it might be printed: 2026-10-28, 10/28/2026, Oct 28, 2026, 28 October 2026… */
function datePattern(iso: string): RegExp {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const month = MONTHS[m - 1]!
  const mon = month.slice(0, 3)
  const variants = [
    iso,
    `0?${m}/0?${d}/${y}`,
    `(?:${month}|${mon}\\.?) 0?${d}(?:st|nd|rd|th)?,? ${y}`,
    `0?${d}(?:st|nd|rd|th)? (?:${month}|${mon}\\.?),? ${y}`,
  ]
  return new RegExp(`(?<![\\d])(?:${variants.join('|')})(?![\\d])`)
}

function tokenPattern(token: string): RegExp {
  return new RegExp(`(?<![a-z0-9])${escape(normalize(token.trim()))}(?![a-z0-9])`)
}

export type Field = { name: string; label: string; value: string | number; kind: 'amount' | 'date' | 'token' | 'text' }

function patternFor(f: Field): RegExp {
  if (f.kind === 'amount') return amountPattern(Number(f.value))
  if (f.kind === 'date') return datePattern(String(f.value))
  if (f.kind === 'token') return tokenPattern(String(f.value))
  return new RegExp(escape(normalize(String(f.value).trim())))
}

export interface ProvenanceResult {
  /** field name → label of the source it was found in */
  found: Record<string, string>
  missing: string[]
}

/**
 * Finds a source for every field. Fields in `anchored` must appear in the same source as the
 * `anchor` field (e.g. an amount next to its invoice number), unless the user stated them.
 */
export function traceFields(sources: Source[], fields: Field[], opts: { anchor?: string; anchored?: string[] } = {}): ProvenanceResult {
  const found: Record<string, string> = {}
  const missing: string[] = []
  const anchorField = opts.anchor ? fields.find((f) => f.name === opts.anchor) : undefined
  const anchorRe = anchorField ? patternFor(anchorField) : null
  const patterns = new Map(fields.map((f) => [f.name, patternFor(f)]))

  // Prefer the single observed source that backs the most values (e.g. the invoice PDF over a list
  // page that only repeats the total); ties go to the most recent observation.
  const observed = sources.filter((s) => !s.fromUser).reverse()
  const score = (s: Source) => fields.filter((f) => patterns.get(f.name)!.test(s.text)).length
  const ranked = [...observed].sort((a, b) => score(b) - score(a))

  for (const f of fields) {
    const re = patterns.get(f.name)!
    const mustCoLocate = anchorRe && opts.anchored?.includes(f.name)
    const hit =
      ranked.find((s) => re.test(s.text) && (!mustCoLocate || anchorRe.test(s.text))) ?? sources.find((s) => s.fromUser && re.test(s.text))
    if (hit) found[f.name] = hit.label
    else missing.push(mustCoLocate ? `${f.label} ${display(f)} (not found alongside ${anchorField!.label.toLowerCase()} ${display(anchorField!)})` : `${f.label} ${display(f)}`)
  }
  return { found, missing }
}

function display(f: Field): string {
  return f.kind === 'amount' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(f.value)) : String(f.value)
}

/** Amounts, ISO dates and invoice-like identifiers mentioned in free text (e.g. a summary file). */
export function extractCheckableValues(text: string): Field[] {
  const out = new Map<string, Field>()
  for (const m of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?!\d)/g)) {
    const value = Number(`${m[1]!.replace(/,/g, '')}.${m[2] ?? '00'}`)
    out.set(`amount:${value}`, { name: `amount:${value}`, label: 'Amount', value, kind: 'amount' })
  }
  for (const m of text.matchAll(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g)) {
    out.set(`date:${m[0]}`, { name: `date:${m[0]}`, label: 'Date', value: m[0], kind: 'date' })
  }
  for (const m of text.matchAll(/(?<![A-Za-z0-9])[A-Z]{2,4}-\d{3,6}(?![A-Za-z0-9])/g)) {
    out.set(`id:${m[0]}`, { name: `id:${m[0]}`, label: 'Identifier', value: m[0], kind: 'token' })
  }
  return [...out.values()]
}
