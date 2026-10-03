export interface PageInfo {
  url: string
  title: string
  /** HTTP status of the last main-frame navigation, if one happened. */
  status: number | null
}

export interface Download {
  filename: string
  contentType: string
  data: Uint8Array
}

/** What the browser tools need. Implemented over Playwright for both the app (CDP) and evals (headless). */
export interface BrowserDriver {
  open(url: string): Promise<PageInfo>
  /** Text snapshot with `[... ref=eN]` markers for interactive elements. Secret field values are never included. */
  snapshot(): Promise<{ info: PageInfo; text: string }>
  click(ref: string): Promise<PageInfo>
  type(ref: string, text: string, submit: boolean): Promise<PageInfo>
  download(ref: string): Promise<Download>
  currentUrl(): Promise<string>

  // Harness-only; never exposed as tools.
  hasLoginForm(): Promise<boolean>
  fillLogin(username: string, password: string): Promise<void>
  hasCaptcha(): Promise<boolean>
  captchaSvg(): Promise<string | null>
  fillCaptcha(answer: string): Promise<void>
  cookie(name: string): Promise<string | null>
}
