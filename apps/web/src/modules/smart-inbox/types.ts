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
// 'outlook'/'gmail' arrive by themselves from the connected mailbox; the
// others are pasted in "Componi risposta" (or relayed by email, see
// mailbox_id on the message).
export type MessageSource = 'outlook' | 'gmail' | 'booking' | 'expedia' | 'airbnb' | 'whatsapp' | 'phone' | 'other'
export type PastedSource = Exclude<MessageSource, 'outlook' | 'gmail'>
export type SignAs = 'agent' | 'property'
export type TemplateCategory = 'prima_arrivo' | 'prenotazioni' | 'soggiorno' | 'dopo' | 'altro'
export type KnowledgeCategory = 'arrivo_partenza' | 'servizi' | 'regole_prezzi' | 'altro'

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
  templates_used: string[]
  info_used: string[]
  missing_fields: string[]
  // Italian rendering for staff; null when the reply is already Italian.
  translation: string | null
  signed_as: SignAs | null
}

export interface ConversationRef {
  id: string
  guest_address: string
  guest_name: string | null
  assigned_to: string | null
  assigned_at: string | null
  is_urgent: boolean
  // First day of the stay month (YYYY-MM-01), or null.
  stay_month: string | null
  notes: string
}

export interface ReplyTemplate {
  id: string
  title: string
  body: string
  sort_order: number
  category: TemplateCategory
  when_to_use: string
  // {"en": "...", "de": "..."}; the base text is Italian.
  translations: Record<string, string>
  updated_at: string
}

// What the assistant read from the guest's own words.
export interface GuestDetails {
  arrival_date?: string | null
  arrival_time?: string | null
  departure_date?: string | null
  guests?: string | null
  booking_reference?: string | null
  requests?: string[]
}

export interface InboxMessage {
  id: string
  thread_id: string | null
  conversation: ConversationRef | null
  // Set when the message arrived by email (and the reply goes back that way).
  mailbox_id: string | null
  source: MessageSource
  created_by: string | null
  guest_details: GuestDetails
  missing_info: string[]
  template_gap: string | null
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
  category: KnowledgeCategory
  assistant_note: string
  updated_at: string
}

export interface InboxSettings {
  // Signature when replying on behalf of the property (no name).
  reply_signature: string
  tone: Tone
  auto_draft: boolean
  ignored_senders: string[]
  // Rendered per sender: {agent} name, {ruolo} job title, {hotel}.
  signature_template: string
  allow_property_signature: boolean
  show_translation: boolean
  enabled_sources: PastedSource[]
}

// How the current person signs, rendered from the settings.
export interface SignatureInfo {
  agent: string
  property: string | null
  name: string | null
}

export type MailProvider = 'microsoft' | 'google'

export interface Mailbox {
  id: string
  provider: MailProvider
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

// The current agent's own preferences (smart_inbox_agent_preferences).
export interface AgentPreferences {
  tone: Tone | null
  instructions: string
  languages: string[]
}

export interface InboxStats {
  days: number
  received: number
  replied: number
  unchanged: number
  avg_response_minutes: number | null
  median_response_minutes: number | null
  open_now: number
  by_day: Array<{ day: string; received: number; replied: number }>
  by_channel: Array<{ source: MessageSource; received: number; replied: number }>
  by_agent: Array<{ profile_id: string; full_name: string | null; replied: number; unchanged: number; avg_response_minutes: number | null }>
  agents_visible: 'all' | 'self'
}
