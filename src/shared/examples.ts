import type { ScenarioId } from './scenarios'

/** Example tasks shown in the chat. The runtime treats them like any typed task. */
export const EXAMPLE_TASKS: { label: string; task: string; scenarios?: ScenarioId[] }[] = [
  {
    label: 'Portal invoice → Finance',
    task: 'Get the latest unpaid invoice from Acme Supplies on the vendor portal and add it to Finance.',
  },
  {
    label: 'Ambiguous vendor',
    task: 'Get the latest unpaid invoice from Acme on the vendor portal and add it to Finance.',
    scenarios: ['ambiguous_vendor'],
  },
  {
    label: 'Batch: all unpaid Acme',
    task: 'Add all unpaid Acme Supplies invoices from the vendor portal to Finance.',
  },
  {
    label: 'Overdue summary',
    task: 'List overdue invoices and save a summary to Notes/overdue.md.',
  },
  {
    label: 'Emailed invoice → Finance',
    task: 'Check the inbox for the Brightline Logistics invoice and make sure it is recorded in Finance.',
  },
]
