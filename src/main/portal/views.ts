import { formatMoney } from '../sandbox/pdf'

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

const CSS = `
:root { --navy:#14305a; --ink:#1d2433; --line:#d5dbe5; --bg:#f3f5f9; --accent:#e8a33d; }
* { box-sizing: border-box; }
body { margin:0; font-family: Georgia, 'Times New Roman', serif; color: var(--ink); background: var(--bg); }
header { background: var(--navy); color: #fff; padding: 14px 28px; display:flex; align-items:center; justify-content:space-between; }
header .brand { font-size: 19px; letter-spacing: .3px; }
header .brand b { color: var(--accent); font-weight: normal; }
header nav a { color:#dbe6f7; margin-left: 18px; font-family: Arial, sans-serif; font-size: 14px; }
main { max-width: 980px; margin: 28px auto; padding: 0 20px; }
h1 { font-weight: normal; font-size: 26px; margin: 0 0 18px; }
.panel { background:#fff; border:1px solid var(--line); border-radius: 4px; padding: 22px; }
table { width:100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 14px; }
th { text-align:left; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; color:#5b6578; border-bottom: 2px solid var(--line); padding: 8px 10px; }
td { border-bottom: 1px solid var(--line); padding: 10px; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.badge { display:inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.badge.paid { background:#e3f4e8; color:#1f6b3a; } .badge.unpaid { background:#fff3dc; color:#8a5a00; } .badge.overdue { background:#fde4e2; color:#a12a1f; }
a { color: var(--navy); }
form label { display:block; font-family: Arial, sans-serif; font-size: 13px; margin: 14px 0 4px; color:#46506a; }
input[type=text], input[type=password] { width: 100%; padding: 9px 10px; border:1px solid #b9c2d3; border-radius: 3px; font-size: 15px; }
button, .button { margin-top: 18px; background: var(--navy); color:#fff; border:0; padding: 10px 18px; border-radius: 3px; font-size: 14px; cursor:pointer; text-decoration:none; display:inline-block; font-family: Arial, sans-serif; }
.notice { padding: 10px 12px; border-radius: 3px; margin-bottom: 14px; font-family: Arial, sans-serif; font-size: 14px; }
.notice.error { background:#fde4e2; color:#a12a1f; } .notice.info { background:#e5eefb; color: var(--navy); }
.captcha { background:#f7f2e7; border:1px solid var(--line); display:inline-block; margin-top: 4px; }
dl { display:grid; grid-template-columns: 180px 1fr; row-gap: 10px; font-family: Arial, sans-serif; font-size: 14px; }
dt { color:#5b6578; }
.cards { display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.card { background:#fff; border:1px solid var(--line); border-radius: 6px; padding: 16px; font-family: Arial, sans-serif; font-size: 14px; }
.card h2 { font-size: 15px; margin: 0 0 6px; }
.filters { margin-bottom: 14px; font-family: Arial, sans-serif; font-size: 14px; }
.filters a { margin-right: 12px; }
`

export function layout(title: string, body: string, opts: { user?: string } = {}): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)} · Arcus Vendor Portal</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head>
<body><header><div class="brand">Arcus <b>Vendor Portal</b></div>
<nav>${opts.user ? `<span style="font-family:Arial;font-size:13px;color:#b8c7e0">Signed in as ${esc(opts.user)}</span><a href="/invoices">Invoices</a><a href="/logout">Sign out</a>` : ''}</nav></header>
<main>${body}</main></body></html>`
}

export function loginPage(opts: { captchaSvg: string; error?: string; info?: string; username?: string }): string {
  return layout(
    'Sign in',
    `<div class="panel" style="max-width:420px;margin:40px auto">
