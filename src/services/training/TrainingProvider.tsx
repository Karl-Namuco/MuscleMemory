import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  writeBatch,
  type DocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { ZodError } from 'zod'
import { EXERCISES } from '../../data/exercises'
import { SPLIT_TEMPLATES } from '../../data/splitTemplates'
import { createRoutineExercise } from '../../domain/training/helpers'
import {
  customExerciseInputSchema,
  customExerciseSchema,
  routineInputSchema,
  routineSchema,
  splitInputSchema,
  trainingSettingsSchema,
  trainingSplitSchema,
} from '../../schemas/training'
import type {
  CustomExerciseInput,
  Exercise,
  RecordMetadata,
  Routine,
  RoutineInput,
  SplitInput,
  TrainingData,
  TrainingSplit,
  WriteOptions,
} from '../../types/training'
import { useAuth } from '../auth/AuthProvider'
import { registerLogoutGuard } from '../auth/logoutGuards'
import { getFirebaseServices } from '../firebase/client'
import { readTrainingRecovery, saveTrainingRecovery, type TrainingRecovery } from './recovery'

type Stored = Exercise | Routine | TrainingSplit
type CollectionName = TrainingRecovery['collection']
type Settings = RecordMetadata & { activeSplitId: string | null }
type Mutation = { collection: CollectionName; value: Stored | Settings }
type Observed = { mutationId: string; pending: boolean; cached: boolean }
type Waiter = {
  mutations: Mutation[]
  resolve: () => void
  reject: (failure: Error) => void
  timeout: ReturnType<typeof setTimeout>
}
const TrainingContext = createContext<TrainingData | null>(null)
const LIST_LIMIT = 200
const message = (failure: unknown) =>
  failure instanceof ZodError
    ? failure.issues[0]?.message || 'Invalid training data.'
    : failure instanceof Error
      ? failure.message
      : 'Training data could not be saved. Try again.'
const recordKey = (collectionName: CollectionName, id: string) => `${collectionName}/${id}`

