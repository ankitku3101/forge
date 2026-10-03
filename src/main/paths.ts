import { join, resolve } from 'node:path'

export interface DataPaths {
  root: string
  dbDir: string
  filesDir: string
}

/**
 * From source, `pnpm seed` and `pnpm dev` share `<repo>/.data`. Packaged builds pass Electron's
 * userData directory instead. `ARCUS_DATA_DIR` overrides both.
 */
export function dataPaths(root: string = process.env.ARCUS_DATA_DIR ?? resolve(process.cwd(), '.data')): DataPaths {
  return { root, dbDir: join(root, 'db'), filesDir: join(root, 'files') }
}
