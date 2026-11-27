import { describe, expect, it } from 'vitest'
import {
  advanceRollingProgress,
  canAdvanceRolling,
  getRollingRecommendation,
  isPartialWorkout,
} from '../src/domain/scheduling/rolling'
import type { RollingProgress } from '../src/types/scheduling'
import type { Routine, SplitSlot, TrainingSplit } from '../src/types/training'
import type { WorkoutSession } from '../src/types/workout'

const completedAt = Date.parse('2026-11-23T10:00:00Z')
const metadata = {
  ownerId: 'alex',
  createdAt: completedAt - 10_000,
  updatedAt: completedAt,
  archived: false,
  schemaVersion: 1 as const,
  revision: 1,
  mutationId: 'mutation-1',
  previousMutationId: null,
}
const snapshot = {
  name: 'Press',
  trackingType: 'weight-reps' as const,
  primaryMuscles: [] as const,
  secondaryMuscles: [] as const,
  equipment: 'Barbell' as const,
  movementPattern: 'Horizontal push' as const,
}
function routine(id = 'push'): Routine {
  return {
    ...metadata,
    id,
    name: id === 'push' ? 'Push' : 'Pull',
    description: '',
    targetMuscles: [],
    exercises: [
      {
        id: 'entry-1',
        exerciseId: 'press',
        exerciseSnapshot: { ...snapshot, primaryMuscles: [], secondaryMuscles: [] },
        sets: ['plan-1', 'plan-2'].map((id) => ({
          id,
          type: 'working',
          repsMin: 8,
          repsMax: 12,
          targetWeightKg: null,
          durationSeconds: null,
          distanceMeters: null,
        })),
        restSeconds: 60,
        notes: '',
        optional: false,
        supersetGroup: null,
      },
    ],
  }
}
const training = (id: string, routineId = id): SplitSlot => ({
  id,
  label: id,
  routineId,
  isRestDay: false,
})
const rest = (id = 'rest'): SplitSlot => ({ id, label: 'Rest', routineId: null, isRestDay: true })
function split(slots = [training('push'), training('pull')]): TrainingSplit {
  return { ...metadata, id: 'split-1', name: 'Strength', description: '', mode: 'rolling', slots }
}
function progress(lastSlotId = 'push', at = completedAt, sequence = 1): RollingProgress {
  return {
    'split-1': {
      splitRevision: 1,
      sequence,
      lastSlotId,
      lastSessionId: 'previous-session',
      completedAt: at,
    },
  }
}
function workout(slotId = 'push', sequence = 0, at = completedAt): WorkoutSession {
  const source = routine(slotId)
  return {
    id: 'session-1',
    ownerId: 'alex',
    schemaVersion: 1,
    revision: 1,
    mutationId: 'session-mutation',
    previousMutationId: null,
    createdAt: at - 1000,
    updatedAt: at,
    status: 'completed',
    startedAt: at - 1000,
    endedAt: at,
    elapsedSeconds: 1,
    timerEndAt: null,
    routineId: source.id,
    routineRevision: source.revision,
    routineName: source.name,
    notes: '',
    exercises: source.exercises.map((entry) => ({
      id: entry.id,
      exerciseId: entry.exerciseId,
      snapshot: entry.exerciseSnapshot,
      originalExerciseId: null,
      plannedSets: entry.sets,
      sets: entry.sets.map((set, index) => ({
        id: `actual-${index}`,
        type: set.type,
        weightKg: 20,
        reps: 8,
        durationSeconds: null,
        distanceMeters: null,
        rpe: null,
        completedAt: at,
      })),
      restSeconds: entry.restSeconds,
      optional: entry.optional,
      supersetGroup: entry.supersetGroup,
      notes: entry.notes,
    })),
    splitContext: { splitId: 'split-1', splitRevision: 1, slotId, sequence },
    completionKey: 'session-1',
    countsForSplit: true,
  }
}
const routines = [routine(), routine('pull')]
const recommend = (source = split(), state: RollingProgress = {}, now = completedAt) =>
  getRollingRecommendation(source, routines, state, now, 'Asia/Manila')

