import { describe, expect, it } from 'vitest'
import { EXERCISES } from '../src/data/exercises'
import { createPlannedSet, createRoutineExercise, weightToKg } from '../src/domain/training/helpers'
import {
  createLoggedSet,
  createRestTimer,
  createWorkoutSession,
  finishWorkoutSession,
  previousExercisePerformance,
  restSecondsRemaining,
  substituteWorkoutExercise,
  workoutElapsedSeconds,
  workoutTotals,
} from '../src/domain/workout/helpers'
import { workoutSessionSchema } from '../src/schemas/workout'
import { workoutValidationPages } from '../src/domain/workout/validationPages'
import { workoutCheckpointSchema, workoutStateSchema } from '../src/services/workouts/storage'
import type { Exercise, Routine, TrackingType } from '../src/types/training'
import type { WorkoutSession } from '../src/types/workout'

const start = 1_800_000_000_000
const exerciseFor = (tracking: TrackingType) =>
  EXERCISES.find((exercise) => exercise.trackingType === tracking)!
const routine = (exercise: Exercise = exerciseFor('weight-reps')): Routine => ({
  id: 'routine-1',
  ownerId: 'alex',
  createdAt: start - 1000,
  updatedAt: start - 1000,
  archived: false,
  schemaVersion: 1,
  revision: 3,
  mutationId: 'routine-new',
  previousMutationId: 'routine-old',
  name: 'Morning strength',
  description: '',
  targetMuscles: [],
  exercises: [createRoutineExercise(exercise)],
})
const session = (tracking: TrackingType = 'weight-reps') =>
  createWorkoutSession(routine(exerciseFor(tracking)), 'alex', null, start)
function performSet(workout: WorkoutSession, at = start + 60_000) {
  const exercise = workout.exercises[0]
  const set = exercise.sets[0]
  const tracking = exercise.snapshot.trackingType
  if (['weight-reps', 'assisted-reps'].includes(tracking)) set.weightKg = 0
  if (['weight-reps', 'reps', 'assisted-reps'].includes(tracking)) set.reps = 8
  if (['duration', 'distance-duration'].includes(tracking)) set.durationSeconds = 60
  if (tracking === 'distance-duration') set.distanceMeters = 200
  set.completedAt = at
  workout.updatedAt = at
  return workout
}

