import { randomBytes } from 'node:crypto'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express, { type NextFunction, type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import svgCaptcha from 'svg-captcha'
import { desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { portalInvoices, portalUsers } from '../db/schema'
import type { Faults } from '../sandbox/faults'
import { verifyPassword } from './auth'
import { errorPage, invoiceDetailPage, invoicesPage, loginPage, type InvoiceRow } from './views'

export const SESSION_COOKIE = 'arcus_portal_sid'
export const CAPTCHA_COOKIE = 'arcus_portal_cid'

interface Session {
  userId: number
  displayName: string
  expiresAt: number
}

export interface PortalOptions {
  getDb: () => Db
  getFaults: () => Faults
  sessionTtlMs?: number
}

export interface Portal {
  app: express.Express
  /** Harness-only: the answer for a captcha id, used by evals' `captcha: "fixture"` auto-responder. */
  captchaAnswer(cid: string): string | null
  /** Drops all sessions and captchas (on sandbox reset). */
  clearState(): void
}

const STATUSES = ['unpaid', 'paid', 'overdue'] as const

export function createPortal(opts: PortalOptions): Portal {
  const sessionTtlMs = opts.sessionTtlMs ?? 30 * 60_000
  const sessions = new Map<string, Session>()
  const captchas = new Map<string, string>()

  const app = express()
  app.disable('x-powered-by')
  app.use(cookieParser())
  app.use(express.urlencoded({ extended: false }))

  // Fault injection: latency and a 503 on the very first request.
  app.use(async (_req, res, next) => {
    const faults = opts.getFaults()
    if (faults.config.portalLatencyMs > 0) await new Promise((r) => setTimeout(r, faults.config.portalLatencyMs))
    if (faults.takePortal503()) {
      res.status(503).type('html').send(errorPage(503, 'The portal is temporarily unavailable. Please try again.'))
      return
    }
    next()
  })

  const newCaptcha = (res: Response, req: Request): string => {
    const cid = (req.cookies?.[CAPTCHA_COOKIE] as string | undefined) ?? randomBytes(12).toString('hex')
    const c = svgCaptcha.create({ size: 5, noise: 2, ignoreChars: '0oO1lIi', width: 160, height: 56, background: '#f7f2e7' })
    captchas.set(cid, c.text)
    res.cookie(CAPTCHA_COOKIE, cid, { httpOnly: true, sameSite: 'lax' })
    return c.data
  }

  const currentSession = (req: Request): [string, Session] | null => {
    const sid = req.cookies?.[SESSION_COOKIE] as string | undefined
    if (!sid) return null
    const s = sessions.get(sid)
    if (!s) return null
    if (Date.now() > s.expiresAt) {
      sessions.delete(sid)
      return null
    }
    return [sid, s]
  }

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const found = currentSession(req)
    if (!found) {
      const hadCookie = Boolean(req.cookies?.[SESSION_COOKIE])
      res.redirect(hadCookie ? '/login?expired=1' : '/login')
      return
    }
    const [sid, session] = found
    if (opts.getFaults().shouldExpireSession()) {
      sessions.delete(sid)
      res.redirect('/login?expired=1')
      return
    }
    res.locals.session = session
    next()
  }

  app.get('/', (req, res) => res.redirect(currentSession(req) ? '/invoices' : '/login'))

  app.get('/login', (req, res) => {
    const info = req.query.expired ? 'Your session has expired. Please sign in again.' : undefined
    res.type('html').send(loginPage({ captchaSvg: newCaptcha(res, req), info }))
  })

  app.post('/login', async (req, res) => {
    const body = req.body as Record<string, string | undefined>
    const username = (body.username ?? '').trim()
    const password = body.password ?? ''
    const answer = (body.captcha ?? '').trim()
    const cid = req.cookies?.[CAPTCHA_COOKIE] as string | undefined
    const expected = cid ? captchas.get(cid) : undefined
    if (cid) captchas.delete(cid) // single use

    const fail = (error: string) =>
      res.status(401).type('html').send(loginPage({ captchaSvg: newCaptcha(res, req), error, username }))

    if (!expected || answer.toLowerCase() !== expected.toLowerCase()) return fail('The characters did not match the image. Please try again.')
    const [user] = await opts.getDb().select().from(portalUsers).where(eq(portalUsers.username, username))
    if (!user || !verifyPassword(password, user.passwordHash)) return fail('Invalid username or password.')

    const sid = randomBytes(18).toString('hex')
    sessions.set(sid, { userId: user.id, displayName: user.displayName, expiresAt: Date.now() + sessionTtlMs })
    opts.getFaults().onPortalLogin()
    res.cookie(SESSION_COOKIE, sid, { httpOnly: true, sameSite: 'lax' })
    res.redirect('/invoices')
  })

  const logout = (req: Request, res: Response) => {
    const sid = req.cookies?.[SESSION_COOKIE] as string | undefined
    if (sid) sessions.delete(sid)
    res.clearCookie(SESSION_COOKIE)
    res.redirect('/login')
  }
  app.get('/logout', logout)
  app.post('/logout', logout)

  const toRow = (r: typeof portalInvoices.$inferSelect): InvoiceRow => ({
    id: r.id,
    vendorName: r.vendorName,
    invoiceNumber: r.invoiceNumber,
    amountCents: r.amountCents,
    currency: r.currency,
    issueDate: r.issueDate,
    status: r.status,
    description: r.description,
  })

  app.get('/invoices', requireAuth, async (req, res) => {
    const status = STATUSES.find((s) => s === req.query.status)
    const rows = await opts
      .getDb()
      .select()
      .from(portalInvoices)
      .where(status ? eq(portalInvoices.status, status) : undefined)
      .orderBy(desc(portalInvoices.issueDate), desc(portalInvoices.id))
    const session = res.locals.session as Session
    res.type('html').send(
      invoicesPage(rows.map(toRow), session.displayName, { status: status ?? 'all', alternate: opts.getFaults().config.portalAlternateLayout }),
    )
  })

  app.get('/invoices/:id', requireAuth, async (req, res) => {
    const id = Number(req.params.id)
    const [row] = Number.isInteger(id) ? await opts.getDb().select().from(portalInvoices).where(eq(portalInvoices.id, id)) : []
    if (!row) {
      res.status(404).type('html').send(errorPage(404, 'Invoice not found.'))
      return
    }
    res.type('html').send(invoiceDetailPage(toRow(row), (res.locals.session as Session).displayName))
  })

  app.get('/invoices/:id/pdf', requireAuth, async (req, res) => {
    const id = Number(req.params.id)
    const [row] = Number.isInteger(id)
      ? await opts.getDb().select({ pdf: portalInvoices.pdf, no: portalInvoices.invoiceNumber }).from(portalInvoices).where(eq(portalInvoices.id, id))
      : []
    if (!row) {
      res.status(404).type('html').send(errorPage(404, 'Invoice not found.'))
      return
    }
    res.setHeader('Content-Disposition', `attachment; filename="${row.no}.pdf"`)
    res.type('application/pdf').send(Buffer.from(row.pdf))
  })

  app.use((_req, res) => {
    res.status(404).type('html').send(errorPage(404, 'Page not found.'))
  })

  return {
    app,
    captchaAnswer: (cid) => captchas.get(cid) ?? null,
    clearState: () => {
      sessions.clear()
      captchas.clear()
    },
  }
}

export interface RunningServer {
  url: string
  port: number
  close(): Promise<void>
}

/** Listens on 127.0.0.1, preferring `port` and falling back to a free one. */
export async function listen(app: express.Express, port = 0): Promise<RunningServer> {
  const tryListen = (p: number) =>
    new Promise<Server>((resolve, reject) => {
      const server = app.listen(p, '127.0.0.1')
      server.once('listening', () => resolve(server))
      server.once('error', reject)
    })
  let server: Server
  try {
    server = await tryListen(port)
  } catch (err) {
    if (port === 0) throw err
    server = await tryListen(0)
  }
  const actual = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
