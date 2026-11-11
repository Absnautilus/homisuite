import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@homisuite/ui'
import { MessageCircle, Unplug } from 'lucide-react'
import { useConfirm } from '../../components/ConfirmDialog'
import { linkWhatsApp, loadWhatsAppAccount, SmartInboxActionError, unlinkWhatsApp } from './api'
import { actionErrorLabel } from './labels'
import type { WhatsAppAccount } from './types'

// The property's WhatsApp Business number (Cloud API). Linking needs three
// values from Meta's WhatsApp Manager; the token is sent once to the Edge
// Function, checked with Meta and stored encrypted -- never shown again.
export function WhatsAppCard({ client, propertyId, canManage, available }: {
  client: SupabaseClient
  propertyId: string
  canManage: boolean
  // The server has the Meta app configured.
  available: boolean
}) {
  const [account, setAccount] = useState<WhatsAppAccount | null | undefined>(undefined)
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [wabaId, setWabaId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDialog, confirm] = useConfirm()

  const load = useCallback(async () => {
    try {
      setAccount(await loadWhatsAppAccount(client, propertyId))
    } catch (cause) {
      console.error('Smart Inbox: WhatsApp account not loaded', cause)
      setAccount(null)
    }
  }, [client, propertyId])

  useEffect(() => { void load() }, [load])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await linkWhatsApp(client, propertyId, { phoneNumberId: phoneNumberId.trim(), wabaId: wabaId.trim(), accessToken: accessToken.trim() })
      setAccessToken('')
      setNotice(`Numero collegato${result.display_phone_number ? `: ${result.display_phone_number}` : ''}. I nuovi messaggi WhatsApp arriveranno in Posta.`)
      await load()
    } catch (cause) {
      setError(actionErrorLabel(cause instanceof SmartInboxActionError ? cause.code : null))
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    const confirmed = await confirm({
      title: 'Scollegare il numero WhatsApp?',
      description: 'I nuovi messaggi WhatsApp non arriveranno più in Smart Inbox. Le conversazioni già presenti restano consultabili.',
      confirmLabel: 'Scollega',
    })
    if (!confirmed) return
    setBusy(true)
    setError(null)
    try {
      await unlinkWhatsApp(client, propertyId)
      await load()
    } catch (cause) {
      setError(actionErrorLabel(cause instanceof SmartInboxActionError ? cause.code : null))
    } finally {
      setBusy(false)
    }
  }

  const linked = account && account.status !== 'disconnected'

  return (
    <section className="shell-card">
      <div className="section-heading">
        <h2>WhatsApp Business</h2>
        <p>I messaggi degli ospiti al numero WhatsApp della struttura arrivano da soli con una bozza; la risposta parte da qui. WhatsApp permette di rispondere entro 24 ore dall'ultimo messaggio dell'ospite.</p>
      </div>
      <div className="smart-inbox-mailbox">
        <span className="icon-tile"><MessageCircle size={17} /></span>
        <div className="smart-inbox-mailbox-text">
          {account === undefined ? <span className="muted">Caricamento…</span> : linked ? (
            <>
              <strong>{account.display_phone_number ?? account.phone_number_id}</strong>
              <span className="muted">{account.verified_name ? `${account.verified_name} · ` : ''}Collegato</span>
            </>
          ) : (
            <>
              <strong>Nessun numero collegato</strong>
              <span className="muted">{available ? 'Serve un numero su WhatsApp Business Platform (Meta).' : 'Il collegamento WhatsApp non è ancora configurato sul server.'}</span>
            </>
          )}
        </div>
        {canManage && linked ? (
          <div className="smart-inbox-mailbox-actions">
            <Button variant="secondary" onClick={() => void unlink()} disabled={busy}><Unplug size={15} /> Scollega</Button>
          </div>
        ) : null}
      </div>

      {canManage && available && account !== undefined && !linked ? (
        <form className="modal-form smart-inbox-settings-form" onSubmit={submit}>
          <p className="muted smart-inbox-note">Da WhatsApp Manager di Meta (Strumenti per l'account → Numeri di telefono, e Impostazioni business → Utenti di sistema per il token):</p>
          <div className="smart-inbox-editor-row">
            <label className="form-field smart-inbox-grow">
              <span>Phone number ID</span>
              <input value={phoneNumberId} onChange={(event) => setPhoneNumberId(event.target.value)} inputMode="numeric" pattern="[0-9]{5,32}" required placeholder="es. 109876543210" />
            </label>
            <label className="form-field smart-inbox-grow">
              <span>WhatsApp Business Account ID</span>
              <input value={wabaId} onChange={(event) => setWabaId(event.target.value)} inputMode="numeric" pattern="[0-9]{5,32}" required placeholder="es. 200000000001" />
            </label>
          </div>
          <label className="form-field">
            <span>Token di accesso permanente (utente di sistema)</span>
            <input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} autoComplete="off" required minLength={20} />
            <small>Viene verificato con Meta e salvato cifrato: non sarà più visibile.</small>
          </label>
          <div className="smart-inbox-buttons">
            <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Verifica con Meta…' : 'Collega WhatsApp'}</Button>
          </div>
        </form>
      ) : null}
      {!canManage ? <p className="muted smart-inbox-note">Solo un responsabile può collegare o scollegare il numero.</p> : null}
      {error ? <p className="form-error smart-inbox-pad" role="alert">{error}</p> : null}
      {notice ? <p className="smart-inbox-notice smart-inbox-pad" role="status">{notice}</p> : null}
      {confirmDialog}
    </section>
  )
}