describe('workout snapshots and actual set contracts', () => {
  it('copies the routine revision, split context, and snapshots without sharing mutable references', () => {
    const source = routine()
    const context = { splitId: 'split-1', splitRevision: 2, slotId: 'slot-1' }
    const workout = createWorkoutSession(source, 'alex', context, start)
    const before = structuredClone(workout)
    source.name = 'Changed after workout started'
    source.revision = 4
    source.exercises[0].exerciseSnapshot.name = 'Renamed exercise'
    source.exercises[0].exerciseSnapshot.primaryMuscles.splice(0)
    source.exercises[0].sets[0].repsMin = 99
    context.slotId = 'different-slot'
    expect(workout).toEqual(before)
    expect(workout.routineRevision).toBe(3)
    expect(workout.splitContext?.slotId).toBe('slot-1')
    expect(workout.exercises[0].sets[0].reps).toBeNull()
    expect(workoutTotals(workout).completedSets).toBe(0)
  })

  it('uses distinct session and actual-set identities even when starting the same routine twice', () => {
    const source = routine()
    const first = createWorkoutSession(source, 'alex', null, start)
    const second = createWorkoutSession(source, 'alex', null, start)
    expect(first.id).not.toBe(second.id)
    expect(first.mutationId).not.toBe(second.mutationId)
    expect(first.exercises[0].id).toBe(second.exercises[0].id)
    expect(first.exercises[0].sets[0].id).not.toBe(second.exercises[0].sets[0].id)
    expect(first.exercises[0].sets[0].id).not.toBe(source.exercises[0].sets[0].id)
  })

  it.each(['weight-reps', 'reps', 'assisted-reps', 'duration', 'distance-duration'] as const)(
    'accepts an incomplete %s draft but requires its own actual metrics when marking a set complete',
    (tracking) => {
      const workout = session(tracking)
      const set = workout.exercises[0].sets[0]
      set.weightKg = null
      set.reps = null
      set.durationSeconds = null
      set.distanceMeters = null
      expect(workoutSessionSchema.safeParse(workout).success).toBe(true)
      set.completedAt = start
      expect(workoutSessionSchema.safeParse(workout).success).toBe(false)
      performSet(workout)
      expect(workoutSessionSchema.safeParse(workout).success).toBe(true)
      if (['duration', 'distance-duration'].includes(tracking)) set.reps = 5
      else set.durationSeconds = 60
      expect(workoutSessionSchema.safeParse(workout).success).toBe(false)
    },
  )

  it('stores canonical kg and accepts zero external weight or assistance without treating it as missing', () => {
    const workout = performSet(session())
    expect(workoutSessionSchema.safeParse(workout).success).toBe(true)
    workout.exercises[0].sets[0].weightKg = weightToKg(100, 'lb')
    expect(workout.exercises[0].sets[0].weightKg).toBeCloseTo(45.3592, 4)
    expect(workoutTotals(workout).volumeKg).toBeCloseTo(362.8736, 4)
    expect(workoutSessionSchema.safeParse(performSet(session('assisted-reps'))).success).toBe(true)
    const bodyweight = performSet(session('reps'))
    bodyweight.exercises[0].sets[0].weightKg = 0
    expect(workoutSessionSchema.safeParse(bodyweight).success).toBe(false)
  })

  it.each([
    ['weightKg', Number.NaN],
    ['weightKg', Number.POSITIVE_INFINITY],
    ['weightKg', -1],
    ['reps', 0],
    ['reps', 2.5],
    ['reps', 1001],
    ['rpe', 0],
    ['rpe', 10.5],
    ['rpe', Number.NaN],
  ] as const)('rejects invalid actual %s=%s', (field, value) => {
    const workout = performSet(session())
    workout.exercises[0].sets[0][field] = value
    expect(workoutSessionSchema.safeParse(workout).success).toBe(false)
  })

  it('rejects invalid duration, distance, duplicate identities, unbounded collections, and unexpected fields', () => {
    const timed = performSet(session('distance-duration'))
    timed.exercises[0].sets[0].durationSeconds = Number.POSITIVE_INFINITY
    expect(workoutSessionSchema.safeParse(timed).success).toBe(false)
    timed.exercises[0].sets[0].durationSeconds = 60
    timed.exercises[0].sets[0].distanceMeters = 0
    expect(workoutSessionSchema.safeParse(timed).success).toBe(false)
    const workout = session()
    workout.exercises[0].sets[1].id = workout.exercises[0].sets[0].id
    expect(workoutSessionSchema.safeParse(workout).success).toBe(false)
    workout.exercises[0].sets = Array.from({ length: 13 }, () =>
      createLoggedSet(createPlannedSet('weight-reps'), 'weight-reps'),
    )
    expect(workoutSessionSchema.safeParse(workout).success).toBe(false)
    workout.exercises = Array.from({ length: 21 }, () => session().exercises[0])
    expect(workoutSessionSchema.safeParse(workout).success).toBe(false)
    expect(workoutSessionSchema.safeParse({ ...session(), archived: true }).success).toBe(false)
  })

  it('rejects fabricated timestamp ordering and incomplete revision metadata', () => {
    const workout = performSet(session())
    workout.exercises[0].sets[0].completedAt = start - 1
    expect(workoutSessionSchema.safeParse(workout).success).toBe(false)
    workout.exercises[0].sets[0].completedAt = workout.updatedAt + 1
    expect(workoutSessionSchema.safeParse(workout).success).toBe(false)
    workout.exercises[0].sets[0].completedAt = workout.updatedAt
    workout.revision = 2
    expect(workoutSessionSchema.safeParse(workout).success).toBe(false)
    workout.previousMutationId = 'old-mutation'
    expect(workoutSessionSchema.safeParse(workout).success).toBe(true)
    workout.previousMutationId = workout.mutationId
    expect(workoutSessionSchema.safeParse(workout).success).toBe(false)
  })
})

