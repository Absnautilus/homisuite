// Microsoft identity platform + Microsoft Graph calls used by Smart Inbox.
// Delegated permissions only (the hotel signs in with the mailbox account
// itself): offline_access, User.Read, Mail.ReadWrite, Mail.Send.

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
export const SCOPES = ['offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send']
// Graph caps message subscriptions at 4230 minutes; stay safely below it.
export const SUBSCRIPTION_MINUTES = 4200

export interface MicrosoftConfig {
  clientId: string
  clientSecret: string
  // 'organizations' (any work/school tenant), 'common', or a tenant id.
  tenant: string
  redirectUri: string
}

export interface TokenSet {
  accessToken: string
  refreshToken: string | null
  expiresIn: number
}

export class GraphError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) {
    super(message)
    this.name = 'GraphError'
  }
}

export function authorizeUrl(config: MicrosoftConfig, state: string): string {
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/authorize`)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_mode', 'query')
  url.searchParams.set('scope', SCOPES.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

async function tokenRequest(config: MicrosoftConfig, params: Record<string, string>): Promise<TokenSet> {
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: SCOPES.join(' '),
      ...params,
    }),
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || typeof payload.access_token !== 'string') {
    const code = typeof payload.error === 'string' ? payload.error : null
    throw new GraphError(`Token request failed (${code ?? response.status})`, response.status, code)
  }
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
    expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : 3600,
  }
}

export function exchangeCode(config: MicrosoftConfig, code: string): Promise<TokenSet> {
  return tokenRequest(config, { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri })
}

export function refreshTokens(config: MicrosoftConfig, refreshToken: string): Promise<TokenSet> {
  return tokenRequest(config, { grant_type: 'refresh_token', refresh_token: refreshToken })
}

async function graph<T>(token: string, path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (init.prefer) headers.set('Prefer', init.prefer)
  const response = await fetch(`${GRAPH_BASE}${path}`, { ...init, headers })
  if (response.status === 202 || response.status === 204) return undefined as T
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    const error = payload?.error as { code?: string; message?: string } | undefined
    throw new GraphError(`Graph ${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${error?.code ?? response.status}`, response.status, error?.code ?? null)
  }
  return payload as T
}

export interface GraphUser {
  displayName: string | null
  mail: string | null
  userPrincipalName: string
}

export function getMe(token: string): Promise<GraphUser> {
  return graph<GraphUser>(token, '/me?$select=displayName,mail,userPrincipalName')
}

export interface GraphSubscription {
  id: string
  expirationDateTime: string
}

export function subscriptionExpiry(now = Date.now()): string {
  return new Date(now + SUBSCRIPTION_MINUTES * 60_000).toISOString()
}

export function createSubscription(token: string, notificationUrl: string, clientState: string): Promise<GraphSubscription> {
  return graph<GraphSubscription>(token, '/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      changeType: 'created',
      notificationUrl,
      resource: "me/mailFolders('Inbox')/messages",
      expirationDateTime: subscriptionExpiry(),
      clientState,
    }),
  })
}

export function renewSubscription(token: string, subscriptionId: string): Promise<GraphSubscription> {
  return graph<GraphSubscription>(token, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ expirationDateTime: subscriptionExpiry() }),
  })
}

export async function deleteSubscription(token: string, subscriptionId: string): Promise<void> {
  try {
    await graph<void>(token, `/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'DELETE' })
  } catch (error) {
    if (!(error instanceof GraphError && error.status === 404)) throw error
  }
}

export interface GraphMessage {
  id: string
  conversationId: string | null
  internetMessageId: string | null
  subject: string | null
  receivedDateTime: string
  isDraft: boolean
  bodyPreview: string | null
  from: { emailAddress: { name?: string; address?: string } } | null
  // Only the new part of the message (no quoted thread), as plain text.
  uniqueBody: { contentType: string; content: string } | null
  body: { contentType: string; content: string } | null
  internetMessageHeaders?: Array<{ name: string; value: string }>
}

export function getMessage(token: string, messageId: string): Promise<GraphMessage> {
  const select = 'id,conversationId,internetMessageId,subject,receivedDateTime,isDraft,bodyPreview,from,uniqueBody,body,internetMessageHeaders'
  return graph<GraphMessage>(token, `/me/messages/${encodeURIComponent(messageId)}?$select=${select}`, {
    prefer: 'outlook.body-content-type="text"',
  })
}

// Creates a reply draft in Outlook (in the Drafts folder, threaded, with
// the original quoted below `commentHtml`), so staff working directly in
// Outlook see the same proposal homisuite shows.
export function createReplyDraft(token: string, messageId: string, commentHtml: string): Promise<{ id: string }> {
  return graph<{ id: string }>(token, `/me/messages/${encodeURIComponent(messageId)}/createReply`, {
    method: 'POST',
    body: JSON.stringify({ comment: commentHtml }),
  })
}

export function sendDraft(token: string, draftId: string): Promise<void> {
  return graph<void>(token, `/me/messages/${encodeURIComponent(draftId)}/send`, { method: 'POST' })
}

export async function deleteMessage(token: string, messageId: string): Promise<void> {
  try {
    await graph<void>(token, `/me/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' })
  } catch (error) {
    if (!(error instanceof GraphError && error.status === 404)) throw error
  }
}

export function replyWithComment(token: string, messageId: string, commentHtml: string): Promise<void> {
  return graph<void>(token, `/me/messages/${encodeURIComponent(messageId)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ comment: commentHtml }),
  })
}

// Plain text (what staff edit) -> the minimal HTML Graph's `comment` expects.
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return escaped.split(/\r?\n/).join('<br>')
}
