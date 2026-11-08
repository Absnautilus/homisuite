import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'

// Replies are signed by the agent who sends them. The property keeps one
// signature template ({agent}, {ruolo}, {hotel}); each sender's name comes
// from their profile and their role from their job title in Team. A reply
// can also be signed on behalf of the property, without a name.

export type SignAs = 'agent' | 'property'

export const DEFAULT_AGENT_SIGNATURE = '{agent}\n{ruolo} — {hotel}'
export const DEFAULT_PROPERTY_SIGNATURE = 'Front Office — {hotel}'

export interface SignatureValues {
  agent: string | null
  role: string | null
  hotel: string
}

// Fills the placeholders and tidies what is left when a value is missing
// (no job title: "{ruolo} — {hotel}" becomes "Hotel", not "— Hotel").
export function renderSignature(template: string, values: SignatureValues): string {
  const filled = template
    .replace(/\{agent\}/gi, values.agent?.trim() ?? '')
    .replace(/\{ruolo\}/gi, values.role?.trim() ?? '')
    .replace(/\{hotel\}/gi, values.hotel.trim())
  return filled
    .split(/\r?\n/)
    .map((line) => line
      .replace(/\s+/g, ' ')
      .replace(/^\s*[—–\-,·|]\s*/, '')
      .replace(/\s*[—–\-,·|]\s*$/, '')
      .trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

// Body + newline + signature; the AI's body already ends with the
// closing formula in the guest's language.
export function appendSignature(body: string, signature: string): string {
  const text = body.trimEnd()
  return signature ? `${text}\n${signature}` : text
}

export interface PropertySignatures {
  agentTemplate: string
  propertyTemplate: string
  allowProperty: boolean
  hotel: string
}

export async function loadSignatureSettings(admin: SupabaseClient, propertyId: string): Promise<PropertySignatures> {
  const [property, settings] = await Promise.all([
    admin.from('properties').select('name').eq('id', propertyId).single(),
    admin
      .from('smart_inbox_settings')
      .select('signature_template, reply_signature, allow_property_signature')
      .eq('property_id', propertyId)
      .maybeSingle(),
  ])
  if (property.error) throw property.error
  if (settings.error) throw settings.error
  const row = settings.data as { signature_template?: string; reply_signature?: string; allow_property_signature?: boolean } | null
  return {
    agentTemplate: row?.signature_template?.trim() || DEFAULT_AGENT_SIGNATURE,
    propertyTemplate: row?.reply_signature?.trim() || DEFAULT_PROPERTY_SIGNATURE,
    allowProperty: row?.allow_property_signature ?? true,
    hotel: (property.data as { name: string }).name,
  }
}

export async function loadAgentIdentity(admin: SupabaseClient, propertyId: string, profileId: string): Promise<{ name: string | null; role: string | null }> {
  const [profile, details] = await Promise.all([
    admin.from('profiles').select('full_name').eq('id', profileId).maybeSingle(),
    admin
      .from('property_staff_details')
      .select('property_job_titles(name)')
      .eq('property_id', propertyId)
      .eq('profile_id', profileId)
      .maybeSingle(),
  ])
  if (profile.error) throw profile.error
  if (details.error) throw details.error
  const jobTitle = (details.data as { property_job_titles?: { name: string } | Array<{ name: string }> | null } | null)?.property_job_titles
  const role = Array.isArray(jobTitle) ? jobTitle[0]?.name ?? null : jobTitle?.name ?? null
  return { name: (profile.data as { full_name: string | null } | null)?.full_name ?? null, role }
}

// The signature a given sender puts under a reply. Signing as the property
// falls back to the agent's own signature when the property doesn't allow it.
export async function signatureFor(admin: SupabaseClient, propertyId: string, profileId: string | null, signAs: SignAs): Promise<{ text: string; signedAs: SignAs }> {
  const settings = await loadSignatureSettings(admin, propertyId)
  if (signAs === 'property' && settings.allowProperty || !profileId) {
    return { text: renderSignature(settings.propertyTemplate, { agent: null, role: null, hotel: settings.hotel }), signedAs: 'property' }
  }
  const identity = await loadAgentIdentity(admin, propertyId, profileId)
  return {
    text: renderSignature(settings.agentTemplate, { agent: identity.name, role: identity.role, hotel: settings.hotel }),
    signedAs: 'agent',
  }
}
