/**
 * A Supabase .update()/.delete() with no matching row (wrong/stale id, or
 * RLS silently filtered it out) returns `error: null` and an empty result
 * -- NOT an error. A mutation that doesn't already get this check for free
 * (a .single() that itself throws on anything but exactly one row) should
 * route its `.select('id').maybeSingle()` result through this instead of a
 * bare `if (error) throw error`, so a 0-row write surfaces as a real,
 * catchable error instead of a silent no-op the caller reports as saved.
 */
export function assertRowAffected<T>(data: T | null, message: string): asserts data is T {
  if (!data) throw new Error(message)
}