<h1>Sign in</h1>
${opts.info ? `<div class="notice info" role="status">${esc(opts.info)}</div>` : ''}
${opts.error ? `<div class="notice error" role="alert">${esc(opts.error)}</div>` : ''}
<form method="post" action="/login" autocomplete="off">
<label for="username">Username</label><input type="text" id="username" name="username" value="${esc(opts.username ?? '')}">
<label for="password">Password</label><input type="password" id="password" name="password">
<label for="captcha">Type the characters shown</label>
<div class="captcha" id="captcha-image" aria-label="captcha image">${opts.captchaSvg}</div>
<input type="text" id="captcha" name="captcha" autocomplete="off">
<button type="submit">Sign in</button>
</form></div>`,
  )
}

export interface InvoiceRow {
  id: number
  vendorName: string
  invoiceNumber: string
  amountCents: number
  currency: string
  issueDate: string
  status: string
  description: string
}

const STATUS_FILTERS = ['all', 'unpaid', 'overdue', 'paid'] as const

export function invoicesPage(rows: InvoiceRow[], user: string, opts: { status: string; alternate: boolean }): string {
  const filters = `<div class="filters">Show: ${STATUS_FILTERS.map((s) =>
    s === opts.status ? `<b>${s}</b>` : `<a href="/invoices${s === 'all' ? '' : `?status=${s}`}">${s}</a>`,
  ).join(' ')}</div>`
  const empty = rows.length === 0 ? '<p>No invoices match this filter.</p>' : ''
  const body = opts.alternate
    ? `<div class="cards">${rows
        .map(
          (r) => `<div class="card"><h2>${esc(r.vendorName)}</h2>
<div>Ref ${esc(r.invoiceNumber)} · issued ${esc(r.issueDate)}</div>
<div style="margin:6px 0">${esc(formatMoney(r.amountCents, r.currency))} <span class="badge ${esc(r.status)}">${esc(r.status)}</span></div>
<a href="/invoices/${r.id}">Open invoice</a></div>`,
        )
        .join('')}</div>`
    : `<table><thead><tr><th>Vendor</th><th>Invoice no.</th><th>Issued</th><th>Description</th><th style="text-align:right">Amount</th><th>Status</th><th></th></tr></thead><tbody>
${rows
  .map(
    (r) => `<tr><td>${esc(r.vendorName)}</td><td>${esc(r.invoiceNumber)}</td><td>${esc(r.issueDate)}</td><td>${esc(r.description)}</td>
<td class="num">${esc(formatMoney(r.amountCents, r.currency))}</td><td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td>
<td><a href="/invoices/${r.id}">View</a></td></tr>`,
  )
  .join('\n')}</tbody></table>`
  return layout('Invoices', `<h1>Invoices to Arcus</h1>${filters}<div class="${opts.alternate ? '' : 'panel'}">${body}${empty}</div>`, { user })
}

export function invoiceDetailPage(r: InvoiceRow, user: string): string {
  return layout(
    `Invoice ${r.invoiceNumber}`,
    `<p><a href="/invoices">← All invoices</a></p>
<div class="panel"><h1>Invoice ${esc(r.invoiceNumber)}</h1>
<dl><dt>Vendor</dt><dd>${esc(r.vendorName)}</dd>
<dt>Invoice number</dt><dd>${esc(r.invoiceNumber)}</dd>
<dt>Issue date</dt><dd>${esc(r.issueDate)}</dd>
<dt>Description</dt><dd>${esc(r.description)}</dd>
<dt>Amount</dt><dd>${esc(formatMoney(r.amountCents, r.currency))}</dd>
<dt>Status</dt><dd><span class="badge ${esc(r.status)}">${esc(r.status)}</span></dd></dl>
<p style="font-family:Arial;font-size:13px;color:#5b6578">Payment terms and due date are stated on the invoice document.</p>
<a class="button" href="/invoices/${r.id}/pdf" download="${esc(r.invoiceNumber)}.pdf">Download PDF</a></div>`,
    { user },
  )
}

export function errorPage(status: number, message: string): string {
  return layout(`Error ${status}`, `<div class="panel"><h1>Error ${status}</h1><p>${esc(message)}</p><p><a href="/invoices">Back to invoices</a></p></div>`)
}
