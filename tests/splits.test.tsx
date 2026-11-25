import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SplitsPage from '../src/features/splits/SplitsPage'
import { EXERCISES } from '../src/data/exercises'
import { createRoutineExercise } from '../src/domain/training/helpers'
import { defaultPreferences } from '../src/types/profile'
import type { Routine, TrainingData, TrainingSplit } from '../src/types/training'

const mock = vi.hoisted(() => ({
  training: null as TrainingData | null,
  read: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
}))
vi.mock('../src/services/training/TrainingProvider', () => ({ useTraining: () => mock.training }))
vi.mock('../src/services/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'alex' }, account: { preferences: defaultPreferences() } }),
}))
vi.mock('../src/features/splits/draft', () => ({
  readSplitDraft: mock.read,
  saveSplitDraft: mock.save,
  clearSplitDraft: mock.clear,
}))
const metadata = {
  ownerId: 'alex',
  createdAt: 1,
  updatedAt: 2,
  archived: false,
  schemaVersion: 1 as const,
  revision: 2,
  mutationId: 'revision-two',
  previousMutationId: 'revision-one',
}
const routine: Routine = {
  ...metadata,
  id: 'routine-one',
  name: 'Upper A',
  description: '',
  targetMuscles: ['Chest'],
  exercises: [createRoutineExercise(EXERCISES[0])],
}
const split: TrainingSplit = {
  ...metadata,
  id: 'split-one',
  name: 'Latest split',
  description: '',
  mode: 'rolling',
  slots: [
    { id: 'training', label: 'Train', routineId: routine.id, isRestDay: false },
    { id: 'rest', label: 'Recover', routineId: null, isRestDay: true },
  ],
}
const show = () =>
  render(
    <MemoryRouter>
      <SplitsPage />
    </MemoryRouter>,
  )
beforeEach(() => {
  mock.read.mockReset().mockResolvedValue(undefined)
  mock.save.mockReset().mockResolvedValue(undefined)
  mock.clear.mockReset().mockResolvedValue(undefined)
  mock.training = {
    exercises: EXERCISES,
    customExercises: [],
    routines: [routine],
    splits: [split],
    activeSplitId: split.id,
    loading: false,
    error: null,
    hasPendingWrites: false,
    fromCache: false,
    recoveryCount: 0,
    downloadRecovery: vi.fn(),
    discardRejectedChanges: vi.fn(),
    saveCustomExercise: vi.fn(),
    archiveCustomExercise: vi.fn(),
    saveRoutine: vi.fn(),
    archiveRoutine: vi.fn(),
    saveSplit: vi.fn().mockResolvedValue('new-split'),
    archiveSplit: vi.fn().mockResolvedValue(undefined),
    setActiveSplit: vi.fn().mockResolvedValue(undefined),
    createSplitFromTemplate: vi.fn(),
    refresh: vi.fn(),
    clearError: vi.fn(),
  }
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('Split configuration', () => {
  it('reorders training and rest slots and retains a failed new save for retry', async () => {
    vi.mocked(mock.training!.saveSplit)
      .mockRejectedValueOnce(new Error('Reconnect and retry.'))
      .mockResolvedValueOnce('new-split')
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'New split' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create a split' })
    fireEvent.change(within(dialog).getByLabelText('Split name'), {
      target: { value: 'My sequence' },
    })
    fireEvent.change(within(dialog).getByLabelText('Slot 1 label'), { target: { value: 'Upper' } })
    await user.selectOptions(within(dialog).getByLabelText('Routine for slot 1'), routine.id)
    await user.click(within(dialog).getByRole('button', { name: 'Add slot' }))
    fireEvent.change(within(dialog).getByLabelText('Slot 2 label'), { target: { value: 'Rest' } })
    await user.click(within(dialog).getAllByLabelText('Rest day')[1])
    await user.click(within(dialog).getByRole('button', { name: 'Move slot 2 up' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save split' }))
    expect(await screen.findByText('Reconnect and retry.')).toBeVisible()
    const firstCall = vi.mocked(mock.training!.saveSplit).mock.calls[0]
    expect(firstCall[0].slots.map((slot) => slot.isRestDay)).toEqual([true, false])
    await user.click(within(dialog).getByRole('button', { name: 'Save split' }))
    expect(vi.mocked(mock.training!.saveSplit).mock.calls[1][1]).toEqual(firstCall[1])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('preserves stale work and explicitly reloads both the latest values and revision', async () => {
    mock.read.mockResolvedValueOnce({
      uid: 'alex',
      id: split.id,
      sourceId: split.id,
      expectedRevision: 1,
      input: {
        name: 'Unfinished older edit',
        description: '',
        mode: 'rolling',
        slots: split.slots,
      },
      savedAt: 10,
    })
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'Edit split' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit your split' })
    expect(within(dialog).getByLabelText('Split name')).toHaveValue('Unfinished older edit')
    await user.click(within(dialog).getByRole('button', { name: 'Save split' }))
    expect(mock.training!.saveSplit).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft and load latest' }))
    await waitFor(() => expect(screen.getByLabelText('Split name')).toHaveValue(split.name))
    expect(mock.clear).toHaveBeenCalledWith('alex', split.id)
    await user.click(screen.getByRole('button', { name: 'Save split' }))
    await waitFor(() =>
      expect(mock.training!.saveSplit).toHaveBeenCalledWith(
        expect.objectContaining({ name: split.name }),
        { id: split.id, expectedRevision: 2 },
      ),
    )
  })

  it('duplicates slot identifiers and confirms archive without deleting routines', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'Duplicate Latest split' }))
    await screen.findByRole('dialog', { name: 'Create a split' })
    await user.click(screen.getByRole('button', { name: 'Save split' }))
    const [input, options] = vi.mocked(mock.training!.saveSplit).mock.calls[0]
    expect(options?.id).not.toBe(split.id)
    expect(input.slots.map((slot) => slot.routineId)).toEqual(
      split.slots.map((slot) => slot.routineId),
    )
    for (const slot of input.slots)
      expect(split.slots.map((item) => item.id)).not.toContain(slot.id)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Archive Latest split' }))
    expect(mock.training!.archiveSplit).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Archive split' }))
    expect(mock.training!.archiveSplit).toHaveBeenCalledWith(split.id, true, split.revision)
    expect(mock.training!.archiveRoutine).not.toHaveBeenCalled()
  })
})
