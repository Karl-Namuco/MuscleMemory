import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore'
import { ZodError } from 'zod'
import {
  createWorkoutSession,
  finishWorkoutSession,
  workoutElapsedSeconds,
} from '../../domain/workout/helpers'
import { workoutValidationPages } from '../../domain/workout/validationPages'
import { workoutSessionSchema } from '../../schemas/workout'
import {
  canCompleteFixed,
  completeFixedOccurrence,
  getFixedRecommendation,
  localDate,
} from '../../domain/scheduling/fixed'
import { fixedScheduleValidationPages } from '../../domain/scheduling/fixedValidationPages'
import { fixedScheduleSchema } from '../../schemas/fixedScheduling'
import type { FixedSchedule } from '../../types/fixedScheduling'
import {
  advanceRollingProgress,
  canAdvanceRolling,
  getRollingRecommendation,
  isPartialWorkout,
} from '../../domain/scheduling/rolling'
import type { RollingProgress } from '../../types/scheduling'
import type { Routine } from '../../types/training'
import type { WorkoutSession } from '../../types/workout'
import { useAuth } from '../auth/AuthProvider'
import { registerLogoutGuard } from '../auth/logoutGuards'
import { getFirebaseServices } from '../firebase/client'
import { useTraining } from '../training/TrainingProvider'
import {
  clearMalformedWorkoutCheckpoints,
  deleteWorkoutCheckpoint,
  readWorkoutRecoveryRaw,
  saveWorkoutCheckpoint,
  workoutCheckpointSchema,
  workoutStateSchema,
  type WorkoutAttempt,
  type WorkoutCheckpoint,
  type WorkoutState,
} from './storage'

export interface WorkoutData {
  rollingProgress: RollingProgress
  sessions: WorkoutSession[]
  activeSession: WorkoutSession | null
  loading: boolean
  error: string | null
  hasPendingWrites: boolean
  fromCache: boolean
  recoveryCount: number
  localSaving: boolean
  writable: boolean
  rejectedSessions: WorkoutSession[]
  unreadableCount: number
  startWorkout: (
    routine: Routine,
    options?: { scheduled?: boolean; allowEarly?: boolean; fixedOccurrenceId?: string },
  ) => Promise<string>
  saveWorkout: (session: WorkoutSession) => Promise<void>
  finishWorkout: (
    session: WorkoutSession,
    status: 'completed' | 'abandoned',
    options?: { countForSplit?: boolean },
  ) => Promise<void>
  retrySync: () => void
  downloadRecovery: () => void
  discardLocalChanges: (sessionId: string) => Promise<void>
  clearUnreadableRecovery: () => Promise<void>
}
const WorkoutContext = createContext<WorkoutData | null>(null)
type Source = { pending: boolean; cached: boolean }
const failureMessage = (failure: unknown) =>
  failure instanceof ZodError
    ? failure.issues[0]?.message || 'Check your workout values.'
    : failure instanceof Error
      ? failure.message
      : 'The workout could not be saved. Your last checkpoint is preserved.'

