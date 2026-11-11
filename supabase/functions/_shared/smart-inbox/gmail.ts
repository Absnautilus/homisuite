import { fromBase64Url, toBase64, toBase64Url } from './crypto.ts'

// Gmail API (REST, no SDK): OAuth, mailbox history, reading a message,
// replying in its thread and keeping a reply draft in Gmail's Drafts.

export const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
// gmail.modify: read, label, draft and send -- no permanent delete.
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/gmail.modify']

export interface GoogleConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface GoogleTokens {
  accessToken: string
  refreshToken: string | null
}

export class GmailError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) {
    super(message)
    this.name = 'GmailError'
  }
}

export function googleAuthorizeUrl(config: GoogleConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    // offline + consent: Google returns a refresh token only on consent.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTHORIZE_URL}?${params}`
}

async function tokenRequest(config: GoogleConfig, body: Record<string, string>): Promise<GoogleTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...body }),
  })
  const payload = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string }
  if (!response.ok || !payload.access_token) {
    throw new GmailError(response.status, payload.error ?? null, `Google token request failed: ${payload.error ?? response.status}`)
  }
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token ?? null }
}

export function googleExchangeCode(config: GoogleConfig, code: string): Promise<GoogleTokens> {
  return tokenRequest(config, { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri })
}

export function googleRefresh(config: GoogleConfig, refreshToken: string): Promise<GoogleTokens> {
  return tokenRequest(config, { grant_type: 'refresh_token', refresh_token: refreshToken })
}

async function gmail<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({})) as { error?: { status?: string; message?: string } }
  if (!response.ok) {
    throw new GmailError(response.status, payload.error?.status ?? null, `Gmail ${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${response.status}`)
  }
  return payload as T
}

export function getProfile(token: string): Promise<{ emailAddress: string; historyId: string }> {
  return gmail(token, '/profile')
}

// Ids of messages that arrived in the inbox since `startHistoryId`, and the
// history id to continue from. Gmail answers 404 when the start is too old
// (about a week): the caller then restarts from the current profile.
export async function listNewInboxMessages(token: string, startHistoryId: string, maxPages = 5): Promise<{ ids: string[]; historyId: string }> {
  const ids = new Set<string>()
  let pageToken: string | undefined
  let historyId = startHistoryId
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', labelId: 'INBOX', maxResults: '100' })
    if (pageToken) params.set('pageToken', pageToken)
    const result = await gmail<{ history?: Array<{ messagesAdded?: Array<{ message: { id: string; labelIds?: string[] } }> }>; historyId?: string; nextPageToken?: string }>(
      token,
      `/history?${params}`,
    )
    for (const entry of result.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const labels = added.message.labelIds ?? []
        if (labels.includes('DRAFT') || labels.includes('SENT')) continue
        ids.add(added.message.id)
      }
    }
    if (result.historyId) historyId = result.historyId
    if (!result.nextPageToken) break
    pageToken = result.nextPageToken
  }
  return { ids: [...ids], historyId }
}

export interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: Array<{ name: string; value: string }>
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
}

export interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: GmailPart
}

export function getGmailMessage(token: string, id: string): Promise<GmailMessage> {
  return gmail(token, `/messages/${encodeURIComponent(id)}?format=full`)
}

// ---------------------------------------------------------------------------
// Reading a message
// ---------------------------------------------------------------------------
export interface ParsedGmailMessage {
  threadId: string
  messageIdHeader: string | null
  references: string | null
  from: { name: string | null; address: string | null }
  replyTo: string | null
  subject: string | null
  receivedAt: string
  isDraft: boolean
  bodyText: string
  bodyPreview: string
  headers: Record<string, string>
}

const decoder = new TextDecoder()

function decodeData(data: string | undefined): string {
  if (!data) return ''
  try {
    return decoder.decode(fromBase64Url(data))
  } catch {
    return ''
  }
}

