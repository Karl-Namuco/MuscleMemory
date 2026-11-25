import type { Exercise, ExerciseSnapshot, PlannedSet, RoutineExercise, TrackingType } from '../../types/training'

export const TRACKING_LABELS: Record<TrackingType, string> = {
  'weight-reps': 'Weight & reps', reps: 'Reps only', 'assisted-reps': 'Assistance & reps',
  duration: 'Duration', 'distance-duration': 'Distance & duration',
}
export function weightToKg(value: number, unit: 'kg' | 'lb'): number {
  return unit === 'kg' ? value : Math.round(value * 0.45359237 * 10000) / 10000
}
export function weightFromKg(value: number, unit: 'kg' | 'lb'): number {
  return unit === 'kg' ? value : Math.round(value / 0.45359237 * 100) / 100
}
export function exerciseSnapshot(exercise: Exercise): ExerciseSnapshot {
  return { name: exercise.name, trackingType: exercise.trackingType, primaryMuscles: [...exercise.primaryMuscles], secondaryMuscles: [...exercise.secondaryMuscles], equipment: exercise.equipment, movementPattern: exercise.movementPattern }
}
export function createPlannedSet(trackingType: TrackingType): PlannedSet {
  const reps = ['weight-reps', 'reps', 'assisted-reps'].includes(trackingType)
  return { id: crypto.randomUUID(), type: 'working', repsMin: reps ? 8 : null, repsMax: reps ? 12 : null, targetWeightKg: null, durationSeconds: reps ? null : 60, distanceMeters: trackingType === 'distance-duration' ? 500 : null }
}
export function createRoutineExercise(exercise: Exercise): RoutineExercise {
  return { id: crypto.randomUUID(), exerciseId: exercise.id, exerciseSnapshot: exerciseSnapshot(exercise), sets: Array.from({length: 3}, () => createPlannedSet(exercise.trackingType)), restSeconds: 90, notes: '', optional: false, supersetGroup: null }
}
export function estimatedRoutineMinutes(exercises: RoutineExercise[]): number {
  return Math.ceil(exercises.reduce((seconds, exercise) => seconds + 60 + exercise.sets.reduce((sum, set) => sum + (set.durationSeconds || (set.repsMax || 10) * 4) + exercise.restSeconds, 0), 300) / 60)
}
