import { weightFromKg } from '../../domain/training/helpers'
import type { ExerciseSnapshot, PlannedSet } from '../../types/training'
import type { LoggedSet } from '../../types/workout'

export function formatClock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function formatWorkoutDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(timestamp)
}

export function formatSet(set: LoggedSet, snapshot: ExerciseSnapshot, unit: 'kg' | 'lb') {
  const weight = set.weightKg === null ? '—' : weightFromKg(set.weightKg, unit)
  switch (snapshot.trackingType) {
    case 'weight-reps':
      return `${weight} ${unit} × ${set.reps ?? '—'} reps`
    case 'assisted-reps':
      return `${weight} ${unit} assistance × ${set.reps ?? '—'} reps`
    case 'reps':
      return `${set.reps ?? '—'} reps`
    case 'duration':
      return `${set.durationSeconds ?? '—'} sec`
    case 'distance-duration':
      return `${set.distanceMeters ?? '—'} m · ${set.durationSeconds ?? '—'} sec`
  }
}

export function formatTarget(
  set: PlannedSet | undefined,
  snapshot: ExerciseSnapshot,
  unit: 'kg' | 'lb',
) {
  if (!set) return 'Added during this workout'
  const repRange = set.repsMin === set.repsMax ? set.repsMin : `${set.repsMin}–${set.repsMax}`
  const weight =
    set.targetWeightKg === null
      ? ''
      : `${weightFromKg(set.targetWeightKg, unit)} ${unit}${snapshot.trackingType === 'assisted-reps' ? ' assistance' : ''} · `
  switch (snapshot.trackingType) {
    case 'weight-reps':
    case 'assisted-reps':
      return `${weight}${repRange} reps`
    case 'reps':
      return `${repRange} reps`
    case 'duration':
      return `${set.durationSeconds} sec`
    case 'distance-duration':
      return `${set.distanceMeters} m · ${set.durationSeconds} sec`
  }
}
