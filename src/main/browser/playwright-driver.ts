import type { Page, Response } from 'playwright-core'
import { ToolFailure } from '../tools/types'
import type { BrowserDriver, Download, PageInfo } from './driver'
import { SNAPSHOT_SCRIPT } from './snapshot'

const NAV_TIMEOUT = 15_000
/** Filling a form that is already on screen should be instant; anything longer means the page is not what we think. */
const FORM_TIMEOUT = 5_000

/** BrowserDriver over a Playwright page. `getPage` lets the app hand over its CDP-attached portal view. */
export class PlaywrightDriver implements BrowserDriver {
  private lastStatus: number | null = null
  private attached = new WeakSet<Page>()

  constructor(private readonly getPage: () => Promise<Page>) {}

  private async page(): Promise<Page> {
    const page = await this.getPage()
    if (!this.attached.has(page)) {
      this.attached.add(page)
      page.on('response', (r: Response) => {
        if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) this.lastStatus = r.status()
      })
    }
    return page
  }

  private async info(page: Page): Promise<PageInfo> {
    const info = { url: page.url(), title: await page.title().catch(() => ''), status: this.lastStatus }
    this.check(info)
    return info
  }

  /** Maps HTTP-level failures to typed tool errors. */
  private check(info: PageInfo): void {
    if (info.status !== null && info.status >= 500) {
      throw new ToolFailure('TRANSIENT', `The page returned HTTP ${info.status}. It may be temporarily unavailable.`)
    }
    const url = safeUrl(info.url)
    if (url && /\/login$/.test(url.pathname) && url.searchParams.has('expired')) {
      throw new ToolFailure(
        'SESSION_EXPIRED',
        'The portal session expired and the browser was sent back to the sign-in page. Sign in again, then continue.',
      )
    }
  }

  async open(url: string): Promise<PageInfo> {
    const page = await this.page()
    this.lastStatus = null
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
      this.lastStatus = res?.status() ?? null
    } catch (err) {
      throw new ToolFailure('TRANSIENT', `Could not load ${url}: ${(err as Error).message.split('\n')[0]}`)
    }
    return this.info(page)
  }

  async snapshot(): Promise<{ info: PageInfo; text: string }> {
    const page = await this.page()
    const info = { url: page.url(), title: await page.title().catch(() => ''), status: this.lastStatus }
    const text = (await page.evaluate(SNAPSHOT_SCRIPT)) as string
    return { info, text }
  }

  private async locate(page: Page, ref: string) {
    if (!/^e\d+$/.test(ref)) throw new ToolFailure('VALIDATION', `"${ref}" is not an element ref. Use a ref like "e12" from browser_read.`)
    const loc = page.locator(`[data-aiw-ref="${ref}"]`)
    if ((await loc.count()) === 0) {
      throw new ToolFailure('NOT_FOUND', `No element with ref ${ref} on the current page. Call browser_read for fresh refs.`)
    }
    return loc.first()
  }

  async click(ref: string): Promise<PageInfo> {
    const page = await this.page()
    const loc = await this.locate(page, ref)
    this.lastStatus = null
    await loc.click({ timeout: NAV_TIMEOUT })
    await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => undefined)
    return this.info(page)
  }

  async type(ref: string, text: string, submit: boolean): Promise<PageInfo> {
    const page = await this.page()
    const loc = await this.locate(page, ref)
    const secret = await loc.evaluate(
      (el) => (el as HTMLInputElement).type === 'password' || /captcha/i.test(`${(el as HTMLInputElement).name}${el.id}`),
    )
    if (secret) {
      throw new ToolFailure('PERMISSION_DENIED', 'Password and captcha fields are filled by the user. Use request_credentials or request_captcha.')
    }
    await loc.fill(text, { timeout: NAV_TIMEOUT })
    if (submit) {
      this.lastStatus = null
      await loc.press('Enter')
      await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => undefined)
    }
    return this.info(page)
  }

  async download(ref: string): Promise<Download> {
    const page = await this.page()
    const loc = await this.locate(page, ref)
    const href = await loc.evaluate((el) => (el as HTMLAnchorElement).href || '')
    if (!href) throw new ToolFailure('VALIDATION', `Element ${ref} is not a link with a downloadable target.`)
    // Fetch inside the page so the request carries the page's real session cookies.
    const result = (await page.evaluate(
      `(async (href) => {
        const res = await fetch(href, { credentials: 'include' });
        const buf = new Uint8Array(await res.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        return { status: res.status, url: res.url, type: res.headers.get('content-type') || '', disposition: res.headers.get('content-disposition') || '', b64: btoa(bin) };
      })(${JSON.stringify(href)})`,
    )) as { status: number; url: string; type: string; disposition: string; b64: string }

    const finalUrl = safeUrl(result.url)
    if (finalUrl && /\/login$/.test(finalUrl.pathname)) {
      // Keep the visible page in sync with the server's view of the session.
      await page.goto(result.url, { waitUntil: 'domcontentloaded' }).catch(() => undefined)
      throw new ToolFailure('SESSION_EXPIRED', 'The portal session expired during the download. Sign in again, then retry the download.')
    }
    if (result.status >= 500) throw new ToolFailure('TRANSIENT', `Download failed with HTTP ${result.status}.`)
    if (result.status === 404) throw new ToolFailure('NOT_FOUND', 'The file was not found on the server.')
    if (result.status >= 400) throw new ToolFailure('PERMISSION_DENIED', `Download refused with HTTP ${result.status}.`)

    const fromHeader = /filename="?([^";]+)"?/i.exec(result.disposition)?.[1]
    const fromUrl = finalUrl?.pathname.split('/').filter(Boolean).pop()
    return {
      filename: fromHeader ?? fromUrl ?? 'download.bin',
      contentType: result.type,
      data: new Uint8Array(Buffer.from(result.b64, 'base64')),
    }
  }

  async currentUrl(): Promise<string> {
    return (await this.page()).url()
  }

  async hasLoginForm(): Promise<boolean> {
    return (await (await this.page()).locator('form input[type=password]').count()) > 0
  }

  async fillLogin(username: string, password: string): Promise<void> {
    const page = await this.page()
    const form = page.locator('form:has(input[type=password])').first()
    if ((await form.count()) === 0) {
      throw new ToolFailure(
        'VALIDATION',
        `The sign-in form is no longer on the page (now at ${page.url()}). Open the sign-in page again, then call request_credentials.`,
      )
    }
    // The username field: the first text-like input that is not the captcha.
    const user = form.locator(
      'input:is([type=text], [type=email], :not([type])):not([name*=captcha i]):not([id*=captcha i]):not([type=hidden])',
    )
    await user.first().fill(username, { timeout: FORM_TIMEOUT })
    await form.locator('input[type=password]').first().fill(password, { timeout: FORM_TIMEOUT })
  }

  async hasCaptcha(): Promise<boolean> {
    return (await (await this.page()).locator('input[name*=captcha i], input[id*=captcha i]').count()) > 0
  }

  async captchaSvg(): Promise<string | null> {
    const page = await this.page()
    const loc = page.locator('[id*=captcha i] svg, [class*=captcha i] svg').first()
    if ((await loc.count()) === 0) return null
    return loc.evaluate((el) => el.outerHTML)
  }

  async fillCaptcha(answer: string): Promise<void> {
    const page = await this.page()
    const field = page.locator('input[name*=captcha i], input[id*=captcha i]').first()
    if ((await field.count()) === 0) {
      throw new ToolFailure('VALIDATION', `The captcha is no longer on the page (now at ${page.url()}). Open the sign-in page again, then call request_captcha.`)
    }
    await field.fill(answer, { timeout: FORM_TIMEOUT })
  }

  async cookie(name: string): Promise<string | null> {
    const page = await this.page()
    const cookies = await page.context().cookies(page.url())
    return cookies.find((c) => c.name === name)?.value ?? null
  }
}

function safeUrl(u: string): URL | null {
  try {
    return new URL(u)
  } catch {
    return null
  }
}
