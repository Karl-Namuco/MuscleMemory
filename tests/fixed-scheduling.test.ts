import { describe, expect, it } from 'vitest'
import {
  addDays,
  canCompleteFixed,
  completeFixedOccurrence,
  createFixedSchedule,
  getFixedRecommendation,
  localDate,
  moveFixedOccurrence,
  skipFixedOccurrence,
  swapFixedOccurrences,
} from '../src/domain/scheduling/fixed'
import { fixedScheduleValidationPages } from '../src/domain/scheduling/fixedValidationPages'
import { fixedScheduleSchema } from '../src/schemas/fixedScheduling'
import type { FixedSchedule, FixedWorkoutContext } from '../src/types/fixedScheduling'
import type { Routine, SplitSlot, TrainingSplit } from '../src/types/training'
import type { WorkoutSession } from '../src/types/workout'

const now = Date.parse('2026-11-23T10:00:00Z')
const metadata = {
  ownerId: 'alex',
  createdAt: now - 10000,
  updatedAt: now,
  archived: false,
  schemaVersion: 1 as const,
  revision: 1,
  mutationId: 'mutation-1',
  previousMutationId: null,
}
const routine: Routine = {
  ...metadata,
  id: 'push',
  name: 'Push',
  description: '',
  targetMuscles: ['Chest'],
  exercises: [
    {
      id: 'entry',
      exerciseId: 'press',
      exerciseSnapshot: {
        name: 'Press',
        trackingType: 'weight-reps',
        primaryMuscles: ['Chest'],
        secondaryMuscles: [],
        equipment: 'Barbell',
        movementPattern: 'Horizontal push',
      },
      sets: [
        {
          id: 'plan',
          type: 'working',
          repsMin: 8,
          repsMax: 12,
          targetWeightKg: null,
          durationSeconds: null,
          distanceMeters: null,
        },
      ],
      restSeconds: 60,
      notes: '',
      optional: false,
      supersetGroup: null,
    },
  ],
}
const training: SplitSlot = { id: 'push-slot', label: 'Push', routineId: 'push', isRestDay: false }
const rest: SplitSlot = { id: 'rest-slot', label: 'Rest', routineId: null, isRestDay: true }
const split: TrainingSplit = {
  ...metadata,
  id: 'split',
  name: 'Strength',
  description: '',
  mode: 'fixed',
  slots: [training, rest],
}
const create = (overrides: Partial<Parameters<typeof createFixedSchedule>[0]> = {}) =>
  createFixedSchedule({
    split,
    routines: [routine],
    startDate: '2026-11-23',
    timeZone: 'Asia/Manila',
    preferredDays: [],
    generationId: 'generation-1',
    now,
    ...overrides,
  })
function session(
  schedule = create(),
  occurrence = schedule.occurrences[0],
): WorkoutSession & { fixedContext: FixedWorkoutContext } {
  return {
    id: 'session',
    ownerId: 'alex',
    schemaVersion: 1,
    revision: 1,
    mutationId: 'session-mut',
    previousMutationId: null,
    createdAt: now - 1000,
    updatedAt: now,
    status: 'completed',
    startedAt: now - 1000,
    endedAt: now,
    elapsedSeconds: 1,
    timerEndAt: null,
    routineId: 'push',
    routineRevision: 1,
    routineName: 'Push',
    notes: '',
    exercises: routine.exercises.map((entry) => ({
      id: entry.id,
      exerciseId: entry.exerciseId,
      snapshot: entry.exerciseSnapshot,
      originalExerciseId: null,
      plannedSets: entry.sets,
      sets: [
        {
          id: 'actual',
          type: 'working',
          weightKg: 20,
          reps: 8,
          durationSeconds: null,
          distanceMeters: null,
          rpe: null,
          completedAt: now,
        },
      ],
      restSeconds: 60,
      optional: false,
      supersetGroup: null,
      notes: '',
    })),
    splitContext: {
      splitId: split.id,
      splitRevision: split.revision,
      slotId: occurrence.slotId,
      sequence: occurrence.sequence,
    },
    fixedContext: {
      scheduleId: schedule.id,
      generationId: schedule.generationId,
      occurrenceId: occurrence.id,
      occurrenceVersion: occurrence.version,
    },
    completionKey: 'session',
    countsForSplit: true,
  }
}

