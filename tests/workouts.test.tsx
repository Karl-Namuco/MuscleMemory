import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EXERCISES } from '../src/data/exercises'
import { createRoutineExercise } from '../src/domain/training/helpers'
import { createWorkoutSession } from '../src/domain/workout/helpers'
import ActiveWorkoutPage from '../src/features/workouts/ActiveWorkoutPage'
import TrainPage from '../src/features/workouts/TrainPage'
import WorkoutHistoryPage from '../src/features/workouts/WorkoutHistoryPage'
import { defaultPreferences } from '../src/types/profile'
import type { Routine, TrackingType } from '../src/types/training'
import type { WorkoutSession } from '../src/types/workout'

const mock = vi.hoisted(() => ({
  routines: [] as Routine[],
  sessions: [] as WorkoutSession[],
  active: null as WorkoutSession | null,
  save: vi.fn<(session: WorkoutSession) => Promise<void>>(),
  start: vi.fn<(routine: Routine) => Promise<string>>(),
  finish: vi.fn<(session: WorkoutSession, status: 'completed' | 'abandoned') => Promise<void>>(),
  retry: vi.fn(),
  download: vi.fn(),
  pending: false,
  cached: false,
  writable: true,
  error: null as string | null,
  unit: 'kg' as 'kg' | 'lb',
}))
vi.mock('../src/services/training/TrainingProvider', () => ({
  useTraining: () => ({ routines: mock.routines, exercises: EXERCISES, loading: false }),
}))
vi.mock('../src/services/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'test-user' },
    account: { preferences: { ...defaultPreferences(), weightUnit: mock.unit } },
  }),
}))
vi.mock('../src/services/workouts/WorkoutProvider', () => ({
  useWorkouts: () => ({
    sessions: mock.sessions,
    activeSession: mock.active,
    loading: false,
    error: mock.error,
    hasPendingWrites: mock.pending,
    fromCache: mock.cached,
    writable: mock.writable,
    startWorkout: mock.start,
    saveWorkout: mock.save,
    finishWorkout: mock.finish,
    retrySync: mock.retry,
    downloadRecovery: mock.download,
  }),
}))

function routine(trackingTypes: TrackingType[] = ['weight-reps']): Routine {
  return {
    id: 'routine-test',
    ownerId: 'test-user',
    name: 'Upper session',
    description: 'Steady work.',
    targetMuscles: [],
    exercises: trackingTypes.map((tracking) => {
      const entry = createRoutineExercise(
        EXERCISES.find((exercise) => exercise.trackingType === tracking)!,
      )
      return { ...entry, sets: entry.sets.slice(0, 1) }
    }),
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    schemaVersion: 1,
    revision: 1,
    mutationId: 'routine-mutation',
    previousMutationId: null,
  }
}

function active(types?: TrackingType[]) {
  const session = createWorkoutSession(routine(types), 'test-user', null, Date.now() - 1000)
  mock.sessions = [session]
  mock.active = session
  return session
}

