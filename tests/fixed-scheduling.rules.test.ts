import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore'
import { EXERCISES } from '../src/data/exercises'
import { createRoutineExercise } from '../src/domain/training/helpers'
import { createWorkoutSession, finishWorkoutSession } from '../src/domain/workout/helpers'
import { workoutValidationPages } from '../src/domain/workout/validationPages'
import {
  completeFixedOccurrence,
  createFixedSchedule,
  moveFixedOccurrence,
  skipFixedOccurrence,
  swapFixedOccurrences,
} from '../src/domain/scheduling/fixed'
import { fixedScheduleValidationPages } from '../src/domain/scheduling/fixedValidationPages'
import type { FixedSchedule } from '../src/types/fixedScheduling'
import type { Routine, TrainingSplit } from '../src/types/training'
import type { WorkoutSession } from '../src/types/workout'

let environment: RulesTestEnvironment
const now = Date.parse('2026-11-28T12:00:00Z')
const db = (uid = 'alex') => environment.authenticatedContext(uid).firestore()
type Database = ReturnType<typeof db>
const ref = (store: Database, collectionName: string, id: string, uid = 'alex') =>
  doc(store, 'users', uid, collectionName, id)
const metadata = (id: string) => ({
  id,
  ownerId: 'alex',
  createdAt: now,
  updatedAt: now,
  archived: false,
  schemaVersion: 1 as const,
  revision: 1,
  mutationId: `${id}-m1`,
  previousMutationId: null as string | null,
})
const next = <T extends { revision: number; mutationId: string; updatedAt: number }>(
  value: T,
): T => ({
  ...value,
  revision: value.revision + 1,
  previousMutationId: value.mutationId,
  mutationId: `mutation-${value.revision + 1}`,
  updatedAt: value.updatedAt + 1,
})
const routine = (count = 1): Routine => ({
  ...metadata('routine-one'),
  name: 'Upper A',
  description: '',
  targetMuscles: ['Chest'],
  exercises: Array.from({ length: count }, () =>
    createRoutineExercise(EXERCISES.find((entry) => entry.trackingType === 'weight-reps')!),
  ),
})
const split = (): TrainingSplit => ({
  ...metadata('split-one'),
  name: 'Fixed split',
  description: '',
  mode: 'fixed',
  slots: [
    { id: 'slot-one', label: 'Upper A', routineId: 'routine-one', isRestDay: false },
    { id: 'slot-rest', label: 'Rest', routineId: null, isRestDay: true },
  ],
})
const calendar = (preferredDays: number[] = []): FixedSchedule =>
  createFixedSchedule({
    split: split(),
    routines: [routine()],
    startDate: '2026-11-28',
    timeZone: 'Asia/Manila',
    preferredDays,
    generationId: 'generation-one',
    now,
  })
