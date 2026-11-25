// Run against the local Firestore emulator using npm run test:rules.
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
  setDoc as rawSetDoc,
  updateDoc as rawUpdateDoc,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type WriteBatch,
} from 'firebase/firestore'
import { EXERCISES } from '../src/data/exercises'
import { createPlannedSet, createRoutineExercise } from '../src/domain/training/helpers'
import { routineValidationPages } from '../src/domain/training/validationPages'
import {
  MUSCLE_GROUPS,
  type Exercise,
  type RecordMetadata,
  type Routine,
  type TrainingSplit,
} from '../src/types/training'

let environment: RulesTestEnvironment
const userDb = (uid = 'alex') => environment.authenticatedContext(uid).firestore()
type Database = ReturnType<typeof userDb>
function addRoutinePages(batch: WriteBatch, reference: DocumentReference, value: Routine) {
  for (const page of routineValidationPages(value))
    batch.set(doc(reference, 'validationPages', page.id), page.value)
}
async function setDoc(reference: DocumentReference, value: DocumentData) {
  if (reference.parent.id !== 'routines') return rawSetDoc(reference, value)
  const batch = writeBatch(reference.firestore)
  batch.set(reference, value)
  addRoutinePages(batch, reference, value as Routine)
  return batch.commit()
}
async function updateDoc(reference: DocumentReference, fields: DocumentData) {
  if (reference.parent.id !== 'routines') return rawUpdateDoc(reference, fields)
  const snapshot = await getDoc(reference)
  const value = { ...snapshot.data(), ...fields }
  const batch = writeBatch(reference.firestore)
  batch.update(reference, fields)
  addRoutinePages(batch, reference, value as Routine)
  return batch.commit()
}
const paths = ['customExercises', 'routines', 'splits'] as const
const metadata = (id: string, ownerId = 'alex'): RecordMetadata => ({
  id,
  ownerId,
  createdAt: 1000,
  updatedAt: 1000,
  archived: false,
  schemaVersion: 1,
  revision: 1,
  mutationId: `${id}-mutation-1`,
  previousMutationId: null,
})
const next = (
  value: RecordMetadata,
  mutationId = `${value.id}-mutation-${value.revision + 1}`,
) => ({
  revision: value.revision + 1,
  updatedAt: value.updatedAt + 1,
  previousMutationId: value.mutationId,
  mutationId,
})
const fixtureExercise = EXERCISES.find((exercise) => exercise.trackingType === 'weight-reps')!
function exercise(id = 'exercise-one', uid = 'alex'): Exercise {
  return {
    ...structuredClone(fixtureExercise),
    ...metadata(id, uid),
    source: 'custom',
    name: 'My press',
    aliases: ['Custom press'],
    instructions: ['Keep a stable position.'],
    alternativeIds: [],
  }
}
function routine(id = 'routine-one', uid = 'alex'): Routine {
  return {
    ...metadata(id, uid),
    name: 'Upper A',
    description: 'A focused session.',
    targetMuscles: ['Chest'],
    exercises: [createRoutineExercise(fixtureExercise)],
  }
}
function split(id = 'split-one', uid = 'alex'): TrainingSplit {
  return {
    ...metadata(id, uid),
    name: 'My rolling split',
    description: '',
    mode: 'rolling',
    slots: [
      { id: 'slot-one', label: 'Upper A', routineId: 'routine-one', isRestDay: false },
      { id: 'slot-rest', label: 'Rest', routineId: null, isRestDay: true },
    ],
  }
}
const settings = (activeSplitId: string | null = null, uid = 'alex') => ({
  ...metadata('current', uid),
  activeSplitId,
})
const reference = (db: Database, collectionName: string, id: string, uid = 'alex') =>
  doc(db, 'users', uid, collectionName, id)

async function approve(...uids: string[]) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const batch = writeBatch(context.firestore())
    for (const uid of uids)
      batch.set(doc(context.firestore(), 'approvedUsers', uid), { active: true })
    await batch.commit()
  })
}
async function seed(db = userDb()) {
  const batch = writeBatch(db)
  const planned = routine()
  batch.set(reference(db, 'customExercises', 'exercise-one'), exercise())
  batch.set(reference(db, 'routines', 'routine-one'), planned)
  addRoutinePages(batch, reference(db, 'routines', 'routine-one'), planned)
  batch.set(reference(db, 'splits', 'split-one'), split())
  await batch.commit()
}