export function TrainingProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth()
  const uid = status === 'ready' ? user?.uid : undefined
  const [customExercises, setCustomExercises] = useState<Exercise[]>([])
  const [routines, setRoutines] = useState<Routine[]>([])
  const [splits, setSplits] = useState<TrainingSplit[]>([])
  const [activeSplitId, setActiveSplitId] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(uid))
  const [error, setError] = useState<string | null>(null)
  const [hasPendingWrites, setHasPendingWrites] = useState(false)
  const [fromCache, setFromCache] = useState(true)
  const [recoveryCount, setRecoveryCount] = useState(0)
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const activeUid = useRef<string | undefined>(uid)
  const records = useRef(new Map<string, Stored>())
  const settings = useRef<Settings | null>(null)
  const observed = useRef(new Map<string, Observed>())
  const sourceStates = useRef(new Map<string, { pending: boolean; cached: boolean }>())
  const failedMutations = useRef(new Set<string>())
  const recoveries = useRef<TrainingRecovery[]>([])
  const waiters = useRef(new Set<Waiter>())
  const outstanding = useRef(new Set<string>())
  const loadingRef = useRef(true)

  useEffect(() => {
    const token = ++generation.current
    const pendingWaiters = waiters.current
    activeUid.current = uid
    records.current.clear()
    observed.current.clear()
    sourceStates.current.clear()
    failedMutations.current.clear()
    settings.current = null
    recoveries.current = uid ? readTrainingRecovery(uid) : []
    setRecoveryCount(recoveries.current.length)
    outstanding.current.clear()
    setCustomExercises([])
    setRoutines([])
    setSplits([])
    setActiveSplitId(null)
    setError(null)
    setFromCache(true)
    setHasPendingWrites(recoveries.current.length > 0)
    setLoading(Boolean(uid))
    loadingRef.current = Boolean(uid)
    if (!uid) return
    const db = getFirebaseServices().db
    const stops: Unsubscribe[] = []
    const ready = new Set<string>()
    const lists = new Map<CollectionName, Set<string>>()
    const extras = new Map<string, Unsubscribe>()
    let stopped = false
    const current = () => !stopped && generation.current === token && activeUid.current === uid
    const fail = (failure: unknown) => {
      if (current()) {
        setError(message(failure))
        loadingRef.current = false
        setLoading(false)
      }
    }
    const settle = () => {
      for (const waiter of waiters.current)
        if (
          waiter.mutations.every(
            (mutation) =>
              observed.current.get(recordKey(mutation.collection, mutation.value.id))
                ?.mutationId === mutation.value.mutationId,
          )
        ) {
          clearTimeout(waiter.timeout)
          waiters.current.delete(waiter)
          waiter.resolve()
        }
    }
    const reconcileRecovery = () => {
      const remaining = recoveries.current.filter((recovery) => {
        const state = observed.current.get(recordKey(recovery.collection, recovery.id))
        return !(
          state &&
          state.mutationId === recovery.mutationId &&
          !state.pending &&
          !state.cached
        )
      })
      if (remaining.length !== recoveries.current.length) {
        recoveries.current = remaining
        try {
          saveTrainingRecovery(uid, remaining)
        } catch (failure) {
          fail(failure)
        }
      }
      for (const recovery of remaining) {
        const key = recordKey(recovery.collection, recovery.id)
        const state = observed.current.get(key)
        const source = sourceStates.current.get(
          recovery.collection === 'trainingSettings' ? 'trainingSettings' : key,
        )
        if (
          !outstanding.current.has(key) &&
          source &&
          !source.cached &&
          !source.pending &&
          !state?.pending &&
          state?.mutationId !== recovery.mutationId
        )
          failedMutations.current.add(recovery.mutationId)
      }
      setRecoveryCount(remaining.length)
      setHasPendingWrites(
        remaining.length > 0 ||
          [...observed.current.values(), ...sourceStates.current.values()].some(
            (state) => state.pending,
          ),
      )
      setFromCache(
        [...observed.current.values(), ...sourceStates.current.values()].some(
          (state) => state.cached,
        ),
      )
      settle()
    }
    const parse = (
      collectionName: CollectionName,
      snapshot: DocumentSnapshot,
    ): Stored | Settings | null => {
      if (!snapshot.exists()) {
        observed.current.delete(recordKey(collectionName, snapshot.id))
        return null
      }
      const schema =
        collectionName === 'customExercises'
          ? customExerciseSchema
          : collectionName === 'routines'
            ? routineSchema
            : collectionName === 'splits'
              ? trainingSplitSchema
              : trainingSettingsSchema
      const value = schema.parse(snapshot.data())
      if (value.id !== snapshot.id || value.ownerId !== uid)
        throw new Error(
          'A training record has invalid ownership or an identifier. It was not loaded.',
        )
      observed.current.set(recordKey(collectionName, snapshot.id), {
        mutationId: value.mutationId,
        pending: snapshot.metadata.hasPendingWrites,
        cached: snapshot.metadata.fromCache,
      })
      return value as Stored | Settings
    }
    const publish = () => {
      if (!current()) return
      setCustomExercises(
        [...records.current.entries()]
          .filter(([key]) => key.startsWith('customExercises/'))
          .map(([, value]) => value as Exercise),
      )
      setRoutines(
        [...records.current.entries()]
          .filter(([key]) => key.startsWith('routines/'))
          .map(([, value]) => value as Routine),
      )
      setSplits(
        [...records.current.entries()]
          .filter(([key]) => key.startsWith('splits/'))
          .map(([, value]) => value as TrainingSplit),
      )
      setActiveSplitId(settings.current?.activeSplitId ?? null)
      loadingRef.current = ready.size < 4
      setLoading(loadingRef.current)
      reconcileRecovery()
    }
    // Keep the active split and its routines available even outside the bounded recent lists.
    const ensureReferences = () => {
      const splitId = settings.current?.activeSplitId
      const needed = new Set<string>()
      if (splitId && !lists.get('splits')?.has(splitId)) needed.add(recordKey('splits', splitId))
      const split = splitId
        ? (records.current.get(recordKey('splits', splitId)) as TrainingSplit | undefined)
        : undefined
      for (const slot of split?.slots ?? [])
        if (slot.routineId && !lists.get('routines')?.has(slot.routineId))
          needed.add(recordKey('routines', slot.routineId))
      for (const recovery of recoveries.current)
        if (recovery.collection !== 'trainingSettings')
          needed.add(recordKey(recovery.collection, recovery.id))
      for (const key of needed)
        if (!extras.has(key)) {
          const [collectionName, id] = key.split('/') as [CollectionName, string]
          extras.set(
            key,
            onSnapshot(
              doc(db, 'users', uid, collectionName, id),
              { includeMetadataChanges: true },
              (snapshot) => {
                if (!current()) return
                try {
                  sourceStates.current.set(key, {
                    pending: snapshot.metadata.hasPendingWrites,
                    cached: snapshot.metadata.fromCache,
                  })
                  const value = parse(collectionName, snapshot)
                  if (value) records.current.set(key, value as Stored)
                  else if (!snapshot.metadata.fromCache) {
                    records.current.delete(key)
                    setError(
                      'An active split references a missing training record. Choose another split or repair its routines.',
                    )
                  }
                  publish()
                  ensureReferences()
                } catch (failure) {
                  fail(failure)
                }
              },
              fail,
            ),
          )
        }
      for (const [key, stop] of extras)
        if (!needed.has(key)) {
          stop()
          extras.delete(key)
          sourceStates.current.delete(key)
          const [name, id] = key.split('/') as [CollectionName, string]
          if (!lists.get(name)?.has(id)) {
            records.current.delete(key)
            observed.current.delete(key)
          }
        }
    }
    for (const collectionName of ['customExercises', 'routines', 'splits'] as const) {
      stops.push(
        onSnapshot(
          query(
            collection(db, 'users', uid, collectionName),
            orderBy('updatedAt', 'desc'),
            limit(LIST_LIMIT),
          ),
          { includeMetadataChanges: true },
          (snapshot) => {
            if (!current()) return
            try {
              sourceStates.current.set(collectionName, {
                pending: snapshot.metadata.hasPendingWrites,
                cached: snapshot.metadata.fromCache,
              })
              const previous = lists.get(collectionName) ?? new Set<string>()
              const next = new Set(snapshot.docs.map((item) => item.id))
              for (const id of previous)
                if (!next.has(id) && !extras.has(recordKey(collectionName, id))) {
                  records.current.delete(recordKey(collectionName, id))
                  observed.current.delete(recordKey(collectionName, id))
                }
              for (const item of snapshot.docs) {
                const value = parse(collectionName, item)
                if (value) records.current.set(recordKey(collectionName, item.id), value as Stored)
              }
              lists.set(collectionName, next)
              ready.add(collectionName)
              if (snapshot.size >= LIST_LIMIT)
                setError(
                  `Showing the ${LIST_LIMIT} most recently changed ${collectionName === 'customExercises' ? 'custom exercises' : collectionName}. Active split routines are loaded separately.`,
                )
              publish()
              ensureReferences()
            } catch (failure) {
              fail(failure)
            }
          },
          fail,
        ),
      )
    }
    stops.push(
      onSnapshot(
        doc(db, 'users', uid, 'trainingSettings', 'current'),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!current()) return
          try {
            sourceStates.current.set('trainingSettings', {
              pending: snapshot.metadata.hasPendingWrites,
              cached: snapshot.metadata.fromCache,
            })
            settings.current = parse('trainingSettings', snapshot) as Settings | null
            ready.add('trainingSettings')
            publish()
            ensureReferences()
          } catch (failure) {
            fail(failure)
          }
        },
        fail,
      ),
    )
    if (recoveries.current.length)
      setError(
        'Training changes from this device are waiting for cloud confirmation. Keep your editor drafts until synchronization finishes; retry any rejected changes.',
      )
    const unregister = registerLogoutGuard(uid, () => {
      if (
        loadingRef.current ||
        waiters.current.size ||
        outstanding.current.size ||
        recoveries.current.length ||
        [...observed.current.values(), ...sourceStates.current.values()].some(
          (state) => state.pending,
        )
      )
        throw new Error(
          'Your training changes are still loading or waiting for cloud confirmation. Reconnect and resolve any save errors before signing out.',
        )
    })
    return () => {
      stopped = true
      unregister()
      for (const stop of stops) stop()
      for (const stop of extras.values()) stop()
      for (const waiter of pendingWaiters) {
        clearTimeout(waiter.timeout)
        waiter.reject(new Error('The account changed before the local training save finished.'))
      }
      pendingWaiters.clear()
    }
  }, [uid, retry])

  function requireUser(): string {
    if (!uid || activeUid.current !== uid || status !== 'ready' || loadingRef.current)
      throw new Error('Wait for your training data to finish loading before saving.')
    return uid
  }
  function metadata(id: string, previous?: RecordMetadata): RecordMetadata {
    const now = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1)
    return {
      id,
      ownerId: requireUser(),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      archived: previous?.archived ?? false,
      schemaVersion: 1,
      revision: (previous?.revision ?? 0) + 1,
      mutationId: crypto.randomUUID(),
      previousMutationId: previous?.mutationId ?? null,
    }
  }
  function previousRecord(
    collectionName: CollectionName,
    options?: WriteOptions,
  ): Stored | undefined {
    requireUser()
    if (!options?.id) return undefined
    const previous = records.current.get(recordKey(collectionName, options.id))
    if (!previous && options.expectedRevision !== undefined && options.expectedRevision !== 0)
      throw new Error('This record is unavailable. Reload before editing it.')
    if (previous && options.expectedRevision !== previous.revision)
      throw new Error(
        'This record changed while you were editing. Reload it and review your draft before saving.',
      )
    return previous
  }
  async function commit(mutations: Mutation[]): Promise<void> {
    const ownerId = requireUser()
    const token = generation.current
    if (
      mutations.some((mutation) =>
        outstanding.current.has(recordKey(mutation.collection, mutation.value.id)),
      )
    )
      throw new Error(
        'This item is already being saved. Wait for confirmation before saving again.',
      )
    const next = recoveries.current.filter(
      (recovery) =>
        !mutations.some(
          (mutation) =>
            recovery.collection === mutation.collection && recovery.id === mutation.value.id,
        ),
    )
    for (const mutation of mutations)
      next.push({
        collection: mutation.collection,
        id: mutation.value.id,
        mutationId: mutation.value.mutationId,
        payload: mutation.value as unknown as Record<string, unknown>,
      })
    saveTrainingRecovery(ownerId, next)
    recoveries.current = next
    setRecoveryCount(next.length)
    setError(null)
    setHasPendingWrites(true)
    const batch = writeBatch(getFirebaseServices().db)
    for (const mutation of mutations) {
      batch.set(
        doc(getFirebaseServices().db, 'users', ownerId, mutation.collection, mutation.value.id),
        mutation.value,
      )
      outstanding.current.add(recordKey(mutation.collection, mutation.value.id))
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        mutations,
        resolve,
        reject,
        timeout: setTimeout(() => {
          waiters.current.delete(waiter)
          reject(
            new Error(
              'This device could not confirm the local save. Your recovery draft is retained; keep this page open and retry.',
            ),
          )
        }, 15000),
      }
      waiters.current.add(waiter)
      void batch
        .commit()
        .then(() => {
          if (generation.current !== token || activeUid.current !== ownerId) return
          for (const mutation of mutations)
            outstanding.current.delete(recordKey(mutation.collection, mutation.value.id))
        })
        .catch((failure: unknown) => {
          clearTimeout(waiter.timeout)
          waiters.current.delete(waiter)
          reject(new Error(message(failure)))
          if (generation.current === token && activeUid.current === ownerId) {
            for (const mutation of mutations)
              outstanding.current.delete(recordKey(mutation.collection, mutation.value.id))
            for (const mutation of mutations) failedMutations.current.add(mutation.value.mutationId)
            setError(
              `Cloud save was rejected: ${message(failure)} Your training draft is retained on this device. Reopen the editor and retry after reviewing newer data.`,
            )
            setHasPendingWrites(true)
          }
        })
    })
  }
  async function saveCustomExercise(input: CustomExerciseInput, options?: WriteOptions) {
    const parsed = customExerciseInputSchema.parse(input),
      previous = previousRecord('customExercises', options)
    const id = options?.id ?? crypto.randomUUID()
    const value = customExerciseSchema.parse({
      ...parsed,
      ...metadata(id, previous),
      source: 'custom',
    })
    if (EXERCISES.some((exercise) => exercise.id === id))
      throw new Error('Built-in exercises cannot be overwritten.')
    await commit([{ collection: 'customExercises', value }])
    return id
  }
  async function saveRoutine(input: RoutineInput, options?: WriteOptions) {
    const parsed = routineInputSchema.parse(input),
      previous = previousRecord('routines', options)
    for (const entry of parsed.exercises) {
      const exercise =
        EXERCISES.find((item) => item.id === entry.exerciseId) ??
        (records.current.get(recordKey('customExercises', entry.exerciseId)) as
          Exercise | undefined)
      const existingEntry = (previous as Routine | undefined)?.exercises.find(
        (item) => item.id === entry.id && item.exerciseId === entry.exerciseId,
      )
      if (!exercise && !existingEntry)
        throw new Error(
          'One exercise is unavailable. Reopen the exercise library and choose a replacement.',
        )
      if (exercise?.archived && !existingEntry)
        throw new Error('An archived exercise cannot be added to a new routine.')
    }
    const id = options?.id ?? crypto.randomUUID(),
      value = routineSchema.parse({ ...parsed, ...metadata(id, previous) })
    await commit([{ collection: 'routines', value }])
    return id
  }
  function validateSplit(input: SplitInput) {
    for (const slot of input.slots)
      if (slot.routineId) {
        const routine = records.current.get(recordKey('routines', slot.routineId)) as
          Routine | undefined
        if (!routine || routine.archived)
          throw new Error('Every training day needs one of your available, non-archived routines.')
      }
  }
  async function saveSplit(input: SplitInput, options?: WriteOptions) {
    const parsed = splitInputSchema.parse(input),
      previous = previousRecord('splits', options)
    validateSplit(parsed)
    const id = options?.id ?? crypto.randomUUID(),
      value = trainingSplitSchema.parse({ ...parsed, ...metadata(id, previous) })
    await commit([{ collection: 'splits', value }])
    return id
  }
  async function archiveRecord(
    collectionName: 'customExercises' | 'routines' | 'splits',
    id: string,
    archived: boolean,
    expectedRevision: number,
  ) {
    const previous = previousRecord(collectionName, { id, expectedRevision })
    if (!previous) throw new Error('This training record no longer exists.')
    if (collectionName === 'routines' && archived && settings.current?.activeSplitId) {
      const split = records.current.get(recordKey('splits', settings.current.activeSplitId)) as
        TrainingSplit | undefined
      if (!split || split.slots.some((slot) => slot.routineId === id))
        throw new Error('Remove this routine from your active split before archiving it.')
    }
    const mutations: Mutation[] = [
      { collection: collectionName, value: { ...previous, ...metadata(id, previous), archived } },
    ]
    if (collectionName === 'splits' && archived && settings.current?.activeSplitId === id)
      mutations.push({
        collection: 'trainingSettings',
        value: { ...metadata('current', settings.current), activeSplitId: null },
      })
    await commit(mutations)
  }
  async function activateSplit(id: string | null) {
    requireUser()
    if (id) {
      const split = records.current.get(recordKey('splits', id)) as TrainingSplit | undefined
      if (!split || split.archived) throw new Error('Choose an available split.')
      validateSplit(split)
    }
    await commit([
      {
        collection: 'trainingSettings',
        value: { ...metadata('current', settings.current ?? undefined), activeSplitId: id },
      },
    ])
  }
  async function createSplitFromTemplate(templateId: string) {
    requireUser()
    if (recoveries.current.length || outstanding.current.size)
      throw new Error(
        'Wait for your training changes to be confirmed before creating another template. Resolve any failed saves using the recovery controls first.',
      )
    const template = SPLIT_TEMPLATES.find((item) => item.id === templateId)
    if (!template) throw new Error('This split template is unavailable.')
    const mutations: Mutation[] = []
    const slots = template.days.map((day) => {
      const routineId = crypto.randomUUID()
      const exercises = day.exerciseIds.map((exerciseId) => {
        const exercise = EXERCISES.find((item) => item.id === exerciseId)
        if (!exercise) throw new Error('Template exercise is unavailable.')
        return createRoutineExercise(exercise)
      })
      const value = routineSchema.parse({
        ...metadata(routineId),
        name: `${template.name} · ${day.label}`,
        description: `Created from ${template.name}. Adjust exercises and targets to your preferences.`,
        targetMuscles: [
          ...new Set(exercises.flatMap((exercise) => exercise.exerciseSnapshot.primaryMuscles)),
        ],
        exercises,
      })
      mutations.push({ collection: 'routines', value })
      return { id: crypto.randomUUID(), label: day.label, routineId, isRestDay: false }
    })
    const id = crypto.randomUUID()
    mutations.push({
      collection: 'splits',
      value: trainingSplitSchema.parse({
        ...metadata(id),
        name: template.name,
        description: template.description,
        mode: 'rolling',
        slots,
      }),
    })
    await commit(mutations)
    return id
  }

  function downloadRecovery() {
    const ownerId = requireUser()
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schemaVersion: 1,
            ownerId,
            exportedAt: new Date().toISOString(),
            records: recoveries.current,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `muscle-memory-recovery-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function discardRejectedChanges() {
    const ownerId = requireUser()
    if (
      outstanding.current.size ||
      waiters.current.size ||
      [...observed.current.values(), ...sourceStates.current.values()].some(
        (state) => state.pending,
      )
    )
      throw new Error(
        'These changes are still synchronizing. Wait for the pending writes to finish before clearing failed saves.',
      )
    if (recoveries.current.some((recovery) => !failedMutations.current.has(recovery.mutationId)))
      throw new Error(
        'Some changes have not been confirmed or rejected yet. Reconnect and wait before clearing failed saves.',
      )
    saveTrainingRecovery(ownerId, [])
    recoveries.current = []
    failedMutations.current.clear()
    setRecoveryCount(0)
    setHasPendingWrites(false)
    setError(null)
  }

  const value: TrainingData = {
    exercises: [...EXERCISES, ...customExercises],
    customExercises,
    routines,
    splits,
    activeSplitId,
    loading,
    error,
    hasPendingWrites,
    fromCache,
    recoveryCount,
    downloadRecovery,
    discardRejectedChanges,
    saveCustomExercise,
    saveRoutine,
    saveSplit,
    archiveCustomExercise: (id, archived, revision) =>
      archiveRecord('customExercises', id, archived, revision),
    archiveRoutine: (id, archived, revision) => archiveRecord('routines', id, archived, revision),
    archiveSplit: (id, archived, revision) => archiveRecord('splits', id, archived, revision),
    setActiveSplit: activateSplit,
    createSplitFromTemplate,
    refresh: () => setRetry((value) => value + 1),
    clearError: () => setError(null),
  }
  return <TrainingContext.Provider value={value}>{children}</TrainingContext.Provider>
}
export function useTraining(): TrainingData {
  const value = useContext(TrainingContext)
  if (!value) throw new Error('useTraining must be called inside TrainingProvider.')
  return value
}