describe('Fixed calendar generation and Gregorian dates', () => {
  it('creates a stable 28-day timeline, including rest days and repeated split cycles', () => {
    const calendar = create()
    expect(calendar).toEqual(create())
    expect(calendar.occurrences).toHaveLength(28)
    expect(calendar).toMatchObject({
      startDate: '2026-11-23',
      endDate: '2026-12-20',
      revision: 1,
      mutationId: 'generation-1',
      previousMutationId: null,
    })
    expect(calendar.occurrences[0]).toMatchObject({
      id: 'generation-1_0',
      slotId: 'push-slot',
      sequence: 0,
      version: 1,
      scheduledDate: '2026-11-23',
    })
    expect(calendar.occurrences[27]).toMatchObject({
      id: 'generation-1_27',
      slotId: 'rest-slot',
      sequence: 27,
      scheduledDate: '2026-12-20',
    })
    expect(fixedScheduleSchema.safeParse(calendar).success).toBe(true)
  })

  it('delays training until preferred days while assigning rest to the next date', () => {
    const calendar = create({ preferredDays: [3, 1, 5] })
    expect(calendar.preferredDays).toEqual([1, 3, 5])
    expect(
      calendar.occurrences.slice(0, 8).map((entry) => [entry.scheduledDate, entry.isRestDay]),
    ).toEqual([
      ['2026-11-23', false],
      ['2026-11-24', true],
      ['2026-11-25', false],
      ['2026-11-26', true],
      ['2026-11-27', false],
      ['2026-11-28', true],
      ['2026-11-30', false],
      ['2026-12-01', true],
    ])
    expect(create({ preferredDays: [0] }).occurrences[0].scheduledDate).toBe('2026-11-29')
  })

  it('preserves leading rest days and starts training only on a permitted weekday', () => {
    expect(
      create({ split: { ...split, slots: [rest, training] }, preferredDays: [3] })
        .occurrences.slice(0, 3)
        .map((entry) => entry.scheduledDate),
    ).toEqual(['2026-11-23', '2026-11-25', '2026-11-26'])
  })

  it('handles leap days, year boundaries, and strict dates without normalization', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-28', 2)).toBe('2028-03-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01', '0000-01-01'])
      expect(() => addDays(date, 1)).toThrow()
    expect(() => addDays('2026-11-23', 0.5)).toThrow()
  })

  it('uses explicit schedule timezones across midnight, travel, and daylight saving transitions', () => {
    expect(localDate(Date.parse('2026-11-23T16:00:00Z'), 'Asia/Manila')).toBe('2026-11-24')
    expect(localDate(Date.parse('2026-11-23T16:00:00Z'), 'America/New_York')).toBe('2026-11-23')
    expect(localDate(Date.parse('2026-03-09T03:59:59Z'), 'America/New_York')).toBe('2026-03-08')
    expect(localDate(Date.parse('2026-03-09T04:00:00Z'), 'America/New_York')).toBe('2026-03-09')
    expect(localDate(Date.parse('2026-11-02T04:59:59Z'), 'America/New_York')).toBe('2026-11-01')
    expect(localDate(Date.parse('2026-11-02T05:00:00Z'), 'America/New_York')).toBe('2026-11-02')
    expect(() => create({ timeZone: 'Invalid/Timezone' })).toThrow()
  })

  it('rejects missing, archived, empty, foreign, or invalid routines and invalid split configuration', () => {
    for (const routines of [
      [],
      [{ ...routine, archived: true }],
      [{ ...routine, ownerId: 'other' }],
      [{ ...routine, exercises: [] }],
      [{ ...routine, exercises: [{ ...routine.exercises[0], sets: [] }] }],
    ])
      expect(() => create({ routines })).toThrow(/available routine/)
    expect(() => create({ split: { ...split, archived: true } })).toThrow()
    expect(() => create({ split: { ...split, mode: 'rolling' } })).toThrow()
    expect(() => create({ split: { ...split, slots: [] } })).toThrow()
    expect(() => create({ preferredDays: [1, 1] })).toThrow()
    expect(() => create({ preferredDays: [7] })).toThrow()
    expect(() => create({ now: NaN })).toThrow()
  })

  it('regenerates a new generation with linked metadata and stable creation time', () => {
    const previous = create()
    const next = create({ previous, generationId: 'generation-2', now: now + 1000 })
    expect(next).toMatchObject({
      revision: 2,
      createdAt: previous.createdAt,
      updatedAt: now + 1000,
      previousMutationId: previous.mutationId,
      mutationId: 'generation-2',
      generationId: 'generation-2',
    })
    expect(() => create({ previous })).toThrow(/new calendar identifier/)
    expect(() =>
      create({ previous: { ...previous, ownerId: 'other' }, generationId: 'generation-2' }),
    ).toThrow(/another split or owner/)
  })

  it('splits every occurrence into four bounded validation pages using current mutation metadata', () => {
    const calendar = create()
    const pages = fixedScheduleValidationPages(calendar)
    expect(pages.map((page) => page.id)).toEqual(['p0', 'p1', 'p2', 'p3'])
    expect(pages.flatMap((page) => page.value.occurrences)).toEqual(calendar.occurrences)
    for (const page of pages)
      expect(page.value).toMatchObject({
        ownerId: 'alex',
        scheduleId: 'split',
        revision: 1,
        mutationId: 'generation-1',
        occurrences: expect.any(Array),
      })
    expect(pages.every((page) => page.value.occurrences.length <= 7)).toBe(true)
  })
})

