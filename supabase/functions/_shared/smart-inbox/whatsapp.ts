// WhatsApp Business Platform (Cloud API), via Meta's Graph API: webhook
// verification and signature, reading incoming messages, sending text
// replies, checking a number when it is linked.

export const DEFAULT_WA_GRAPH_VERSION = 'v24.0'

export interface WhatsAppConfig {
  // Meta app secret: signs every webhook delivery (X-Hub-Signature-256).
  appSecret: string
  // Chosen by us, typed into the Meta app's webhook settings.
  verifyToken: string
  graphVersion: string
}

export class WhatsAppError extends Error {
  constructor(readonly status: number, readonly code: number | null, message: string) {
    super(message)
    this.name = 'WhatsAppError'
  }
}

// Meta error 131047: more than 24 hours since the guest's last message --
// only pre-approved template messages may be sent.
export function isWindowClosed(error: unknown): boolean {
  return error instanceof WhatsAppError && (error.code === 131047 || error.code === 131026)
}

function graphUrl(config: Pick<WhatsAppConfig, 'graphVersion'>, path: string): string {
  return `https://graph.facebook.com/${config.graphVersion}/${path}`
}

async function graph<T>(config: Pick<WhatsAppConfig, 'graphVersion'>, token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(graphUrl(config, path), {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
  const payload = await response.json().catch(() => ({})) as { error?: { code?: number; message?: string } }
  if (!response.ok) {
    throw new WhatsAppError(response.status, payload.error?.code ?? null, `WhatsApp ${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${response.status} ${payload.error?.code ?? ''}`)
  }
  return payload as T
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------
// Constant-time comparison of the X-Hub-Signature-256 header with the
// HMAC-SHA256 of the raw body under the app secret.
export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)))
  const expected = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const provided = header.slice('sha256='.length).toLowerCase()
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i)
  return diff === 0
}

export interface IncomingWhatsApp {
  phoneNumberId: string
  messageId: string
  // The guest's WhatsApp id (international number, digits only).
  from: string
  name: string | null
  receivedAt: string
  text: string
}

const MEDIA_LABELS: Record<string, string> = {
  image: '[Immagine]',
  audio: '[Messaggio vocale]',
  video: '[Video]',
  document: '[Documento]',
  sticker: '[Sticker]',
  location: '[Posizione]',
  contacts: '[Contatto]',
}

// Guest messages in a webhook delivery. Status updates (sent, delivered,
// read) and Meta's system messages are skipped; media arrive as a label
// plus their caption so staff know to look at the phone.
export function parseWebhook(payload: unknown): IncomingWhatsApp[] {
  const out: IncomingWhatsApp[] = []
  const entries = (payload as { entry?: unknown[] })?.entry
  if (!Array.isArray(entries)) return out
  for (const entry of entries) {
    for (const change of ((entry as { changes?: unknown[] }).changes ?? [])) {
      const value = (change as { field?: string; value?: Record<string, unknown> })
      if (value.field !== 'messages' || !value.value) continue
      const phoneNumberId = (value.value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id
      if (!phoneNumberId) continue
      const contacts = (value.value.contacts as Array<{ wa_id?: string; profile?: { name?: string } }> | undefined) ?? []
      for (const raw of (value.value.messages as Array<Record<string, unknown>> | undefined) ?? []) {
        const from = typeof raw.from === 'string' ? raw.from.replace(/\D/g, '') : ''
        const id = typeof raw.id === 'string' ? raw.id : ''
        const type = typeof raw.type === 'string' ? raw.type : ''
        if (!from || !id || type === 'system' || type === 'unsupported' || type === 'reaction') continue
        let text = ''
        if (type === 'text') text = ((raw.text as { body?: string } | undefined)?.body ?? '').trim()
        else if (type === 'button') text = ((raw.button as { text?: string } | undefined)?.text ?? '').trim()
        else if (type === 'interactive') {
          const interactive = raw.interactive as { button_reply?: { title?: string }; list_reply?: { title?: string } } | undefined
          text = (interactive?.button_reply?.title ?? interactive?.list_reply?.title ?? '').trim()
        } else {
          const media = raw[type] as { caption?: string } | undefined
          text = [MEDIA_LABELS[type] ?? `[${type}]`, media?.caption?.trim()].filter(Boolean).join(' ')
        }
        if (!text) continue
        const seconds = Number(raw.timestamp)
        out.push({
          phoneNumberId,
          messageId: id,
          from,
          name: contacts.find((contact) => contact.wa_id === raw.from)?.profile?.name?.trim() || null,
          receivedAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString(),
          text: text.slice(0, 40000),
        })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Number and sending
// ---------------------------------------------------------------------------
export function getPhoneNumber(config: Pick<WhatsAppConfig, 'graphVersion'>, token: string, phoneNumberId: string): Promise<{ id: string; display_phone_number?: string; verified_name?: string }> {
  return graph(config, token, `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`)
}

// Lets the app receive this business account's webhooks.
export function subscribeApp(config: Pick<WhatsAppConfig, 'graphVersion'>, token: string, wabaId: string): Promise<{ success?: boolean }> {
  return graph(config, token, `${encodeURIComponent(wabaId)}/subscribed_apps`, { method: 'POST' })
}

export function sendText(config: Pick<WhatsAppConfig, 'graphVersion'>, token: string, phoneNumberId: string, to: string, text: string): Promise<{ messages?: Array<{ id: string }> }> {
  return graph(config, token, `${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: text.slice(0, 4096) } }),
  })
}

// Stable conversation key for a WhatsApp guest: "whatsapp:+393331234567".
export function whatsappGuestKey(waId: string): string {
  return `whatsapp:+${waId.replace(/\D/g, '')}`
}

// For tests: the header Meta would send for this body.
export async function signBody(rawBody: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)))
  return `sha256=${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
