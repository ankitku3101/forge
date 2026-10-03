import { describe, expect, it } from 'vitest'
import { collectSources, extractCheckableValues, normalize, traceFields, type Field, type Source } from '../src/main/agent/provenance'
import type { ChatMessage } from '../src/main/llm/types'

const src = (label: string, text: string, fromUser = false): Source => ({ id: label, label, fromUser, text: normalize(text) })

const pdf = src('Downloads/ACM-1058.pdf', 'Acme Supplies INVOICE Invoice number ACM-1058 Issue date 2026-09-28 Due date 2026-10-28 Total due (USD) $4,812.50')
const other = src('Downloads/BL-22031.pdf', 'Brightline Logistics Invoice number BL-22031 Total due $1,980.75 Due Oct 15, 2026')

const fields = (amount: number, due = '2026-10-28'): Field[] => [
  { name: 'invoiceNumber', label: 'Invoice number', value: 'ACM-1058', kind: 'token' },
  { name: 'amount', label: 'Amount', value: amount, kind: 'amount' },
  { name: 'dueDate', label: 'Due date', value: due, kind: 'date' },
]
const anchored = { anchor: 'invoiceNumber', anchored: ['amount', 'dueDate'] }

describe('value provenance', () => {
  it('traces values to the document they came from, across formats', () => {
    const res = traceFields([pdf, other], fields(4812.5), anchored)
    expect(res.missing).toEqual([])
    expect(res.found).toEqual({ invoiceNumber: pdf.label, amount: pdf.label, dueDate: pdf.label })
  })

  it('rejects values that appear nowhere', () => {
    expect(traceFields([pdf], fields(4900), anchored).missing[0]).toContain('$4,900.00')
    expect(traceFields([pdf], fields(4812.5, '2026-11-28'), anchored).missing[0]).toContain('2026-11-28')
  })

  it('does not accept a near miss as a match', () => {
    expect(traceFields([src('x', 'ACM-1058 total 4812.55')], fields(4812.5).slice(0, 2), anchored).missing).toHaveLength(1)
    expect(traceFields([src('x', 'ACM-10580 4812.50')], fields(4812.5).slice(0, 1)).missing).toHaveLength(1)
  })

  it('requires the amount to sit next to its invoice number', () => {
    // $1,980.75 exists, but only in another invoice.
    const res = traceFields([pdf, other], fields(1980.75), anchored)
    expect(res.missing[0]).toContain('not found alongside invoice number ACM-1058')
  })

  it('accepts values the user stated, without co-location', () => {
    const answer = src('your answer', 'use October 30, 2026 as the due date', true)
    expect(traceFields([pdf, answer], fields(4812.5, '2026-10-30'), anchored).found.dueDate).toBe('your answer')
  })

  it('matches common date spellings', () => {
    const f: Field[] = [{ name: 'd', label: 'Date', value: '2026-10-15', kind: 'date' }]
    expect(traceFields([other], f).missing).toEqual([])
    expect(traceFields([src('x', 'due 10/15/2026')], f).missing).toEqual([])
    expect(traceFields([src('x', 'due 15 October 2026')], f).missing).toEqual([])
  })

  it('builds sources from history: task, successful observations and answers only', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Add invoice ACM-1058' },
      { role: 'tool', toolCallId: 'a', name: 'read_file', content: JSON.stringify({ ok: true, data: { path: 'x.pdf', text: 'Total $10.00' } }) },
      { role: 'tool', toolCallId: 'b', name: 'read_file', content: JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Total $99.00' } }) },
      { role: 'tool', toolCallId: 'c', name: 'ask_user', content: JSON.stringify({ ok: true, data: { answer: 'Acme Supplies' } }) },
    ]
    const sources = collectSources(messages)
    expect(sources.map((s) => [s.label, s.fromUser])).toEqual([
      ['your task', true],
      ['x.pdf', false],
      ['your answer', true],
    ])
  })

  it('extracts checkable values from free text', () => {
    const values = extractCheckableValues('Overdue: ACM-1046 ($1,385.20, due 2026-09-19) and NO-5512 ($312.40).')
    expect(values.map((v) => v.value)).toEqual([1385.2, 312.4, '2026-09-19', 'ACM-1046', 'NO-5512'])
  })
})
