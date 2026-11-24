export const GOALS = ['Build muscle', 'Get stronger', 'General fitness', 'Endurance', 'Body recomposition'] as const
export const EQUIPMENT = ['Barbell', 'Dumbbell', 'Cable', 'Machine', 'Smith machine', 'Bodyweight', 'Resistance band', 'Kettlebell'] as const
export const MUSCLES = ['Chest', 'Shoulders', 'Back', 'Biceps', 'Triceps', 'Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Core'] as const
export type Goal = (typeof GOALS)[number]
export type Equipment = (typeof EQUIPMENT)[number]
export interface UserPreferences {
  weightUnit: 'kg' | 'lb'
  timeZone: string
  weekStartsOn: 0 | 1
  experience: 'beginner' | 'intermediate' | 'advanced'
  goals: Goal[]
  sessionsPerWeek: number
  preferredDays: number[]
  restDays: number[]
  sessionMinutes: number
  flexibility: 'fixed' | 'flexible'
  schedulingMode: 'fixed' | 'rolling' | 'adaptive'
  preferredSplit: 'push-pull-legs' | 'upper-lower' | 'full-body' | 'custom'
  equipment: Equipment[]
  priorityMuscles: string[]
  excludedExercises: string[]
  favoriteExercises: string[]
  recoveryPreference: 'balanced' | 'conservative'
  initialHistory: { lastTrainedDate: string; lastWorkout: string; muscles: string[] }
}
export interface UserProfile {
  uid: string
  displayName: string
  onboardingCompleted: boolean
  schemaVersion: 1
  createdAt: number
  updatedAt: number
}
export interface AccountData {
  profile: UserProfile
  preferences: UserPreferences
  hasPendingWrites: boolean
  fromCache: boolean
}
export interface ProfileInput {
  displayName: string
  preferences: UserPreferences
  onboardingCompleted: boolean
}
export function defaultPreferences(): UserPreferences {
  return {
    weightUnit: 'kg', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    weekStartsOn: 1, experience: 'beginner', goals: ['Build muscle'], sessionsPerWeek: 3,
    preferredDays: [1, 3, 5], restDays: [], sessionMinutes: 60, flexibility: 'flexible',
    schedulingMode: 'rolling', preferredSplit: 'push-pull-legs', equipment: ['Dumbbell', 'Bodyweight'],
    priorityMuscles: [], excludedExercises: [], favoriteExercises: [], recoveryPreference: 'balanced',
    initialHistory: { lastTrainedDate: '', lastWorkout: '', muscles: [] },
  }
}
