import type { ReactNode } from 'react'

// Shared across the three management forms below (organizations/properties/
// modules) -- same minimal shape TeamPage.tsx's own local Field already
// uses, just not private to one file since three platform pages need it.
export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return <label className="form-field" htmlFor={htmlFor}><span>{label}</span>{children}</label>
}
