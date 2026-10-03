/** Dev aid: prints the model's view of the portal pages and an invoice PDF. `pnpm tsx scripts/peek-snapshot.ts` */
import { CAPTCHA_COOKIE } from '../src/main/portal/server'
import { createHeadlessSandbox } from '../src/main/sandbox/headless'
import { readSandboxFile } from '../src/main/sandbox/files'

const sb = await createHeadlessSandbox('happy_path')
try {
  await sb.driver.open(`${sb.server.url}/invoices`)
  console.log('--- login ---\n' + (await sb.driver.snapshot()).text)
  await sb.driver.fillLogin('demo', 'demo123')
  await sb.driver.fillCaptcha(sb.portal.captchaAnswer((await sb.driver.cookie(CAPTCHA_COOKIE))!)!)
  const login = (await sb.driver.snapshot()).text
  console.log('--- login filled ---\n' + login)
  await sb.driver.click(/\[button "Sign in" ref=(e\d+)/.exec(login)![1]!)
  const list = (await sb.driver.snapshot()).text
  console.log('--- invoices ---\n' + list)
  await sb.driver.open(`${sb.server.url}/invoices/4`)
  const detail = (await sb.driver.snapshot()).text
  console.log('--- detail ---\n' + detail)
  const dl = await sb.driver.download(/\[link "Download PDF" ref=(e\d+)/.exec(detail)![1]!)
  const { writeSandboxFile } = await import('../src/main/sandbox/files')
  await writeSandboxFile(sb.filesDir, `Downloads/${dl.filename}`, dl.data)
  const pdf = await readSandboxFile(sb.filesDir, `Downloads/${dl.filename}`)
  console.log('--- pdf ---\n' + (pdf.kind === 'pdf' ? pdf.text : pdf.kind))
} finally {
  await sb.close()
}
