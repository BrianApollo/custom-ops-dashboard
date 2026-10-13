import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'

// Same scheme as the old login, so imported hashes keep working:
// PBKDF2-SHA256, 100,000 iterations, stored as base64(salt16):base64(hash32)
const ITERATIONS = 100_000
const HASH = /^[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]{43}=$/

export const isHash = (stored: string) => HASH.test(stored)

async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256)
  return Buffer.from(bits)
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt)
  return `${Buffer.from(salt).toString('base64')}:${hash.toString('base64')}`
}

const equal = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b)

// `plaintext` is true when the stored value matched as an unhashed password
export async function verifyPassword(password: string, stored: string) {
  if (!isHash(stored)) {
    const ok = equal(Buffer.from(password), Buffer.from(stored))
    return { ok, plaintext: ok }
  }
  const [salt, hash] = stored.split(':')
  const derived = await derive(password, Uint8Array.from(Buffer.from(salt, 'base64')))
  return { ok: equal(derived, Buffer.from(hash, 'base64')), plaintext: false }
}
