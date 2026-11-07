// Small, dependency-free crypto helpers for Smart Inbox, built on Web Crypto
// (available in the Supabase Edge Runtime and in Deno tests alike).
//
//   * encryptSecret / decryptSecret -- AES-GCM for the Microsoft refresh
//     token at rest (key: SMART_INBOX_TOKEN_KEY, 32 random bytes, base64).
//   * signState / verifyState -- HMAC-signed, expiring OAuth `state`, so the
//     callback can trust which property/user started the connection without
//     storing anything server-side.
//   * sha256Hex -- hashing the Graph subscription clientState.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return fromBase64(padded)
}

export function randomToken(byteLength = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function importAesKey(keyBase64: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = fromBase64(keyBase64)
  } catch {
    throw new Error('SMART_INBOX_TOKEN_KEY is not valid base64')
  }
  if (raw.length !== 32) throw new Error('SMART_INBOX_TOKEN_KEY must decode to exactly 32 bytes')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// Format: v1.<iv base64>.<ciphertext base64>. The version prefix leaves room
// to rotate the scheme later without guessing what an old row contains.
export async function encryptSecret(plaintext: string, keyBase64: string): Promise<string> {
  const key = await importAesKey(keyBase64)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext)))
  return `v1.${toBase64(iv)}.${toBase64(ciphertext)}`
}

export async function decryptSecret(payload: string, keyBase64: string): Promise<string> {
  const [version, ivPart, dataPart] = payload.split('.')
  if (version !== 'v1' || !ivPart || !dataPart) throw new Error('Unsupported secret format')
  const key = await importAesKey(keyBase64)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivPart) }, key, fromBase64(dataPart))
  return decoder.decode(plaintext)
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('SMART_INBOX_STATE_SECRET must be at least 32 characters')
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signState<T extends Record<string, unknown>>(payload: T, secret: string, ttlSeconds: number, now = Date.now()): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSeconds })))
  const key = await importHmacKey(secret)
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)))
  return `${body}.${toBase64Url(signature)}`
}

// Returns the payload only when the signature is valid and not expired.
// crypto.subtle.verify compares in constant time.
export async function verifyState<T extends Record<string, unknown>>(token: string, secret: string, now = Date.now()): Promise<T | null> {
  const [body, signature] = token.split('.')
  if (!body || !signature) return null
  try {
    const key = await importHmacKey(secret)
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(signature), encoder.encode(body))
    if (!valid) return null
    const payload = JSON.parse(decoder.decode(fromBase64Url(body))) as T & { exp?: unknown }
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null
    return payload
  } catch {
    return null
  }
}