describe('workout completion, substitution, and previous performance', () => {
  it('requires actual performed work for completion, permits abandonment, and refuses a second finish', () => {
    const empty = session()
    expect(() => finishWorkoutSession(empty, 'completed', start + 1000)).toThrow()
    const abandoned = finishWorkoutSession(empty, 'abandoned', start + 5000)
    expect(abandoned.status).toBe('abandoned')
    expect(abandoned.elapsedSeconds).toBe(5)
    expect(() => finishWorkoutSession(abandoned, 'completed', start + 6000)).toThrow(
      'already ended',
    )
    const workout = performSet(session())
    workout.timerEndAt = start + 150_000
    const completed = finishWorkoutSession(workout, 'completed', start + 120_000)
    expect(completed.status).toBe('completed')
    expect(completed.completionKey).toBe(completed.id)
    expect(completed.elapsedSeconds).toBe(120)
    expect(completed.timerEndAt).toBeNull()
    expect(empty.status).toBe('active')
  })

  it('counts performed sets only and separates assistance from lifted external volume', () => {
    const workout = performSet(session())
    workout.exercises[0].sets[0].weightKg = 20
    workout.exercises[0].sets[0].type = 'warmup'
    workout.exercises[0].sets[1].weightKg = 999
    workout.exercises[0].sets[1].reps = 999
    const assistance = performSet(session('assisted-reps')).exercises[0]
    assistance.sets[0].weightKg = 50
    const timed = performSet(session('distance-duration')).exercises[0]
    workout.exercises.push(assistance, timed)
    expect(workoutTotals(workout)).toEqual({
      completedSets: 3,
      workingSets: 2,
      completedExercises: 3,
      reps: 16,
      volumeKg: 160,
      durationSeconds: 60,
      distanceMeters: 200,
    })
  })

  it('substitutes safely before performance and preserves the original reference through multiple replacements', () => {
    const original = session().exercises[0]
    original.sets[0].weightKg = 100
    original.sets[0].reps = 10
    original.sets[0].rpe = 9
    const duration = exerciseFor('duration')
    const replaced = substituteWorkoutExercise(original, duration)
    expect(replaced.id).toBe(original.id)
    expect(replaced.exerciseId).toBe(duration.id)
    expect(replaced.originalExerciseId).toBe(original.exerciseId)
    expect(replaced.sets[0]).toMatchObject({
      weightKg: null,
      reps: null,
      rpe: null,
      completedAt: null,
    })
    const second = substituteWorkoutExercise(replaced, exerciseFor('reps'))
    expect(second.originalExerciseId).toBe(original.exerciseId)
    const reverted = substituteWorkoutExercise(second, exerciseFor('weight-reps'))
    expect(reverted.originalExerciseId).toBeNull()
    expect(original.sets[0].weightKg).toBe(100)
    const workout = session()
    workout.exercises[0] = replaced
    expect(workoutSessionSchema.safeParse(workout).success).toBe(true)
    expect(() => substituteWorkoutExercise(performSet(session()).exercises[0], duration)).toThrow(
      'performed sets',
    )
  })

  it('finds the latest performed exercise by its actual identity and ignores abandoned or empty sessions', () => {
    const original = exerciseFor('weight-reps')
    const substitute = exerciseFor('reps')
    const first = finishWorkoutSession(performSet(session()), 'completed', start + 120_000)
    const substituted = session()
    substituted.exercises[0] = substituteWorkoutExercise(substituted.exercises[0], substitute)
    const recent = finishWorkoutSession(
      performSet(substituted, start + 180_000),
      'completed',
      start + 240_000,
    )
    const abandoned = finishWorkoutSession(
      performSet(session(), start + 300_000),
      'abandoned',
      start + 360_000,
    )
    const sessions = [recent, abandoned, first, session()]
    expect(previousExercisePerformance(sessions, original.id)?.sessionId).toBe(first.id)
    const previous = previousExercisePerformance(sessions, substitute.id)!
    expect(previous.sessionId).toBe(recent.id)
    expect(previous.sets).toHaveLength(1)
    previous.sets[0].reps = 99
    expect(recent.exercises[0].sets[0].reps).toBe(8)
    expect(previousExercisePerformance(sessions, substitute.id, recent.id)).toBeNull()
    expect(previousExercisePerformance(sessions, 'missing-exercise')).toBeNull()
  })
})

describe('timestamp-based workout and rest timer recovery', () => {
  it('recovers elapsed workout time after reload or long background suspension', () => {
    const restored = JSON.parse(JSON.stringify(session())) as WorkoutSession
    expect(workoutElapsedSeconds(restored, start + 3_600_999)).toBe(3600)
    expect(workoutElapsedSeconds(restored, start - 1000)).toBe(0)
    restored.elapsedSeconds = 30
    expect(workoutElapsedSeconds(restored, start + 10_000)).toBe(30)
    const completed = finishWorkoutSession(performSet(restored), 'completed', start + 120_000)
    expect(workoutElapsedSeconds(completed, start + 86_400_000)).toBe(120)
  })

  it('recovers rest from a persisted deadline without delayed interval drift', () => {
    const timer = JSON.parse(JSON.stringify(createRestTimer(90, start)))
    expect(restSecondsRemaining(timer, start + 30_001)).toBe(60)
    expect(restSecondsRemaining(timer, start + 90_000)).toBe(0)
    expect(restSecondsRemaining(timer, start + 3_600_000)).toBe(0)
    expect(restSecondsRemaining(null, start)).toBe(0)
    expect(restSecondsRemaining(createRestTimer(0, start), start)).toBe(0)
    expect(() => createRestTimer(Number.NaN, start)).toThrow()
    expect(() => createRestTimer(-1, start)).toThrow()
    expect(() => createRestTimer(1801, start)).toThrow()
  })
})

