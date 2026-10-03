import { extname } from 'node:path'
import { ipcMain } from 'electron'
import type { z } from 'zod'
import { ipcInputs, type IpcChannel, type IpcOutputs, type IpcResult } from '@shared/ipc'
import { getMail, searchMail } from '../apps/mail'
import { getRecord, listVendors, NO_FAULTS, searchRecords, updateRecord } from '../apps/finance'
import { listTree, readSandboxFile, writeSandboxFile, TEXT_EXTENSIONS } from '../sandbox/files'
import { ToolFailure } from '../tools/types'
import type { AppController } from './controller'

type Handlers = {
  [C in IpcChannel]: (input: z.output<(typeof ipcInputs)[C]>) => Promise<IpcOutputs[C]> | IpcOutputs[C]
}

/** Registers every typed IPC channel. Inputs are validated with the shared Zod schemas. */
export function registerIpc(ctl: AppController, paths: { filesDir: string }): void {
  const handlers: Handlers = {
    'app:state': () => ctl.state(),
    'app:setScenario': ({ scenario }) => ctl.setScenario(scenario),
    'app:setApiKey': async ({ provider, key }) => {
      ctl.setApiKey(provider, key)
      return ctl.state()
    },
    'sandbox:reset': () => ctl.reset(),

    'files:list': () => listTree(paths.filesDir),
    'files:read': ({ path }) => readSandboxFile(paths.filesDir, path),
    'files:write': async ({ path, text }) => {
      await ctl.assertIdle('edit files')
      if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) throw new Error('Only text files can be edited.')
      await writeSandboxFile(paths.filesDir, path, text)
      ctl.push('sandbox:changed', { area: 'files' })
    },

    'mail:list': () => searchMail(ctl.database.db, { limit: 100 }),
    'mail:get': ({ id }) => getMail(ctl.database.db, id),

    'finance:list': async () => ({
      vendors: await listVendors(ctl.database.db),
      records: await searchRecords(ctl.database.db, { limit: 500 }),
    }),
    'finance:update': async ({ id, patch }) => {
      await ctl.assertIdle('edit Finance')
      await getRecord(ctl.database.db, id)
      // Manual edits bypass injected faults: they are the user's, not the worker's.
      const rec = await updateRecord(ctl.database.db, NO_FAULTS, id, patch)
      ctl.push('sandbox:changed', { area: 'finance' })
      return rec
    },

    'run:start': async ({ task }) => {
      await ctl.assertIdle('start another task')
      return { runId: await ctl.runtime.start(task) }
    },
    'run:respond': ({ runId, response }) => ctl.runtime.respond(runId, response),
    'run:cancel': ({ runId }) => ctl.runtime.cancel(runId),
    'run:resume': ({ runId }) => ctl.resume(runId),
    'run:list': () => ctl.store.list(),
    'run:events': ({ runId }) => ctl.events.list(runId),
    'run:captcha': async () => ({ svg: await ctl.browser.captchaSvg().catch(() => null) }),

    'portal:setBounds': ({ bounds }) => ctl.portalView.setBounds(bounds),
  }

  for (const channel of Object.keys(ipcInputs) as IpcChannel[]) {
    ipcMain.handle(channel, async (_event, raw: unknown): Promise<IpcResult<unknown>> => {
      const parsed = ipcInputs[channel].safeParse(raw)
      if (!parsed.success) return { ok: false, error: `Invalid input for ${channel}` }
      try {
        const handler = handlers[channel] as (input: unknown) => unknown
        return { ok: true, value: await handler(parsed.data) }
      } catch (err) {
        if (!(err instanceof ToolFailure)) console.error(`[ipc] ${channel} failed`, err)
        return { ok: false, error: (err as Error).message }
      }
    })
  }
}

