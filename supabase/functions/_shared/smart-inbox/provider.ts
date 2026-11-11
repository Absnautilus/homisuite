import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'
import { buildReplyMime, createGmailDraft, deleteGmailDraft, getGmailMessage, type ParsedGmailMessage, parseGmailMessage, sendGmailReply } from './gmail.ts'
import { createReplyDraft, deleteMessage, getMessage, replyWithComment, textToHtml } from './graph.ts'
import { getAccessToken, loadMailbox, type MailboxRow } from './mailbox.ts'
import type { SmartInboxConfig } from './runtime.ts'

// One interface over the connected mailbox, whichever provider it is, so
// the pipeline and the send action never branch on Outlook vs Gmail.

export interface IncomingEmail {
  conversationId: string | null
  fromAddress: string | null
  fromName: string | null
  subject: string | null
  // Only what the guest just wrote, as plain text (no quoted thread).
  bodyText: string
  bodyPreview: string
  receivedAt: string
  // Written from the mailbox itself (a draft or a sent message).
  isOwn: boolean
  headers: Record<string, string>
}

export interface MailboxClient {
  provider: MailboxRow['provider']
  mailbox: MailboxRow
  read(messageId: string): Promise<IncomingEmail>
  // Mirrors the proposal as a reply draft in the mailbox's Drafts.
  createReplyDraft(messageId: string, text: string): Promise<string>
  deleteDraft(draftId: string): Promise<void>
  reply(messageId: string, text: string): Promise<void>
}

export class MailboxUnavailableError extends Error {
  constructor() {
    super('mailbox_disconnected')
    this.name = 'MailboxUnavailableError'
  }
}

export async function openMailbox(admin: SupabaseClient, config: SmartInboxConfig, mailboxId: string): Promise<MailboxClient> {
  const { mailbox, secret } = await loadMailbox(admin, mailboxId)
  if (mailbox.status === 'disconnected' || !secret) throw new MailboxUnavailableError()
  const token = await getAccessToken(admin, config, secret, mailbox.provider)
  return mailbox.provider === 'google' ? gmailClient(mailbox, token) : graphClient(mailbox, token)
}

function graphClient(mailbox: MailboxRow, token: string): MailboxClient {
  return {
    provider: 'microsoft',
    mailbox,
    async read(messageId) {
      const email = await getMessage(token, messageId)
      const headers: Record<string, string> = {}
      for (const header of email.internetMessageHeaders ?? []) headers[header.name.toLowerCase()] = header.value
      return {
        conversationId: email.conversationId,
        fromAddress: email.from?.emailAddress?.address?.toLowerCase() ?? null,
        fromName: email.from?.emailAddress?.name ?? null,
        subject: email.subject,
        bodyText: (email.uniqueBody?.content ?? email.body?.content ?? '').trim(),
        bodyPreview: email.bodyPreview ?? '',
        receivedAt: email.receivedDateTime,
        isOwn: email.isDraft,
        headers,
      }
    },
    async createReplyDraft(messageId, text) {
      return (await createReplyDraft(token, messageId, textToHtml(text))).id
    },
    deleteDraft: (draftId) => deleteMessage(token, draftId),
    reply: (messageId, text) => replyWithComment(token, messageId, textToHtml(text)),
  }
}

function gmailClient(mailbox: MailboxRow, token: string): MailboxClient {
  const parsed = new Map<string, ParsedGmailMessage>()
  async function load(messageId: string): Promise<ParsedGmailMessage> {
    let message = parsed.get(messageId)
    if (!message) {
      message = parseGmailMessage(await getGmailMessage(token, messageId))
      parsed.set(messageId, message)
    }
    return message
  }
  async function mime(messageId: string, text: string): Promise<{ threadId: string; mime: string }> {
    const original = await load(messageId)
    const to = original.replyTo ?? original.from.address
    if (!to) throw new Error('missing_sender')
    const from = mailbox.display_name ? `${mailbox.display_name.replace(/["\r\n]/g, '')} <${mailbox.email_address}>` : mailbox.email_address
    return {
      threadId: original.threadId,
      mime: buildReplyMime({ from, to, subject: original.subject, inReplyTo: original.messageIdHeader, references: original.references }, text),
    }
  }
  return {
    provider: 'google',
    mailbox,
    async read(messageId) {
      const message = await load(messageId)
      return {
        conversationId: message.threadId,
        fromAddress: message.from.address,
        fromName: message.from.name,
        subject: message.subject,
        bodyText: message.bodyText,
        bodyPreview: message.bodyPreview,
        receivedAt: message.receivedAt,
        isOwn: message.isDraft,
        headers: message.headers,
      }
    },
    async createReplyDraft(messageId, text) {
      const { threadId, mime: raw } = await mime(messageId, text)
      return (await createGmailDraft(token, threadId, raw)).id
    },
    deleteDraft: (draftId) => deleteGmailDraft(token, draftId),
    async reply(messageId, text) {
      const { threadId, mime: raw } = await mime(messageId, text)
      await sendGmailReply(token, threadId, raw)
    },
  }
}
