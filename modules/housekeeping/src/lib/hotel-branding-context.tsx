import { createContext, useContext, type ReactNode } from 'react'

// Plumbs the property name from the Shell down to every page's PageHeader
// eyebrow, without threading a prop through each intermediate route/layout.
const HotelBrandingContext = createContext<string | null>(null)

export function HotelBrandingProvider({ hotelName, children }: { hotelName: string; children: ReactNode }) {
  return <HotelBrandingContext.Provider value={hotelName}>{children}</HotelBrandingContext.Provider>
}

export function useHotelName(): string {
  return useContext(HotelBrandingContext) ?? 'Struttura'
}
