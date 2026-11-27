// Run with the local Firestore emulator using npm run test:rules.
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
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type WriteBatch,
} from 'firebase/firestore'
import { EXERCISES } from '../src/data/exercises'
import { createPlannedSet } from '../src/domain/training/helpers'
import type { TrackingType } from '../src/types/training'
import type { WorkoutExercise, WorkoutSession } from '../src/types/workout'

let environment: RulesTestEnvironment
const userDb = (uid = 'alex') => environment.authenticatedContext(uid).firestore()
type Database = ReturnType<typeof userDb>
const reference = (db: Database, id: string, uid = 'alex') =>
  doc(db, 'users', uid, 'workoutSessions', id)
const stateReference = (db: Database, uid = 'alex') =>
  doc(db, 'users', uid, 'workoutState', 'current')
const metadata = (id: string, ownerId = 'alex') => ({
  id,
  ownerId,
  schemaVersion: 1 as const,
  revision: 1,
  mutationId: `${id}-mutation-1`,
  previousMutationId: null as string | null,
  createdAt: 1000,
  updatedAt: 1000,
})
const next = <T extends ReturnType<typeof metadata>>(value: T, mutationId?: string) => ({
  ...value,
  revision: value.revision + 1,
  mutationId: mutationId ?? `${value.id}-mutation-${value.revision + 1}`,
  previousMutationId: value.mutationId,
  updatedAt: value.updatedAt + 1,
})
function exercise(index = 0, tracking: TrackingType = 'weight-reps'): WorkoutExercise {
  const source = EXERCISES.find((item) => item.trackingType === tracking)!
  const { name, trackingType, primaryMuscles, secondaryMuscles, equipment, movementPattern } =
    source
  return {
    id: `entry-${index}`,
    exerciseId: source.id,
    snapshot: { name, trackingType, primaryMuscles, secondaryMuscles, equipment, movementPattern },
    originalExerciseId: null,
    plannedSets: [{ ...createPlannedSet(tracking), id: `planned-${index}-0` }],
    sets: [
      {
        id: `logged-${index}-0`,
        type: 'working',
        weightKg: null,
        reps: null,
        durationSeconds: null,
        distanceMeters: null,
        rpe: null,
        completedAt: null,
      },
    ],
    restSeconds: 90,
    optional: false,
    supersetGroup: null,
    notes: '',
  }
}
function session(id = 'workout-one', uid = 'alex'): WorkoutSession {
  return {
    ...metadata(id, uid),
    status: 'active',
    startedAt: 1000,
    endedAt: null,
    elapsedSeconds: 0,
    timerEndAt: null,
    routineId: 'routine-one',
    routineRevision: 1,
    routineName: 'Upper A',
    notes: '',
    exercises: [exercise()],
    splitContext: { splitId: 'split-one', splitRevision: 1, slotId: 'slot-one' },
    completionKey: null,
  }
}
const state = (activeSessionId: string | null, uid = 'alex') => ({
  ...metadata('current', uid),
  activeSessionId,
})
function addPages(batch: WriteBatch, db: Database, value: WorkoutSession, uid = value.ownerId) {
  for (let start = 0; start < value.exercises.length; start += 5)
    batch.set(doc(reference(db, value.id, uid), 'validationPages', `p${start / 5}`), {
      ownerId: value.ownerId,
      sessionId: value.id,
      revision: value.revision,
      mutationId: value.mutationId,
      exercises: value.exercises.slice(start, start + 5),
    })
}
function writeSession(
  db: Database,
  value: WorkoutSession,
  current?: DocumentData,
  uid = value.ownerId,
) {
  const batch = writeBatch(db)
  batch.set(reference(db, value.id, uid), value)
  addPages(batch, db, value, uid)
  if (current) batch.set(stateReference(db, uid), current)
  return batch.commit()
}
async function approve(...uids: string[]) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const batch = writeBatch(context.firestore())
    for (const uid of uids)
      batch.set(doc(context.firestore(), 'approvedUsers', uid), { active: true })
    await batch.commit()
  })
}
function finished(value: WorkoutSession, status: 'completed' | 'abandoned'): WorkoutSession {
  const result = { ...next(value), status, endedAt: value.updatedAt + 1, timerEndAt: null }
  return {
    ...result,
    completionKey: status === 'completed' ? value.id : null,
    exercises: value.exercises.map((entry) => ({
      ...entry,
      sets: entry.sets.map((set) => ({ ...set, weightKg: 40, reps: 8, completedAt: 1000 })),
    })),
  }
}