const state = (id: string | null) => {
  const { archived: _, ...base } = metadata('current')
  void _
  return { ...base, activeSessionId: id, rollingProgress: {} }
}
function addCalendar(batch: WriteBatch, store: Database, value: FixedSchedule, uid = 'alex') {
  const parent = ref(store, 'fixedSchedules', value.id, uid)
  batch.set(parent, value)
  for (const page of fixedScheduleValidationPages(value))
    batch.set(doc(parent, 'validationPages', page.id), page.value)
}
function writeCalendar(value: FixedSchedule, store = db(), uid = 'alex') {
  const batch = writeBatch(store)
  addCalendar(batch, store, value, uid)
  return batch.commit()
}
function addSession(batch: WriteBatch, store: Database, value: WorkoutSession) {
  const parent = ref(store, 'workoutSessions', value.id)
  batch.set(parent, value)
  for (const page of workoutValidationPages(value))
    batch.set(doc(parent, 'validationPages', page.id), page.value)
}
async function seed(
  options: {
    active?: string | null
    revision?: number
    mode?: string
    archived?: boolean
    calendar?: FixedSchedule
  } = {},
) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore(),
      batch = writeBatch(store)
    batch.set(doc(store, 'approvedUsers', 'alex'), { active: true })
    batch.set(doc(store, 'approvedUsers', 'blair'), { active: true })
    batch.set(ref(store, 'splits', 'split-one'), {
      ...split(),
      mode: options.mode ?? 'fixed',
      revision: options.revision ?? 1,
      archived: options.archived ?? false,
    })
    batch.set(ref(store, 'trainingSettings', 'current'), {
      ...metadata('current'),
      activeSplitId: options.active === undefined ? 'split-one' : options.active,
    })
    if (options.calendar) addCalendar(batch, store, options.calendar)
    await batch.commit()
  })
}
function activeSession(value: FixedSchedule, count = 1): WorkoutSession {
  const occurrence = value.occurrences.find((entry) => !entry.isRestDay)!
  return {
    ...createWorkoutSession(
      routine(count),
      'alex',
      {
        splitId: value.splitId,
        splitRevision: value.splitRevision,
        slotId: occurrence.slotId,
        sequence: occurrence.sequence,
      },
      now,
    ),
    fixedContext: {
      scheduleId: value.id,
      generationId: value.generationId,
      occurrenceId: occurrence.id,
      occurrenceVersion: occurrence.version,
    },
    countsForSplit: false,
  }
}
async function startSession(value: WorkoutSession) {
  const store = db(),
    batch = writeBatch(store)
  addSession(batch, store, value)
  batch.set(ref(store, 'workoutState', 'current'), state(value.id))
  await assertSucceeds(batch.commit())
}
function completion(value: FixedSchedule, active: WorkoutSession) {
  const performed = {
    ...active,
    exercises: active.exercises.map((entry) => ({
      ...entry,
      sets: entry.sets.map((set) => ({ ...set, weightKg: 40, reps: 8, completedAt: now })),
    })),
  }
  const finished = {
    ...next(finishWorkoutSession(performed, 'completed', now + 1)),
    countsForSplit: true,
  }
  const completed = next(completeFixedOccurrence(value, finished, split()))
  return { finished, completed, current: next(state(null)) }
}
function writeCompletion(
  value: FixedSchedule | null,
  session: WorkoutSession | null,
  current: ReturnType<typeof state> | null,
) {
  const store = db(),
    batch = writeBatch(store)
  if (value) addCalendar(batch, store, value)
  if (session) addSession(batch, store, session)
  if (current) batch.set(ref(store, 'workoutState', 'current'), current)
  return batch.commit()
}