describe('private training configuration rules', () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: 'demo-muscle-memory-training',
      firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
    })
  }, 30000)
  beforeEach(async () => {
    await environment.clearFirestore()
  })
  afterAll(async () => {
    await environment?.cleanup()
  })

  it('allows an approved owner to create, read, list, revise, archive, and restore configuration', async () => {
    await approve('alex')
    const db = userDb()
    await assertSucceeds(seed(db))
    for (const [collectionName, value] of [
      ['customExercises', exercise()],
      ['routines', routine()],
      ['splits', split()],
    ] as const) {
      const ref = reference(db, collectionName, value.id)
      await assertSucceeds(getDoc(ref))
      const listed = await assertSucceeds(getDocs(collection(db, 'users', 'alex', collectionName)))
      expect(listed.docs.map((item) => item.id)).toEqual([value.id])
      await assertSucceeds(updateDoc(ref, { ...next(value), archived: true }))
      await assertSucceeds(
        updateDoc(ref, {
          revision: 3,
          updatedAt: 1002,
          mutationId: `${value.id}-mutation-3`,
          previousMutationId: `${value.id}-mutation-2`,
          archived: false,
        }),
      )
      expect((await getDoc(ref)).data()?.archived).toBe(false)
    }
  })

  it('denies anonymous and unapproved reads, enumeration, and writes', async () => {
    await approve('alex')
    await seed()
    const anonymous = environment.unauthenticatedContext().firestore()
    for (const db of [anonymous, userDb('unapproved')]) {
      for (const [collectionName, value] of [
        ['customExercises', exercise()],
        ['routines', routine()],
        ['splits', split()],
      ] as const) {
        const targetUid = db === anonymous ? 'alex' : 'unapproved'
        await assertFails(getDoc(reference(db, collectionName, value.id, targetUid)))
        await assertFails(getDocs(collection(db, 'users', targetUid, collectionName)))
        await assertFails(
          setDoc(reference(db, collectionName, value.id, targetUid), {
            ...value,
            ownerId: targetUid,
          }),
        )
      }
      await assertFails(
        setDoc(
          reference(db, 'trainingSettings', 'current', 'unapproved'),
          settings(null, 'unapproved'),
        ),
      )
    }
  })

  it('isolates approved owners, including list and collection-group queries', async () => {
    await approve('alex', 'other')
    await seed()
    const other = userDb('other')
    for (const [collectionName, value] of [
      ['customExercises', exercise()],
      ['routines', routine()],
      ['splits', split()],
    ] as const) {
      await assertFails(getDoc(reference(other, collectionName, value.id)))
      await assertFails(getDocs(collection(other, 'users', 'alex', collectionName)))
      await assertFails(
        updateDoc(reference(other, collectionName, value.id), { ...next(value), name: 'Hijacked' }),
      )
      await assertFails(
        setDoc(reference(other, collectionName, 'foreign', 'other'), {
          ...value,
          id: 'foreign',
          ownerId: 'alex',
        }),
      )
      await assertFails(getDocs(collectionGroup(other, collectionName)))
      const own = await assertSucceeds(getDocs(collection(other, 'users', 'other', collectionName)))
      expect(own.empty).toBe(true)
    }
    await assertFails(getDoc(reference(other, 'trainingSettings', 'current')))
  })

  it('rejects ownership, path identifier, schema, creation timestamp, and extra-field changes', async () => {
    await approve('alex')
    const db = userDb()
    await seed(db)
    for (const [collectionName, value] of [
      ['customExercises', exercise()],
      ['routines', routine()],
      ['splits', split()],
    ] as const) {
      const ref = reference(db, collectionName, value.id)
      for (const invalid of [
        { ownerId: 'other' },
        { id: 'another-id' },
        { schemaVersion: 2 },
        { createdAt: 999 },
        { administrator: true },
      ]) {
        await assertFails(updateDoc(ref, { ...next(value), ...invalid }))
      }
      await assertFails(setDoc(reference(db, collectionName, 'wrong-path'), value))
    }
  })

  it('requires strictly increasing revisions, timestamps, and the previous mutation chain', async () => {
    await approve('alex')
    const db = userDb()
    const value = routine()
    const ref = reference(db, 'routines', value.id)
    await assertSucceeds(setDoc(ref, value))
    for (const invalid of [
      { revision: 1 },
      { revision: 3 },
      { previousMutationId: null },
      { previousMutationId: 'wrong-parent' },
      { mutationId: value.mutationId },
      { updatedAt: value.updatedAt },
    ]) {
      await assertFails(updateDoc(ref, { ...next(value), ...invalid }))
    }
    await assertFails(
      setDoc(reference(db, 'routines', 'invalid-create'), {
        ...routine('invalid-create'),
        revision: 2,
        previousMutationId: 'not-a-create',
      }),
    )
    await assertSucceeds(updateDoc(ref, { ...next(value), name: 'Revision two' }))
    await assertFails(updateDoc(ref, { ...next(value), name: 'Stale revision one' }))
  })

  it('accepts one concurrent edit and rejects the competing stale ancestry without overwriting it', async () => {
    await approve('alex')
    const value = routine()
    await setDoc(reference(userDb(), 'routines', value.id), value)
    const first = userDb()
    const second = userDb()
    const outcomes = await Promise.allSettled([
      updateDoc(reference(first, 'routines', value.id), {
        ...next(value, 'device-a'),
        name: 'Device A',
      }),
      updateDoc(reference(second, 'routines', value.id), {
        ...next(value, 'device-b'),
        name: 'Device B',
      }),
    ])
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const stored = (await getDoc(reference(userDb(), 'routines', value.id))).data()!
    expect(stored.revision).toBe(2)
    expect(['Device A', 'Device B']).toContain(stored.name)
    await assertSucceeds(
      updateDoc(reference(userDb(), 'routines', value.id), {
        revision: 3,
        updatedAt: 1002,
        previousMutationId: stored.mutationId,
        mutationId: 'reviewed-next',
        name: 'Reviewed changes',
      }),
    )
  })

  it('rejects unsupported exercise values and bounded-list violations', async () => {
    await approve('alex')
    const db = userDb()
    const value = exercise()
    const ref = reference(db, 'customExercises', value.id)
    await setDoc(ref, value)
    for (const invalid of [
      { source: 'builtin' },
      { name: '' },
      { description: 'x'.repeat(1001) },
      { equipment: 'Unknown' },
      { category: 'medical' },
      { difficulty: 'expert' },
      { trackingType: 'arbitrary' },
      { movementPattern: 'Unknown' },
      { primaryMuscles: [] },
      { primaryMuscles: ['Brain'] },
      { primaryMuscles: ['Chest', 'Chest'] },
      { primaryMuscles: ['Chest'], secondaryMuscles: ['Chest'] },
      { aliases: Array.from({ length: 11 }, (_, index) => `Alias ${index}`) },
      { instructions: Array.from({ length: 13 }, () => 'Cue') },
      { alternativeIds: Array.from({ length: 11 }, (_, index) => `alternative-${index}`) },
    ]) {
      await assertFails(updateDoc(ref, { ...next(value), ...invalid }))
    }
  })

  it('rejects malformed routine and split structures, including final-entry bounds', async () => {
    await approve('alex')
    const db = userDb()
    const planned = routine()
    const cycle = split()
    await seed(db)
    for (const invalid of [
      { name: '' },
      { targetMuscles: ['Brain'] },
      { exercises: [] },
      { exercises: Array.from({ length: 21 }, () => createRoutineExercise(fixtureExercise)) },
      { exercises: [{ ...planned.exercises[0], restSeconds: -1 }] },
      { exercises: [{ ...planned.exercises[0], optional: 'yes' }] },
      {
        exercises: [
          {
            ...planned.exercises[0],
            sets: Array.from({ length: 13 }, () => createPlannedSet('weight-reps')),
          },
        ],
      },
      { exercises: [{ ...planned.exercises[0], unrecognized: true }] },
    ]) {
      await assertFails(
        updateDoc(reference(db, 'routines', planned.id), { ...next(planned), ...invalid }),
      )
    }
    for (const invalid of [
      { mode: 'unknown' },
      { slots: [] },
      {
        slots: Array.from({ length: 13 }, (_, index) => ({
          id: `rest-${index}`,
          label: 'Rest',
          routineId: null,
          isRestDay: true,
        })),
      },
      { slots: [{ id: 'bad', label: 'Train', routineId: null, isRestDay: false }] },
      { slots: [{ id: 'bad', label: 'Rest', routineId: 'routine-one', isRestDay: true }] },
      { slots: [{ id: 'bad', label: '', routineId: null, isRestDay: true }] },
    ]) {
      await assertFails(
        updateDoc(reference(db, 'splits', cycle.id), { ...next(cycle), ...invalid }),
      )
    }
  })

  it('accepts a maximum 20-exercise, 12-set routine and 12-slot split within the rules expression budget', async () => {
    await approve('alex')
    const db = userDb()
    const maximumRoutine: Routine = {
      ...routine(),
      targetMuscles: [...MUSCLE_GROUPS],
      exercises: Array.from({ length: 20 }, () => ({
        ...createRoutineExercise(fixtureExercise),
        sets: Array.from({ length: 12 }, () => createPlannedSet('weight-reps')),
        notes: 'x'.repeat(1000),
        supersetGroup: 'A',
      })),
    }
    const maximumSplit: TrainingSplit = {
      ...split(),
      slots: Array.from({ length: 12 }, (_, index) => ({
        id: `slot-${index}`,
        label: `Training ${index + 1}`,
        routineId: maximumRoutine.id,
        isRestDay: false,
      })),
    }
    await assertSucceeds(setDoc(reference(db, 'routines', maximumRoutine.id), maximumRoutine))
    await assertSucceeds(setDoc(reference(db, 'splits', maximumSplit.id), maximumSplit))
    const storedRoutine = await getDoc(reference(db, 'routines', maximumRoutine.id))
    expect(storedRoutine.data()?.exercises).toHaveLength(20)
    expect(storedRoutine.data()?.exercises[19].sets).toHaveLength(12)
    for (const invalid of [
      { id: '' },
      { exerciseId: 'invalid/id' },
      { notes: 'x'.repeat(1001) },
      { supersetGroup: '' },
      { exerciseSnapshot: { ...maximumRoutine.exercises[19].exerciseSnapshot, unexpected: true } },
    ])
      await assertFails(
        updateDoc(reference(db, 'routines', maximumRoutine.id), {
          ...next(maximumRoutine),
          exercises: maximumRoutine.exercises.map((entry, index) =>
            index === 19 ? { ...entry, ...invalid } : entry,
          ),
        }),
      )
    await assertFails(
      updateDoc(reference(db, 'routines', maximumRoutine.id), {
        ...next(maximumRoutine),
        exercises: maximumRoutine.exercises.map((entry, index) =>
          index === 19
            ? { ...entry, sets: [...entry.sets, createPlannedSet('weight-reps')] }
            : entry,
        ),
      }),
    )
    await assertFails(
      updateDoc(reference(db, 'splits', maximumSplit.id), {
        ...next(maximumSplit),
        slots: maximumSplit.slots.map((slot, index) =>
          index === 11 ? { ...slot, isRestDay: true } : slot,
        ),
      }),
    )
  })

  it('requires atomically validated pages bound to the complete routine mutation', async () => {
    await approve('alex')
    const db = userDb()
    const planned = routine()
    const ref = reference(db, 'routines', planned.id)
    await assertFails(rawSetDoc(ref, planned))
    const page = routineValidationPages(planned)[0]
    const incomplete = writeBatch(db)
    incomplete.set(ref, planned)
    incomplete.set(doc(ref, 'validationPages', page.id), { ...page.value, mutationId: 'different' })
    await assertFails(incomplete.commit())
    const mismatch = writeBatch(db)
    mismatch.set(ref, planned)
    mismatch.set(doc(ref, 'validationPages', page.id), {
      ...page.value,
      exercises: [{ ...planned.exercises[0], notes: 'Different content' }],
    })
    await assertFails(mismatch.commit())
    await assertSucceeds(setDoc(ref, planned))
    await assertFails(rawUpdateDoc(ref, { ...next(planned), name: 'Unvalidated update' }))
    await assertFails(
      rawSetDoc(doc(ref, 'validationPages', 'p0'), {
        ...page.value,
        exercises: [{ ...planned.exercises[0], notes: 'Standalone replacement' }],
      }),
    )
    await assertFails(getDoc(doc(ref, 'validationPages', 'p0')))
    await assertFails(deleteDoc(doc(ref, 'validationPages', 'p0')))
    await assertFails(
      getDoc(
        doc(userDb('other'), 'users', 'alex', 'routines', planned.id, 'validationPages', 'p0'),
      ),
    )
  })

  it('allows only the current settings document and an existing, own, nonarchived active split', async () => {
    await approve('alex', 'other')
    const db = userDb()
    const current = settings()
    const ref = reference(db, 'trainingSettings', 'current')
    await assertFails(setDoc(ref, settings('missing-split')))
    await assertFails(
      setDoc(reference(db, 'trainingSettings', 'another'), { ...current, id: 'another' }),
    )
    await assertFails(setDoc(ref, { ...current, unrecognized: true }))
    await assertFails(setDoc(ref, { ...current, archived: true }))
    await setDoc(
      reference(userDb('other'), 'splits', 'foreign-split', 'other'),
      split('foreign-split', 'other'),
    )
    await assertFails(setDoc(ref, settings('foreign-split')))
    await setDoc(reference(db, 'splits', 'archived-split'), {
      ...split('archived-split'),
      archived: true,
    })
    await assertFails(setDoc(ref, settings('archived-split')))
    await assertSucceeds(setDoc(ref, current))
    await assertFails(getDocs(collection(db, 'users', 'alex', 'trainingSettings')))
    await assertFails(updateDoc(ref, { ...next(current), activeSplitId: 'missing-split' }))
    await assertSucceeds(updateDoc(ref, { ...next(current), activeSplitId: null }))
  })

  it('archives an active split only with atomic deactivation while preserving its routines', async () => {
    await approve('alex')
    const db = userDb()
    const cycle = split()
    const current = settings(cycle.id)
    await seed(db)
    await assertSucceeds(setDoc(reference(db, 'trainingSettings', 'current'), current))
    await assertFails(
      updateDoc(reference(db, 'routines', 'routine-one'), {
        ...next(routine()),
        archived: true,
      }),
    )
    await assertFails(
      updateDoc(reference(db, 'splits', cycle.id), { ...next(cycle), archived: true }),
    )
    const batch = writeBatch(db)
    batch.update(reference(db, 'splits', cycle.id), { ...next(cycle), archived: true })
    batch.update(reference(db, 'trainingSettings', 'current'), {
      ...next(current),
      activeSplitId: null,
    })
    await assertSucceeds(batch.commit())
    expect((await getDoc(reference(db, 'splits', cycle.id))).data()?.archived).toBe(true)
    const preserved = (await getDoc(reference(db, 'routines', 'routine-one'))).data()!
    expect(preserved.archived).toBe(false)
    expect(preserved.revision).toBe(1)
    expect(preserved.exercises).toHaveLength(1)
    const restore = writeBatch(db)
    restore.update(reference(db, 'splits', cycle.id), {
      revision: 3,
      updatedAt: 1002,
      mutationId: 'split-restored',
      previousMutationId: 'split-one-mutation-2',
      archived: false,
    })
    restore.update(reference(db, 'trainingSettings', 'current'), {
      revision: 3,
      updatedAt: 1002,
      mutationId: 'settings-reactivated',
      previousMutationId: 'current-mutation-2',
      activeSplitId: cycle.id,
    })
    await assertSucceeds(restore.commit())
  })

  it('denies client deletion, approval self-grants, global configuration, and revoked access', async () => {
    await approve('alex')
    const db = userDb()
    await seed(db)
    await setDoc(reference(db, 'trainingSettings', 'current'), settings())
    for (const [collectionName, id] of [
      ['customExercises', 'exercise-one'],
      ['routines', 'routine-one'],
      ['splits', 'split-one'],
      ['trainingSettings', 'current'],
    ])
      await assertFails(deleteDoc(reference(db, collectionName, id)))
    await assertFails(
      setDoc(doc(db, 'approvedUsers', 'alex'), { active: true, administrator: true }),
    )
    await assertFails(setDoc(doc(db, 'config', 'global'), { public: true }))
    await assertFails(getDoc(doc(db, 'config', 'global')))
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'approvedUsers', 'alex'), { active: false })
    })
    for (const collectionName of paths) {
      await assertFails(getDocs(collection(db, 'users', 'alex', collectionName)))
      await assertFails(
        getDoc(
          reference(
            db,
            collectionName,
            collectionName === 'customExercises'
              ? 'exercise-one'
              : collectionName === 'routines'
                ? 'routine-one'
                : 'split-one',
          ),
        ),
      )
    }
    await assertFails(
      updateDoc(reference(db, 'routines', 'routine-one'), {
        ...next(routine()),
        name: 'Access revoked',
      }),
    )
  })
})
