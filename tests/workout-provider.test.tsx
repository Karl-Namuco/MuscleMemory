import { act, cleanup, render } from '@testing-library/react'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXERCISES } from '../src/data/exercises'
import { createRoutineExercise } from '../src/domain/training/helpers'
import { createWorkoutSession } from '../src/domain/workout/helpers'
import { createFixedSchedule } from '../src/domain/scheduling/fixed'
import type { FixedSchedule } from '../src/types/fixedScheduling'
import {
  WorkoutProvider,
  useWorkouts,
  type WorkoutData,
} from '../src/services/workouts/WorkoutProvider'
import type { WorkoutCheckpoint } from '../src/services/workouts/storage'
import type { Routine, TrainingSplit } from '../src/types/training'
import type { WorkoutSession } from '../src/types/workout'

interface Reference {
  path: string
  kind: 'doc' | 'query' | 'collection'
}
interface Snapshot {
  metadata: { hasPendingWrites: boolean; fromCache: boolean }
  exists: () => boolean
  data: () => unknown
  docs: { id: string; data: () => unknown; metadata: Snapshot['metadata'] }[]
}
interface Write {
  path: string
  value: unknown
}
interface PendingCommit {
  writes: Write[]
  resolve: () => void
  reject: (failure: Error) => void
}

const mock = vi.hoisted(() => ({
  uid: 'owner-a',
  routines: [] as Routine[],
  splits: [] as TrainingSplit[],
  fixedSchedules: [] as FixedSchedule[],
  activeSplitId: null as string | null,
  trainingLoading: false,
  trainingPending: false,
  trainingError: null as string | null,
  persisted: new Map<string, WorkoutCheckpoint>(),
  remote: new Map<string, unknown>(),
  listeners: new Map<Reference, (snapshot: Snapshot) => void>(),
  commits: [] as PendingCommit[],
  delayPut: null as null | ((checkpoint: WorkoutCheckpoint) => Promise<void>),
  offline: false,
  deferSnapshots: false,
}))

vi.mock('../src/services/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: mock.uid }, status: 'ready' }),
}))
vi.mock('../src/services/training/TrainingProvider', () => ({
  useTraining: () => ({
    routines: mock.routines,
    splits: mock.splits,
    fixedSchedules: mock.fixedSchedules,
    activeSplitId: mock.activeSplitId,
    loading: mock.trainingLoading,
    hasPendingWrites: mock.trainingPending,
    error: mock.trainingError,
  }),
}))
vi.mock('../src/services/firebase/client', () => ({
  getFirebaseServices: () => ({ db: {} }),
}))
vi.mock('../src/services/workouts/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/workouts/storage')>()
  return {
    ...actual,
    readWorkoutRecoveryRaw: vi.fn(async (uid: string) =>
      [...mock.persisted.values()]
        .filter((row) => row.uid === uid)
        .map((row) => structuredClone(row)),
    ),
    saveWorkoutCheckpoint: vi.fn(async (checkpoint: WorkoutCheckpoint) => {
      const snapshot = structuredClone(checkpoint)
      if (mock.delayPut) await mock.delayPut(snapshot)
      mock.persisted.set(snapshot.key, snapshot)
    }),
    deleteWorkoutCheckpoint: vi.fn(async (uid: string, id: string) => {
      mock.persisted.delete(`${uid}:${id}`)
    }),
    clearMalformedWorkoutCheckpoints: vi.fn(async () => undefined),
  }
})
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]): Reference => ({
    path: parts.join('/'),
    kind: 'collection',
  }),
  doc: (_db: unknown, ...parts: string[]): Reference => ({ path: parts.join('/'), kind: 'doc' }),
  query: (reference: Reference): Reference => ({ ...reference, kind: 'query' }),
  orderBy: () => ({}),
  limit: () => ({}),
  onSnapshot: (reference: Reference, _options: unknown, next: (snapshot: Snapshot) => void) => {
    mock.listeners.set(reference, next)
    queueMicrotask(() => {
      if (!mock.deferSnapshots && mock.listeners.has(reference)) next(snapshotFor(reference))
    })
    return () => {
      mock.listeners.delete(reference)
    }
  },
  writeBatch: () => {
    const writes: Write[] = []
    return {
      set: (reference: Reference, value: unknown) => {
        writes.push({ path: reference.path, value: structuredClone(value) })
      },
      commit: () =>
        new Promise<void>((resolve, reject) => {
          mock.commits.push({ writes, resolve, reject })
        }),
    }
  },
}))

