import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ArcusApi, IpcPushChannel, IpcResult } from '@shared/ipc'

const PUSH_CHANNELS: IpcPushChannel[] = ['run:event', 'run:updated', 'sandbox:changed']

const api: ArcusApi = {
  async invoke(channel, ...args) {
    const result = (await ipcRenderer.invoke(channel, args[0])) as IpcResult<never>
    if (!result.ok) throw new Error(result.error)
    return result.value
  },
  on(channel, listener) {
    if (!PUSH_CHANNELS.includes(channel)) throw new Error(`Unknown channel ${channel}`)
    const handler = (_e: IpcRendererEvent, payload: unknown) => listener(payload as never)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
}

contextBridge.exposeInMainWorld('arcus', api)