describe('workout state and checkpoint contracts', () => {
  const state = () => ({
    id: 'current' as const,
    ownerId: 'alex',
    createdAt: start,
    updatedAt: start,
    schemaVersion: 1 as const,
    revision: 1,
    mutationId: 'state-mutation',
    previousMutationId: null,
    activeSessionId: 'session-id',
  })

  it('accepts a first active pointer and a subsequent clear only with revision ancestry', () => {
    const active = state()
    expect(workoutStateSchema.safeParse(active).success).toBe(true)
    const cleared = {
      ...active,
      activeSessionId: null,
      updatedAt: start + 1000,
      revision: 2,
      mutationId: 'state-next',
      previousMutationId: active.mutationId,
    }
    expect(workoutStateSchema.safeParse(cleared).success).toBe(true)
    expect(workoutStateSchema.safeParse({ ...cleared, previousMutationId: null }).success).toBe(
      false,
    )
    expect(
      workoutStateSchema.safeParse({ ...cleared, previousMutationId: cleared.mutationId }).success,
    ).toBe(false)
    expect(workoutStateSchema.safeParse({ ...active, updatedAt: start - 1 }).success).toBe(false)
    expect(workoutStateSchema.safeParse({ ...active, archived: true }).success).toBe(false)
  })

  it('validates the full interrupted write alongside its durable local draft', () => {
    const workout = session()
    const checkpoint = {
      key: `alex:${workout.id}`,
      uid: 'alex',
      session: workout,
      baseRevision: 0,
      baseMutationId: null,
      version: 2,
      dirty: true,
      attempt: { session: structuredClone(workout), state: state(), version: 1 },
      stateBase: null,
      error: null,
      conflict: false,
    }
    expect(workoutCheckpointSchema.safeParse(checkpoint).success).toBe(true)
    const corrupted = structuredClone(checkpoint)
    corrupted.attempt.session.exercises[0].sets[0].reps = Number.NaN
    expect(workoutCheckpointSchema.safeParse(corrupted).success).toBe(false)
    expect(workoutCheckpointSchema.safeParse({ ...checkpoint, version: -1 }).success).toBe(false)
    expect(workoutCheckpointSchema.safeParse({ ...checkpoint, dirty: 'false' }).success).toBe(false)
    expect(
      workoutCheckpointSchema.safeParse({ ...checkpoint, key: `other:${workout.id}` }).success,
    ).toBe(false)
    expect(
      workoutCheckpointSchema.safeParse({
        ...checkpoint,
        session: { ...workout, ownerId: 'other' },
      }).success,
    ).toBe(false)
    expect(
      workoutCheckpointSchema.safeParse({
        ...checkpoint,
        attempt: { ...checkpoint.attempt, session: { ...workout, id: 'another-workout' } },
      }).success,
    ).toBe(false)
    expect(
      workoutCheckpointSchema.safeParse({
        ...checkpoint,
        stateBase: { ...state(), ownerId: 'other' },
      }).success,
    ).toBe(false)
    expect(
      workoutCheckpointSchema.safeParse({
        ...checkpoint,
        attempt: { ...checkpoint.attempt, state: { ...state(), ownerId: 'other' } },
      }).success,
    ).toBe(false)
  })

  it('partitions twenty exercise snapshots into bounded proof pages tied to the exact workout mutation', () => {
    const source = routine()
    source.exercises = Array.from({ length: 20 }, () =>
      createRoutineExercise(exerciseFor('weight-reps')),
    )
    const workout = createWorkoutSession(source, 'alex', null, start)
    const pages = workoutValidationPages(workout)
    expect(pages.map((page) => page.id)).toEqual(['p0', 'p1', 'p2', 'p3'])
    expect(pages.map((page) => page.value.exercises.length)).toEqual([5, 5, 5, 5])
    expect(pages.flatMap((page) => page.value.exercises)).toEqual(workout.exercises)
    for (const page of pages)
      expect(page.value).toMatchObject({
        ownerId: 'alex',
        sessionId: workout.id,
        revision: workout.revision,
        mutationId: workout.mutationId,
      })
  })
})