function snapshotFor(reference: Reference): Snapshot {
  const metadata = { hasPendingWrites: false, fromCache: mock.offline }
  const value = mock.remote.get(reference.path)
  return {
    metadata,
    exists: () => value !== undefined,
    data: () => structuredClone(value),
    docs:
      reference.kind === 'query'
        ? [...mock.remote.entries()]
            .filter(
              ([path]) =>
                path.startsWith(`${reference.path}/`) &&
                !path.slice(reference.path.length + 1).includes('/'),
            )
            .map(([path, record]) => ({
              id: path.split('/').at(-1)!,
              data: () => structuredClone(record),
              metadata,
            }))
        : [],
  }
}

function notifyRemote() {
  for (const [reference, next] of [...mock.listeners]) next(snapshotFor(reference))
}

async function confirm(index: number, resolveCommit = true) {
  await act(async () => {
    for (const write of mock.commits[index].writes)
      mock.remote.set(write.path, structuredClone(write.value))
    mock.offline = false
    notifyRemote()
    if (resolveCommit) mock.commits[index].resolve()
    for (let count = 0; count < 20; count += 1) await Promise.resolve()
  })
}

let current: WorkoutData | null = null
function Probe() {
  current = useWorkouts()
  return null
}
const tree = () => (
  <WorkoutProvider>
    <Probe />
  </WorkoutProvider>
)
const api = () => {
  if (!current) throw new Error('Provider not mounted')
  return current
}

async function settle() {
  await act(async () => {
    for (let count = 0; count < 30; count += 1) await Promise.resolve()
  })
}
async function advance(milliseconds = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
  await settle()
}

function routine(): Routine {
  const timestamp = Date.now() - 1000
  return {
    id: 'routine',
    ownerId: mock.uid,
    createdAt: timestamp,
    updatedAt: timestamp,
    archived: false,
    schemaVersion: 1,
    revision: 1,
    mutationId: 'routine-mutation',
    previousMutationId: null,
    name: 'Strength',
    description: '',
    targetMuscles: [],
    exercises: [
      createRoutineExercise(EXERCISES.find((exercise) => exercise.trackingType === 'weight-reps')!),
    ],
  }
}

async function start() {
  let id = ''
  await act(async () => {
    id = await api().startWorkout(mock.routines[0])
  })
  return id
}

function sessionWrite(index: number): WorkoutSession {
  const write = mock.commits[index].writes.find((item) =>
    /\/workoutSessions\/[^/]+$/.test(item.path),
  )
  if (!write) throw new Error('No session in the committed batch')
  return write.value as WorkoutSession
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-25T10:00:00Z'))
  mock.uid = 'owner-a'
  mock.routines = [routine()]
  mock.splits = []
  mock.fixedSchedules = []
  mock.activeSplitId = null
  mock.trainingLoading = false
  mock.trainingPending = false
  mock.trainingError = null
  mock.persisted.clear()
  mock.remote.clear()
  mock.listeners.clear()
  mock.commits.length = 0
  mock.delayPut = null
  mock.offline = false
  mock.deferSnapshots = false
  current = null
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: vi.fn(
        (
          _name: string,
          optionsOrCallback: unknown,
          possibleCallback?: (lock: { name: string }) => unknown,
        ) => {
          const callback =
            typeof optionsOrCallback === 'function'
              ? (optionsOrCallback as (lock: { name: string }) => unknown)
              : possibleCallback!
          return Promise.resolve(callback({ name: 'workout-owner' }))
        },
      ),
    },
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function enableRolling() {
  mock.activeSplitId = 'rolling-split'
  mock.splits = [
    {
      ...routine(),
      id: mock.activeSplitId,
      name: 'Rolling strength',
      mode: 'rolling',
      slots: [
        { id: 'first-slot', label: 'Strength A', routineId: mock.routines[0].id, isRestDay: false },
        {
          id: 'second-slot',
          label: 'Strength B',
          routineId: mock.routines[0].id,
          isRestDay: false,
        },
      ],
    },
  ]
}

