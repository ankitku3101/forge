import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { app, BrowserWindow, shell } from 'electron'
import { dataPaths } from './paths'
import { AppController } from './app/controller'
import { registerIpc } from './app/ipc'

loadEnv({ quiet: true })

// Lets Playwright attach to the embedded portal view over CDP (localhost only).
// Port 0 makes Chromium pick a free port and write it to <userData>/DevToolsActivePort.
app.commandLine.appendSwitch('remote-debugging-port', '0')
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')

let controller: AppController | null = null

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Autonomous AI Worker',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      plugins: true, // built-in PDF viewer for invoice previews
    },
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // From source, `pnpm seed` and `pnpm dev` share <repo>/.data; installed builds use userData.
  const paths = app.isPackaged ? dataPaths(join(app.getPath('userData'), 'sandbox')) : dataPaths()
  controller = new AppController(paths, app.getPath('userData'), win)
  await controller.init()
  registerIpc(controller, paths)

  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow).catch((err) => {
  console.error('Failed to start', err)
  app.quit()
})

app.on('window-all-closed', () => app.quit())

let disposing = false
app.on('before-quit', (e) => {
  if (disposing || !controller) return
  e.preventDefault()
  disposing = true
  void controller.dispose().finally(() => app.quit())
})