describe('Fixed recommendations and explicit calendar changes', () => {
  it('prioritizes oldest overdue training over today and future sessions without losing missed workouts', () => {
    const calendar = create()
    expect(getFixedRecommendation(calendar, split, [routine], now + 8 * 86400000)).toMatchObject({
      kind: 'workout',
      occurrence: { id: 'generation-1_0' },
      reason: expect.stringContaining('overdue'),
    })
    const skipped = skipFixedOccurrence(calendar, calendar.occurrences[0].id, now)
    expect(getFixedRecommendation(skipped, split, [routine], now + 8 * 86400000)).toMatchObject({
      kind: 'workout',
      occurrence: { id: 'generation-1_2' },
    })
    expect(getFixedRecommendation(calendar, split, [routine], now + 365 * 86400000).kind).toBe(
      'workout',
    )
  })

  it('shows today rest or next future date only after overdue training is resolved', () => {
    const calendar = completeFixedOccurrence(create(), session(), split)
    expect(getFixedRecommendation(calendar, split, [routine], now + 86400000)).toMatchObject({
      kind: 'rest',
      occurrence: { scheduledDate: '2026-11-24' },
    })
    expect(
      getFixedRecommendation(create({ preferredDays: [0] }), split, [routine], now),
    ).toMatchObject({ kind: 'upcoming', occurrence: { scheduledDate: '2026-11-29' } })
  })

  it('explains missing setup, revised splits, archived schedules, and unavailable next routines', () => {
    expect(getFixedRecommendation(null, split, [routine], now)).toMatchObject({
      kind: 'setup',
      reason: expect.stringContaining('preferred days empty'),
    })
    expect(getFixedRecommendation(create(), null, [routine], now).kind).toBe('setup')
    expect(getFixedRecommendation(create(), { ...split, revision: 2 }, [routine], now).kind).toBe(
      'stale',
    )
    expect(
      getFixedRecommendation({ ...create(), archived: true }, split, [routine], now).kind,
    ).toBe('stale')
    expect(getFixedRecommendation(create(), split, [], now).kind).toBe('unavailable')
    expect(
      getFixedRecommendation(create(), { ...split, archived: true }, [routine], now).kind,
    ).toBe('unavailable')
  })

  it('moves to empty dates and rejects occupied, invalid, and out-of-window dates', () => {
    const calendar = create({ preferredDays: [1] })
    const id = calendar.occurrences[0].id
    const moved = moveFixedOccurrence(calendar, id, '2026-11-25')
    expect(moved.occurrences[0]).toMatchObject({
      originalDate: '2026-11-23',
      scheduledDate: '2026-11-25',
      version: 2,
    })
    expect(moved.revision).toBe(calendar.revision)
    expect(moved.action).toEqual({
      kind: 'move',
      occurrenceId: id,
      otherOccurrenceId: null,
      sessionId: null,
    })
    expect(moveFixedOccurrence(calendar, id, '2026-11-23')).toBe(calendar)
    for (const date of ['2026-11-24', '2026-12-21', '2026-11-22', '2026-02-30'])
      expect(() => moveFixedOccurrence(calendar, id, date)).toThrow()
  })

  it('swaps planned workout and rest dates, preserving identities and original dates', () => {
    const calendar = create()
    const swapped = swapFixedOccurrences(
      calendar,
      calendar.occurrences[0].id,
      calendar.occurrences[1].id,
    )
    expect(swapped.occurrences[0]).toMatchObject({
      originalDate: '2026-11-23',
      scheduledDate: '2026-11-24',
      version: 2,
      slotId: 'push-slot',
    })
    expect(swapped.occurrences[1]).toMatchObject({
      originalDate: '2026-11-24',
      scheduledDate: '2026-11-23',
      version: 2,
      slotId: 'rest-slot',
    })
    expect(fixedScheduleSchema.safeParse(swapped).success).toBe(true)
    expect(() =>
      swapFixedOccurrences(calendar, calendar.occurrences[0].id, calendar.occurrences[0].id),
    ).toThrow()
  })

  it('skips explicitly, frees the date, and keeps completed and skipped occurrences immutable', () => {
    const calendar = create()
    const id = calendar.occurrences[0].id
    const skipped = skipFixedOccurrence(calendar, id, now)
    expect(skipped.occurrences[0]).toMatchObject({ status: 'skipped', version: 2, resolvedAt: now })
    expect(
      moveFixedOccurrence(skipped, calendar.occurrences[1].id, '2026-11-23').occurrences[1]
        .scheduledDate,
    ).toBe('2026-11-23')
    const completed = completeFixedOccurrence(calendar, session(), split)
    for (const changed of [skipped, completed]) {
      expect(() => moveFixedOccurrence(changed, id, '2026-11-25')).toThrow()
      expect(() => skipFixedOccurrence(changed, id, now)).toThrow()
      expect(() => swapFixedOccurrences(changed, id, calendar.occurrences[1].id)).toThrow()
    }
    expect(calendar.occurrences[0].status).toBe('planned')
  })
})