function findPart(part: GmailPart | undefined, mimeType: string): GmailPart | null {
  if (!part) return null
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return part
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType)
    if (found) return found
  }
  return null
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Gmail has no "unique body": drop the quoted thread below a reply so the
// assistant reads only what the guest just wrote (earlier messages come
// from the conversation history anyway).
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const quoteHeader = /^(On .+ wrote:|Il giorno .+ ha scritto:|Am .+ schrieb .+:|Le .+ a écrit :|El .+ escribió:|-----\s*Original Message\s*-----|-{2,}\s*Messaggio originale\s*-{2,}|From: .+)$/i
  const kept: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (quoteHeader.test(trimmed)) break
    if (trimmed.startsWith('>')) continue
    kept.push(line)
  }
  return kept.join('\n').trim()
}

function parseAddress(value: string | undefined): { name: string | null; address: string | null } {
  if (!value) return { name: null, address: null }
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value)
  if (match) return { name: match[1].trim() || null, address: match[2].trim().toLowerCase() }
  const bare = value.trim()
  return { name: null, address: bare.includes('@') ? bare.toLowerCase() : null }
}

export function parseGmailMessage(message: GmailMessage): ParsedGmailMessage {
  const headers: Record<string, string> = {}
  for (const header of message.payload?.headers ?? []) headers[header.name.toLowerCase()] = header.value
  const plain = findPart(message.payload, 'text/plain')
  const html = plain ? null : findPart(message.payload, 'text/html')
  const raw = plain ? decodeData(plain.body?.data) : html ? htmlToText(decodeData(html.body?.data)) : decodeData(message.payload?.body?.data)
  const bodyText = stripQuotedReply(raw)
  const labels = message.labelIds ?? []
  const internal = Number(message.internalDate)
  return {
    threadId: message.threadId,
    messageIdHeader: headers['message-id'] ?? null,
    references: headers['references'] ?? null,
    from: parseAddress(headers['from']),
    replyTo: parseAddress(headers['reply-to']).address,
    subject: headers['subject'] ?? null,
    receivedAt: Number.isFinite(internal) && internal > 0 ? new Date(internal).toISOString() : new Date().toISOString(),
    isDraft: labels.includes('DRAFT') || labels.includes('SENT'),
    bodyText,
    bodyPreview: (message.snippet ?? bodyText).slice(0, 255),
    headers,
  }
}

// ---------------------------------------------------------------------------
// Replying
// ---------------------------------------------------------------------------
// RFC 2047 for non-ASCII subjects ("Re: Anfrage für Dezember").
function encodeHeader(value: string): string {
  // deno-lint-ignore no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value
  return `=?UTF-8?B?${toBase64(new TextEncoder().encode(value))}?=`
}

function wrapBase64(value: string): string {
  return value.replace(/.{1,76}/g, (chunk) => `${chunk}\r\n`).trimEnd()
}

export interface ReplyEnvelope {
  from: string
  to: string
  subject: string | null
  inReplyTo: string | null
  references: string | null
}

export function buildReplyMime(envelope: ReplyEnvelope, text: string): string {
  const subject = envelope.subject?.trim() ?? ''
  const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`.trim()
  const references = [envelope.references, envelope.inReplyTo].filter(Boolean).join(' ').trim()
  const lines = [
    `From: ${envelope.from}`,
    `To: ${envelope.to}`,
    `Subject: ${encodeHeader(replySubject)}`,
    ...(envelope.inReplyTo ? [`In-Reply-To: ${envelope.inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(toBase64(new TextEncoder().encode(text.replace(/\r?\n/g, '\r\n')))),
  ]
  return lines.join('\r\n')
}

function rawOf(mime: string): string {
  return toBase64Url(new TextEncoder().encode(mime))
}

export function sendGmailReply(token: string, threadId: string, mime: string): Promise<{ id: string }> {
  return gmail(token, '/messages/send', { method: 'POST', body: JSON.stringify({ raw: rawOf(mime), threadId }) })
}

export function createGmailDraft(token: string, threadId: string, mime: string): Promise<{ id: string }> {
  return gmail(token, '/drafts', { method: 'POST', body: JSON.stringify({ message: { raw: rawOf(mime), threadId } }) })
}

export async function deleteGmailDraft(token: string, draftId: string): Promise<void> {
  try {
    await gmail<void>(token, `/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' })
  } catch (error) {
    if (!(error instanceof GmailError && error.status === 404)) throw error
  }
}
