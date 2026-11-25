import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EXERCISES } from '../src/data/exercises'
import { createRoutineExercise } from '../src/domain/training/helpers'
import RoutineEditorPage from '../src/features/routines/RoutineEditorPage'
import RoutineListPage from '../src/features/routines/RoutineListPage'
import { defaultPreferences } from '../src/types/profile'
import type { Routine, TrainingData } from '../src/types/training'

const mock = vi.hoisted(() => ({
  training: null as TrainingData | null,
  readDraft: vi.fn(),
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
  weightUnit: 'kg' as 'kg' | 'lb',
}))
vi.mock('../src/services/training/TrainingProvider', () => ({ useTraining: () => mock.training }))
vi.mock('../src/services/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'user-1' },
    account: { preferences: { ...defaultPreferences(), weightUnit: mock.weightUnit } },
  }),
}))
vi.mock('../src/features/routines/draft', () => ({
  readRoutineDraft: mock.readDraft,
  saveRoutineDraft: mock.saveDraft,
  clearRoutineDraft: mock.clearDraft,
}))

const bench = EXERCISES.find((exercise) => exercise.trackingType === 'weight-reps')!
const row = EXERCISES.find(
  (exercise) => exercise.trackingType === 'weight-reps' && exercise.id !== bench.id,
)!
function routine(): Routine {
  return {
    id: 'routine-one',
    name: 'Upper A',
    description: 'Train with intent.',
    targetMuscles: ['Chest'],
    exercises: [createRoutineExercise(bench), createRoutineExercise(row)],
    ownerId: 'user-1',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    schemaVersion: 1,
    revision: 2,
    mutationId: 'mutation-two',
    previousMutationId: 'mutation-one',
  }
}
function renderEditor(path = '/plan/routines/new') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/plan/routines/new" element={<RoutineEditorPage />} />
        <Route path="/plan/routines/:routineId" element={<RoutineEditorPage />} />
        <Route path="/plan/routines" element={<RoutineListPage />} />
      </Routes>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  mock.weightUnit = 'kg'
  mock.readDraft.mockReset().mockResolvedValue(undefined)
  mock.saveDraft.mockReset().mockResolvedValue(undefined)
  mock.clearDraft.mockReset().mockResolvedValue(undefined)
  mock.training = {
    exercises: EXERCISES,
    customExercises: [],
    routines: [],
    splits: [],
    activeSplitId: null,
    loading: false,
    error: null,
    hasPendingWrites: false,
    fromCache: false,
    saveCustomExercise: vi.fn(),
    archiveCustomExercise: vi.fn(),
    saveRoutine: vi.fn().mockResolvedValue('created-routine'),
    archiveRoutine: vi.fn().mockResolvedValue(undefined),
    saveSplit: vi.fn(),
    archiveSplit: vi.fn(),
    setActiveSplit: vi.fn(),
    createSplitFromTemplate: vi.fn(),
    refresh: vi.fn(),
    clearError: vi.fn(),
  }
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('Routine builder', () => {
  it('validates rep ranges before saving while preserving the exercise snapshot', async () => {
    const user = userEvent.setup()
    renderEditor(`/plan/routines/new?exercise=${bench.id}`)
    await user.type(await screen.findByLabelText('Routine name'), 'Push day')
    const minimum = screen.getAllByLabelText('Min reps')[0]
    await user.clear(minimum)
    await user.type(minimum, '20')
    await user.click(screen.getByRole('button', { name: 'Save routine' }))
    expect(await screen.findAllByText('Minimum reps cannot exceed maximum reps.')).not.toHaveLength(
      0,
    )
    expect(mock.training!.saveRoutine).not.toHaveBeenCalled()
    await user.clear(minimum)
    await user.type(minimum, '8')
    await user.click(screen.getByRole('button', { name: 'Save routine' }))
    await waitFor(() => expect(mock.training!.saveRoutine).toHaveBeenCalledTimes(1))
    const saved = vi.mocked(mock.training!.saveRoutine).mock.calls[0][0]
    expect(saved.exercises[0].exerciseSnapshot).toEqual({
      name: bench.name,
      trackingType: bench.trackingType,
      primaryMuscles: bench.primaryMuscles,
      secondaryMuscles: bench.secondaryMuscles,
      equipment: bench.equipment,
      movementPattern: bench.movementPattern,
    })
    expect(saved.exercises[0].exerciseSnapshot).not.toBe(bench)
    expect(mock.clearDraft).not.toHaveBeenCalled()
  })

  it('blocks duplicate submits and retains the same new identifier on retry', async () => {
    let finish!: () => void
    vi.mocked(mock.training!.saveRoutine).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve('new-id')
        }),
    )
    const user = userEvent.setup()
    renderEditor(`/plan/routines/new?exercise=${bench.id}`)
    await user.type(await screen.findByLabelText('Routine name'), 'Push day')
    const form = screen.getByRole('button', { name: 'Save routine' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(mock.training!.saveRoutine).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByLabelText('Routine name')).toBeDisabled()
    const id = vi.mocked(mock.training!.saveRoutine).mock.calls[0][1]!.id
    expect(id).toEqual(expect.any(String))
    fireEvent.submit(form)
    expect(mock.training!.saveRoutine).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(await screen.findByRole('button', { name: 'Save routine' })).toBeEnabled()
    await user.type(screen.getByLabelText('Routine name'), ' revised')
    await user.click(screen.getByRole('button', { name: 'Save routine' }))
    await waitFor(() => expect(mock.training!.saveRoutine).toHaveBeenCalledTimes(2))
    expect(vi.mocked(mock.training!.saveRoutine).mock.calls[1][1]).toEqual({
      id,
      expectedRevision: 1,
    })
  })

  it('duplicates with new entry and set IDs, reorders locally, and saves canonical kg', async () => {
    const original = routine()
    mock.training!.routines = [original]
    mock.weightUnit = 'lb'
    const user = userEvent.setup()
    renderEditor('/plan/routines/new?duplicate=routine-one')
    expect(await screen.findByLabelText('Routine name')).toHaveValue('Upper A copy')
    await user.click(screen.getByRole('button', { name: `Move ${row.name} up` }))
    await user.type(screen.getAllByLabelText(/Weight \(lb\)/)[0], '100')
    await user.click(screen.getByRole('button', { name: 'Save routine' }))
    await waitFor(() => expect(mock.training!.saveRoutine).toHaveBeenCalledTimes(1))
    const saved = vi.mocked(mock.training!.saveRoutine).mock.calls[0][0]
    expect(saved.exercises[0].exerciseId).toBe(row.id)
    expect(saved.exercises[0].sets[0].targetWeightKg).toBeCloseTo(45.3592)
    expect(saved.exercises.map((entry) => entry.id)).not.toEqual(
      original.exercises.map((entry) => entry.id),
    )
    expect(saved.exercises[0].sets[0].id).not.toBe(original.exercises[1].sets[0].id)
    expect(original.name).toBe('Upper A')
    expect(original.exercises[0].exerciseId).toBe(bench.id)
    expect(original.exercises[1].sets[0].targetWeightKg).toBeNull()
  })

  it('restores UID-scoped rejected work without accepting a newer cloud revision', async () => {
    const original = routine()
    const draft = {
      name: 'Recovered routine',
      description: '',
      targetMuscles: [],
      exercises: original.exercises,
    }
    mock.training!.routines = [{ ...original, revision: 3 }]
    mock.readDraft.mockResolvedValue({
      recordId: original.id,
      expectedRevision: 2,
      input: draft,
      savedInput: null,
      savedAt: 10,
    })
    vi.mocked(mock.training!.saveRoutine).mockRejectedValue(
      new Error('This record changed while you were editing.'),
    )
    const user = userEvent.setup()
    renderEditor('/plan/routines/routine-one')
    expect(await screen.findByLabelText('Routine name')).toHaveValue('Recovered routine')
    expect(mock.readDraft).toHaveBeenCalledWith('user-1', 'routine-one')
    expect(screen.getByText(/changed in another tab or device/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save routine' }))
    await waitFor(() =>
      expect(mock.training!.saveRoutine).toHaveBeenCalledWith(draft, {
        id: 'routine-one',
        expectedRevision: 2,
      }),
    )
    expect(await screen.findByText('This record changed while you were editing.')).toBeVisible()
    expect(mock.clearDraft).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Routine name')).toHaveValue('Recovered routine')
  })

  it('offers only available exercises and validates incomplete superset groups', async () => {
    const hidden = { ...row, id: 'hidden-exercise', name: 'Archived movement', archived: true }
    mock.training!.exercises = [bench, hidden]
    const user = userEvent.setup()
    renderEditor()
    await screen.findByLabelText('Routine name')
    await user.click(screen.getByRole('button', { name: 'Add exercise' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText('Archived movement')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: `Add ${bench.name}` }))
    await user.type(screen.getByLabelText('Routine name'), 'Superset test')
    await user.selectOptions(screen.getByLabelText('Superset'), 'A')
    await user.click(screen.getByRole('button', { name: 'Save routine' }))
    expect(
      await screen.findAllByText('A superset must contain at least two exercises.'),
    ).not.toHaveLength(0)
    expect(mock.training!.saveRoutine).not.toHaveBeenCalled()
  })
})

describe('Routine list', () => {
  it('requires an archive confirmation and restores archived records without deleting history', async () => {
    mock.training!.routines = [routine()]
    const user = userEvent.setup()
    renderEditor('/plan/routines')
    await user.click(screen.getByRole('button', { name: 'Archive Upper A' }))
    expect(mock.training!.archiveRoutine).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Archive routine' }))
    await waitFor(() =>
      expect(mock.training!.archiveRoutine).toHaveBeenCalledWith('routine-one', true, 2),
    )
  })
})
