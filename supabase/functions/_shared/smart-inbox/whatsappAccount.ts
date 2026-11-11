import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'
import { decryptSecret, encryptSecret } from './crypto.ts'
import type { SmartInboxConfig } from './runtime.ts'
import { getPhoneNumber, subscribeApp, type WhatsAppConfig } from './whatsapp.ts'

export interface WhatsAppAccountRow {
  id: string
  property_id: string
  phone_number_id: string
  waba_id: string
  status: 'connected' | 'error' | 'disconnected'
}

export class WhatsAppUnavailableError extends Error {
  constructor() {
    super('whatsapp_disconnected')
    this.name = 'WhatsAppUnavailableError'
  }
}

export async function loadWhatsApp(admin: SupabaseClient, config: SmartInboxConfig, accountId: string): Promise<{ account: WhatsAppAccountRow; token: string; whatsapp: WhatsAppConfig }> {
  if (!config.whatsapp) throw new WhatsAppUnavailableError()
  const [{ data: account, error }, { data: secret, error: secretError }] = await Promise.all([
    admin.from('smart_inbox_whatsapp_accounts').select('id, property_id, phone_number_id, waba_id, status').eq('id', accountId).maybeSingle(),
    admin.from('smart_inbox_whatsapp_secrets').select('access_token_ciphertext').eq('account_id', accountId).maybeSingle(),
  ])
  if (error) throw error
  if (secretError) throw secretError
  const row = account as WhatsAppAccountRow | null
  if (!row || row.status === 'disconnected' || !secret) throw new WhatsAppUnavailableError()
  const token = await decryptSecret((secret as { access_token_ciphertext: string }).access_token_ciphertext, config.tokenKey)
  return { account: row, token, whatsapp: config.whatsapp }
}

export class WhatsAppLinkError extends Error {
  constructor(readonly code: 'whatsapp_invalid_number' | 'whatsapp_subscribe_failed') {
    super(code)
    this.name = 'WhatsAppLinkError'
  }
}

// Checks the number with the given token, subscribes the Meta app to the
// business account's webhooks, then stores the link (token encrypted).
// Replaces any number the property linked before.
export async function linkWhatsApp(
  admin: SupabaseClient,
  config: SmartInboxConfig,
  input: { propertyId: string; userId: string; phoneNumberId: string; wabaId: string; accessToken: string },
): Promise<{ display_phone_number: string | null; verified_name: string | null }> {
  if (!config.whatsapp) throw new WhatsAppUnavailableError()
  let number
  try {
    number = await getPhoneNumber(config.whatsapp, input.accessToken, input.phoneNumberId)
  } catch (cause) {
    console.warn('smart-inbox: WhatsApp number check failed', cause)
    throw new WhatsAppLinkError('whatsapp_invalid_number')
  }
  try {
    await subscribeApp(config.whatsapp, input.accessToken, input.wabaId)
  } catch (cause) {
    console.warn('smart-inbox: WhatsApp app subscription failed', cause)
    throw new WhatsAppLinkError('whatsapp_subscribe_failed')
  }
  const details = { display_phone_number: number.display_phone_number ?? null, verified_name: number.verified_name ?? null }
  const { data: account, error } = await admin
    .from('smart_inbox_whatsapp_accounts')
    .upsert({
      property_id: input.propertyId,
      phone_number_id: input.phoneNumberId,
      waba_id: input.wabaId,
      ...details,
      status: 'connected',
      last_error: null,
      connected_by: input.userId,
    }, { onConflict: 'property_id' })
    .select('id')
    .single()
  if (error) throw error
  const { error: secretError } = await admin
    .from('smart_inbox_whatsapp_secrets')
    .upsert({ account_id: (account as { id: string }).id, access_token_ciphertext: await encryptSecret(input.accessToken, config.tokenKey) }, { onConflict: 'account_id' })
  if (secretError) throw secretError
  return details
}

export async function unlinkWhatsApp(admin: SupabaseClient, propertyId: string): Promise<void> {
  const { data, error } = await admin.from('smart_inbox_whatsapp_accounts').select('id').eq('property_id', propertyId).maybeSingle()
  if (error) throw error
  if (!data) return
  const id = (data as { id: string }).id
  const { error: deleteError } = await admin.from('smart_inbox_whatsapp_secrets').delete().eq('account_id', id)
  if (deleteError) throw deleteError
  const { error: updateError } = await admin.from('smart_inbox_whatsapp_accounts').update({ status: 'disconnected', last_error: null }).eq('id', id)
  if (updateError) throw updateError
}