function performed(all = true) {
  const session = structuredClone(api().activeSession!)
  session.exercises = session.exercises.map((entry) => ({
    ...entry,
    sets: entry.sets.map((set, index) => ({
      ...set,
      weightKg: 30,
      reps: 8,
      completedAt: all || index === 0 ? Date.now() : null,
    })),
  }))
  return session
}

function enableFixed() {
  const timestamp=Date.now()-1000
  const split:TrainingSplit={id:'fixed-split',ownerId:mock.uid,createdAt:timestamp,updatedAt:timestamp,archived:false,schemaVersion:1,revision:1,mutationId:'fixed-split-mutation',previousMutationId:null,name:'Fixed strength',description:'',mode:'fixed',slots:[{id:'fixed-slot',label:'Strength',routineId:mock.routines[0].id,isRestDay:false}]}
  mock.splits=[split];mock.activeSplitId=split.id
  const calendar=createFixedSchedule({split,routines:mock.routines,startDate:'2026-11-25',timeZone:'UTC',preferredDays:[],generationId:'fixed-calendar',now:Date.now()})
  mock.fixedSchedules=[calendar]
  mock.remote.set(`users/${mock.uid}/fixedSchedules/${calendar.id}`,calendar)
  return calendar
}

describe('Fixed workout coordination',()=>{
  it('completes the frozen occurrence atomically with history and checkpoints its calendar attempt',async()=>{
    const calendar=enableFixed()
    render(tree());await settle()
    await act(async()=>{await api().startWorkout(mock.routines[0],{scheduled:true})})
    expect(api().activeSession?.fixedContext).toMatchObject({generationId:calendar.generationId,occurrenceId:calendar.occurrences[0].id,occurrenceVersion:1})
    await advance();await confirm(0)
    const session=performed()
    await act(async()=>{await api().finishWorkout(session,'completed')});await advance()
    const changed=mock.commits[1].writes.find(write=>write.path.endsWith(`/fixedSchedules/${calendar.id}`))!.value as FixedSchedule
    expect(changed.occurrences[0]).toMatchObject({status:'completed',completionSessionId:session.id,version:2})
    expect(changed.occurrences.slice(1)).toEqual(calendar.occurrences.slice(1))
    expect([...mock.persisted.values()][0].attempt?.fixedSchedule).toEqual(changed)
    expect(mock.commits[1].writes.some(write=>write.path.endsWith('/validationPages/p3'))).toBe(true)
    await act(async()=>{await api().finishWorkout(session,'completed')});await advance()
    expect(mock.commits).toHaveLength(2)
    await confirm(1)
    expect(mock.persisted.size).toBe(0)
    await expect(api().startWorkout(mock.routines[0],{scheduled:true,fixedOccurrenceId:calendar.occurrences[0].id})).rejects.toThrow('unavailable')
  })
  it('keeps one identity when a scheduled workout finishes offline before its first acknowledgment',async()=>{
    const calendar=enableFixed();mock.offline=true
    render(tree());await settle()
    await act(async()=>{await api().startWorkout(mock.routines[0],{scheduled:true})})
    await act(async()=>{await api().finishWorkout(performed(),'completed')});await advance()
    expect(sessionWrite(0).countsForSplit).toBe(false)
    expect(mock.commits[0].writes.some(write=>write.path.includes('/fixedSchedules/'))).toBe(false)
    await confirm(0);await advance(1500)
    expect(sessionWrite(1).countsForSplit).toBe(true)
    await confirm(1)
    expect((mock.remote.get(`users/${mock.uid}/fixedSchedules/${calendar.id}`) as FixedSchedule).occurrences[0].status).toBe('completed')
    expect(api().sessions).toHaveLength(1)
  })
  it.each([false,true])('respects explicit partial inclusion: %s',async(countForSplit)=>{
    enableFixed();render(tree());await settle()
    await act(async()=>{await api().startWorkout(mock.routines[0],{scheduled:true})})
    await advance();await confirm(0)
    await act(async()=>{await api().finishWorkout(performed(false),'completed',{countForSplit})});await advance()
    expect(sessionWrite(1).countsForSplit).toBe(countForSplit)
    expect(mock.commits[1].writes.some(write=>/\/fixedSchedules\/[^/]+$/.test(write.path))).toBe(countForSplit)
  })
  it('keeps history without completing a regenerated occurrence and rejects future starts',async()=>{
    const calendar=enableFixed();const view=render(tree());await settle()
    await expect(api().startWorkout(mock.routines[0],{scheduled:true,fixedOccurrenceId:calendar.occurrences[1].id})).rejects.toThrow('future')
    await act(async()=>{await api().startWorkout(mock.routines[0],{scheduled:true})});await advance();await confirm(0)
    mock.fixedSchedules=[createFixedSchedule({split:mock.splits[0],routines:mock.routines,startDate:'2026-11-25',timeZone:'UTC',preferredDays:[],generationId:'regenerated-calendar',now:Date.now()+1,previous:calendar})]
    view.rerender(tree());await settle()
    await act(async()=>{await api().finishWorkout(performed(),'completed')});await advance()
    expect(sessionWrite(1).countsForSplit).toBe(false)
    expect(mock.commits[1].writes.some(write=>write.path.includes('/fixedSchedules/'))).toBe(false)
  })
})

