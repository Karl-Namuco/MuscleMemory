import { exerciseSnapshot, createPlannedSet } from '../training/helpers'
import { routineSchema } from '../../schemas/training'
import { workoutSessionSchema } from '../../schemas/workout'
import type { Exercise, PlannedSet, Routine, TrackingType } from '../../types/training'
import { TRACKING_TYPES } from '../../types/training'
import type {
  LoggedSet,
  PreviousExercisePerformance,
  RestTimer,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSplitContext,
  WorkoutTotals,
} from '../../types/workout'

export function createLoggedSet(planned: PlannedSet, tracking: TrackingType): LoggedSet {
  if (!TRACKING_TYPES.includes(tracking)) throw new Error('Choose an exercise tracking type.')
  return {
    id: crypto.randomUUID(),
    type: planned.type,
    weightKg: null,
    reps: null,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: null,
  }
}

export function createWorkoutSession(
  routine: Routine,
  ownerId: string,
  context: WorkoutSplitContext | null = null,
  now = Date.now(),
): WorkoutSession {
  const source = routineSchema.parse(routine)
  return workoutSessionSchema.parse({
    id: crypto.randomUUID(),
    ownerId,
    schemaVersion: 1,
    revision: 1,
    mutationId: crypto.randomUUID(),
    previousMutationId: null,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    startedAt: now,
    endedAt: null,
    elapsedSeconds: 0,
    timerEndAt: null,
    routineId: source.id,
    routineRevision: source.revision,
    routineName: source.name,
    notes: '',
    exercises: source.exercises.map((entry) => ({
      id: entry.id,
      exerciseId: entry.exerciseId,
      snapshot: structuredClone(entry.exerciseSnapshot),
      originalExerciseId: null,
      plannedSets: structuredClone(entry.sets),
      sets: entry.sets.map((set) => createLoggedSet(set, entry.exerciseSnapshot.trackingType)),
      restSeconds: entry.restSeconds,
      optional: entry.optional,
      supersetGroup: entry.supersetGroup,
      notes: entry.notes,
    })),
    splitContext: context === null ? null : { ...context },
    completionKey: null,
  })
}

/** Wall-clock differences survive background tabs, sleeping devices, and reloads. */
export function workoutElapsedSeconds(session: WorkoutSession, now = Date.now()): number {
  if (session.status !== 'active') return session.elapsedSeconds
  return Math.min(
    31536000,
    Math.max(session.elapsedSeconds, Math.floor((now - session.startedAt) / 1000), 0),
  )
}

export function createRestTimer(durationSeconds: number, now = Date.now()): RestTimer {
  if (
    !Number.isInteger(durationSeconds) ||
    durationSeconds < 0 ||
    durationSeconds > 1800 ||
    !Number.isSafeInteger(now) ||
    now <= 0
  )
    throw new Error('Choose a rest duration between 0 and 1800 seconds.')
  return { startedAt: now, endsAt: now + durationSeconds * 1000 }
}

export function restSecondsRemaining(timer: RestTimer | null, now = Date.now()): number {
  return timer === null ? 0 : Math.max(0, Math.ceil((timer.endsAt - now) / 1000))
}

export function workoutTotals(session: WorkoutSession): WorkoutTotals {
  const totals: WorkoutTotals = {
    completedSets: 0,
    workingSets: 0,
    completedExercises: 0,
    reps: 0,
    volumeKg: 0,
    durationSeconds: 0,
    distanceMeters: 0,
  }
  for (const exercise of session.exercises) {
    const completed = exercise.sets.filter((set) => set.completedAt !== null)
    if (completed.length) totals.completedExercises += 1
    for (const set of completed) {
      totals.completedSets += 1
      if (set.type !== 'warmup') totals.workingSets += 1
      totals.reps += set.reps ?? 0
      if (exercise.snapshot.trackingType === 'weight-reps')
        totals.volumeKg += (set.weightKg ?? 0) * (set.reps ?? 0)
      totals.durationSeconds += set.durationSeconds ?? 0
      totals.distanceMeters += set.distanceMeters ?? 0
    }
  }
  totals.volumeKg = Math.round(totals.volumeKg * 10000) / 10000
  return totals
}

/** Match the exercise actually performed, including replacements, instead of the original routine entry. */
export function previousExercisePerformance(
  sessions: WorkoutSession[],
  exerciseId: string,
  excludeSessionId?: string,
): PreviousExercisePerformance | null {
  const session = sessions
    .filter(
      (candidate) =>
        candidate.status === 'completed' &&
        candidate.id !== excludeSessionId &&
        candidate.exercises.some(
          (exercise) =>
            exercise.exerciseId === exerciseId &&
            exercise.sets.some((set) => set.completedAt !== null),
        ),
    )
    .sort(
      (left, right) =>
        (right.endedAt ?? right.startedAt) - (left.endedAt ?? left.startedAt) ||
        right.id.localeCompare(left.id),
    )[0]
  if (!session) return null
  const entries = session.exercises.filter((exercise) => exercise.exerciseId === exerciseId)
  return {
    sessionId: session.id,
    routineName: session.routineName,
    performedAt: session.endedAt ?? session.startedAt,
    snapshot: structuredClone(entries[0].snapshot),
    sets: structuredClone(
      entries.flatMap((exercise) => exercise.sets.filter((set) => set.completedAt !== null)),
    ),
  }
}

/** Substitutions must be explicit: previous actual values cannot become records for a different exercise. */
export function substituteWorkoutExercise(
  entry: WorkoutExercise,
  replacement: Exercise,
): WorkoutExercise {
  if (entry.exerciseId === replacement.id) return structuredClone(entry)
  if (entry.sets.some((set) => set.completedAt !== null))
    throw new Error(
      'Keep performed sets with their original exercise. Substitute before logging a set.',
    )
  const plannedSets = entry.plannedSets.map((set) => ({
    ...createPlannedSet(replacement.trackingType),
    type: set.type,
  }))
  const originalId = entry.originalExerciseId ?? entry.exerciseId
  return {
    ...structuredClone(entry),
    exerciseId: replacement.id,
    snapshot: exerciseSnapshot(replacement),
    originalExerciseId: replacement.id === originalId ? null : originalId,
    plannedSets,
    sets: plannedSets.map((set) => createLoggedSet(set, replacement.trackingType)),
  }
}

export function finishWorkoutSession(
  session: WorkoutSession,
  status: 'completed' | 'abandoned',
  now = Date.now(),
): WorkoutSession {
  if (session.status !== 'active') throw new Error('This workout has already ended.')
  return workoutSessionSchema.parse({
    ...session,
    status,
    endedAt: now,
    updatedAt: now,
    timerEndAt: null,
    elapsedSeconds: workoutElapsedSeconds(session, now),
    completionKey: status === 'completed' ? session.id : null,
  })
}