function app(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/train" element={<TrainPage />} />
        <Route path="/train/:sessionId" element={<ActiveWorkoutPage />} />
        <Route path="/history" element={<WorkoutHistoryPage />} />
        <Route path="/history/:sessionId" element={<WorkoutHistoryPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function actual(label: string, value: string, index = 0) {
  fireEvent.change(screen.getAllByLabelText(label)[index], { target: { value } })
}

function latestSaved() {
  return mock.save.mock.calls.at(-1)![0]
}

beforeEach(() => {
  mock.routines = [routine()]
  mock.sessions = []
  mock.active = null
  mock.unit = 'kg'
  mock.error = null
  mock.pending = false
  mock.cached = false
  mock.writable = true
  mock.save.mockReset().mockResolvedValue(undefined)
  mock.start.mockReset().mockResolvedValue('new-session')
  mock.finish.mockReset().mockResolvedValue(undefined)
  mock.retry.mockReset()
  mock.download.mockReset()
})

describe('Workout logger', () => {
  it('disables logging and starting a workout while another tab owns the writer lock', () => {
    mock.writable = false
    const view = render(app('/train'))
    expect(screen.getByRole('button', { name: /Start workout:/ })).toBeDisabled()
    view.unmount()
    const session = active()
    render(app(`/train/${session.id}`))
    expect(screen.getByLabelText('Weight (kg)')).toBeDisabled()
    expect(screen.getByLabelText('Workout notes (optional)')).toBeDisabled()
    expect(screen.getByLabelText('Exercise notes (optional)')).toBeDisabled()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: /Add set to/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'End early' })).toBeDisabled()
    expect(mock.save).not.toHaveBeenCalled()
  })
  it('starts a routine once and offers the existing workout instead of a second start', async () => {
    const session = active()
    render(app('/train'))
    expect(screen.getByRole('link', { name: /Resume workout/ })).toHaveAttribute(
      'href',
      `/train/${session.id}`,
    )
    expect(screen.getByRole('button', { name: /Start workout:/ })).toBeDisabled()
    expect(mock.start).not.toHaveBeenCalled()
  })

  it('prevents duplicate start submissions while the local checkpoint is saving', async () => {
    let resolve!: (id: string) => void
    mock.start.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    render(app('/train'))
    const button = screen.getByRole('button', { name: /Start workout:/ })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mock.start).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    await act(async () => resolve('new-session'))
  })

  it('requires actual values and completes only the explicitly checked set', async () => {
    const session = active(['weight-reps', 'reps'])
    render(app(`/train/${session.id}`))
    const checkbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(checkbox)
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter valid actual values')
    expect(checkbox).not.toBeChecked()
    expect(mock.save).not.toHaveBeenCalled()
    actual('Weight (kg)', '45')
    actual('Reps', '8')
    fireEvent.click(checkbox)
    const saved = latestSaved()
    expect(saved.exercises[0].sets[0]).toMatchObject({
      weightKg: 45,
      reps: 8,
      completedAt: expect.any(Number),
    })
    expect(saved.exercises[1].sets[0].completedAt).toBeNull()
    expect(saved.timerEndAt).toBeGreaterThan(Date.now())
    expect(checkbox).toBeChecked()
    expect(screen.getByLabelText('Weight (kg)')).toBeDisabled()
    expect(
      screen.getByRole('button', { name: `Substitute ${session.exercises[0].snapshot.name}` }),
    ).toBeDisabled()
    await act(async () => undefined)
  })

  it('renders the actual inputs for all five tracking types and converts pounds to canonical kg', async () => {
    mock.unit = 'lb'
    const session = active([
      'weight-reps',
      'reps',
      'assisted-reps',
      'duration',
      'distance-duration',
    ])
    render(app(`/train/${session.id}`))
    expect(screen.getByLabelText('Weight (lb)')).toHaveValue(null)
    expect(screen.getByLabelText('Assistance (lb)')).toHaveValue(null)
    expect(screen.getAllByLabelText('Duration (sec)')).toHaveLength(2)
    expect(screen.getByLabelText('Distance (m)')).toHaveValue(null)
    actual('Weight (lb)', '100')
    actual('Reps', '10')
    actual('Assistance (lb)', '20')
    actual('Reps', '6', 2)
    actual('Duration (sec)', '45')
    actual('Duration (sec)', '120', 1)
    actual('Distance (m)', '500')
    expect(latestSaved().exercises[0].sets[0].weightKg).toBeCloseTo(45.3592, 4)
    expect(latestSaved().exercises[2].sets[0].weightKg).toBeCloseTo(9.0718, 4)
    expect(latestSaved().exercises[3].sets[0].durationSeconds).toBe(45)
    expect(latestSaved().exercises[4].sets[0]).toMatchObject({
      durationSeconds: 120,
      distanceMeters: 500,
    })
    await act(async () => undefined)
  })

  it.each<TrackingType>(['reps', 'assisted-reps', 'duration', 'distance-duration'])(
    'validates actual fields for %s completion',
    async (tracking) => {
      const session = active([tracking])
      render(app(`/train/${session.id}`))
      const checkbox = screen.getByRole('checkbox')
      fireEvent.click(checkbox)
      expect(checkbox).not.toBeChecked()
      if (tracking === 'reps' || tracking === 'assisted-reps') actual('Reps', '8')
      if (tracking === 'assisted-reps') actual('Assistance (kg)', '15')
      if (tracking === 'duration' || tracking === 'distance-duration')
        actual('Duration (sec)', '60')
      if (tracking === 'distance-duration') actual('Distance (m)', '200')
      fireEvent.click(checkbox)
      expect(checkbox).toBeChecked()
      expect(latestSaved().exercises[0].sets[0].completedAt).toEqual(expect.any(Number))
      await act(async () => undefined)
    },
  )

  it('preserves typed input when a live sync snapshot arrives and checkpoints the last edit before navigation', async () => {
    const session = active()
    const view = render(app(`/train/${session.id}`))
    actual('Weight (kg)', '52')
    mock.sessions = [
      {
        ...session,
        notes: 'Remote version',
        exercises: session.exercises.map((entry) => ({ ...entry, notes: 'Remote exercise notes' })),
      },
    ]
    view.rerender(app(`/train/${session.id}`))
    expect(screen.getByLabelText('Weight (kg)')).toHaveValue(52)
    fireEvent.change(screen.getByLabelText('Workout notes (optional)'), {
      target: { value: 'Last edit before leaving' },
    })
    view.unmount()
    expect(latestSaved().notes).toBe('Last edit before leaving')
    expect(latestSaved().exercises[0].sets[0].weightKg).toBe(52)
    await act(async () => undefined)
  })

  it('substitutes explicitly and clears incomplete actuals without changing the routine', async () => {
    const session = active()
    const originalExerciseId = session.exercises[0].exerciseId
    const replacement = EXERCISES.find((exercise) => exercise.trackingType === 'duration')!
    const user = userEvent.setup()
    render(app(`/train/${session.id}`))
    actual('Weight (kg)', '30')
    await user.click(screen.getByRole('button', { name: /Substitute / }))
    await user.type(screen.getByLabelText('Search exercises'), replacement.name)
    await user.click(screen.getByRole('button', { name: new RegExp(replacement.name) }))
    expect(screen.getByRole('dialog')).toHaveTextContent('incomplete actual values')
    await user.click(screen.getByRole('button', { name: 'Use replacement' }))
    expect(latestSaved().exercises[0]).toMatchObject({
      exerciseId: replacement.id,
      originalExerciseId,
      snapshot: { name: replacement.name },
    })
    expect(latestSaved().exercises[0].sets[0]).toMatchObject({
      weightKg: null,
      reps: null,
      durationSeconds: null,
      completedAt: null,
    })
    expect(mock.routines[0].exercises[0].exerciseId).toBe(originalExerciseId)
    expect(screen.getByLabelText('Duration (sec)')).toHaveValue(null)
  })

  it('limits actual sets to twelve and confirms removal without changing the planned snapshot', async () => {
    const session = active()
    const planned = structuredClone(session.exercises[0].plannedSets)
    render(app(`/train/${session.id}`))
    const add = screen.getByRole('button', { name: /Add set to/ })
    for (let i = 0; i < 11; i += 1) fireEvent.click(add)
    expect(add).toBeDisabled()
    expect(latestSaved().exercises[0].sets).toHaveLength(12)
    fireEvent.click(
      screen.getByRole('button', {
        name: `Remove set 1 from ${session.exercises[0].snapshot.name}`,
      }),
    )
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'entered values and completion will be removed',
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove set' }))
    expect(latestSaved().exercises[0].sets).toHaveLength(11)
    expect(latestSaved().exercises[0].plannedSets).toEqual(planned)
    expect(add).toBeEnabled()
  })

  it('shows a partial finish confirmation and retains incomplete sets in the final session', async () => {
    const session = active(['weight-reps', 'reps'])
    const user = userEvent.setup()
    render(app(`/train/${session.id}`))
    actual('Weight (kg)', '40')
    actual('Reps', '8')
    await user.click(screen.getAllByRole('checkbox')[0])
    await user.click(screen.getAllByRole('button', { name: 'Finish workout' })[0])
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('1 of 2 sets completed')
    expect(dialog).toHaveTextContent('1 sets are incomplete')
    await user.click(within(dialog).getByRole('button', { name: 'Finish and save' }))
    expect(mock.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        exercises: expect.arrayContaining([
          expect.objectContaining({ sets: [expect.objectContaining({ completedAt: null })] }),
        ]),
      }),
      'completed',
    )
  })

  it('ends early while preserving performed data and session notes', async () => {
    const session = active()
    const user = userEvent.setup()
    render(app(`/train/${session.id}`))
    actual('Weight (kg)', '25')
    actual('Reps', '5')
    await user.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText('Workout notes (optional)'), {
      target: { value: 'Had to leave early' },
    })
    await user.click(screen.getByRole('button', { name: 'End early' }))
    await user.click(screen.getByRole('button', { name: 'End early and keep work' }))
    expect(mock.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: 'Had to leave early',
        exercises: [
          expect.objectContaining({
            sets: [
              expect.objectContaining({ reps: 5, weightKg: 25, completedAt: expect.any(Number) }),
            ],
          }),
        ],
      }),
      'abandoned',
    )
  })

  it('resumes the remaining rest time from its persisted timestamp after reload', async () => {
    const session = active()
    const timestamp = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(timestamp)
    session.timerEndAt = timestamp + 42000
    const view = render(app(`/train/${session.id}`))
    expect(
      within(screen.getByRole('region', { name: 'Rest timer' })).getByText('0:42'),
    ).toBeInTheDocument()
    view.unmount()
    vi.spyOn(Date, 'now').mockReturnValue(timestamp + 30000)
    render(app(`/train/${session.id}`))
    expect(
      within(screen.getByRole('region', { name: 'Rest timer' })).getByText('0:12'),
    ).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: '+30 seconds' }))
    expect(latestSaved().timerEndAt).toBe(timestamp + 72000)
  })

  it('shows only completed previous sets for the actual exercise performed', () => {
    const session = active()
    const previous = structuredClone(session)
    previous.id = 'previous-session'
    previous.status = 'completed'
    previous.endedAt = session.startedAt - 10000
    previous.startedAt = session.startedAt - 20000
    previous.exercises[0].sets[0] = {
      ...previous.exercises[0].sets[0],
      weightKg: 35,
      reps: 9,
      completedAt: previous.startedAt + 1000,
    }
    previous.exercises[0].sets.push({
      ...previous.exercises[0].sets[0],
      id: 'unfinished',
      weightKg: 999,
      reps: 99,
      completedAt: null,
    })
    mock.sessions.push(previous)
    render(app(`/train/${session.id}`))
    expect(screen.getByText('35 kg × 9 reps')).toBeInTheDocument()
    expect(screen.queryByText('999 kg × 99 reps')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View previous workout' })).toHaveAttribute(
      'href',
      '/history/previous-session',
    )
  })

  it('keeps failed local edits visible and retries the same values', async () => {
    const session = active()
    mock.save.mockRejectedValueOnce(new Error('Device storage is unavailable.'))
    const user = userEvent.setup()
    render(app(`/train/${session.id}`))
    actual('Weight (kg)', '55')
    expect(await screen.findByRole('alert')).toHaveTextContent('Device storage is unavailable')
    expect(screen.getByLabelText('Weight (kg)')).toHaveValue(55)
    await user.click(screen.getByRole('link', { name: /Back to training/ }))
    expect(screen.getByLabelText('Weight (kg)')).toHaveValue(55)
    expect(screen.getByText(/Your latest edits have not been saved/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry saving on this device' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(latestSaved().exercises[0].sets[0].weightKg).toBe(55)
  })

  it('restores editor-only values after in-app back navigation when device saving failed', async () => {
    const session = active()
    mock.save.mockRejectedValueOnce(new Error('Device storage is unavailable.'))
    const view = render(app(`/train/${session.id}`))
    actual('Weight (kg)', '62')
    expect(await screen.findByRole('alert')).toHaveTextContent('Device storage is unavailable')
    view.unmount()
    render(app(`/train/${session.id}`))
    expect(screen.getByLabelText('Weight (kg)')).toHaveValue(62)
    expect(screen.getByRole('alert')).toHaveTextContent('Device storage is unavailable')
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Retry saving on this device' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})

describe('Workout history', () => {
  it('renders frozen actual exercise details and excludes incomplete sets from totals', () => {
    const session = createWorkoutSession(routine(), 'test-user', null, Date.now() - 5000)
    session.status = 'completed'
    session.endedAt = Date.now()
    session.elapsedSeconds = 120
    session.exercises[0].snapshot.name = 'Original saved exercise name'
    session.exercises[0].sets[0] = {
      ...session.exercises[0].sets[0],
      weightKg: 40,
      reps: 10,
      completedAt: Date.now() - 1000,
    }
    session.exercises[0].sets.push({
      ...session.exercises[0].sets[0],
      id: 'incomplete-extra',
      weightKg: 1000,
      reps: 100,
      completedAt: null,
    })
    mock.sessions = [session]
    render(app(`/history/${session.id}`))
    expect(
      screen.getByRole('heading', { name: 'Original saved exercise name' }),
    ).toBeInTheDocument()
    expect(screen.getByText('400 kg')).toBeInTheDocument()
    expect(screen.getByText('Incomplete · excluded from totals')).toBeInTheDocument()
    expect(screen.getByText('40 kg × 10 reps')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('distinguishes a device checkpoint from a cloud confirmed workout', () => {
    mock.pending = true
    render(app('/history'))
    expect(screen.getByRole('status')).toHaveTextContent('waiting for cloud confirmation')
    expect(screen.queryByText('Changes synced')).not.toBeInTheDocument()
  })
})