describe('deterministic Rolling recommendations', () => {
  it('explains absent splits and unsupported scheduling modes', () => {
    expect(getRollingRecommendation(null, routines, {}, completedAt, 'Asia/Manila').kind).toBe(
      'none',
    )
    expect(recommend({ ...split(), mode: 'fixed' }).kind).toBe('unsupported')
    expect(recommend({ ...split(), mode: 'adaptive' }).kind).toBe('unsupported')
  })

  it('starts at the first training slot and applies leading rests only after completion', () => {
    expect(recommend(split([rest(), training('push'), training('pull')]))).toMatchObject({
      kind: 'workout',
      slotId: 'push',
      sequence: 0,
      restDays: 0,
      availableOn: null,
      reason: expect.stringContaining('Rest days apply after a completed workout'),
    })
  })

  it('keeps the next workout through missed days, week boundaries, and long absences', () => {
    for (const days of [0, 2, 7, 28, 365]) {
      expect(recommend(split(), progress(), completedAt + days * 86_400_000)).toMatchObject({
        kind: 'workout',
        slotId: 'pull',
        sequence: 1,
        availableOn: null,
      })
    }
  })

  it('uses slot identities for repeated routines and wraps the ordered cycle', () => {
    const source = split([training('push-a', 'push'), training('push-b', 'push')])
    expect(recommend(source, progress('push-a'))).toMatchObject({ slotId: 'push-b', sequence: 1 })
    expect(recommend(source, progress('push-b', completedAt, 2))).toMatchObject({
      slotId: 'push-a',
      sequence: 2,
    })
  })

  it('wraps a single workout with trailing and leading rest slots', () => {
    const source = split([rest('rest-a'), training('push'), rest('rest-b')])
    expect(recommend(source, progress())).toMatchObject({
      kind: 'rest',
      slotId: 'push',
      restDays: 2,
      availableOn: '2026-11-26',
    })
  })

  it('waits for complete local rest dates and releases at local midnight', () => {
    const source = split([training('push'), rest(), training('pull')])
    const state = progress('push', Date.parse('2026-11-23T15:59:59Z'))
    expect(recommend(source, state, Date.parse('2026-11-24T15:59:59Z'))).toMatchObject({
      kind: 'rest',
      availableOn: '2026-11-25',
      restDays: 1,
    })
    expect(recommend(source, state, Date.parse('2026-11-24T16:00:00Z')).kind).toBe('workout')
  })

  it.each([
    [
      'spring forward',
      '2026-03-07T23:30:00-05:00',
      '2026-03-08T23:59:59-04:00',
      '2026-03-09T00:00:00-04:00',
      '2026-03-09',
    ],
    [
      'fall back',
      '2026-10-31T23:30:00-04:00',
      '2026-11-01T23:59:59-05:00',
      '2026-11-02T00:00:00-05:00',
      '2026-11-02',
    ],
  ])('uses calendar rest dates through %s', (_label, end, before, available, date) => {
    const source = split([training('push'), rest(), training('pull')])
    const state = progress('push', Date.parse(end))
    expect(
      getRollingRecommendation(source, routines, state, Date.parse(before), 'America/New_York'),
    ).toMatchObject({
      kind: 'rest',
      availableOn: date,
    })
    expect(
      getRollingRecommendation(source, routines, state, Date.parse(available), 'America/New_York')
        .kind,
    ).toBe('workout')
  })

  it('recomputes dates from the supplied timezone without changing the next slot', () => {
    const source = split([training('push'), rest(), training('pull')])
    const state = progress('push', Date.parse('2026-11-23T23:00:00Z'))
    const now = Date.parse('2026-11-25T01:00:00Z')
    expect(getRollingRecommendation(source, routines, state, now, 'UTC')).toMatchObject({
      kind: 'workout',
      slotId: 'pull',
      availableOn: '2026-11-25',
    })
    expect(getRollingRecommendation(source, routines, state, now, 'Asia/Manila')).toMatchObject({
      kind: 'rest',
      slotId: 'pull',
      availableOn: '2026-11-26',
    })
  })

  it('restarts at sequence zero after a split revision or missing cursor slot', () => {
    expect(recommend({ ...split(), revision: 2 }, progress())).toMatchObject({
      kind: 'workout',
      slotId: 'push',
      sequence: 0,
      reason: expect.stringContaining('restarts'),
    })
    expect(recommend(split(), progress('removed-slot'))).toMatchObject({
      kind: 'workout',
      slotId: 'push',
      sequence: 0,
    })
  })

  it('never silently skips the next missing, archived, or empty routine', () => {
    const source = split([training('missing'), training('push')])
    expect(recommend(source)).toMatchObject({ kind: 'unavailable', slotId: 'missing' })
    for (const changed of [
      { ...routine(), archived: true },
      { ...routine(), exercises: [] },
      {
        ...routine(),
        exercises: routine().exercises.map((entry) => ({ ...entry, sets: [] })),
      },
    ]) {
      expect(
        getRollingRecommendation(split(), [changed, routine('pull')], {}, completedAt, 'UTC'),
      ).toMatchObject({ kind: 'unavailable', slotId: 'push' })
    }
    expect(
      recommend(split([{ ...training('empty'), routineId: null }, training('push')])).kind,
    ).toBe('unavailable')
  })

  it('explains archived splits and splits without training slots', () => {
    expect(recommend({ ...split(), archived: true }).kind).toBe('unavailable')
    expect(recommend(split([rest()]))).toMatchObject({ kind: 'unavailable', slotId: null })
    expect(recommend(split([])).kind).toBe('unavailable')
  })

  it('returns identical results for identical inputs and never mutates its inputs', () => {
    const source = split()
    const state = progress()
    const before = structuredClone({ source, state, routines })
    expect(recommend(source, state)).toEqual(recommend(source, state))
    expect({ source, state, routines }).toEqual(before)
  })
})