describe('Rolling workout coordination', () => {
  it.each(['loading', 'pending', 'error'] as const)(
    'retains inclusion intent while the training plan is %s',
    async (condition) => {
      enableRolling()
      const view = render(tree())
      await settle()
      await act(async () => {
        await api().startWorkout(mock.routines[0], { scheduled: true })
      })
      await advance()
      await confirm(0)
      mock.trainingLoading = condition === 'loading'
      mock.trainingPending = condition === 'pending'
      mock.trainingError = condition === 'error' ? 'Training data unavailable' : null
      view.rerender(tree())
      await settle()
      await act(async () => {
        await api().finishWorkout(performed(), 'completed')
      })
      await advance(2000)
      expect(api().sessions[0].countsForSplit).toBe(true)
      expect(mock.commits).toHaveLength(1)
      mock.trainingLoading = false
      mock.trainingPending = false
      mock.trainingError = null
      view.rerender(tree())
      await settle()
      await advance()
      expect(mock.commits).toHaveLength(2)
      expect(sessionWrite(1).countsForSplit).toBe(true)
      await confirm(1)
      expect(api().rollingProgress['rolling-split'].sequence).toBe(1)
    },
  )

  it('waits for the split when recovering a terminal checkpoint before training hydration', async () => {
    enableRolling()
    const view = render(tree())
    await settle()
    await act(async () => {
      await api().startWorkout(mock.routines[0], { scheduled: true })
    })
    await advance()
    await confirm(0)
    await act(async () => {
      await api().finishWorkout(performed(), 'completed')
    })
    view.unmount()
    await settle()
    const savedSplits = mock.splits
    mock.trainingLoading = true
    mock.splits = []
    const recovered = render(tree())
    await settle()
    await advance(2000)
    expect(mock.commits).toHaveLength(1)
    expect(api().sessions[0].countsForSplit).toBe(true)
    expect(api().hasPendingWrites).toBe(true)
    mock.trainingLoading = false
    mock.splits = savedSplits
    recovered.rerender(tree())
    await settle()
    await advance()
    expect(sessionWrite(1).countsForSplit).toBe(true)
    await confirm(1)
    expect(api().rollingProgress['rolling-split'].sequence).toBe(1)
  })

  it('advances the exact repeated-routine slot atomically and ignores duplicate completion', async () => {
    enableRolling()
    render(tree())
    await settle()
    await act(async () => {
      await api().startWorkout(mock.routines[0], { scheduled: true })
    })
    expect(api().activeSession?.splitContext).toMatchObject({ slotId: 'first-slot', sequence: 0 })
    await advance()
    await confirm(0)
    const session = performed()
    await act(async () => {
      await api().finishWorkout(session, 'completed')
    })
    await advance()
    expect(sessionWrite(1).countsForSplit).toBe(true)
    const pointer = mock.commits[1].writes.find((item) =>
      item.path.endsWith('/workoutState/current'),
    )!
    expect(pointer.value).toMatchObject({
      activeSessionId: null,
      rollingProgress: {
        'rolling-split': { sequence: 1, lastSlotId: 'first-slot', lastSessionId: session.id },
      },
    })
    await act(async () => {
      await api().finishWorkout(session, 'completed')
    })
    await advance()
    expect(mock.commits).toHaveLength(2)
    await confirm(1)
    expect(api().rollingProgress['rolling-split'].sequence).toBe(1)
    await act(async () => {
      await api().startWorkout(mock.routines[0], { scheduled: true })
    })
    expect(api().activeSession?.splitContext).toMatchObject({ slotId: 'second-slot', sequence: 1 })
  })

  it('checkpoints an offline completion before its active write and advances only on the terminal batch', async () => {
    enableRolling()
    mock.offline = true
    render(tree())
    await settle()
    await act(async () => {
      await api().startWorkout(mock.routines[0], { scheduled: true })
    })
    const session = performed()
    await act(async () => {
      await api().finishWorkout(session, 'completed')
    })
    expect(api().rollingProgress['rolling-split'].sequence).toBe(1)
    await advance()
    expect(sessionWrite(0).status).toBe('active')
    expect(sessionWrite(0).countsForSplit).toBe(false)
    await confirm(0)
    await advance(1500)
    expect(sessionWrite(1).countsForSplit).toBe(true)
    expect(sessionWrite(1).id).toBe(session.id)
    await confirm(1)
    expect(api().rollingProgress['rolling-split'].sequence).toBe(1)
    expect(mock.persisted.size).toBe(0)
  })

  it.each([undefined, false, true])(
    'counts a partial workout only with explicit consent: %s',
    async (choice) => {
      enableRolling()
      render(tree())
      await settle()
      await act(async () => {
        await api().startWorkout(mock.routines[0], { scheduled: true })
      })
      await advance()
      await confirm(0)
      await act(async () => {
        await api().finishWorkout(
          performed(false),
          'completed',
          choice === undefined ? undefined : { countForSplit: choice },
        )
      })
      await advance()
      expect(sessionWrite(1).countsForSplit).toBe(choice === true)
      await confirm(1)
      expect(api().rollingProgress['rolling-split']?.sequence ?? 0).toBe(choice === true ? 1 : 0)
    },
  )

  it('saves performed work without advancement after a split edit', async () => {
    enableRolling()
    const view = render(tree())
    await settle()
    await act(async () => {
      await api().startWorkout(mock.routines[0], { scheduled: true })
    })
    await advance()
    await confirm(0)
    mock.splits = mock.splits.map((split) => ({ ...split, revision: 2 }))
    view.rerender(tree())
    await settle()
    await act(async () => {
      await api().finishWorkout(performed(), 'completed')
    })
    await advance()
    expect(sessionWrite(1).countsForSplit).toBe(false)
    await confirm(1)
    expect(api().rollingProgress).toEqual({})
  })

  it('keeps library starts and ended-early workouts outside the split sequence', async () => {
    enableRolling()
    render(tree())
    await settle()
    await start()
    expect(api().activeSession?.splitContext).toBeNull()
    await advance()
    await confirm(0)
    await act(async () => {
      await api().finishWorkout(performed(), 'completed', { countForSplit: true })
    })
    await advance()
    expect(sessionWrite(1).countsForSplit).toBe(false)
    await confirm(1)
    await act(async () => {
      await api().startWorkout(mock.routines[0], { scheduled: true })
    })
    await advance()
    await confirm(2)
    await act(async () => {
      await api().finishWorkout(performed(), 'abandoned', { countForSplit: true })
    })
    await advance()
    expect(sessionWrite(3).countsForSplit).toBe(false)
  })
})

