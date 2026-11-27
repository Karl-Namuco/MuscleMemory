import type { ExerciseSnapshot, PlannedSet } from './training'

export type WorkoutStatus = 'active' | 'completed' | 'abandoned'

export interface LoggedSet {
  id: string
  type: PlannedSet['type']
  weightKg: number | null
  /** Entry/display unit only; actual load remains canonical kilograms. */
  inputWeightUnit?: 'kg' | 'lb'
  reps: number | null
  durationSeconds: number | null
  distanceMeters: number | null
  rpe: number | null
  completedAt: number | null
}

export interface WorkoutExercise {
  /** The original routine entry identifier, retained through substitutions. */
  id: string
  exerciseId: string
  snapshot: ExerciseSnapshot
  originalExerciseId: string | null
  plannedSets: PlannedSet[]
  sets: LoggedSet[]
  restSeconds: number
  optional: boolean
  supersetGroup: string | null
  notes: string
}

export interface WorkoutSplitContext {
  splitId: string
  splitRevision: number
  slotId: string
  /** Expected Rolling completion sequence, frozen when the recommended slot starts. */
  sequence?: number
}

export interface WorkoutSession {
  id: string
  ownerId: string
  schemaVersion: 1
  revision: number
  mutationId: string
  previousMutationId: string | null
  createdAt: number
  updatedAt: number
  status: WorkoutStatus
  startedAt: number
  endedAt: number | null
  elapsedSeconds: number
  timerEndAt: number | null
  routineId: string
  routineRevision: number
  routineName: string
  notes: string
  exercises: WorkoutExercise[]
  splitContext: WorkoutSplitContext | null
  completionKey: string | null
  /** Explicitly recorded on completion; legacy and unscheduled sessions do not advance. */
  countsForSplit?: boolean
  fixedContext?: {
    scheduleId: string
    generationId: string
    occurrenceId: string
    occurrenceVersion: number
  }
}

export interface RestTimer {
  startedAt: number
  endsAt: number
}

export interface WorkoutTotals {
  completedSets: number
  workingSets: number
  completedExercises: number
  reps: number
  /** External load only; assistance does not count as lifted volume. */
  volumeKg: number
  durationSeconds: number
  distanceMeters: number
}

export interface PreviousExercisePerformance {
  sessionId: string
  routineName: string
  performedAt: number
  snapshot: ExerciseSnapshot
  sets: LoggedSet[]
}
