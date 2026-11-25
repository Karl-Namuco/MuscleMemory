import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountData } from '../src/types/profile'
import { defaultPreferences } from '../src/types/profile'
import type { Exercise, TrainingData } from '../src/types/training'
import ExerciseLibraryPage from '../src/features/exercises/ExerciseLibraryPage'
import ExerciseDetailPage from '../src/features/exercises/ExerciseDetailPage'
import CustomExercisePage from '../src/features/exercises/CustomExercisePage'
import { emptyExercise, formValues } from '../src/features/exercises/draft'

const mock = vi.hoisted(() => ({
  training: {} as TrainingData,
  account: {} as AccountData,
  saveProfile: vi.fn(),
  readDraft: vi.fn(),
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
}))
vi.mock('../src/services/training/TrainingProvider', () => ({ useTraining: () => mock.training }))
vi.mock('../src/services/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'athlete' },
    account: mock.account,
    saveProfile: mock.saveProfile,
  }),
}))
vi.mock('../src/features/exercises/draft', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/features/exercises/draft')>()),
  readExerciseDraft: mock.readDraft,
  saveExerciseDraft: mock.saveDraft,
  clearExerciseDraft: mock.clearDraft,
  acknowledgeExerciseDrafts: vi.fn().mockResolvedValue(undefined),
}))

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    ...emptyExercise,
    id: 'row',
    name: 'Cable row',
    aliases: ['Seated pull'],
    description: 'A controlled horizontal pull.',
    primaryMuscles: ['Upper back'],
    secondaryMuscles: ['Biceps'],
    equipment: 'Cable',
    movementPattern: 'Horizontal pull',
    source: 'builtin',
    ownerId: 'system',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    schemaVersion: 1,
    revision: 1,
    mutationId: 'initial',
    previousMutationId: null,
    ...overrides,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mock.account = {
    profile: {
      uid: 'athlete',
      displayName: 'Alex',
      onboardingCompleted: true,
      schemaVersion: 1,
      createdAt: 1,
      updatedAt: 2,
    },
    preferences: defaultPreferences(),
    hasPendingWrites: false,
    fromCache: false,
  }
  mock.training = {
    exercises: [
      exercise(),
      exercise({
        id: 'squat',
        name: 'Barbell squat',
        aliases: [],
        primaryMuscles: ['Quadriceps'],
        secondaryMuscles: ['Glutes'],
        equipment: 'Barbell',
      }),
      exercise({
        id: 'archived',
        name: 'Old custom row',
        source: 'custom',
        ownerId: 'athlete',
        archived: true,
      }),
    ],
    customExercises: [],
    routines: [],
    splits: [],
    activeSplitId: null,
    loading: false,
    error: null,
    hasPendingWrites: false,
    fromCache: false,
    recoveryCount: 0,
    downloadRecovery: vi.fn(),
    discardRejectedChanges: vi.fn(),
    saveCustomExercise: vi.fn().mockResolvedValue('new-exercise'),
    archiveCustomExercise: vi.fn().mockResolvedValue(undefined),
    saveRoutine: vi.fn(),
    archiveRoutine: vi.fn(),
    saveSplit: vi.fn(),
    archiveSplit: vi.fn(),
    setActiveSplit: vi.fn(),
    createSplitFromTemplate: vi.fn(),
    refresh: vi.fn(),
    clearError: vi.fn(),
  }
  mock.readDraft.mockResolvedValue(undefined)
  mock.saveDraft.mockResolvedValue(undefined)
  mock.clearDraft.mockResolvedValue(undefined)
  mock.saveProfile.mockResolvedValue(undefined)
})

describe('Exercise library', () => {
  it('searches alternate names and combines secondary-muscle and equipment filters', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ExerciseLibraryPage />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('heading', { name: 'Old custom row' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Search exercises'), 'seated')
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Barbell squat' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('heading', { name: 'Cable row' })).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Muscle group'), 'Biceps')
    await user.selectOptions(screen.getByLabelText('Muscle involvement'), 'secondary')
    await user.selectOptions(screen.getByLabelText('Equipment'), 'Barbell')
    expect(screen.getByText('No matching movements')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('heading', { name: 'Barbell squat' })).toBeVisible()
    await user.click(screen.getByLabelText('Include archived exercises'))
    expect(screen.getByRole('heading', { name: 'Old custom row' })).toBeVisible()
  })

  it('saves favorites while preserving all profile preferences', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ExerciseLibraryPage />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Add Cable row to favorites' }))
    expect(mock.saveProfile).toHaveBeenCalledExactlyOnceWith({
      displayName: 'Alex',
      onboardingCompleted: true,
      preferences: { ...mock.account.preferences, favoriteExercises: ['Cable row'] },
    })
  })

  it('shows an actionable limit instead of overwriting existing favorites', async () => {
    mock.account.preferences.favoriteExercises = Array.from(
      { length: 10 },
      (_, index) => `Favorite ${index}`,
    )
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ExerciseLibraryPage />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Add Cable row to favorites' }))
    expect(screen.getByRole('alert')).toHaveTextContent('up to 10 favorite exercises')
    expect(mock.saveProfile).not.toHaveBeenCalled()
  })
})

