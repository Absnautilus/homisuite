import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { LoginScreen } from './pages/LoginScreen'
import { Dashboard } from './pages/Dashboard'

export function AuthGate() {
  const [session, setSession] = useState<Session | null | 'checking'>('checking')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === 'checking') {
    return <main className="login-screen"><p className="muted">Caricamento…</p></main>
  }
  if (!session) return <LoginScreen />
  return <Dashboard />
}
