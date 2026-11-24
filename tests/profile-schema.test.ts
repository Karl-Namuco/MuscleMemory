import { describe, expect, it } from 'vitest'
import { preferencesSchema, profileInputSchema, userProfileSchema } from '../src/schemas/profile'
import { defaultPreferences } from '../src/types/profile'

describe('profile schema', () => {
  it('accepts defaults and trims the display name', () => {
    const input = profileInputSchema.parse({ displayName: '  Alex  ', onboardingCompleted: true, preferences: defaultPreferences() })
    expect(input.displayName).toBe('Alex')
    expect(input.preferences.weightUnit).toBe('kg')
  })
  it('rejects unknown fields and missing required fields', () => {
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), admin: true }).success).toBe(false)
    expect(profileInputSchema.safeParse({ displayName: 'Alex', onboardingCompleted: true }).success).toBe(false)
  })
  it('rejects invalid time zones, impossible dates and invalid list entries', () => {
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), timeZone: 'Mars/Olympus' }).success).toBe(false)
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), initialHistory: { lastTrainedDate: '2026-02-31', lastWorkout: '', muscles: [] } }).success).toBe(false)
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), equipment: ['Something'] }).success).toBe(false)
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), favoriteExercises: [42] }).success).toBe(false)
  })
  it('rejects duplicate and contradictory preferences', () => {
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), preferredDays: [1, 1] }).success).toBe(false)
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), restDays: [1] }).success).toBe(false)
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), favoriteExercises: ['Squat'], excludedExercises: ['Squat'] }).success).toBe(false)
  })
  it('rejects unrealistic ranges and blank names', () => {
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), sessionMinutes: 0 }).success).toBe(false)
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), sessionsPerWeek: 8 }).success).toBe(false)
    expect(profileInputSchema.safeParse({ displayName: ' ', onboardingCompleted: true, preferences: defaultPreferences() }).success).toBe(false)
  })
  it('requires a date for previous training and rejects future history', () => {
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), initialHistory: { lastTrainedDate: '', lastWorkout: 'Push', muscles: [] } }).success).toBe(false)
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), initialHistory: { lastTrainedDate: '2999-01-01', lastWorkout: 'Push', muscles: [] } }).success).toBe(false)
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), initialHistory: { lastTrainedDate: '2020-01-01', lastWorkout: 'Push', muscles: ['Chest'] } }).success).toBe(true)
  })
  it('validates cached account documents instead of trusting stored data', () => {
    expect(userProfileSchema.safeParse({ uid: 'alex', displayName: '', onboardingCompleted: false, schemaVersion: 1, createdAt: 1, updatedAt: 1 }).success).toBe(true)
    expect(userProfileSchema.safeParse({ uid: 'alex', displayName: 'Alex', onboardingCompleted: true, schemaVersion: 2, createdAt: 1, updatedAt: 1 }).success).toBe(false)
  })
})