describe('durable workout coordinator', () => {
  it('exports only the hydrated account recovery while initial cloud snapshots are still loading', async () => {
    mock.deferSnapshots = true
    const session = createWorkoutSession(mock.routines[0], mock.uid)
    session.notes = 'Device recovery awaiting cloud access'
    const checkpoint: WorkoutCheckpoint = {
      key: `${mock.uid}:${session.id}`,
      uid: mock.uid,
      session,
      baseRevision: 0,
      baseMutationId: null,
      version: 1,
      dirty: true,
      attempt: null,
      stateBase: null,
      error: 'The prior cloud save was not confirmed.',
      conflict: false,
    }
    mock.persisted.set(checkpoint.key, checkpoint)
    const otherSession = createWorkoutSession(mock.routines[0], 'owner-b')
    const otherCheckpoint = {
      ...structuredClone(checkpoint),
      key: `owner-b:${otherSession.id}`,
      uid: 'owner-b',
      session: otherSession,
    }
    mock.persisted.set(otherCheckpoint.key, otherCheckpoint)
    const createObjectURL = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:recovery')
    const revokeObjectURL = vi.fn()
    const OriginalURL = URL
    vi.stubGlobal(
      'URL',
      class extends OriginalURL {
        static createObjectURL = createObjectURL
        static revokeObjectURL = revokeObjectURL
      },
    )
    vi.stubGlobal('Blob', NodeBlob)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(tree())
    await settle()

    expect(mock.listeners.size).toBeGreaterThan(0)
    expect(api().loading).toBe(true)
    expect(api().sessions.map((item) => item.id)).toEqual([session.id])
    expect(() => api().downloadRecovery()).not.toThrow()
    expect(click).toHaveBeenCalledOnce()
    expect(createObjectURL).toHaveBeenCalledOnce()
    const exported = JSON.parse(await createObjectURL.mock.calls[0][0].text()) as {
      ownerId: string
      checkpoints: WorkoutCheckpoint[]
    }
    expect(exported.ownerId).toBe(mock.uid)
    expect(exported.checkpoints).toEqual([checkpoint])
    await expect(api().saveWorkout(session)).rejects.toThrow('finish loading')
    expect(mock.commits).toHaveLength(0)
  })

  it('does not publish a previous account checkpoint when its delayed disk write resolves after an auth switch', async () => {
    const view = render(tree())
    await settle()
    expect(api().loading).toBe(false)
    let release!: () => void
    let started = false
    mock.delayPut = async () => {
      if (started) return
      started = true
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
    let pending!: Promise<unknown>
    await act(async () => {
      pending = api()
        .startWorkout(mock.routines[0])
        .catch((failure: unknown) => failure)
      await Promise.resolve()
    })
    expect(started).toBe(true)
    mock.uid = 'owner-b'
    mock.routines = [routine()]
    view.rerender(tree())
    await settle()
    await act(async () => {
      release()
      await pending
    })
    await settle()
    await act(async () => {
      notifyRemote()
    })
    await settle()
    expect(api().sessions).toEqual([])
    expect(api().activeSession).toBeNull()
    expect([...mock.persisted.values()].every((row) => row.uid === 'owner-a')).toBe(true)
    expect(mock.commits).toHaveLength(0)
  })

  it('synchronizes a newer edit after the server snapshot confirms the prior batch before its commit promise resolves', async () => {
    render(tree())
    await settle()
    await start()
    await advance()
    expect(mock.commits).toHaveLength(1)
    await confirm(0)
    const firstEdit = structuredClone(api().activeSession!)
    firstEdit.notes = 'First edit'
    await act(async () => {
      await api().saveWorkout(firstEdit)
    })
    await advance(1500)
    expect(mock.commits).toHaveLength(2)
    const latestEdit = structuredClone(api().activeSession!)
    latestEdit.notes = 'Typed while the earlier write was in flight'
    await act(async () => {
      await api().saveWorkout(latestEdit)
    })
    await confirm(1, false)
    await advance()
    await act(async () => {
      mock.commits[1].resolve()
    })
    await settle()
    await advance(1500)
    expect(mock.commits).toHaveLength(3)
    expect(sessionWrite(2).notes).toBe('Typed while the earlier write was in flight')
    expect(sessionWrite(2).revision).toBe(sessionWrite(1).revision + 1)
    expect(sessionWrite(2).previousMutationId).toBe(sessionWrite(1).mutationId)
    await confirm(2)
    expect(api().hasPendingWrites).toBe(false)
  })

  it('keeps one session identity when an offline workout is completed before its first cloud acknowledgment', async () => {
    mock.offline = true
    render(tree())
    await settle()
    const id = await start()
    const completed = structuredClone(api().activeSession!)
    completed.exercises[0].sets[0] = {
      ...completed.exercises[0].sets[0],
      weightKg: 30,
      reps: 8,
      completedAt: Date.now(),
    }
    completed.notes = 'Finished offline'
    await act(async () => {
      await api().finishWorkout(completed, 'completed')
    })
    expect(api().sessions).toHaveLength(1)
    expect(api().sessions[0]).toMatchObject({ id, status: 'completed', notes: 'Finished offline' })
    expect(api().hasPendingWrites).toBe(true)
    await advance()
    expect(mock.commits).toHaveLength(1)
    expect(sessionWrite(0)).toMatchObject({ id, status: 'active', revision: 1 })
    await confirm(0)
    await advance(1500)
    expect(mock.commits).toHaveLength(2)
    expect(sessionWrite(1)).toMatchObject({
      id,
      status: 'completed',
      revision: 2,
      completionKey: id,
      notes: 'Finished offline',
    })
    const pointer = mock.commits[1].writes.find((write) =>
      write.path.endsWith('/workoutState/current'),
    )!.value
    expect(pointer).toMatchObject({ activeSessionId: null })
    await confirm(1)
    expect(api().sessions).toHaveLength(1)
    expect(api().activeSession).toBeNull()
    expect(api().hasPendingWrites).toBe(false)
    expect(mock.persisted.size).toBe(0)
  })

  it('keeps a newer cloud version when an older acknowledgment waits behind a device checkpoint', async () => {
    render(tree())
    await settle()
    const id = await start()
    await advance()
    await confirm(0)
    const firstEdit = structuredClone(api().activeSession!)
    firstEdit.notes = 'Earlier submitted edit'
    await act(async () => {
      await api().saveWorkout(firstEdit)
    })
    await advance(1500)
    const submitted = sessionWrite(1)
    let release!: () => void
    let writing = false
    mock.delayPut = async (checkpoint) => {
      if (writing || checkpoint.session.notes !== 'Latest local draft') return
      writing = true
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
    let pending!: Promise<void>
    await act(async () => {
      pending = api().saveWorkout({
        ...structuredClone(api().activeSession!),
        notes: 'Latest local draft',
      })
      await Promise.resolve()
    })
    expect(writing).toBe(true)
    await confirm(1, false)
    const newer = {
      ...submitted,
      revision: submitted.revision + 1,
      previousMutationId: submitted.mutationId,
      mutationId: 'another-device-edit',
      updatedAt: submitted.updatedAt + 1,
      notes: 'Newest cloud edit',
    }
    await act(async () => {
      mock.remote.set(`users/${mock.uid}/workoutSessions/${id}`, newer)
      notifyRemote()
      release()
      await pending
    })
    await settle()
    await act(async () => {
      mock.commits[1].resolve()
    })
    await settle()
    expect(api().activeSession?.notes).toBe('Latest local draft')
    expect(api().rejectedSessions.map((session) => session.id)).toContain(id)
    await act(async () => {
      await api().discardLocalChanges(id)
    })
    expect(api().activeSession).toMatchObject({
      revision: newer.revision,
      mutationId: newer.mutationId,
      notes: 'Newest cloud edit',
    })
  })
})
