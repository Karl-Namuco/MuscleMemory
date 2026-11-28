import { act, render } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { TrainingProvider, useTraining } from '../src/services/training/TrainingProvider'
import { createRoutineExercise } from '../src/domain/training/helpers'
import { emptyExercise } from '../src/features/exercises/draft'
import type { Exercise, TrainingData } from '../src/types/training'
import type { TrainingRecovery } from '../src/services/training/recovery'

const mock = vi.hoisted(() => ({
  writes: [] as { path: string; value: unknown }[],
  recovery: [] as TrainingRecovery[],
  direct: new Map<string, Exercise>(),
}))
vi.mock('../src/services/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'owner' }, status: 'ready' }),
}))
vi.mock('../src/services/firebase/client', () => ({ getFirebaseServices: () => ({ db: {} }) }))
vi.mock('../src/services/training/recovery', () => ({
  readTrainingRecovery: () => mock.recovery,
  saveTrainingRecovery: vi.fn(),
}))
vi.mock('firebase/firestore', () => ({
  getDoc: vi.fn(async (reference: { path: string }) => {
    const value = mock.direct.get(reference.path)
    return { exists: () => Boolean(value), data: () => value }
  }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/'), query: true }),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/'), query: false }),
  query: (reference: unknown) => reference,
  orderBy: () => ({}),
  limit: () => ({}),
  onSnapshot: (
    reference: { path: string; query: boolean },
    _options: unknown,
    next: (snapshot: unknown) => void,
  ) => {
    let active = true
    queueMicrotask(() => {
      if (active) {
        const value = reference.query ? undefined : mock.direct.get(reference.path)
        next({
          id: reference.path.split('/').at(-1),
          exists: () => Boolean(value),
          data: () => value,
          docs: [],
          size: 0,
          metadata: { hasPendingWrites: false, fromCache: false },
        })
      }
    })
    return () => {
      active = false
    }
  },
  // Deliberately acknowledge without emitting the document's listener snapshot.
  writeBatch: () => ({
    set: (reference: { path: string }, value: unknown) => {
      mock.writes.push({ path: reference.path, value: structuredClone(value) })
    },
    commit: async () => undefined,
  }),
}))

let api: TrainingData
function Probe() {
  api = useTraining()
  return null
}
beforeEach(() => {
  mock.writes = []
  mock.recovery = []
  mock.direct.clear()
})

it('retains a recovered custom exercise when its confirmed direct snapshot precedes the bounded list', async () => {
  const saved: Exercise = {
    ...emptyExercise,
    name: 'Recovered custom row',
    primaryMuscles: ['Lats'],
    id: 'recovered',
    ownerId: 'owner',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    schemaVersion: 1,
    revision: 1,
    mutationId: 'recovered-mutation',
    previousMutationId: null,
    source: 'custom',
  }
  mock.direct.set('users/owner/customExercises/recovered', saved)
  mock.recovery = [
    {
      collection: 'customExercises',
      id: saved.id,
      mutationId: saved.mutationId,
      payload: saved as unknown as Record<string, unknown>,
    },
  ]
  render(
    <TrainingProvider>
      <Probe />
    </TrainingProvider>,
  )
  await act(async () => {
    for (let count = 0; count < 25; count++) await Promise.resolve()
  })
  expect(api.loading).toBe(false)
  expect(api.recoveryCount).toBe(0)
  expect(api.error).toBeNull()
  expect(api.customExercises.map((item) => item.id)).toContain(saved.id)
  await act(async () => {
    await api.saveRoutine({
      name: 'Recovered routine',
      description: '',
      targetMuscles: [],
      exercises: [createRoutineExercise(saved)],
    })
  })
  expect(mock.writes.some((write) => /^users\/owner\/routines\/[^/]+$/.test(write.path))).toBe(true)
})

it('resolves a restored routine custom reference before the bounded exercise list has hydrated', async () => {
  const saved: Exercise = {
    ...emptyExercise,
    name: 'Confirmed personal row',
    primaryMuscles: ['Lats'],
    id: 'confirmed-custom',
    ownerId: 'owner',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    schemaVersion: 1,
    revision: 1,
    mutationId: 'confirmed-mutation',
    previousMutationId: null,
    source: 'custom',
  }
  mock.direct.set(`users/owner/customExercises/${saved.id}`, saved)
  render(
    <TrainingProvider>
      <Probe />
    </TrainingProvider>,
  )
  await act(async () => {
    for (let count = 0; count < 15; count++) await Promise.resolve()
  })
  expect(api.loading).toBe(false)
  expect(api.customExercises).toHaveLength(0)
  await act(async () => {
    await api.saveRoutine({
      name: 'Restored personal routine',
      description: '',
      targetMuscles: [],
      exercises: [createRoutineExercise(saved)],
    })
  })
  expect(api.customExercises.map((item) => item.id)).toContain(saved.id)
  expect(mock.writes.some((write) => /^users\/owner\/routines\/[^/]+$/.test(write.path))).toBe(true)
})

it.each(['another-owner', 'archived'])(
  'rejects an invalid restored custom reference: %s',
  async (condition) => {
    const saved: Exercise = {
      ...emptyExercise,
      name: 'Unavailable personal row',
      primaryMuscles: ['Lats'],
      id: 'invalid-custom',
      ownerId: condition === 'another-owner' ? 'other' : 'owner',
      createdAt: 1,
      updatedAt: 1,
      archived: condition === 'archived',
      schemaVersion: 1,
      revision: 1,
      mutationId: 'invalid-mutation',
      previousMutationId: null,
      source: 'custom',
    }
    mock.direct.set(`users/owner/customExercises/${saved.id}`, saved)
    render(
      <TrainingProvider>
        <Probe />
      </TrainingProvider>,
    )
    await act(async () => {
      for (let count = 0; count < 15; count++) await Promise.resolve()
    })
    await expect(
      api.saveRoutine({
        name: 'Preserved draft',
        description: '',
        targetMuscles: [],
        exercises: [createRoutineExercise(saved)],
      }),
    ).rejects.toThrow(condition === 'another-owner' ? 'ownership' : 'archived')
    expect(mock.writes).toHaveLength(0)
  },
)

it('lets an inline custom exercise be used immediately when acknowledgment precedes its listener', async () => {
  render(
    <TrainingProvider>
      <Probe />
    </TrainingProvider>,
  )
  await act(async () => {
    for (let count = 0; count < 10; count++) await Promise.resolve()
  })
  expect(api.loading).toBe(false)
  const input = { ...emptyExercise, name: 'My custom row', primaryMuscles: ['Lats' as const] }
  let id = ''
  await act(async () => {
    id = await api.saveCustomExercise(input, { id: 'my-exercise', expectedRevision: 0 })
  })
  const saved = mock.writes.find(
    (write) => write.path === 'users/owner/customExercises/my-exercise',
  )!.value as Exercise
  expect(id).toBe('my-exercise')
  expect(api.customExercises.find((exercise) => exercise.id === id)?.name).toBe(input.name)
  await act(async () => {
    await api.saveRoutine({
      name: 'My routine',
      description: '',
      targetMuscles: [],
      exercises: [createRoutineExercise(saved)],
    })
  })
  expect(mock.writes.some((write) => /^users\/owner\/routines\/[^/]+$/.test(write.path))).toBe(true)
})