/** IndexedDB is the durable editor checkpoint; Firestore owns the cloud write queue. */
export function WorkoutProvider({ children }: { children: ReactNode }) {
  const { user, status, account } = useAuth()
  const training = useTraining()
  const trainingLatest = useRef(training)
  trainingLatest.current = training
  const confirmedCalendars = useRef(new Map<string, FixedSchedule>())
  function currentCalendar(id: string): FixedSchedule | null {
    const observed = trainingLatest.current.fixedSchedules?.find((item) => item.id === id)
    const confirmed = confirmedCalendars.current.get(id)
    return confirmed && (!observed || confirmed.revision > observed.revision)
      ? confirmed
      : (observed ?? null)
  }
  const uid = status === 'ready' ? user?.uid : undefined
  const [sessions, setSessions] = useState<WorkoutSession[]>([])
  const [rollingProgress, setRollingProgress] = useState<RollingProgress>({})
  const [activeSession, setActiveSession] = useState<WorkoutSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasPendingWrites, setHasPendingWrites] = useState(false)
  const [fromCache, setFromCache] = useState(true)
  const [recoveryCount, setRecoveryCount] = useState(0)
  const [localSaving, setLocalSaving] = useState(false)
  const [writable, setWritable] = useState(false)
  const [rejectedSessions, setRejectedSessions] = useState<WorkoutSession[]>([])
  const [unreadableCount, setUnreadableCount] = useState(0)
  const [retry, setRetry] = useState(0)
  const owner = useRef<string | undefined>(undefined)
  const generation = useRef(0)
  const checkpoints = useRef(new Map<string, WorkoutCheckpoint>())
  const cloud = useRef(new Map<string, WorkoutSession>())
  const state = useRef<WorkoutState | null>(null)
  const sources = useRef(new Map<string, Source>())
  const ready = useRef(new Set<string>())
  const quarantined = useRef<unknown[]>([])
  const listenerError = useRef<string | null>(null)
  const writerError = useRef<string | null>(null)
  const writer = useRef(false)
  const storageError = useRef<string | null>(null)
  const hydrated = useRef(false)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const localWrites = useRef(0)
  const inFlight = useRef(new Map<string, string>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const watchReferences = useRef<() => void>(() => undefined)
  const syncRef = useRef<(id: string) => void>(() => undefined)

  function publish() {
    if (!owner.current) return
    const merged = new Map(
      [...cloud.current].filter(([, session]) => session.ownerId === owner.current),
    )
    for (const checkpoint of checkpoints.current.values())
      if (checkpoint.uid === owner.current && checkpoint.session.ownerId === owner.current)
        merged.set(checkpoint.session.id, checkpoint.session)
    const values = [...merged.values()].sort(
      (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
    )
    setSessions(values)
    let progress = state.current?.rollingProgress ?? {}
    for (const checkpoint of checkpoints.current.values()) {
      const split =
        trainingLatest.current.splits.find(
          (item) => item.id === checkpoint.session.splitContext?.splitId,
        ) ?? null
      progress = advanceRollingProgress(checkpoint.session, split, progress)
    }
    setRollingProgress(progress)
    const localActive = [...checkpoints.current.values()].find(
      (item) => item.session.status === 'active',
    )?.session
    const current = state.current?.activeSessionId
      ? merged.get(state.current.activeSessionId)
      : undefined
    setActiveSession(localActive ?? (current?.status === 'active' ? current : undefined) ?? null)
    setLoading(!hydrated.current || ready.current.size < 2)
    setLocalSaving(localWrites.current > 0)
    setWritable(writer.current)
    setHasPendingWrites(
      localWrites.current > 0 ||
        [...checkpoints.current.values()].some((item) => item.dirty || item.attempt !== null) ||
        [...sources.current.values()].some((item) => item.pending),
    )
    setFromCache([...sources.current.values()].some((item) => item.cached))
    setRecoveryCount(
      quarantined.current.length +
        [...checkpoints.current.values()].filter((item) => item.dirty || item.error || item.attempt)
          .length,
    )
    setRejectedSessions(
      [...checkpoints.current.values()]
        .filter((item) => item.error || item.conflict)
        .map((item) => item.session),
    )
    setUnreadableCount(quarantined.current.length)
    setError(
      storageError.current ||
        writerError.current ||
        listenerError.current ||
        [...checkpoints.current.values()].find((item) => item.error)?.error ||
        null,
    )
    watchReferences.current()
  }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const token = generation.current
    localWrites.current += 1
    setLocalSaving(true)
    const result = queue.current
      .catch(() => undefined)
      .then(async () => {
        if (generation.current !== token)
          throw new Error('The account changed before this checkpoint was saved.')
        return operation()
      })
    queue.current = result.catch(() => undefined)
    return result.finally(() => {
      if (generation.current === token) {
        localWrites.current = Math.max(0, localWrites.current - 1)
        publish()
      }
    })
  }
  function requireOwner(readOnly = false) {
    if (!uid || owner.current !== uid || !hydrated.current || (!readOnly && ready.current.size < 2))
      throw new Error('Wait for your workouts to finish loading before making changes.')
    if (!readOnly && !writer.current)
      throw new Error(
        writerError.current ||
          'Workout editing is open in another tab. Close that tab and retry here.',
      )
    return uid
  }
  function schedule(id: string, immediate = false) {
    const previous = timers.current.get(id)
    if (previous) clearTimeout(previous)
    timers.current.set(
      id,
      setTimeout(
        () => {
          timers.current.delete(id)
          syncRef.current(id)
        },
        immediate ? 0 : 1500,
      ),
    )
  }
  async function persist(checkpoint: WorkoutCheckpoint) {
    const token = generation.current
    const account = owner.current
    try {
      await saveWorkoutCheckpoint(checkpoint)
      if (generation.current !== token || owner.current !== account || checkpoint.uid !== account)
        throw new Error(
          'The account changed; the workout remains safely scoped to its original account.',
        )
      checkpoints.current.set(checkpoint.session.id, checkpoint)
      storageError.current = null
    } catch (failure) {
      if (generation.current === token)
        storageError.current =
          'This device could not write a workout checkpoint. Keep the editor open and retry before leaving.'
      throw failure
    }
  }
  async function acknowledge(id: string, attempt: WorkoutAttempt) {
    const token = generation.current
    const row = checkpoints.current.get(id)
    if (
      !row ||
      row.uid !== owner.current ||
      row.attempt?.session.mutationId !== attempt.session.mutationId
    )
      return
    inFlight.current.delete(id)
    const dirty = row.version !== attempt.version || row.session.status !== attempt.session.status
    const newest = cloud.current.get(id)
    // Snapshots can advance while acknowledgment waits for IndexedDB. Confirm
    // this attempt without rewinding the cloud copy used for conflict recovery.
    if (
      !newest ||
      newest.revision < attempt.session.revision ||
      (newest.revision === attempt.session.revision &&
        newest.mutationId === attempt.session.mutationId)
    ) {
      cloud.current.set(id, attempt.session)
      sources.current.set(id, { pending: false, cached: false })
    }
    if (attempt.state && (!state.current || state.current.revision <= attempt.state.revision))
      state.current = attempt.state
    if (attempt.fixedSchedule) {
      const prior = confirmedCalendars.current.get(attempt.fixedSchedule.id)
      if (!prior || prior.revision < attempt.fixedSchedule.revision)
        confirmedCalendars.current.set(attempt.fixedSchedule.id, attempt.fixedSchedule)
    }
    if (!dirty && attempt.session.status !== 'active') {
      await deleteWorkoutCheckpoint(row.uid, id)
      if (generation.current !== token || owner.current !== row.uid) return
      checkpoints.current.delete(id)
    } else {
      await persist({
        ...row,
        dirty,
        attempt: null,
        error: null,
        conflict: false,
        baseRevision: attempt.session.revision,
        baseMutationId: attempt.session.mutationId,
        stateBase: attempt.state ?? row.stateBase,
        session: {
          ...row.session,
          revision: attempt.session.revision,
          mutationId: attempt.session.mutationId,
          previousMutationId: attempt.session.previousMutationId,
          updatedAt: Math.max(row.session.updatedAt, attempt.session.updatedAt),
        },
      })
      if (dirty) schedule(id, true)
    }
  }
  function observeConfirmed(id: string, session: WorkoutSession | null, source: Source) {
    if (!writer.current || source.cached || source.pending || !checkpoints.current.has(id)) return
    const token = generation.current
    void enqueue(async () => {
      const row = checkpoints.current.get(id)
      if (!row) return
      if (row.attempt && session?.mutationId === row.attempt.session.mutationId) {
        await acknowledge(id, row.attempt)
        return
      }
      const changed = session
        ? session.revision !== row.baseRevision || session.mutationId !== row.baseMutationId
        : row.baseRevision > 0
      if (changed && !inFlight.current.has(id)) {
        await persist({
          ...row,
          conflict: true,
          error:
            'This workout changed in another tab or device. Your device copy is preserved. Download it before choosing the cloud version.',
        })
      } else if (row.attempt && !inFlight.current.has(id)) {
        await persist({
          ...row,
          error:
            'A previous workout save was not confirmed. Your checkpoint is preserved. Retry synchronization to review the save.',
        })
      }
    }).catch((failure) => {
      if (generation.current === token) {
        storageError.current = failureMessage(failure)
        publish()
      }
    })
  }

  useEffect(() => {
    const token = ++generation.current
    const scheduledTimers = timers.current
    owner.current = uid
    checkpoints.current.clear()
    cloud.current.clear()
    sources.current.clear()
    ready.current.clear()
    inFlight.current.clear()
    state.current = null
    hydrated.current = false
    writer.current = false
    localWrites.current = 0
    queue.current = Promise.resolve()
    writerError.current = null
    listenerError.current = null
    storageError.current = null
    quarantined.current = []
    setSessions([])
    confirmedCalendars.current.clear()
    setRollingProgress({})
    setActiveSession(null)
    setLoading(Boolean(uid))
    setError(null)
    setHasPendingWrites(false)
    setFromCache(true)
    setLocalSaving(false)
    setWritable(false)
    setRejectedSessions([])
    setUnreadableCount(0)
    const stops: Unsubscribe[] = []
    const extras = new Map<string, Unsubscribe>()
    let listed = new Set<string>()
    let stopped = false
    let releaseWriter: () => void = () => undefined
    const current = () => !stopped && generation.current === token && owner.current === uid
    const failed = (name: string, failure: unknown) => {
      if (!current()) return
      ready.current.add(name)
      listenerError.current = `Workouts could not be loaded: ${failureMessage(failure)}`
      publish()
    }
    if (!uid) return
    const db = getFirebaseServices().db
    function ensureReferences() {
      if (!current()) return
      const needed = new Set(checkpoints.current.keys())
      if (state.current?.activeSessionId) needed.add(state.current.activeSessionId)
      for (const id of needed)
        if (!extras.has(id)) {
          extras.set(
            id,
            onSnapshot(
              doc(db, 'users', uid!, 'workoutSessions', id),
              { includeMetadataChanges: true },
              (snapshot) => {
                if (!current()) return
                try {
                  const meta = {
                    pending: snapshot.metadata.hasPendingWrites,
                    cached: snapshot.metadata.fromCache,
                  }
                  sources.current.set(id, meta)
                  const value = snapshot.exists()
                    ? (workoutSessionSchema.parse(snapshot.data()) as WorkoutSession)
                    : null
                  if (value && (value.ownerId !== uid || value.id !== id))
                    throw new Error('A workout has invalid ownership or an identifier.')
                  if (value) cloud.current.set(id, value)
                  else if (!meta.cached) cloud.current.delete(id)
                  observeConfirmed(id, value, meta)
                  publish()
                } catch (failure) {
                  failed('sessions', failure)
                }
              },
              (failure) => failed('sessions', failure),
            ),
          )
        }
      for (const [id, stop] of extras)
        if (!needed.has(id)) {
          stop()
          extras.delete(id)
          sources.current.delete(id)
          if (!listed.has(id)) cloud.current.delete(id)
        }
    }
    watchReferences.current = ensureReferences
    const unregister = registerLogoutGuard(uid, () => {
      if (!writer.current)
        throw new Error('Another tab is editing workouts. Close that tab before signing out here.')
      if (
        !hydrated.current ||
        localWrites.current ||
        inFlight.current.size ||
        quarantined.current.length ||
        [...checkpoints.current.values()].some(
          (item) => item.dirty || item.attempt || item.error || item.conflict,
        )
      )
        throw new Error(
          'Your workout has changes waiting for cloud confirmation. Reconnect or resolve its recovery copy before signing out.',
        )
    })
    const warn = (event: BeforeUnloadEvent) => {
      if (localWrites.current > 0) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    const releaseOnPageHide = () => {
      stopped = true
      generation.current += 1
      owner.current = undefined
      writer.current = false
      void queue.current.catch(() => undefined).then(releaseWriter)
      for (const stop of stops) stop()
      for (const stop of extras.values()) stop()
      for (const timer of scheduledTimers.values()) clearTimeout(timer)
      scheduledTimers.clear()
    }
    const restoreOnPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRetry((value) => value + 1)
    }
    window.addEventListener('pagehide', releaseOnPageHide)
    window.addEventListener('pageshow', restoreOnPageShow)
    const acquireWriter = async () => {
      if (!navigator.locks) {
        writerError.current =
          'This browser cannot safely coordinate workout editing between tabs. Open the application in a current browser to log a workout.'
        return
      }
      await new Promise<void>((resolve) => {
        const controller = new AbortController()
        const waitForPreviousDocument = setTimeout(() => controller.abort(), 750)
        void navigator.locks
          .request(
            `muscle-memory-workout-writer:${uid}`,
            { signal: controller.signal },
            async (lock) => {
              clearTimeout(waitForPreviousDocument)
              if (!current()) {
                resolve()
                return
              }
              writer.current = Boolean(lock)
              if (!lock) {
                writerError.current =
                  'Another tab is editing your workouts. Close that tab, then select Retry synchronization here.'
                resolve()
                return
              }
              resolve()
              await new Promise<void>((release) => {
                releaseWriter = release
              })
            },
          )
          .catch((failure) => {
            clearTimeout(waitForPreviousDocument)
            if (current())
              writerError.current =
                failure instanceof DOMException && failure.name === 'AbortError'
                  ? 'Another tab is editing your workouts. Close that tab, then select Retry synchronization here.'
                  : failureMessage(failure)
            resolve()
          })
      })
    }
    void acquireWriter()
      .then(() => readWorkoutRecoveryRaw(uid))
      .then((raw) => {
        if (!current()) return
        for (const value of raw) {
          const result = workoutCheckpointSchema.safeParse(value)
          if (result.success && result.data.uid === uid && result.data.session.ownerId === uid)
            checkpoints.current.set(result.data.session.id, result.data as WorkoutCheckpoint)
          else quarantined.current.push(value)
        }
        if (quarantined.current.length)
          storageError.current =
            'Some workout recovery data could not be read. Download a recovery copy before clearing unreadable records.'
        hydrated.current = true
        sources.current.set('sessions', { pending: false, cached: true })
        sources.current.set('state', { pending: false, cached: true })
        stops.push(
          onSnapshot(
            query(
              collection(db, 'users', uid, 'workoutSessions'),
              orderBy('updatedAt', 'desc'),
              limit(200),
            ),
            { includeMetadataChanges: true },
            (snapshot) => {
              if (!current()) return
              sources.current.set('sessions', {
                pending: snapshot.metadata.hasPendingWrites,
                cached: snapshot.metadata.fromCache,
              })
              const next = new Set(snapshot.docs.map((item) => item.id))
              for (const id of listed)
                if (!next.has(id) && !extras.has(id)) cloud.current.delete(id)
              listed = next
              for (const item of snapshot.docs) {
                try {
                  const value = workoutSessionSchema.parse(item.data()) as WorkoutSession
                  if (value.ownerId !== uid || value.id !== item.id)
                    throw new Error('A workout has invalid ownership or an identifier.')
                  cloud.current.set(value.id, value)
                  observeConfirmed(value.id, value, {
                    pending: item.metadata.hasPendingWrites,
                    cached: item.metadata.fromCache,
                  })
                } catch (failure) {
                  listenerError.current = `One workout could not be read: ${failureMessage(failure)}`
                }
              }
              ready.current.add('sessions')
              publish()
            },
            (failure) => failed('sessions', failure),
          ),
        )
        stops.push(
          onSnapshot(
            doc(db, 'users', uid, 'workoutState', 'current'),
            { includeMetadataChanges: true },
            (snapshot) => {
              if (!current()) return
              try {
                sources.current.set('state', {
                  pending: snapshot.metadata.hasPendingWrites,
                  cached: snapshot.metadata.fromCache,
                })
                const value = snapshot.exists()
                  ? (workoutStateSchema.parse(snapshot.data()) as WorkoutState)
                  : null
                if (value && value.ownerId !== uid)
                  throw new Error('The active workout belongs to a different account.')
                state.current = value
                ready.current.add('state')
                publish()
                for (const row of checkpoints.current.values())
                  if (writer.current && row.dirty && !row.attempt && !row.error)
                    schedule(row.session.id)
              } catch (failure) {
                failed('state', failure)
              }
            },
            (failure) => failed('state', failure),
          ),
        )
        publish()
      })
      .catch((failure) => {
        if (!current()) return
        storageError.current = `Workout checkpoints could not be opened: ${failureMessage(failure)}`
        hydrated.current = true
        ready.current.add('sessions')
        ready.current.add('state')
        publish()
      })
    return () => {
      stopped = true
      generation.current += 1
      owner.current = undefined
      writer.current = false
      // A new tab must not acquire the writer while a previous IndexedDB write
      // is still committing. Retain the lock until this generation's queue ends.
      void queue.current.catch(() => undefined).then(releaseWriter)
      unregister()
      window.removeEventListener('beforeunload', warn)
      window.removeEventListener('pagehide', releaseOnPageHide)
      window.removeEventListener('pageshow', restoreOnPageShow)
      for (const stop of stops) stop()
      for (const stop of extras.values()) stop()
      for (const timer of scheduledTimers.values()) clearTimeout(timer)
      scheduledTimers.clear()
      watchReferences.current = () => undefined
    }
    // Refs are the serialized checkpoint coordinator; changing render closures must not restart listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, retry])

  // Recovered completions may hydrate before their split. Retain their intent
  // until the plan is ready, including any rejected or pending training edits.
  useEffect(() => {
    if (
      !uid ||
      owner.current !== uid ||
      training.loading ||
      training.error ||
      training.hasPendingWrites
    )
      return
    for (const row of checkpoints.current.values())
      if (row.dirty && !row.attempt && !row.error && !row.conflict) schedule(row.session.id, true)
  }, [
    uid,
    training.loading,
    training.error,
    training.hasPendingWrites,
    training.activeSplitId,
    training.splits,
    training.fixedSchedules,
  ])

  function nextState(previous: WorkoutState | null, activeSessionId: string | null): WorkoutState {
    const now = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1)
    return {
      id: 'current',
      ownerId: requireOwner(),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      schemaVersion: 1,
      revision: (previous?.revision ?? 0) + 1,
      mutationId: crypto.randomUUID(),
      previousMutationId: previous?.mutationId ?? null,
      activeSessionId,
      ...(previous?.rollingProgress ? { rollingProgress: previous.rollingProgress } : {}),
    }
  }
  function sync(id: string) {
    if (!uid || owner.current !== uid || !writer.current || inFlight.current.has(id)) return
    const token = generation.current
    void enqueue(async () => {
      const row = checkpoints.current.get(id)
      if (
        !row ||
        !row.dirty ||
        row.attempt ||
        row.error ||
        row.conflict ||
        inFlight.current.has(id)
      )
        return
      if (
        row.session.status === 'completed' &&
        row.session.countsForSplit &&
        (trainingLatest.current.loading ||
          trainingLatest.current.error ||
          trainingLatest.current.hasPendingWrites)
      )
        return
      if (row.baseRevision > 0 && state.current?.activeSessionId !== id) {
        await persist({
          ...row,
          conflict: true,
          error:
            'The active workout changed on another device. Your local workout is preserved in recovery.',
        })
        return
      }
      const isStart = row.baseRevision === 0
      const source =
        isStart && row.session.status !== 'active'
          ? {
              ...row.session,
              status: 'active' as const,
              endedAt: null,
              completionKey: null,
              countsForSplit: false,
              timerEndAt: null,
            }
          : row.session
      const now = Math.max(Date.now(), source.updatedAt + 1, source.endedAt ?? 0)
      let value = workoutSessionSchema.parse({
        ...source,
        revision: row.baseRevision + 1,
        mutationId: crypto.randomUUID(),
        previousMutationId: row.baseMutationId,
        updatedAt: now,
        elapsedSeconds:
          source.status === 'active' ? workoutElapsedSeconds(source, now) : source.elapsedSeconds,
      }) as WorkoutSession
      const changedState = isStart
        ? nextState(row.stateBase, id)
        : value.status !== 'active'
          ? nextState(row.stateBase ?? state.current, null)
          : null
      let changedCalendar: FixedSchedule | undefined
      if (
        changedState &&
        value.status === 'completed' &&
        value.countsForSplit &&
        value.fixedContext
      ) {
        const split =
          trainingLatest.current.splits.find(
            (item) =>
              item.id === trainingLatest.current.activeSplitId &&
              item.id === value.splitContext?.splitId,
          ) ?? null
        const calendar = currentCalendar(value.fixedContext.scheduleId)
        if (calendar && canCompleteFixed(value, calendar, split)) {
          changedCalendar = fixedScheduleSchema.parse({
            ...completeFixedOccurrence(calendar, value, split),
            revision: calendar.revision + 1,
            mutationId: crypto.randomUUID(),
            previousMutationId: calendar.mutationId,
            updatedAt: Math.max(Date.now(), calendar.updatedAt + 1, value.endedAt ?? 0),
          }) as FixedSchedule
        } else value = { ...value, countsForSplit: false }
      } else if (changedState && value.status === 'completed' && value.countsForSplit) {
        const split =
          trainingLatest.current.splits.find(
            (item) =>
              item.id === trainingLatest.current.activeSplitId &&
              item.id === value.splitContext?.splitId,
          ) ?? null
        const progress = changedState.rollingProgress ?? {}
        if (canAdvanceRolling(value, split, progress)) {
          changedState.rollingProgress = advanceRollingProgress(value, split, progress)
        } else {
          // A split edit or activation change must not prevent preserving performed work.
          value = { ...value, countsForSplit: false }
        }
      }
      const attempt: WorkoutAttempt = {
        session: value,
        state: changedState,
        version: row.version,
        ...(changedCalendar ? { fixedSchedule: changedCalendar } : {}),
      }
      await persist({ ...row, attempt })
      inFlight.current.set(id, value.mutationId)
      const db = getFirebaseServices().db
      const batch = writeBatch(db)
      batch.set(doc(db, 'users', uid, 'workoutSessions', id), value)
      for (const page of workoutValidationPages(value))
        batch.set(
          doc(db, 'users', uid, 'workoutSessions', id, 'validationPages', page.id),
          page.value,
        )
      if (changedState) batch.set(doc(db, 'users', uid, 'workoutState', 'current'), changedState)
      if (changedCalendar) {
        batch.set(doc(db, 'users', uid, 'fixedSchedules', changedCalendar.id), changedCalendar)
        for (const page of fixedScheduleValidationPages(changedCalendar))
          batch.set(
            doc(db, 'users', uid, 'fixedSchedules', changedCalendar.id, 'validationPages', page.id),
            page.value,
          )
      }
      void batch
        .commit()
        .then(() => {
          if (generation.current !== token) return
          inFlight.current.delete(id)
          void enqueue(async () => {
            await acknowledge(id, attempt)
            const latest = checkpoints.current.get(id)
            if (latest?.dirty && !latest.attempt && !latest.error && !latest.conflict)
              schedule(id, true)
          }).catch((failure) => {
            if (generation.current === token) {
              storageError.current = failureMessage(failure)
              publish()
            }
          })
        })
        .catch((failure) => {
          if (generation.current !== token) return
          inFlight.current.delete(id)
          void enqueue(async () => {
            const latest = checkpoints.current.get(id)
            if (!latest || latest.attempt?.session.mutationId !== attempt.session.mutationId) return
            await persist({
              ...latest,
              error: `Cloud save was rejected. Your workout is retained on this device. ${failureMessage(failure)}`,
            })
          }).catch((storageFailure) => {
            if (generation.current === token) {
              storageError.current = failureMessage(storageFailure)
              publish()
            }
          })
        })
    }).catch((failure) => {
      if (generation.current === token) {
        storageError.current = failureMessage(failure)
        publish()
      }
    })
  }
  syncRef.current = sync

  async function startWorkout(
    routine: Routine,
    options?: { scheduled?: boolean; allowEarly?: boolean; fixedOccurrenceId?: string },
  ) {
    const ownerId = requireOwner()
    return enqueue(async () => {
      if (
        quarantined.current.length ||
        [...checkpoints.current.values()].some(
          (row) => row.dirty || row.attempt || row.error || row.session.status === 'active',
        ) ||
        state.current?.activeSessionId
      )
        throw new Error(
          'Resume your active workout or finish synchronizing its recovery copy before starting another.',
        )
      const currentRoutine = training.routines.find(
        (item) => item.id === routine.id && !item.archived,
      )
      if (!currentRoutine || currentRoutine.revision !== routine.revision)
        throw new Error(
          'This routine changed. Reopen Train and review the latest routine before starting.',
        )
      let context: WorkoutSession['splitContext'] = null
      let fixedContext: WorkoutSession['fixedContext']
      if (options?.scheduled) {
        if (training.loading || training.error || training.hasPendingWrites)
          throw new Error(
            'Wait for your training plan to finish synchronizing before starting its next workout.',
          )
        const split = training.splits.find((item) => item.id === training.activeSplitId) ?? null
        if (split?.mode === 'fixed') {
          const calendar = currentCalendar(split.id)
          const recommendation = getFixedRecommendation(
            calendar,
            split,
            training.routines,
            Date.now(),
          )
          const occurrence = options.fixedOccurrenceId
            ? calendar?.occurrences.find((item) => item.id === options.fixedOccurrenceId)
            : recommendation.kind === 'workout'
              ? recommendation.occurrence
              : undefined
          if (
            !calendar ||
            calendar.splitRevision !== split.revision ||
            !occurrence ||
            occurrence.status !== 'planned' ||
            occurrence.isRestDay ||
            occurrence.routineId !== routine.id ||
            occurrence.scheduledDate > localDate(Date.now(), calendar.timeZone)
          )
            throw new Error(
              'This calendar workout is unavailable or scheduled for a future date. Review your calendar first.',
            )
          context = {
            splitId: split.id,
            splitRevision: split.revision,
            slotId: occurrence.slotId,
            sequence: occurrence.sequence,
          }
          fixedContext = {
            scheduleId: calendar.id,
            generationId: calendar.generationId,
            occurrenceId: occurrence.id,
            occurrenceVersion: occurrence.version,
          }
        } else {
          const recommendation = getRollingRecommendation(
            split,
            training.routines,
            state.current?.rollingProgress ?? {},
            Date.now(),
            account?.preferences.timeZone ?? 'UTC',
          )
          if (
            (recommendation.kind !== 'workout' && recommendation.kind !== 'rest') ||
            recommendation.routine.id !== routine.id
          )
            throw new Error('Your next workout changed. Review your training plan and try again.')
          if (recommendation.kind === 'rest' && !options.allowEarly)
            throw new Error('Rest is next in your split. Confirm training early before starting.')
          context = {
            splitId: recommendation.splitId,
            splitRevision: recommendation.splitRevision,
            slotId: recommendation.slotId,
            sequence: recommendation.sequence,
          }
        }
      }
      const value = workoutSessionSchema.parse({
        ...createWorkoutSession(currentRoutine, ownerId, context),
        ...(fixedContext ? { fixedContext } : {}),
      }) as WorkoutSession
      await persist({
        key: `${ownerId}:${value.id}`,
        uid: ownerId,
        session: value,
        baseRevision: 0,
        baseMutationId: null,
        version: 1,
        dirty: true,
        attempt: null,
        stateBase: state.current,
        error: null,
        conflict: false,
      })
      schedule(value.id, true)
      return value.id
    })
  }
  async function saveWorkout(input: WorkoutSession) {
    const ownerId = requireOwner()
    await enqueue(async () => {
      const existing = checkpoints.current.get(input.id)
      const authoritative = existing?.session ?? cloud.current.get(input.id)
      if (!authoritative || authoritative.ownerId !== ownerId || authoritative.status !== 'active')
        throw new Error('This workout is no longer active. Your recorded history is preserved.')
      if (!existing && input.revision !== authoritative.revision)
        throw new Error('This workout changed. Reopen its latest cloud version before editing.')
      const now = Math.max(Date.now(), authoritative.updatedAt)
      const editable = { ...input }
      delete editable.fixedContext
      const value = workoutSessionSchema.parse({
        ...editable,
        id: authoritative.id,
        ownerId,
        status: 'active',
        endedAt: null,
        completionKey: null,
        countsForSplit: false,
        routineId: authoritative.routineId,
        routineRevision: authoritative.routineRevision,
        routineName: authoritative.routineName,
        splitContext: authoritative.splitContext,
        ...(authoritative.fixedContext ? { fixedContext: authoritative.fixedContext } : {}),
        startedAt: authoritative.startedAt,
        createdAt: authoritative.createdAt,
        schemaVersion: 1,
        revision: authoritative.revision,
        mutationId: authoritative.mutationId,
        previousMutationId: authoritative.previousMutationId,
        updatedAt: now,
        elapsedSeconds: workoutElapsedSeconds(authoritative, now),
      }) as WorkoutSession
      const row: WorkoutCheckpoint = existing ?? {
        key: `${ownerId}:${input.id}`,
        uid: ownerId,
        session: authoritative,
        baseRevision: authoritative.revision,
        baseMutationId: authoritative.mutationId,
        version: 0,
        dirty: false,
        attempt: null,
        stateBase: state.current,
        error: null,
        conflict: false,
      }
      await persist({ ...row, session: value, version: row.version + 1, dirty: true })
      schedule(input.id)
    })
  }
  async function finishWorkout(
    input: WorkoutSession,
    finalStatus: 'completed' | 'abandoned',
    options?: { countForSplit?: boolean },
  ) {
    const ownerId = requireOwner()
    await enqueue(async () => {
      const row = checkpoints.current.get(input.id)
      const current = row?.session ?? cloud.current.get(input.id)
      if (!current || current.ownerId !== ownerId) throw new Error('This workout is unavailable.')
      if (current.status !== 'active') return
      if (row?.conflict || row?.error)
        throw new Error(
          'Resolve the workout recovery message before finishing. Your performed sets remain on this device.',
        )
      if (!row && input.revision !== current.revision)
        throw new Error(
          'This workout changed on another device. Review the latest version before finishing.',
        )
      const editable = { ...input }
      delete editable.fixedContext
      const source = {
        ...editable,
        id: current.id,
        ownerId,
        routineId: current.routineId,
        routineRevision: current.routineRevision,
        routineName: current.routineName,
        splitContext: current.splitContext,
        ...(current.fixedContext ? { fixedContext: current.fixedContext } : {}),
        startedAt: current.startedAt,
        createdAt: current.createdAt,
        schemaVersion: 1 as const,
        revision: current.revision,
        mutationId: current.mutationId,
        previousMutationId: current.previousMutationId,
        updatedAt: Math.max(Date.now(), current.updatedAt),
      }
      const value = finishWorkoutSession(
        source,
        finalStatus,
        Math.max(Date.now(), source.updatedAt),
      )
      const split =
        training.splits.find(
          (item) => item.id === training.activeSplitId && item.id === value.splitContext?.splitId,
        ) ?? null
      const requestedCount = options?.countForSplit ?? !isPartialWorkout(value)
      const candidate = { ...value, countsForSplit: finalStatus === 'completed' && requestedCount }
      const waitingForPlan = training.loading || training.error || training.hasPendingWrites
      value.countsForSplit =
        candidate.countsForSplit &&
        value.splitContext?.sequence !== undefined &&
        (Boolean(waitingForPlan) ||
          (candidate.fixedContext
            ? canCompleteFixed(candidate, currentCalendar(candidate.fixedContext.scheduleId), split)
            : canAdvanceRolling(candidate, split, state.current?.rollingProgress ?? {})))
      const checkpoint: WorkoutCheckpoint = row ?? {
        key: `${ownerId}:${input.id}`,
        uid: ownerId,
        session: current,
        baseRevision: current.revision,
        baseMutationId: current.mutationId,
        version: 0,
        dirty: false,
        attempt: null,
        stateBase: state.current,
        error: null,
        conflict: false,
      }
      await persist({ ...checkpoint, session: value, version: checkpoint.version + 1, dirty: true })
      schedule(input.id, true)
    })
  }
  function retrySync() {
    if (!uid || owner.current !== uid) return
    if (localWrites.current) return
    const token = generation.current
    if (
      (!writer.current || listenerError.current || storageError.current) &&
      !inFlight.current.size
    ) {
      setRetry((value) => value + 1)
      return
    }
    void enqueue(async () => {
      for (const row of checkpoints.current.values()) {
        if (inFlight.current.has(row.session.id) || sources.current.get(row.session.id)?.pending)
          continue
        const latest = cloud.current.get(row.session.id)
        if (
          row.conflict ||
          (latest &&
            (latest.revision !== row.baseRevision || latest.mutationId !== row.baseMutationId))
        ) {
          await persist({
            ...row,
            conflict: true,
            error:
              'A newer cloud copy exists. Download your local recovery before choosing the cloud version.',
          })
          continue
        }
        await persist({
          ...row,
          error: null,
          attempt: null,
          stateBase:
            row.baseRevision === 0 && !state.current?.activeSessionId
              ? state.current
              : row.stateBase,
        })
        schedule(row.session.id, true)
      }
    }).catch((failure) => {
      if (generation.current === token) {
        storageError.current = failureMessage(failure)
        publish()
      }
    })
  }
  function downloadRecovery() {
    requireOwner(true)
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schemaVersion: 1,
            ownerId: uid,
            exportedAt: new Date().toISOString(),
            checkpoints: [...checkpoints.current.values()],
            unreadableRecords: quarantined.current,
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
    anchor.download = `muscle-memory-workout-recovery-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function discardLocalChanges(id: string) {
    const ownerId = requireOwner()
    const token = generation.current
    await enqueue(async () => {
      const row = checkpoints.current.get(id)
      if (!row) return
      const source = sources.current.get(id)
      if (inFlight.current.has(id) || source?.pending || !source || source.cached)
        throw new Error(
          'Reconnect and wait for the pending workout write before choosing a cloud copy.',
        )
      if (!row.error && !row.conflict)
        throw new Error(
          'This checkpoint has not been rejected. Synchronize it before clearing recovery.',
        )
      await deleteWorkoutCheckpoint(ownerId, id)
      if (generation.current !== token || owner.current !== ownerId) return
      checkpoints.current.delete(id)
      const timer = timers.current.get(id)
      if (timer) clearTimeout(timer)
      timers.current.delete(id)
    })
  }
  async function clearUnreadableRecovery() {
    const ownerId = requireOwner()
    const token = generation.current
    await enqueue(async () => {
      await clearMalformedWorkoutCheckpoints(ownerId)
      if (generation.current === token && owner.current === ownerId) {
        quarantined.current = []
        storageError.current = null
      }
    })
  }
  return (
    <WorkoutContext.Provider
      value={{
        rollingProgress,
        sessions,
        activeSession,
        loading,
        error,
        hasPendingWrites,
        fromCache,
        recoveryCount,
        localSaving,
        writable,
        rejectedSessions,
        unreadableCount,
        startWorkout,
        saveWorkout,
        finishWorkout,
        retrySync,
        downloadRecovery,
        discardLocalChanges,
        clearUnreadableRecovery,
      }}
    >
      {children}
    </WorkoutContext.Provider>
  )
}

export function useWorkouts(): WorkoutData {
  const value = useContext(WorkoutContext)
  if (!value) throw new Error('useWorkouts must be called inside WorkoutProvider.')
  return value
}
