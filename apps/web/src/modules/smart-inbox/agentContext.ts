import { createContext, useContext } from 'react'

// The current agent's own languages, shared with every reply editor on the
// page so the Italian translation shows only when they need it.
export const MyLanguagesContext = createContext<string[]>(['it'])

export function useReadsLanguage(): (code: string | null) => boolean {
  const languages = useContext(MyLanguagesContext)
  return (code) => Boolean(code) && languages.includes((code as string).toLowerCase().slice(0, 2))
}