describe('Fixed completion inclusion and replay protection', () => {
  it('resolves exactly one occurrence once, retaining all unrelated entries and metadata', () => {
    const calendar = create()
    const finished = session(calendar)
    expect(canCompleteFixed(finished, calendar, split)).toBe(true)
    const completed = completeFixedOccurrence(calendar, finished, split)
    expect(completed.occurrences[0]).toMatchObject({
      status: 'completed',
      version: 2,
      completionSessionId: finished.id,
      resolvedAt: now,
    })
    expect(completed.occurrences[1]).toBe(calendar.occurrences[1])
    expect(completed.revision).toBe(calendar.revision)
    expect(completeFixedOccurrence(completed, finished, split)).toBe(completed)
    expect(fixedScheduleSchema.safeParse(completed).success).toBe(true)
  })

  it('allows explicitly included partial workouts but rejects excluded, unfinished, and empty workouts', () => {
    const calendar = create()
    const partial = session(calendar)
    partial.exercises[0].plannedSets.push({ ...partial.exercises[0].plannedSets[0], id: 'plan-2' })
    expect(canCompleteFixed(partial, calendar, split)).toBe(true)
    for (const finished of [
      { ...partial, countsForSplit: false },
      { ...partial, countsForSplit: undefined },
      { ...partial, status: 'active' as const },
      { ...partial, status: 'abandoned' as const },
      { ...partial, completionKey: null },
      { ...partial, endedAt: null },
      { ...partial, endedAt: partial.startedAt - 1 },
    ])
      expect(canCompleteFixed(finished, calendar, split)).toBe(false)
    partial.exercises[0].sets[0].completedAt = null
    expect(canCompleteFixed(partial, calendar, split)).toBe(false)
  })

  it('rejects tokens after moving, swapping, skipping, split edits, and regeneration', () => {
    const calendar = create({ preferredDays: [1] })
    const finished = session(calendar)
    const id = calendar.occurrences[0].id
    for (const changed of [
      moveFixedOccurrence(calendar, id, '2026-11-25'),
      swapFixedOccurrences(calendar, id, calendar.occurrences[1].id),
      skipFixedOccurrence(calendar, id, now),
      create({ previous: calendar, generationId: 'generation-2' }),
    ])
      expect(canCompleteFixed(finished, changed, split)).toBe(false)
    expect(canCompleteFixed(finished, calendar, { ...split, revision: 2 })).toBe(false)
    expect(canCompleteFixed(finished, calendar, { ...split, archived: true })).toBe(false)
    expect(canCompleteFixed(finished, calendar, { ...split, mode: 'rolling' })).toBe(false)
  })

  it('rejects future or rest occurrences and mismatched owner, routine, slot, sequence, or generation', () => {
    const calendar = create()
    expect(canCompleteFixed(session(calendar, calendar.occurrences[1]), calendar, split)).toBe(
      false,
    )
    expect(canCompleteFixed(session(calendar, calendar.occurrences[2]), calendar, split)).toBe(
      false,
    )
    const finished = session(calendar)
    const variants = [
      { ...finished, ownerId: 'other' },
      { ...finished, routineId: 'other' },
      { ...finished, splitContext: null },
      { ...finished, fixedContext: undefined },
      { ...finished, splitContext: { ...finished.splitContext!, slotId: 'rest-slot' } },
      { ...finished, splitContext: { ...finished.splitContext!, sequence: 2 } },
      { ...finished, fixedContext: { ...finished.fixedContext, generationId: 'other' } },
      { ...finished, fixedContext: { ...finished.fixedContext, occurrenceVersion: 2 } },
    ]
    for (const candidate of variants)
      expect(canCompleteFixed(candidate, calendar, split)).toBe(false)
    expect(canCompleteFixed(finished, null, split)).toBe(false)
    expect(canCompleteFixed(finished, calendar, null)).toBe(false)
  })
})

