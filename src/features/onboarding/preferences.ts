import type { UserPreferences } from '../../types/profile'

export const DAYS = [
  { value: 1, short: 'Mon', name: 'Monday' },
  { value: 2, short: 'Tue', name: 'Tuesday' },
  { value: 3, short: 'Wed', name: 'Wednesday' },
  { value: 4, short: 'Thu', name: 'Thursday' },
  { value: 5, short: 'Fri', name: 'Friday' },
  { value: 6, short: 'Sat', name: 'Saturday' },
  { value: 0, short: 'Sun', name: 'Sunday' },
] as const

export const SCHEDULING_LABELS: Record<UserPreferences['schedulingMode'], string> = {
  fixed: 'Fixed schedule', rolling: 'Rolling split', adaptive: 'Smart adaptive',
}

export const SPLIT_LABELS: Record<UserPreferences['preferredSplit'], string> = {
  'push-pull-legs': 'Push / Pull / Legs', 'upper-lower': 'Upper / Lower',
  'full-body': 'Full body', custom: 'Custom split',
}

export const EXPERIENCE_LABELS: Record<UserPreferences['experience'], string> = {
  beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced',
}

export function dayNames(values: number[], weekStartsOn: 0 | 1 = 1): string {
  const days = weekStartsOn === 0 ? [DAYS[6], ...DAYS.slice(0, 6)] : DAYS
  return days.filter((day) => values.includes(day.value)).map((day) => day.short).join(', ')
}

export function commaSeparatedValues(value: string): string[] {
  return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))]
}
