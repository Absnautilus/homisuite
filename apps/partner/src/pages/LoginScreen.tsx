import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { PasswordField } from '../components/PasswordField'

// Simplified version of apps/web's own LoginScreen: a partner account is
// always invited by email (invite-service-partner-user), never created
// with a synthetic username like apps/web's credentials path, so there's
// no username-to-email resolution step here -- just signInWithPassword.
export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (signInError) {
      setError(signInError.message === 'Invalid login credentials' ? 'Email o password non corretti.' : 'Accesso non riuscito. Riprova.')
      setPending(false)
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand"><img className="mark" src="/icon-192.png" alt="" width={28} height={28} /><span>Homisuite Partner</span></div>
        <div className="login-copy">
          <p className="eyebrow">Area partner</p>
          <h1 id="login-title">Bentornato</h1>
          <p>Accedi per vedere e gestire le tue prenotazioni.</p>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            <span>Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
          </label>
          <label>
            <span>Password</span>
            <PasswordField required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error ? <p className="login-error" role="alert">{error}</p> : null}
          <button className="login-submit" type="submit" disabled={pending}>{pending ? 'Accesso…' : 'Accedi'}</button>
        </form>
      </section>
    </main>
  )
}
