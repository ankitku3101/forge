import type { ArcusApi } from '../shared/ipc'

declare global {
  interface Window {
    arcus: ArcusApi
  }
}

export {}
