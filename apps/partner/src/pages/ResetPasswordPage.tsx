import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PasswordField } from '../components/PasswordField'

// Copied from apps/web's own ResetPasswordPage almost verbatim -- same
// mechanism (Supabase auto-exchanges the invite/recovery link's token for a
// transient session and fires PASSWORD_RECOVERY), reached the same way:
// invite-service-partner-user's inviteUserByEmail call sends this app's own
// link via PARTNER_APP_URL. Rendered outside the normal AuthGate, since
// that transient session isn't the same thing as "signed in" for App.tsx's
// routing to make sense of.
export function ResetPasswordPage() {
  const [ready, setReady] = useState<'checking' | 'ready' | 'invalid'>('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady('ready')
    })
    supabase.auth.getSession().then(({ data }) => {
      setReady((current) => (current === 'checking' ? (data.session ? 'ready' : 'invalid') : current))
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== confirmPassword) { setError('Le due password non coincidono.'); return }
    setPending(true)
    setError(null)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setDone(true)
    } catch {
      setError('Non è stato possibile aggiornare la password. Il link potrebbe essere scaduto.')
      setPending(false)
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="reset-title">
        <div className="login-brand"><img className="mark" src="/icon-192.png" alt="" width={28} height={28} /><span>Homisuite Partner</span></div>

        {ready === 'checking' && (
          <div className="login-copy"><p>Verifica del link in corso…</p></div>
        )}

        {ready === 'invalid' && (
          <>
            <div className="login-copy">
              <h1 id="reset-title">Link non valido</h1>
              <p>Il link è scaduto o non è più valido. Contatta l'hotel per un nuovo invito.</p>
            </div>
            <Link className="login-submit" to="/" style={{ display: 'grid', placeItems: 'center' }}>Torna al login</Link>
          </>
        )}

        {ready === 'ready' && !done && (
          <>
            <div className="login-copy">
              <h1 id="reset-title">Imposta una password</h1>
              <p>Scegli una password per il tuo account partner.</p>
            </div>
            <form className="login-form" onSubmit={submit}>
              <label>
                <span>Nuova password</span>
                <PasswordField required minLength={8} maxLength={72} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
              </label>
              <label>
                <span>Conferma nuova password</span>
                <PasswordField required minLength={8} maxLength={72} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </label>
              {error ? <p className="login-error" role="alert">{error}</p> : null}
              <button className="login-submit" type="submit" disabled={pending}>{pending ? 'Salvataggio…' : 'Imposta password'}</button>
            </form>
          </>
        )}

        {done && (
          <>
            <div className="login-copy">
              <h1 id="reset-title">Password impostata</h1>
              <p>Il tuo account è pronto.</p>
            </div>
            <Link className="login-submit" to="/" style={{ display: 'grid', placeItems: 'center' }}>Continua</Link>
          </>
        )}
      </section>
    </main>
  )
}