function rollingSession(id = 'rolling-one', sequence = 0, slotId = 'slot-one'): WorkoutSession {
  return {
    ...session(id),
    countsForSplit: false,
    splitContext: { splitId: 'split-one', splitRevision: 1, slotId, sequence },
  }
}
function rollingProgress(value: WorkoutSession) {
  const context = value.splitContext!
  return {
    splitRevision: context.splitRevision,
    sequence: context.sequence! + 1,
    lastSlotId: context.slotId,
    lastSessionId: value.id,
    completedAt: value.endedAt!,
  }
}
async function seedRollingConfiguration(
  options: { revision?: number; mode?: string; active?: string } = {},
) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    const batch = writeBatch(db)
    batch.set(doc(db, 'users', 'alex', 'splits', 'split-one'), {
      ...metadata('split-one'),
      revision: options.revision ?? 1,
      archived: false,
      mode: options.mode ?? 'rolling',
      slots: [
        { id: 'opening-rest', label: 'Rest', routineId: null, isRestDay: true },
        { id: 'slot-one', label: 'Upper A', routineId: 'routine-one', isRestDay: false },
        { id: 'middle-rest', label: 'Rest', routineId: null, isRestDay: true },
        { id: 'slot-two', label: 'Upper B', routineId: 'routine-one', isRestDay: false },
        { id: 'closing-rest', label: 'Rest', routineId: null, isRestDay: true },
      ],
    })
    batch.set(doc(db, 'users', 'alex', 'trainingSettings', 'current'), {
      ...metadata('current'),
      archived: false,
      activeSplitId: options.active ?? 'split-one',
    })
    await batch.commit()
  })
}

