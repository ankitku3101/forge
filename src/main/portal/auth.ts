import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** `scrypt$<salt>$<hash>`. The seed passes a fixed salt so rebuilt sandboxes are byte-identical. */
export function hashPassword(password: string, salt: string = randomBytes(16).toString('hex')): string {
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return timingSafeEqual(expected, actual)
}
