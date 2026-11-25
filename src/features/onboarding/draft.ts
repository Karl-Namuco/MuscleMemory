import Dexie, { type Table } from 'dexie'
import { defaultPreferences, type ProfileInput } from '../../types/profile'

export interface OnboardingDraft {
  uid: string
  input: ProfileInput
  step: number
  savedAt: number
}

class OnboardingDatabase extends Dexie {
  drafts!: Table<OnboardingDraft, string>

  constructor() {
    super('muscle-memory-onboarding')
    this.version(1).stores({ drafts: '&uid, savedAt' })
  }
}

const database = new OnboardingDatabase()

/** Recover incomplete input without requiring it to pass completion validation. */
export function recoverDraftInput(value: unknown): ProfileInput | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (
    typeof input.displayName !== 'string' ||
    !input.preferences ||
    typeof input.preferences !== 'object'
  )
    return null
  const preferences = input.preferences as Record<string, unknown>
  const defaults = defaultPreferences()
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const current = preferences[key]
    if (key === 'initialHistory') continue
    if (Array.isArray(defaultValue)) {
      if (!Array.isArray(current)) return null
      const itemType = key === 'preferredDays' || key === 'restDays' ? 'number' : 'string'
      if (current.some((item: unknown) => typeof item !== itemType)) return null
    } else if (typeof defaultValue === 'number') {
      if (current !== null && typeof current !== 'number') return null
    } else if (typeof current !== typeof defaultValue) return null
  }
  const history = preferences.initialHistory as Record<string, unknown> | undefined
  if (
    !history ||
    typeof history.lastTrainedDate !== 'string' ||
    typeof history.lastWorkout !== 'string' ||
    !Array.isArray(history.muscles) ||
    history.muscles.some((item: unknown) => typeof item !== 'string')
  )
    return null
  const result = structuredClone(value) as ProfileInput
  // JSON serializes an empty numeric input's NaN as null. Restore the empty
  // numeric state so validation can explain it without discarding other edits.
  if (preferences.sessionMinutes === null) result.preferences.sessionMinutes = Number.NaN
  if (preferences.sessionsPerWeek === null) result.preferences.sessionsPerWeek = Number.NaN
  return result
}

export function readOnboardingDraft(uid: string): Promise<OnboardingDraft | undefined> {
  return database.drafts.get(uid)
}

export async function saveOnboardingDraft(
  uid: string,
  input: ProfileInput,
  step: number,
): Promise<void> {
  await database.drafts.put({ uid, input: structuredClone(input), step, savedAt: Date.now() })
}

export async function clearOnboardingDraft(uid: string): Promise<void> {
  await database.drafts.delete(uid)
}

export async function clearAllOnboardingDrafts(): Promise<void> {
  await database.drafts.clear()
}
