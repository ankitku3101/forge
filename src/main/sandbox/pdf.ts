import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Fixtures, PortalInvoiceFixture } from './fixtures'
import { invoiceTotalCents } from './fixtures'

export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

/** Renders an invoice PDF from fixture data, so the document matches ground truth exactly. */
export async function renderInvoicePdf(inv: PortalInvoiceFixture, f: Fixtures): Promise<Uint8Array> {
  const vendor = f.vendors.find((v) => v.name === inv.vendor)
  if (!vendor) throw new Error(`Unknown vendor ${inv.vendor}`)

  const doc = await PDFDocument.create()
  doc.setTitle(`Invoice ${inv.invoiceNumber}`)
  doc.setAuthor(inv.vendor)
  // Fixed dates keep the bytes deterministic across seeds.
  doc.setCreationDate(new Date(`${inv.issueDate}T00:00:00Z`))
  doc.setModificationDate(new Date(`${inv.issueDate}T00:00:00Z`))
  const page = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.12, 0.12, 0.14)
  const muted = rgb(0.4, 0.4, 0.45)

  let y = 740
  const text = (s: string, x: number, size = 10, f2 = font, color = ink) => page.drawText(s, { x, y, size, font: f2, color })

  text(inv.vendor, 50, 18, bold)
  text('INVOICE', 470, 18, bold)
  y -= 18
  text(vendor.address, 50, 9, font, muted)
  y -= 12
  text(vendor.email, 50, 9, font, muted)

  y -= 40
  text('Bill to', 50, 9, bold, muted)
  text('Invoice number', 340, 9, bold, muted)
  text(inv.invoiceNumber, 450, 10, bold)
  y -= 14
  text(f.company.name, 50, 10)
  text('Issue date', 340, 9, bold, muted)
  text(inv.issueDate, 450, 10)
  y -= 14
  text(f.company.address, 50, 9)
  if (inv.dueDate) {
    text('Due date', 340, 9, bold, muted)
    text(inv.dueDate, 450, 10)
  }

  y -= 50
  text('Description', 50, 9, bold, muted)
  text('Qty', 340, 9, bold, muted)
  text('Unit price', 400, 9, bold, muted)
  text('Amount', 500, 9, bold, muted)
  y -= 6
  page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 0.5, color: muted })
  for (const li of inv.lineItems) {
    y -= 18
    text(li.description, 50)
    text(String(li.quantity), 340)
    text(formatMoney(Math.round(li.unitPrice * 100), inv.currency), 400)
    text(formatMoney(Math.round(li.quantity * li.unitPrice * 100), inv.currency), 500)
  }
  y -= 12
  page.drawLine({ start: { x: 340, y }, end: { x: 562, y }, thickness: 0.5, color: muted })
  y -= 20
  text(`Total due (${inv.currency})`, 340, 11, bold)
  text(formatMoney(invoiceTotalCents(inv), inv.currency), 500, 11, bold)

  y -= 50
  text('Remit to', 50, 9, bold, muted)
  y -= 14
  text(`${inv.bank ?? vendor.bank}, account ${inv.remitAccount ?? vendor.remitAccount}`, 50, 10)

  y -= 30
  text(`Payment terms: ${inv.dueDate ? 'see due date above' : 'to be confirmed'}. Thank you for your business.`, 50, 9, font, muted)

  if (inv.hiddenNote) {
    // White 1pt text: invisible on the page, but present in the extracted text a model reads.
    page.drawText(inv.hiddenNote, { x: 50, y: 40, size: 1, font, color: rgb(1, 1, 1) })
  }

  return doc.save({ useObjectStreams: false })
}