describe('strict Fixed schedule validation', () => {
  it('rejects unknown fields, malformed resolutions, duplicate identities or dates, and invalid windows', () => {
    const original = create()
    const invalid: unknown[] = [
      { ...original, unknown: true },
      { ...original, id: 'other' },
      { ...original, endDate: '2026-12-21' },
      { ...original, timeZone: 'Mars/Other' },
      { ...original, previousMutationId: original.mutationId },
      { ...original, occurrences: [{ ...original.occurrences[0], status: 'completed' }] },
      { ...original, occurrences: [{ ...original.occurrences[0], resolvedAt: now }] },
      {
        ...original,
        occurrences: original.occurrences.map((entry, index) =>
          index === 1 ? { ...entry, scheduledDate: original.occurrences[0].scheduledDate } : entry,
        ),
      },
      {
        ...original,
        action: {
          kind: 'swap',
          occurrenceId: original.occurrences[0].id,
          otherOccurrenceId: original.occurrences[0].id,
          sessionId: null,
        },
      },
    ]
    for (const candidate of invalid)
      expect(fixedScheduleSchema.safeParse(candidate).success).toBe(false)
  })

  it('rejects duplicate completion session IDs even across different occurrences', () => {
    const calendar: FixedSchedule = create()
    for (const index of [0, 2])
      calendar.occurrences[index] = {
        ...calendar.occurrences[index],
        status: 'completed',
        resolvedAt: now,
        completionSessionId: 'duplicate',
      }
    expect(fixedScheduleSchema.safeParse(calendar).success).toBe(false)
  })
})