describe('Rolling completion inclusion and cursor advancement', () => {
  it('advances one slot atomically in a new map and preserves other splits', () => {
    const state = { other: { ...progress()['split-1'] } }
    const finished = workout()
    const next = advanceRollingProgress(finished, split(), state)
    expect(state).not.toHaveProperty('split-1')
    expect(next.other).toBe(state.other)
    expect(next['split-1']).toEqual({
      splitRevision: 1,
      sequence: 1,
      lastSlotId: 'push',
      lastSessionId: finished.id,
      completedAt,
    })
    expect(recommend(split(), next)).toMatchObject({ slotId: 'pull' })
    expect(advanceRollingProgress(finished, split(), next)).toBe(next)
  })

  it('requires an explicit inclusion decision and performed work', () => {
    const finished = workout()
    expect(canAdvanceRolling(finished, split(), {})).toBe(true)
    finished.countsForSplit = false
    expect(canAdvanceRolling(finished, split(), {})).toBe(false)
    delete finished.countsForSplit
    expect(canAdvanceRolling(finished, split(), {})).toBe(false)
    finished.countsForSplit = true
    finished.exercises[0].sets.forEach((set) => {
      set.completedAt = null
    })
    expect(canAdvanceRolling(finished, split(), {})).toBe(false)
  })

  it('ignores active, abandoned, unscheduled, mismatched, or obsolete completions', () => {
    const original = workout()
    const variants: WorkoutSession[] = [
      { ...original, status: 'active' },
      { ...original, status: 'abandoned' },
      { ...original, endedAt: null },
      { ...original, endedAt: original.startedAt - 1 },
      { ...original, completionKey: null },
      { ...original, splitContext: null },
      { ...original, splitContext: { ...original.splitContext!, sequence: undefined } },
      { ...original, splitContext: { ...original.splitContext!, splitId: 'other' } },
      { ...original, splitContext: { ...original.splitContext!, splitRevision: 2 } },
      { ...original, splitContext: { ...original.splitContext!, slotId: 'pull' } },
      { ...original, routineId: 'pull' },
      { ...original, ownerId: 'someone-else' },
    ]
    for (const session of variants) expect(canAdvanceRolling(session, split(), {})).toBe(false)
    expect(canAdvanceRolling(original, null, {})).toBe(false)
    expect(canAdvanceRolling(original, { ...split(), mode: 'fixed' }, {})).toBe(false)
    expect(canAdvanceRolling(original, { ...split(), archived: true }, {})).toBe(false)
  })

  it('rejects duplicate or stale sequence tokens even when the cycle wraps to the same slot', () => {
    const source = split([training('push')])
    const state = progress('push', completedAt, 4)
    expect(canAdvanceRolling(workout('push', 0), source, state)).toBe(false)
    expect(canAdvanceRolling(workout('push', 3), source, state)).toBe(false)
    expect(canAdvanceRolling(workout('push', 5), source, state)).toBe(false)
    expect(canAdvanceRolling(workout('push', 4), source, state)).toBe(true)
    state['split-1'].lastSessionId = 'session-1'
    expect(canAdvanceRolling(workout('push', 4), source, state)).toBe(false)
  })

  it('rejects out-of-order completion timestamps without regressing saved progress', () => {
    const state = progress('push', completedAt, 1)
    const finished = workout('pull', 1, completedAt - 1)
    expect(canAdvanceRolling(finished, split(), state)).toBe(false)
    expect(advanceRollingProgress(finished, split(), state)).toBe(state)
    expect(canAdvanceRolling(workout('pull', 1, completedAt), split(), state)).toBe(true)
  })

  it('uses the restarted sequence after split edits', () => {
    const source = { ...split(), revision: 2 }
    const finished = workout()
    expect(canAdvanceRolling(finished, source, progress())).toBe(false)
    finished.splitContext!.splitRevision = 2
    expect(canAdvanceRolling(finished, source, progress())).toBe(true)
    expect(advanceRollingProgress(finished, source, progress())['split-1'].sequence).toBe(1)
  })

  it('detects incomplete original plans after actual-set removal, including optional and warmup sets', () => {
    const finished = workout()
    expect(isPartialWorkout(finished)).toBe(false)
    expect(finished.exercises[0].sets[0].id).not.toBe(finished.exercises[0].plannedSets[0].id)
    finished.exercises[0].sets.pop()
    expect(isPartialWorkout(finished)).toBe(true)
    expect(canAdvanceRolling(finished, split(), {})).toBe(true)
    finished.exercises[0].optional = true
    finished.exercises[0].plannedSets[1].type = 'warmup'
    expect(isPartialWorkout(finished)).toBe(true)
    finished.countsForSplit = false
    expect(canAdvanceRolling(finished, split(), {})).toBe(false)
  })

  it('requires each original exercise entry to meet its own planned count', () => {
    const finished = workout()
    const extra = structuredClone(finished.exercises[0])
    extra.id = 'entry-2'
    extra.sets.forEach((set) => {
      set.completedAt = null
    })
    finished.exercises.push(extra)
    finished.exercises[0].sets.push(...structuredClone(finished.exercises[0].sets))
    expect(isPartialWorkout(finished)).toBe(true)
  })
})