describe('Fixed calendar security rules', () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: 'demo-muscle-memory-fixed-security',
      firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
    })
  }, 30000)
  beforeEach(async () => {
    await environment.clearFirestore()
  })
  afterAll(async () => {
    await environment?.cleanup()
  })

  it('creates and reads the full 28-occurrence calendar with bounded history', async () => {
    await seed()
    const value = calendar()
    expect(value.occurrences).toHaveLength(28)
    await assertSucceeds(writeCalendar(value))
    expect(
      (await assertSucceeds(getDoc(ref(db(), 'fixedSchedules', value.id)))).data()?.occurrences,
    ).toHaveLength(28)
    await assertSucceeds(
      getDocs(query(collection(db(), 'users', 'alex', 'fixedSchedules'), limit(200))),
    )
    await assertFails(getDocs(collection(db(), 'users', 'alex', 'fixedSchedules')))
    await assertFails(
      getDocs(query(collection(db(), 'users', 'alex', 'fixedSchedules'), limit(201))),
    )
    await assertFails(getDoc(doc(ref(db(), 'fixedSchedules', value.id), 'validationPages', 'p0')))
    await assertFails(deleteDoc(ref(db(), 'fixedSchedules', value.id)))
  })

  it('requires approval and prevents cross-owner reads and writes', async () => {
    await seed()
    const value = calendar()
    await assertSucceeds(writeCalendar(value))
    for (const store of [
      db('blair'),
      db('unapproved'),
      environment.unauthenticatedContext().firestore(),
    ]) {
      await assertFails(getDoc(ref(store, 'fixedSchedules', value.id)))
      await assertFails(writeCalendar(next(value), store))
    }
    await assertFails(writeCalendar({ ...value, ownerId: 'blair' }))
    await assertFails(writeCalendar({ ...value, id: 'another-split' }))
  })

  it.each([{ active: null }, { mode: 'rolling' }, { revision: 2 }, { archived: true }])(
    'generates only for the active current Fixed split: %j',
    async (options) => {
      await seed(options)
      await assertFails(writeCalendar(calendar()))
    },
  )

  it('requires every bounded page to match the exact parent mutation', async () => {
    await seed()
    const value = calendar(),
      store = db()
    await assertFails(setDoc(ref(store, 'fixedSchedules', value.id), value))
    const batch = writeBatch(store)
    addCalendar(batch, store, value)
    batch.set(doc(ref(store, 'fixedSchedules', value.id), 'validationPages', 'p3'), {
      ...fixedScheduleValidationPages(value)[3].value,
      mutationId: 'wrong',
    })
    await assertFails(batch.commit())
    await assertSucceeds(writeCalendar(value))
    await assertFails(
      setDoc(
        doc(ref(store, 'fixedSchedules', value.id), 'validationPages', 'p0'),
        fixedScheduleValidationPages(value)[0].value,
      ),
    )
  })

  it('rejects extra fields, invalid bounds, duplicate sequence, and arbitrary slot snapshots', async () => {
    await seed()
    const value = calendar()
    for (const invalid of [
      { ...value, unexpected: true },
      { ...value, endDate: '2026-12-26' },
      { ...value, occurrences: [...value.occurrences, value.occurrences[0]] },
      {
        ...value,
        occurrences: value.occurrences.map((entry, index) =>
          index === 27 ? { ...entry, sequence: 0 } : entry,
        ),
      },
      {
        ...value,
        occurrences: value.occurrences.map((entry, index) =>
          index === 27 ? { ...entry, label: 'forged' } : entry,
        ),
      },
      {
        ...value,
        occurrences: value.occurrences.map((entry, index) =>
          index === 27 ? { ...entry, originalDate: value.startDate } : entry,
        ),
      },
    ])
      await assertFails(writeCalendar(invalid))
  })

  it('moves only one planned occurrence to a free date and rejects collisions', async () => {
    await seed()
    const value = calendar([1, 3, 5])
    await assertSucceeds(writeCalendar(value))
    const first = value.occurrences[0],
      occupied = value.occurrences[1]
    const moved = next(moveFixedOccurrence(value, first.id, '2026-11-29'))
    await assertSucceeds(writeCalendar(moved))
    const collision = next({
      ...moved,
      action: { ...moved.action, occurrenceId: first.id },
      occurrences: moved.occurrences.map((entry) =>
        entry.id === first.id
          ? { ...entry, version: entry.version + 1, scheduledDate: occupied.scheduledDate }
          : entry,
      ),
    })
    await assertFails(writeCalendar(collision))
    await assertFails(writeCalendar({ ...next(moved), timeZone: 'UTC' }))
    await assertFails(
      writeCalendar({
        ...next(moved),
        occurrences: moved.occurrences.map((entry, index) =>
          index < 2 ? { ...entry, label: 'changed' } : entry,
        ),
      }),
    )
  })

  it('swaps two planned occurrences reciprocally and leaves every other occurrence frozen', async () => {
    await seed()
    const value = calendar()
    await assertSucceeds(writeCalendar(value))
    const swapped = next(
      swapFixedOccurrences(value, value.occurrences[0].id, value.occurrences[27].id),
    )
    await assertSucceeds(writeCalendar(swapped))
    const invalid = next(
      swapFixedOccurrences(swapped, swapped.occurrences[0].id, swapped.occurrences[1].id),
    )
    invalid.occurrences[1].scheduledDate = '2026-12-05'
    await assertFails(writeCalendar(invalid))
  })

  it('skips only planned occurrences and prevents further edits to resolved entries', async () => {
    await seed()
    const value = calendar()
    await assertSucceeds(writeCalendar(value))
    const skipped = next(skipFixedOccurrence(value, value.occurrences[27].id, now + 1))
    await assertSucceeds(writeCalendar(skipped))
    await assertFails(
      writeCalendar(
        next({
          ...skipped,
          occurrences: skipped.occurrences.map((entry) =>
            entry.sequence === 27
              ? { ...entry, resolvedAt: now + 2, version: entry.version + 1 }
              : entry,
          ),
        }),
      ),
    )
    await assertFails(
      writeCalendar({
        ...next(skipped),
        occurrences: skipped.occurrences.map((entry) =>
          entry.sequence === 27
            ? { ...entry, version: entry.version + 1, scheduledDate: '2026-11-28' }
            : entry,
        ),
        action: {
          kind: 'move',
          occurrenceId: skipped.occurrences[27].id,
          otherOccurrenceId: null,
          sessionId: null,
        },
      }),
    )
  })

  it('regenerates with a fresh generation, valid revision, and current split snapshot', async () => {
    await seed()
    const value = calendar()
    await assertSucceeds(writeCalendar(value))
    const regenerated = createFixedSchedule({
      split: split(),
      routines: [routine()],
      startDate: '2026-12-26',
      timeZone: 'UTC',
      preferredDays: [1, 3, 5],
      generationId: 'generation-two',
      now: now + 1,
      previous: value,
    })
    await assertSucceeds(writeCalendar(regenerated))
    await assertFails(
      writeCalendar({
        ...next(regenerated),
        generationId: regenerated.generationId,
        mutationId: regenerated.generationId,
      }),
    )
    await assertFails(
      writeCalendar({
        ...regenerated,
        mutationId: 'fresh-but-stale',
        generationId: 'fresh-but-stale',
        previousMutationId: value.mutationId,
      }),
    )
  })

  it('atomically completes a 28-occurrence calendar and a 20-exercise session within rule budgets', async () => {
    await seed()
    const value = calendar()
    await assertSucceeds(writeCalendar(value))
    const active = activeSession(value, 20)
    await startSession(active)
    const { finished, completed, current } = completion(value, active)
    await assertFails(writeCompletion(completed, null, null))
    await assertFails(writeCompletion(null, finished, current))
    await assertFails(writeCompletion(completed, finished, null))
    await assertSucceeds(writeCompletion(completed, finished, current))
    expect(
      (await getDoc(ref(db(), 'fixedSchedules', value.id))).data()?.occurrences[0]
        .completionSessionId,
    ).toBe(active.id)
    await assertFails(writeCompletion(completed, finished, current))
    await assertFails(
      writeCalendar(
        next({
          ...completed,
          occurrences: completed.occurrences.map((entry, index) =>
            index === 0 ? { ...entry, version: entry.version + 1, resolvedAt: now + 3 } : entry,
          ),
        }),
      ),
    )
  })

  it('requires a counted completion and rejects frozen context changes', async () => {
    await seed()
    const value = calendar()
    await assertSucceeds(writeCalendar(value))
    const active = activeSession(value)
    await startSession(active)
    const { finished, completed, current } = completion(value, active)
    await assertFails(writeCompletion(completed, { ...finished, countsForSplit: false }, current))
    await assertFails(
      writeCompletion(
        completed,
        { ...finished, fixedContext: { ...finished.fixedContext!, occurrenceVersion: 2 } },
        current,
      ),
    )
    await assertFails(
      writeCompletion(
        completed,
        { ...finished, splitContext: { ...finished.splitContext!, sequence: 2 } },
        current,
      ),
    )
    await assertSucceeds(writeCompletion(null, { ...finished, countsForSplit: false }, current))
    expect(
      (await getDoc(ref(db(), 'fixedSchedules', value.id))).data()?.occurrences[0].status,
    ).toBe('planned')
  })

  it('rejects a completion token after the occurrence was moved', async () => {
    await seed()
    const value = calendar([1, 3, 5])
    await assertSucceeds(writeCalendar(value))
    const active = activeSession(value)
    await startSession(active)
    const moved = next(moveFixedOccurrence(value, value.occurrences[0].id, '2026-11-29'))
    await assertSucceeds(writeCalendar(moved))
    const { finished, current } = completion(value, active)
    const forged = next({
      ...moved,
      action: {
        kind: 'complete' as const,
        occurrenceId: value.occurrences[0].id,
        otherOccurrenceId: null,
        sessionId: active.id,
      },
      occurrences: moved.occurrences.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              status: 'completed' as const,
              version: entry.version + 1,
              completionSessionId: active.id,
              resolvedAt: finished.endedAt,
            }
          : entry,
      ),
    })
    await assertFails(writeCompletion(forged, finished, current))
  })

  it('moves the last entry in a full calendar after a date is explicitly freed', async () => {
    await seed()
    const value = calendar()
    await assertSucceeds(writeCalendar(value))
    const skipped = next(skipFixedOccurrence(value, value.occurrences[0].id, now + 1))
    await assertSucceeds(writeCalendar(skipped))
    const moved = next(moveFixedOccurrence(skipped, skipped.occurrences[27].id, skipped.startDate))
    await assertSucceeds(writeCalendar(moved))
    const collision = next({
      ...moved,
      action: {
        kind: 'move' as const,
        occurrenceId: moved.occurrences[1].id,
        otherOccurrenceId: null,
        sessionId: null,
      },
      occurrences: moved.occurrences.map((entry, index) =>
        index === 1
          ? { ...entry, version: entry.version + 1, scheduledDate: moved.startDate }
          : entry,
      ),
    })
    // The conflicting entry is in a different proof page from the moved one.
    await assertFails(writeCalendar(collision))
    await assertFails(setDoc(ref(db(), 'fixedSchedules', value.id), collision))
  })

  it('rejects a frozen completion token after calendar regeneration', async () => {
    await seed()
    const value = calendar()
    await assertSucceeds(writeCalendar(value))
    const active = activeSession(value)
    await startSession(active)
    const regenerated = createFixedSchedule({
      split: split(),
      routines: [routine()],
      startDate: value.startDate,
      timeZone: value.timeZone,
      preferredDays: [],
      generationId: 'generation-two',
      now: now + 1,
      previous: value,
    })
    await assertSucceeds(writeCalendar(regenerated))
    const { finished, current } = completion(value, active)
    const forged = next({
      ...regenerated,
      action: {
        kind: 'complete' as const,
        occurrenceId: regenerated.occurrences[0].id,
        otherOccurrenceId: null,
        sessionId: active.id,
      },
      occurrences: regenerated.occurrences.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              version: 2,
              status: 'completed' as const,
              completionSessionId: active.id,
              resolvedAt: finished.endedAt,
            }
          : entry,
      ),
    })
    await assertFails(writeCompletion(forged, finished, current))
    await assertSucceeds(writeCompletion(null, { ...finished, countsForSplit: false }, current))
  })

  it.each([{ active: null }, { mode: 'rolling' }, { revision: 2 }])(
    'rejects counted completion when the active split changes: %j',
    async (options) => {
      await seed()
      const value = calendar()
      await assertSucceeds(writeCalendar(value))
      const active = activeSession(value)
      await startSession(active)
      const { finished, completed, current } = completion(value, active)
      await seed(options)
      await assertFails(writeCompletion(completed, finished, current))
      await assertSucceeds(writeCompletion(null, { ...finished, countsForSplit: false }, current))
    },
  )
})
