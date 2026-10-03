import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'

type Provider = 'groq' | 'google'

/** API keys entered in Settings, encrypted with Electron safeStorage. They override `.env`. */
export class SettingsStore {
  private readonly file: string
  private data: Partial<Record<Provider, string>> = {}

  constructor(dir: string) {
    this.file = join(dir, 'settings.json')
    try {
      this.data = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Record<Provider, string>>
    } catch {
      this.data = {}
    }
  }

  get(provider: Provider): string | null {
    const enc = this.data[provider]
    if (!enc || !safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  set(provider: Provider, key: string): void {
    if (!key) delete this.data[provider]
    else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system.')
      this.data[provider] = safeStorage.encryptString(key).toString('base64')
    }
    writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }
}
