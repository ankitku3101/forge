import { afterEach, describe, expect, it } from 'vitest'
import { CAPTCHA_COOKIE, SESSION_COOKIE } from '../src/main/portal/server'
import { createHeadlessSandbox, type HeadlessSandbox } from '../src/main/sandbox/headless'

/** Minimal cookie-jar HTTP client against the real portal server. */
function client(base: string) {
  const jar = new Map<string, string>()
  return {
    jar,
    async req(path: string, init: RequestInit = {}) {
      const res = await fetch(base + path, {
        ...init,
        redirect: 'manual',
        headers: { ...(init.headers as Record<string, string>), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      })
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';')
        const [k, v] = pair!.split('=')
        if (v) jar.set(k!, v)
        else jar.delete(k!)
      }
      return res
    },
  }
}

async function login(sb: HeadlessSandbox, c: ReturnType<typeof client>, password = 'demo123') {
  await c.req('/login')
  const answer = sb.portal.captchaAnswer(c.jar.get(CAPTCHA_COOKIE)!)!
  return c.req('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'demo', password, captcha: answer }).toString(),
  })
}

describe('portal', () => {
  let sb: HeadlessSandbox
  afterEach(() => sb?.close())

  it('requires login, then lists invoices and serves PDFs', async () => {
    sb = await createHeadlessSandbox('happy_path')
    const c = client(sb.server.url)
    expect((await c.req('/invoices')).headers.get('location')).toBe('/login')

    const res = await login(sb, c)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/invoices')
    expect(c.jar.has(SESSION_COOKIE)).toBe(true)

    const list = await (await c.req('/invoices?status=unpaid')).text()
    expect(list).toContain('ACM-1058')
    expect(list).not.toContain('ACM-1031')

    const pdf = await c.req('/invoices/4/pdf')
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(pdf.headers.get('content-disposition')).toContain('ACM-1058.pdf')
  })

  it('rejects a wrong captcha or password', async () => {
    sb = await createHeadlessSandbox('happy_path')
    const c = client(sb.server.url)
    expect((await login(sb, c, 'wrong')).status).toBe(401)
    await c.req('/login')
    const bad = await c.req('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'username=demo&password=demo123&captcha=zzzzz',
    })
    expect(bad.status).toBe(401)
    expect(await bad.text()).toContain('did not match')
  })

  it('expires the session mid-task in session_expired', async () => {
    sb = await createHeadlessSandbox('session_expired')
    const c = client(sb.server.url)
    await login(sb, c)
    expect((await c.req('/invoices')).status).toBe(200)
    expect((await c.req('/invoices/4')).status).toBe(200)
    expect((await c.req('/invoices/4/pdf')).headers.get('location')).toBe('/login?expired=1')
    // Only once: after signing in again the task can finish.
    await login(sb, c)
    expect((await c.req('/invoices/4/pdf')).status).toBe(200)
  })

  it('injects a 503 and an alternate layout when configured', async () => {
    sb = await createHeadlessSandbox('happy_path', { faults: { portal503FirstRequest: true, portalAlternateLayout: true } })
    const c = client(sb.server.url)
    expect((await c.req('/login')).status).toBe(503)
    await login(sb, c)
    expect(await (await c.req('/invoices')).text()).toContain('class="cards"')
  })
})
