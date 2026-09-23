import { setOnDuty } from '@/lib/staff-api'

// Push subscription ownership now lives entirely in the Homisuite Shell.
// Housekeeping only controls the operational on-duty gate used by recipient
// selection; it must not create, rotate, claim, or delete browser
// subscriptions independently.
export async function goOnDuty(): Promise<void> {
  await setOnDuty(true)
}

export async function goOffDuty(): Promise<void> {
  await setOnDuty(false)
}
