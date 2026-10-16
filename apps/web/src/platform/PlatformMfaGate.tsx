import { FormEvent, useEffect, useState } from 'react'
import { Button } from '@homisuite/ui'
import { PageState } from '../components/PageState'
import { supabase } from '../core/client'
import { usePlatformContext } from './PlatformContext'

// Supabase's own TOTP enrollment/verification flow (supabase.auth.mfa.*) --
// not a bespoke scheme. A factor enrolled here is tied to the signed-in
// profile's auth.users row like any other MFA factor; this component only
// decides WHEN to show it (the platform console's own gate), never how TOTP
// itself works.
//
// Enrollment vs. challenge are different screens on purpose: a platform
// admin who already completed enrollment in an earlier session, and is only
// missing a verified factor THIS session (a plain password login since),
// must not be asked to scan a new QR code -- that would silently create a
// second, redundant factor. listFactors() on mount decides which screen to
// show.
export function PlatformMfaGate() {
  const { refresh } = usePlatformContext()
  const [phase, setPhase] = useState<'checking' | 'enroll' | 'challenge' | 'error'>('checking')
  const [error, setError] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function prepare() {
      const { data, error: listError } = await supabase.auth.mfa.listFactors()
      if (cancelled) return
      if (listError) {
        setError(listError.message)
        setPhase('error')
        return
      }
      const verifiedTotp = data.totp.find((factor) => factor.status === 'verified')
      if (verifiedTotp) {
        setFactorId(verifiedTotp.id)
        setPhase('challenge')
        return
      }
      const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (cancelled) return
      if (enrollError) {
        setError(enrollError.message)
        setPhase('error')
        return
      }
      setFactorId(enrollData.id)
      setQrCode(enrollData.totp.qr_code)
      setSecret(enrollData.totp.secret)
      setPhase('enroll')
    }
    void prepare()
    return () => { cancelled = true }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!factorId || submitting) return
    setSubmitting(true)
    setError(null)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    setSubmitting(false)
    if (verifyError) {
      setError('Codice non valido. Riprova.')
      return
    }
    // challengeAndVerify already refreshed the session's access token with
    // the new aal2 claim -- reloading the platform context re-reads it via
    // platform_admin_self_status(), server-side.
    void refresh()
  }

  if (phase === 'checking') return <PageState kind="loading" title="Verifica autenticazione a due fattori…" variant="fullscreen" />

  if (phase === 'error') {
    return (
      <main className="platform-mfa-gate">
        <PageState kind="error" title="Impossibile preparare la verifica MFA." description={error ?? undefined} variant="fullscreen" />
      </main>
    )
  }

  return (
    <main className="platform-mfa-gate">
      <div className="platform-mfa-card">
        <h1>Autenticazione a due fattori richiesta</h1>
        <p className="muted">
          {phase === 'enroll'
            ? 'Le operazioni della console Platform Admin richiedono un\'app authenticator (es. Google Authenticator, 1Password). Inquadra il codice con la tua app, poi inserisci il codice generato.'
            : 'Inserisci il codice generato dalla tua app authenticator per continuare.'}
        </p>
        {phase === 'enroll' && qrCode ? (
          <div className="platform-mfa-enroll">
            <img src={qrCode} alt="Codice QR per l'app authenticator" width={200} height={200} />
            {secret ? <p className="platform-mfa-secret">Chiave manuale: <code>{secret}</code></p> : null}
          </div>
        ) : null}
        <form onSubmit={handleSubmit} className="platform-mfa-form">
          <label htmlFor="platform-mfa-code">Codice a 6 cifre</label>
          <input
            id="platform-mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            autoFocus
          />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <Button type="submit" variant="primary" disabled={submitting || code.length !== 6}>
            {submitting ? 'Verifica…' : 'Verifica'}
          </Button>
        </form>
      </div>
    </main>
  )
}
