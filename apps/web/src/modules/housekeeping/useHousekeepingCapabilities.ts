import { useEffect, useState } from 'react'
import { supabase } from '../../core/client'
import { useModuleRuntime } from '../../core/ModuleRuntimeContext'

export interface HousekeepingCapabilities {
  manage: boolean
  queueManage: boolean
}

// Shared by ShellLayout (deciding full vs. minimal chrome for a facchino) and
// HousekeepingModuleGate (gating "Gestione") so both read the same
// resolution without a second round-trip -- cached per property+profile for
// the tab's lifetime, same reasoning as HousekeepingModuleGate's own
// capabilitiesCache before this was extracted out of it.
const capabilitiesCache = new Map<string, HousekeepingCapabilities>()

export function useHousekeepingCapabilities(): HousekeepingCapabilities | null {
  const runtime = useModuleRuntime()
  const { hasPermission } = runtime
  const propertyId = runtime.property?.id ?? null
  const profileId = runtime.profile?.id ?? null
  const capabilitiesKey = propertyId && profileId ? `${propertyId}:${profileId}` : null
  const cached = capabilitiesKey ? capabilitiesCache.get(capabilitiesKey) : undefined
  const [capabilities, setCapabilities] = useState<HousekeepingCapabilities | null>(cached ?? null)

  useEffect(() => {
    if (!propertyId || !profileId) return
    if (capabilitiesKey && capabilitiesCache.has(capabilitiesKey)) return
    const resolvedPropertyId = propertyId
    const resolvedProfileId = profileId
    let cancelled = false

    async function resolveCapabilities() {
      try {
        const [manage, detailResult] = await Promise.all([
          hasPermission('core.staff.manage'),
          supabase
            .from('property_staff_details')
            .select('housekeeping_department, job_title_id')
            .eq('property_id', resolvedPropertyId)
            .eq('profile_id', resolvedProfileId)
            .maybeSingle(),
        ])

        let reception = detailResult.data?.housekeeping_department === 'reception'
        const jobTitleId = detailResult.data?.job_title_id
        if (!reception && jobTitleId) {
          const { data: jobTitle } = await supabase
            .from('property_job_titles')
            .select('name, sees_full_queue')
            .eq('id', jobTitleId)
            .maybeSingle()
          reception = jobTitle?.sees_full_queue === true || jobTitle?.name.trim().toLocaleLowerCase('it') === 'reception'
        }

        if (!cancelled) {
          const resolved = { manage, queueManage: reception }
          if (capabilitiesKey) capabilitiesCache.set(capabilitiesKey, resolved)
          setCapabilities(resolved)
        }
      } catch (cause) {
        console.error('useHousekeepingCapabilities: resolution failed', cause)
        if (!cancelled) setCapabilities({ manage: false, queueManage: false })
      }
    }

    void resolveCapabilities()
    return () => {
      cancelled = true
    }
  }, [propertyId, profileId, hasPermission, capabilitiesKey])

  return capabilities
}