describe('private workout rules', () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: 'demo-muscle-memory-workouts',
      firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
    })
  }, 30000)
  beforeEach(async () => {
    await environment.clearFirestore()
  })
  afterAll(async () => {
    await environment?.cleanup()
  })

  it('starts atomically, reads bounded history, and saves an active session revision', async () => {
    await approve('alex')
    const db = userDb()
    const value = session()
    await assertSucceeds(writeSession(db, value, state(value.id)))
    expect((await assertSucceeds(getDoc(stateReference(db)))).data()?.activeSessionId).toBe(
      value.id,
    )
    expect((await assertSucceeds(getDoc(reference(db, value.id)))).data()?.routineName).toBe(
      'Upper A',
    )
    const history = await assertSucceeds(
      getDocs(query(collection(db, 'users', 'alex', 'workoutSessions'), limit(200))),
    )
    expect(history.size).toBe(1)
    await assertSucceeds(
      writeSession(db, { ...next(value), notes: 'Felt good', timerEndAt: 91000 }),
    )
    expect((await getDoc(reference(db, value.id))).data()?.revision).toBe(2)
    await assertFails(getDocs(collection(db, 'users', 'alex', 'workoutSessions')))
    await assertFails(
      getDocs(query(collection(db, 'users', 'alex', 'workoutSessions'), limit(201))),
    )
    await assertFails(getDocs(collection(db, 'users', 'alex', 'workoutState')))
  })

  it('requires approval and isolates sessions, state, history, and proofs across owners', async () => {
    await approve('alex', 'other')
    const value = session()
    await writeSession(userDb(), value, state(value.id))
    for (const db of [
      environment.unauthenticatedContext().firestore(),
      userDb('waiting'),
      userDb('other'),
    ]) {
      await assertFails(getDoc(reference(db, value.id)))
      await assertFails(getDoc(stateReference(db)))
      await assertFails(
        getDocs(query(collection(db, 'users', 'alex', 'workoutSessions'), limit(200))),
      )
      await assertFails(writeSession(db, { ...next(value), notes: 'Hijacked' }))
      await assertFails(getDoc(doc(reference(db, value.id), 'validationPages', 'p0')))
    }
    await assertFails(
      getDocs(query(collectionGroup(userDb('other'), 'workoutSessions'), limit(200))),
    )
    await assertFails(
      writeSession(userDb('other'), session('foreign', 'alex'), state('foreign', 'other'), 'other'),
    )
    await assertFails(
      writeSession(userDb('waiting'), session('waiting', 'waiting'), state('waiting', 'waiting')),
    )
    const own = await assertSucceeds(
      getDocs(query(collection(userDb('other'), 'users', 'other', 'workoutSessions'), limit(200))),
    )
    expect(own.empty).toBe(true)
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'approvedUsers', 'alex'), { active: false })
    })
    await assertFails(getDoc(reference(userDb(), value.id)))
    await assertFails(writeSession(userDb(), { ...next(value), notes: 'Revoked' }))
  })

  it('requires both the active pointer and complete proof pages on initial creation', async () => {
    await approve('alex')
    const db = userDb()
    const value = session()
    await assertFails(setDoc(reference(db, value.id), value))
    await assertFails(writeSession(db, value))
    await assertFails(setDoc(stateReference(db), state(value.id)))
    await assertFails(writeSession(db, finished(value, 'completed'), state(null)))
    await assertFails(writeSession(db, finished(value, 'abandoned'), state(null)))
    await assertSucceeds(writeSession(db, value, state(value.id)))
  })

  it('completes and abandons only with atomic state clearing, then seals terminal history', async () => {
    await approve('alex')
    for (const status of ['completed', 'abandoned'] as const) {
      const db = userDb()
      const value = session(`workout-${status}`)
      const previousState = (await getDoc(stateReference(db))).data()
      const activeState = previousState
        ? { ...next(previousState as ReturnType<typeof metadata>), activeSessionId: value.id }
        : state(value.id)
      await assertSucceeds(writeSession(db, value, activeState))
      const terminal = finished(value, status)
      await assertFails(writeSession(db, terminal))
      await assertFails(setDoc(stateReference(db), { ...next(activeState), activeSessionId: null }))
      const cleared = { ...next(activeState), activeSessionId: null }
      await assertSucceeds(writeSession(db, terminal, cleared))
      expect((await getDoc(reference(db, value.id))).data()?.status).toBe(status)
      expect((await getDoc(stateReference(db))).data()?.activeSessionId).toBeNull()
      await assertFails(writeSession(db, terminal, cleared))
      await assertFails(writeSession(db, { ...next(terminal), notes: 'Rewrite history' }))
      await assertFails(
        writeSession(db, {
          ...next(terminal),
          status: 'active',
          endedAt: null,
          completionKey: null,
        }),
      )
    }
  })

  it('atomically advances Rolling tokens, skips rest slots, wraps, and rejects duplicate completion', async () => {
    await approve('alex')
    await seedRollingConfiguration()
    const db = userDb()
    let current = {
      ...state(null),
      rollingProgress: {} as Record<string, ReturnType<typeof rollingProgress>>,
    }
    for (const [sequence, slotId] of ['slot-one', 'slot-two', 'slot-one'].entries()) {
      const value = rollingSession(`rolling-${sequence}`, sequence, slotId)
      const active =
        sequence === 0
          ? { ...current, activeSessionId: value.id }
          : { ...next(current), activeSessionId: value.id }
      await assertSucceeds(writeSession(db, value, active))
      const terminal = { ...finished(value, 'completed'), countsForSplit: true }
      const advanced = {
        ...next(active),
        activeSessionId: null,
        rollingProgress: { 'split-one': rollingProgress(terminal) },
      }
      await assertFails(writeSession(db, terminal))
      await assertSucceeds(writeSession(db, terminal, advanced))
      expect((await getDoc(stateReference(db))).data()?.rollingProgress['split-one'].sequence).toBe(
        sequence + 1,
      )
      await assertFails(writeSession(db, terminal, advanced))
      current = advanced
    }
  })

  it('requires immutable matching tokens and the expected slot before counting completion', async () => {
    await approve('alex')
    await seedRollingConfiguration()
    const db = userDb()
    const value = rollingSession()
    const active = { ...state(value.id), rollingProgress: {} }
    await writeSession(db, value, active)
    const terminal = { ...finished(value, 'completed'), countsForSplit: true }
    const advanced = {
      ...next(active),
      activeSessionId: null,
      rollingProgress: { 'split-one': rollingProgress(terminal) },
    }
    for (const progress of [
      { ...rollingProgress(terminal), sequence: 2 },
      { ...rollingProgress(terminal), splitRevision: 2 },
      { ...rollingProgress(terminal), lastSessionId: 'other' },
      { ...rollingProgress(terminal), lastSlotId: 'slot-two' },
      { ...rollingProgress(terminal), completedAt: terminal.endedAt! + 1 },
      { ...rollingProgress(terminal), unexpected: true },
    ])
      await assertFails(
        writeSession(db, terminal, {
          ...advanced,
          rollingProgress: { 'split-one': progress },
        }),
      )
    await assertFails(writeSession(db, terminal, { ...next(active), activeSessionId: null }))
    await assertFails(
      writeSession(
        db,
        {
          ...terminal,
          splitContext: { ...value.splitContext!, sequence: 1 },
        },
        advanced,
      ),
    )
    await assertFails(setDoc(stateReference(db), advanced))
    await assertSucceeds(writeSession(db, terminal, advanced))
  })

  it('never advances a standalone state, start, abandoned workout, or uncounted completion', async () => {
    await approve('alex')
    await seedRollingConfiguration()
    const db = userDb()
    const value = rollingSession()
    const forged = { 'split-one': rollingProgress(finished(value, 'completed')) }
    await assertFails(setDoc(stateReference(db), { ...state(null), rollingProgress: forged }))
    await assertFails(writeSession(db, value, { ...state(value.id), rollingProgress: forged }))
    const active = { ...state(value.id), rollingProgress: {} }
    await assertSucceeds(writeSession(db, value, active))
    await assertFails(setDoc(stateReference(db), { ...next(active), rollingProgress: forged }))
    for (const status of ['completed', 'abandoned'] as const) {
      const terminal = { ...finished(value, status), countsForSplit: false }
      await assertFails(
        writeSession(db, terminal, {
          ...next(active),
          activeSessionId: null,
          rollingProgress: forged,
        }),
      )
    }
    await assertFails(
      writeSession(
        db,
        { ...finished(value, 'abandoned'), countsForSplit: true },
        {
          ...next(active),
          activeSessionId: null,
          rollingProgress: forged,
        },
      ),
    )
    await assertSucceeds(
      writeSession(
        db,
        { ...finished(value, 'abandoned'), countsForSplit: false },
        {
          ...next(active),
          activeSessionId: null,
          rollingProgress: {},
        },
      ),
    )
  })

  it('rejects missing, stale, wrong-slot, and unrelated routine tokens while preserving history', async () => {
    await approve('alex')
    await seedRollingConfiguration()
    const db = userDb()
    const candidates = [
      session('missing-token'),
      rollingSession('stale-sequence', 3),
      rollingSession('wrong-slot', 0, 'slot-two'),
      { ...rollingSession('wrong-routine'), routineId: 'unrelated-routine' },
    ]
    for (const value of candidates) {
      const existing = (await getDoc(stateReference(db))).data()
      const active = existing
        ? { ...next(existing as ReturnType<typeof metadata>), activeSessionId: value.id }
        : state(value.id)
      await assertSucceeds(writeSession(db, value, active))
      const terminal = { ...finished(value, 'completed'), countsForSplit: true }
      await assertFails(
        writeSession(db, terminal, {
          ...next(active),
          activeSessionId: null,
          rollingProgress: {
            'split-one': {
              ...rollingProgress(terminal),
              sequence: (value.splitContext?.sequence ?? 0) + 1,
            },
          },
        }),
      )
      await assertSucceeds(
        writeSession(
          db,
          { ...terminal, countsForSplit: false },
          {
            ...next(active),
            activeSessionId: null,
          },
        ),
      )
    }
  })

  it('rejects stale split revisions, non-Rolling mode, and a changed active split without losing completion', async () => {
    await approve('alex')
    const db = userDb()
    for (const [index, options] of [
      { revision: 2 },
      { mode: 'adaptive' },
      { active: 'another-split' },
    ].entries()) {
      await seedRollingConfiguration(options)
      const value = rollingSession(`changed-split-${index}`)
      const existing = (await getDoc(stateReference(db))).data()
      const active = existing
        ? { ...next(existing as ReturnType<typeof metadata>), activeSessionId: value.id }
        : state(value.id)
      await assertSucceeds(writeSession(db, value, active))
      const terminal = { ...finished(value, 'completed'), countsForSplit: true }
      await assertFails(
        writeSession(db, terminal, {
          ...next(active),
          activeSessionId: null,
          rollingProgress: { 'split-one': rollingProgress(terminal) },
        }),
      )
      await assertSucceeds(
        writeSession(
          db,
          { ...terminal, countsForSplit: false },
          {
            ...next(active),
            activeSessionId: null,
          },
        ),
      )
    }
  })

  it('preserves every other split cursor and restarts the sequence after a split edit', async () => {
    await approve('alex')
    await seedRollingConfiguration()
    const db = userDb()
    const unrelated = {
      splitRevision: 1,
      sequence: 5,
      lastSlotId: 'old-slot',
      lastSessionId: 'old-workout',
      completedAt: 999,
    }
    const stale = { ...unrelated, splitRevision: 7 }
    const value = rollingSession()
    const active = {
      ...state(value.id),
      rollingProgress: { 'split-one': stale, 'other-split': unrelated },
    }
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(stateReference(context.firestore()), active)
    })
    await assertSucceeds(writeSession(db, value))
    const terminal = { ...finished(value, 'completed'), countsForSplit: true }
    const advanced = {
      ...next(active),
      activeSessionId: null,
      rollingProgress: { ...active.rollingProgress, 'split-one': rollingProgress(terminal) },
    }
    await assertFails(
      writeSession(db, terminal, {
        ...advanced,
        rollingProgress: { 'split-one': rollingProgress(terminal) },
      }),
    )
    await assertFails(
      writeSession(db, terminal, {
        ...advanced,
        rollingProgress: {
          ...advanced.rollingProgress,
          'other-split': { ...unrelated, sequence: 6 },
        },
      }),
    )
    await assertSucceeds(writeSession(db, terminal, advanced))
    const another = session('legacy-after-progress')
    await assertFails(
      writeSession(db, another, {
        ...next(advanced),
        activeSessionId: another.id,
        rollingProgress: {},
      }),
    )
    const legacyState: DocumentData = { ...next(advanced) }
    delete legacyState.rollingProgress
    await assertFails(writeSession(db, another, { ...legacyState, activeSessionId: another.id }))
    await assertSucceeds(
      writeSession(db, another, { ...next(advanced), activeSessionId: another.id }),
    )
  })

  it('rejects a completion older than its cursor and reuse of its last session identity', async () => {
    await approve('alex')
    await seedRollingConfiguration()
    const db = userDb()
    for (const [index, prior] of [
      { lastSessionId: 'prior-workout', completedAt: 2000 },
      { lastSessionId: 'chronology-1', completedAt: 999 },
    ].entries()) {
      const value = rollingSession(`chronology-${index}`, 1)
      const active = {
        ...state(value.id),
        rollingProgress: {
          'split-one': {
            splitRevision: 1,
            sequence: 1,
            lastSlotId: 'slot-two',
            ...prior,
          },
        },
      }
      await environment.withSecurityRulesDisabled(async (context) => {
        await setDoc(stateReference(context.firestore()), active)
      })
      await assertSucceeds(writeSession(db, value))
      const terminal = { ...finished(value, 'completed'), countsForSplit: true }
      await assertFails(
        writeSession(db, terminal, {
          ...next(active),
          activeSessionId: null,
          rollingProgress: { 'split-one': rollingProgress(terminal) },
        }),
      )
      await assertSucceeds(
        writeSession(
          db,
          { ...terminal, countsForSplit: false },
          {
            ...next(active),
            activeSessionId: null,
          },
        ),
      )
    }
  })

  it('accepts the final safe token and rejects an occurrence that cannot safely increment', async () => {
    await approve('alex')
    await seedRollingConfiguration()
    const db = userDb()
    const exhausted = rollingSession('unsafe-token', Number.MAX_SAFE_INTEGER)
    await assertFails(writeSession(db, exhausted, state(exhausted.id)))
    const value = rollingSession('final-safe-token', Number.MAX_SAFE_INTEGER - 1, 'slot-two')
    const active = {
      ...state(value.id),
      rollingProgress: {
        'split-one': {
          splitRevision: 1,
          sequence: Number.MAX_SAFE_INTEGER - 1,
          lastSlotId: 'slot-one',
          lastSessionId: 'previous-safe-token',
          completedAt: 999,
        },
      },
    }
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(stateReference(context.firestore()), active)
    })
    await assertSucceeds(writeSession(db, value))
    const terminal = { ...finished(value, 'completed'), countsForSplit: true }
    const advanced = {
      ...next(active),
      activeSessionId: null,
      rollingProgress: { 'split-one': rollingProgress(terminal) },
    }
    await assertSucceeds(writeSession(db, terminal, advanced))
    expect((await getDoc(stateReference(db))).data()?.rollingProgress['split-one'].sequence).toBe(
      Number.MAX_SAFE_INTEGER,
    )
  })

  it('counts a maximum-size workout through all twelve split slots within the rules budget', async () => {
    await approve('alex')
    await seedRollingConfiguration()
    const db = userDb()
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'users', 'alex', 'splits', 'split-one'), {
        slots: Array.from({ length: 12 }, (_, index) => ({
          id: index === 11 ? 'slot-one' : `rest-${index}`,
          label: index === 11 ? 'Upper' : 'Rest',
          routineId: index === 11 ? 'routine-one' : null,
          isRestDay: index !== 11,
        })),
      })
    })
    const value = {
      ...rollingSession('maximum-counted'),
      exercises: Array.from({ length: 20 }, (_, index) => {
        const entry = exercise(index)
        return {
          ...entry,
          plannedSets: Array.from({ length: 12 }, (_, setIndex) => ({
            ...entry.plannedSets[0],
            id: `planned-${index}-${setIndex}`,
          })),
          sets: Array.from({ length: 12 }, (_, setIndex) => ({
            ...entry.sets[0],
            id: `logged-${index}-${setIndex}`,
          })),
        }
      }),
    }
    const active = { ...state(value.id), rollingProgress: {} }
    await assertSucceeds(writeSession(db, value, active))
    const terminal = { ...finished(value, 'completed'), countsForSplit: true }
    await assertSucceeds(
      writeSession(db, terminal, {
        ...next(active),
        activeSessionId: null,
        rollingProgress: { 'split-one': rollingProgress(terminal) },
      }),
    )
    expect((await getDoc(reference(db, value.id))).data()?.exercises[19].sets).toHaveLength(12)
  })

  it('rejects competing starts without replacing the winning session or pointer', async () => {
    await approve('alex')
    const db = userDb()
    const first = session('first')
    const second = session('second')
    const outcomes = await Promise.allSettled([
      writeSession(userDb(), first, state(first.id)),
      writeSession(userDb(), second, state(second.id)),
    ])
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const current = (await getDoc(stateReference(db))).data()!
    const losing = current.activeSessionId === first.id ? second : first
    await assertFails(
      writeSession(db, losing, {
        ...next(current as ReturnType<typeof metadata>),
        activeSessionId: losing.id,
      }),
    )
    expect((await getDoc(stateReference(db))).data()?.activeSessionId).toBe(current.activeSessionId)
    expect((await getDoc(reference(db, losing.id))).exists()).toBe(false)
    expect((await getDoc(reference(db, current.activeSessionId))).data()?.status).toBe('active')
  })

  it('rejects stale ancestry, duplicate revisions, and changes to routine/split snapshots', async () => {
    await approve('alex')
    const db = userDb()
    const value = session()
    await writeSession(db, value, state(value.id))
    for (const invalid of [
      { ownerId: 'other' },
      { id: 'wrong' },
      { schemaVersion: 2 },
      { createdAt: 999 },
      { revision: 1 },
      { revision: 3 },
      { previousMutationId: null },
      { previousMutationId: 'unrelated' },
      { mutationId: value.mutationId },
      { updatedAt: 1000 },
      { startedAt: 1001 },
      { routineId: 'changed' },
      { routineRevision: 2 },
      { routineName: 'New routine' },
      { splitContext: null },
      { unexpected: true },
    ])
      await assertFails(writeSession(db, { ...next(value), ...invalid } as WorkoutSession))
    await assertSucceeds(writeSession(db, { ...next(value), notes: 'First save' }))
    await assertFails(writeSession(db, { ...next(value), notes: 'Stale save' }))
    expect((await getDoc(reference(db, value.id))).data()?.notes).toBe('First save')
  })

  it('requires a fresh atomic proof bound to all session content and metadata', async () => {
    await approve('alex')
    const db = userDb()
    const value = session()
    const pageRef = doc(reference(db, value.id), 'validationPages', 'p0')
    const proof = {
      ownerId: 'alex',
      sessionId: value.id,
      revision: 1,
      mutationId: value.mutationId,
      exercises: value.exercises,
    }
    for (const invalid of [
      { mutationId: 'different' },
      { revision: 2 },
      { ownerId: 'other' },
      { sessionId: 'other' },
      { exercises: [{ ...value.exercises[0], notes: 'Different ordered content' }] },
    ]) {
      const batch = writeBatch(db)
      batch.set(reference(db, value.id), value)
      batch.set(stateReference(db), state(value.id))
      batch.set(pageRef, { ...proof, ...invalid })
      await assertFails(batch.commit())
    }
    await assertSucceeds(writeSession(db, value, state(value.id)))
    await assertFails(
      updateDoc(reference(db, value.id), { ...next(value), notes: 'No fresh page' }),
    )
    await assertFails(
      setDoc(pageRef, { ...proof, exercises: [{ ...value.exercises[0], notes: 'Standalone' }] }),
    )
    await assertFails(setDoc(doc(reference(db, value.id), 'validationPages', 'p4'), proof))
    await assertFails(getDoc(pageRef))
    await assertFails(getDocs(collection(reference(db, value.id), 'validationPages')))
    await assertFails(deleteDoc(pageRef))
  })

  it('validates session lifecycle, split context, and time bounds', async () => {
    await approve('alex')
    const db = userDb()
    const value = session()
    await writeSession(db, value, state(value.id))
    for (const invalid of [
      { status: 'unknown' },
      { endedAt: 1001 },
      { completionKey: value.id },
      { elapsedSeconds: -1 },
      { elapsedSeconds: 31536001 },
      { elapsedSeconds: 1.5 },
      { timerEndAt: 999 },
      { timerEndAt: 1000.5 },
      { routineName: '' },
      { notes: 'x'.repeat(2001) },
    ])
      await assertFails(writeSession(db, { ...next(value), ...invalid } as WorkoutSession))
    for (const invalid of [
      { endedAt: null },
      { endedAt: 999 },
      { endedAt: 1002 },
      { completionKey: null },
      { completionKey: 'other-workout' },
      { timerEndAt: 2000 },
    ])
      await assertFails(
        writeSession(db, { ...finished(value, 'completed'), ...invalid } as WorkoutSession, {
          ...next(state(value.id)),
          activeSessionId: null,
        }),
      )
    await assertFails(
      writeSession(
        db,
        { ...finished(value, 'abandoned'), completionKey: value.id },
        { ...next(state(value.id)), activeSessionId: null },
      ),
    )
    const another = session('bad-context')
    for (const splitContext of [
      { splitId: '', splitRevision: 1, slotId: 'slot' },
      { splitId: 'split', splitRevision: 0, slotId: 'slot' },
      { splitId: 'split', splitRevision: 1, slotId: '' },
      { splitId: 'split', splitRevision: 1, slotId: 'slot', unexpected: true },
    ])
      await assertFails(
        writeSession(
          db,
          { ...another, splitContext },
          { ...next(state(value.id)), activeSessionId: another.id },
        ),
      )
  })

  it('bounds and validates every exercise, including the final entry in maximum sessions', async () => {
    await approve('alex')
    const db = userDb()
    const value: WorkoutSession = {
      ...session(),
      exercises: Array.from({ length: 20 }, (_, index) => {
        const entry = exercise(index)
        return {
          ...entry,
          originalExerciseId: `original-${index}`,
          plannedSets: Array.from({ length: 12 }, (_, setIndex) => ({
            ...entry.plannedSets[0],
            id: `planned-${index}-${setIndex}`,
          })),
          sets: Array.from({ length: 12 }, (_, setIndex) => ({
            ...entry.sets[0],
            id: `logged-${index}-${setIndex}`,
          })),
          notes: 'x'.repeat(1000),
          supersetGroup: 'A',
        }
      }),
    }
    await assertSucceeds(writeSession(db, value, state(value.id)))
    expect((await getDoc(reference(db, value.id))).data()?.exercises[19].sets).toHaveLength(12)
    for (const invalid of [
      { id: '' },
      { exerciseId: 'bad/id' },
      { originalExerciseId: '' },
      { originalExerciseId: value.exercises[19].exerciseId },
      { restSeconds: -1 },
      { restSeconds: 1801 },
      { optional: 'yes' },
      { notes: 'x'.repeat(1001) },
      { supersetGroup: '' },
      { sets: [] },
      { plannedSets: [] },
      { sets: Array.from({ length: 13 }, () => value.exercises[19].sets[0]) },
      { plannedSets: Array.from({ length: 13 }, () => value.exercises[19].plannedSets[0]) },
      { snapshot: { ...value.exercises[19].snapshot, unexpected: true } },
      {
        snapshot: {
          name: value.exercises[19].snapshot.name,
          trackingType: value.exercises[19].snapshot.trackingType,
        },
      },
      { snapshot: { ...value.exercises[19].snapshot, name: '' } },
      { snapshot: { ...value.exercises[19].snapshot, trackingType: 'unknown' } },
      { unexpected: true },
    ])
      await assertFails(
        writeSession(db, {
          ...next(value),
          exercises: value.exercises.map((entry, index) =>
            index === 19 ? { ...entry, ...invalid } : entry,
          ),
        } as WorkoutSession),
      )
    await assertFails(writeSession(db, { ...next(value), exercises: [] }))
    await assertFails(
      writeSession(db, { ...next(value), exercises: [...value.exercises, exercise(21)] }),
    )
    // Reordered, missing, and stale pages cannot prove the complete ordered list.
    const batch = writeBatch(db)
    const changed = { ...next(value), notes: 'Needs all four proof pages' }
    batch.set(reference(db, value.id), changed)
    batch.set(doc(reference(db, value.id), 'validationPages', 'p0'), {
      ownerId: 'alex',
      sessionId: value.id,
      revision: changed.revision,
      mutationId: changed.mutationId,
      exercises: changed.exercises.slice(0, 5),
    })
    await assertFails(batch.commit())
    const activeRevision = {
      ...next(value),
      notes: 'x'.repeat(2000),
      elapsedSeconds: 31536000,
      timerEndAt: 91000,
    }
    await assertSucceeds(writeSession(db, activeRevision))
    const terminal = finished(activeRevision, 'completed')
    await assertSucceeds(
      writeSession(db, terminal, { ...next(state(value.id)), activeSessionId: null }),
    )
    const preserved = (await getDoc(reference(db, value.id))).data()!
    expect(preserved.status).toBe('completed')
    expect(preserved.exercises[19].sets).toHaveLength(12)
    expect(preserved.notes).toHaveLength(2000)
    const abandoned = { ...value, ...metadata('maximum-abandoned') }
    const activeState = {
      ...next(next(state(value.id))),
      activeSessionId: abandoned.id,
    }
    await assertSucceeds(writeSession(db, abandoned, activeState))
    await assertSucceeds(
      writeSession(db, finished(abandoned, 'abandoned'), {
        ...next(activeState),
        activeSessionId: null,
      }),
    )
  })

  it('accepts snapshots of all five tracking types with bounded planned and logged sets', async () => {
    await approve('alex')
    const db = userDb()
    const tracking: TrackingType[] = [
      'weight-reps',
      'reps',
      'assisted-reps',
      'duration',
      'distance-duration',
    ]
    const value = { ...session(), exercises: tracking.map((type, index) => exercise(index, type)) }
    await assertSucceeds(writeSession(db, value, state(value.id)))
    expect((await getDoc(reference(db, value.id))).data()?.exercises).toHaveLength(5)
  })

  it('restricts the current state document, its ancestry, and active pointer changes', async () => {
    await approve('alex')
    const db = userDb()
    const current = state(null)
    await assertSucceeds(setDoc(stateReference(db), current))
    for (const invalid of [
      { ownerId: 'other' },
      { id: 'other' },
      { archived: false },
      { unexpected: true },
      { schemaVersion: 2 },
      { createdAt: 999 },
      { revision: 1 },
      { revision: 3 },
      { mutationId: current.mutationId },
      { previousMutationId: null },
      { updatedAt: 1000 },
      { activeSessionId: 'missing' },
    ])
      await assertFails(setDoc(stateReference(db), { ...next(current), ...invalid }))
    await assertFails(
      setDoc(doc(db, 'users', 'alex', 'workoutState', 'other'), { ...current, id: 'other' }),
    )
    const value = session()
    const active = { ...next(current), activeSessionId: value.id }
    await assertSucceeds(writeSession(db, value, active))
    await assertFails(setDoc(stateReference(db), { ...next(active), activeSessionId: null }))
    await assertFails(setDoc(stateReference(db), { ...next(active), activeSessionId: 'missing' }))
    await assertSucceeds(setDoc(stateReference(db), { ...next(active), activeSessionId: value.id }))
  })

  it('denies session/state deletion and proof writes after terminal completion', async () => {
    await approve('alex')
    const db = userDb()
    const value = session()
    const current = state(value.id)
    await writeSession(db, value, current)
    await assertFails(deleteDoc(reference(db, value.id)))
    await assertFails(deleteDoc(stateReference(db)))
    const terminal = finished(value, 'completed')
    await assertSucceeds(writeSession(db, terminal, { ...next(current), activeSessionId: null }))
    await assertFails(
      setDoc(doc(reference(db, value.id), 'validationPages', 'p1'), {
        ownerId: 'alex',
        sessionId: value.id,
        revision: terminal.revision,
        mutationId: terminal.mutationId,
        exercises: value.exercises,
      }),
    )
  })
})
