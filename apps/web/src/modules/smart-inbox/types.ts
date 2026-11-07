// Row shapes of the Smart Inbox tables as the client reads them (see
// supabase/migrations/20261107180000_smart_inbox_module.sql).

export type MessageStatus =
  | 'pending'
  | 'processing'
  | 'draft_ready'
  | 'needs_attention'
  | 'ignored'
  | 'replied'
  | 'dismissed'
  | 'failed'

export type MessageCategory = 'information' | 'request' | 'booking' | 'complaint' | 'other'
export type MessageUrgency = 'low' | 'normal' | 'high'
export type Tone = 'cordiale' | 'formale' | 'essenziale'

export interface SuggestedAction {
  type: 'transfer' | 'restaurant_booking' | 'guest_request' | 'room_booking' | 'other'
  details: string
}

export interface InboxDraft {
  id: string
  message_id: string
  body: string
  ai_body: string
  suggested_actions: SuggestedAction[]
  model: string | null
  status: 'pending' | 'sent' | 'discarded'
  sent_by: string | null
  sent_at: string | null
  updated_at: string
}

export interface ConversationRef {
  id: string
  guest_address: string
  guest_name: string | null
  assigned_to: string | null
  assigned_at: string | null
}

export interface InboxMessage {
  id: string
  thread_id: string | null
  conversation: ConversationRef | null
  from_address: string | null
  from_name: string | null
  subject: string | null
  body_preview: string | null
  body_text: string | null
  received_at: string
  language: string | null
  category: MessageCategory | null
  urgency: MessageUrgency | null
  summary: string | null
  status: MessageStatus
  ignore_reason: string | null
  error: string | null
  draft: InboxDraft | null
}

export interface KnowledgeEntry {
  id: string
  title: string
  content: string
  active: boolean
  sort_order: number
}

export interface InboxSettings {
  reply_signature: string
  tone: Tone
  auto_draft: boolean
  ignored_senders: string[]
}

export interface Mailbox {
  id: string
  email_address: string
  display_name: string | null
  status: 'connected' | 'error' | 'disconnected'
  last_error: string | null
  subscription_expires_at: string | null
}

export interface UsageRow {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export interface Agent {
  profile_id: string
  full_name: string
}