describe('Custom exercise editor', () => {
  function renderEditor(path = '/exercises/new') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/exercises/new" element={<CustomExercisePage />} />
          <Route path="/exercises/:exerciseId/edit" element={<CustomExercisePage />} />
          <Route path="/exercises/:exerciseId" element={<p>Saved exercise detail</p>} />
        </Routes>
      </MemoryRouter>,
    )
  }
  it('validates required input before saving', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(await screen.findByRole('button', { name: 'Save exercise' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Review the highlighted fields')
    expect(screen.getByLabelText('Exercise name', { exact: false })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(mock.training.saveCustomExercise).not.toHaveBeenCalled()
  })

  it('retains the same identifier and revision after a failed save and retry', async () => {
    vi.mocked(mock.training.saveCustomExercise)
      .mockRejectedValueOnce(new Error('Reconnect and try again.'))
      .mockResolvedValueOnce('new-exercise')
    const user = userEvent.setup()
    renderEditor()
    await user.type(await screen.findByLabelText('Exercise name', { exact: false }), 'My cable row')
    await user.type(screen.getByLabelText('Alternate names'), 'One-arm pull, unilateral row')
    await user.click(
      within(screen.getByRole('group', { name: /Primary muscles/ })).getByRole('button', {
        name: 'Lats',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Save exercise' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect and try again.')
    await user.click(screen.getByRole('button', { name: 'Save exercise' }))
    await screen.findByText('Saved exercise detail')
    const calls = vi.mocked(mock.training.saveCustomExercise).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][1]).toEqual(calls[1][1])
    expect(calls[0][1]).toMatchObject({ expectedRevision: 0 })
    expect(calls[0][0]).toMatchObject({
      name: 'My cable row',
      primaryMuscles: ['Lats'],
      aliases: ['One-arm pull', 'unilateral row'],
    })
    expect(mock.saveDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ uid: 'athlete', pending: true, id: calls[0][1]?.id }),
    )
  })

  it('restores an interrupted edit with its original base revision', async () => {
    const custom = exercise({ id: 'custom-row', source: 'custom', ownerId: 'athlete', revision: 5 })
    mock.training.exercises.push(custom)
    mock.readDraft.mockResolvedValue({
      key: 'athlete:custom-row',
      uid: 'athlete',
      id: 'custom-row',
      expectedRevision: 3,
      values: formValues({ ...custom, name: 'Recovered row' }),
      pending: false,
      savedAt: 123,
    })
    const user = userEvent.setup()
    renderEditor('/exercises/custom-row/edit')
    expect(await screen.findByDisplayValue('Recovered row')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('account copy has changed')
    await user.click(screen.getByRole('button', { name: 'Save exercise' }))
    await waitFor(() =>
      expect(mock.training.saveCustomExercise).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Recovered row' }),
        { id: 'custom-row', expectedRevision: 3 },
      ),
    )
  })
})

describe('Custom exercise archival', () => {
  it('requires confirmation and passes the current revision to the archive operation', async () => {
    mock.training.exercises = [
      exercise({ id: 'custom', source: 'custom', ownerId: 'athlete', revision: 4 }),
    ]
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/exercises/custom']}>
        <Routes>
          <Route path="/exercises/:exerciseId" element={<ExerciseDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Archive exercise' }))
    expect(mock.training.archiveCustomExercise).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Archive this exercise?' })
    expect(dialog).toHaveTextContent('Existing routines and exercise history will be preserved')
    await user.click(within(dialog).getByRole('button', { name: 'Archive exercise' }))
    await waitFor(() =>
      expect(mock.training.archiveCustomExercise).toHaveBeenCalledExactlyOnceWith(
        'custom',
        true,
        4,
      ),
    )
  })
})
