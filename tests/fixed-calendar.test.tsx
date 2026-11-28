import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EXERCISES } from '../src/data/exercises'
import { createFixedSchedule } from '../src/domain/scheduling/fixed'
import { createRoutineExercise } from '../src/domain/training/helpers'
import { createWorkoutSession } from '../src/domain/workout/helpers'
import FixedCalendarPage from '../src/features/plan/FixedCalendarPage'
import NextWorkoutRecommendation from '../src/features/workouts/NextWorkoutRecommendation'
import { defaultPreferences } from '../src/types/profile'
import type { FixedSchedule } from '../src/types/fixedScheduling'
import type { Routine, TrainingSplit } from '../src/types/training'
import type { WorkoutSession } from '../src/types/workout'

const mock = vi.hoisted(() => ({
  routines: [] as Routine[],
  splits: [] as TrainingSplit[],
  calendars: [] as FixedSchedule[],
  activeSplitId: 'fixed-split' as string | null,
  activeSession: null as WorkoutSession | null,
  loading: false,
  workoutLoading: false,
  trainingPending: false,
  workoutPending: false,
  trainingError: null as string | null,
  workoutError: null as string | null,
  writable: true,
  build: vi.fn(),
  edit: vi.fn(),
  start: vi.fn(),
}))
vi.mock('../src/services/training/TrainingProvider', () => ({
  useTraining: () => ({
    routines: mock.routines,
    splits: mock.splits,
    activeSplitId: mock.activeSplitId,
    fixedSchedules: mock.calendars,
    loading: mock.loading,
    hasPendingWrites: mock.trainingPending,
    error: mock.trainingError,
    buildFixedSchedule: mock.build,
    editFixedSchedule: mock.edit,
  }),
}))
vi.mock('../src/services/workouts/WorkoutProvider', () => ({
  useWorkouts: () => ({
    activeSession: mock.activeSession,
    loading: mock.workoutLoading,
    hasPendingWrites: mock.workoutPending,
    error: mock.workoutError,
    writable: mock.writable,
    startWorkout: mock.start,
  }),
}))
vi.mock('../src/services/auth/AuthProvider', () => ({
  useAuth: () => ({
    account: {
      preferences: {
        ...defaultPreferences(),
        timeZone: 'Asia/Manila',
        preferredDays: [1, 3, 5],
        weekStartsOn: 1,
      },
    },
  }),
}))

const now = Date.parse('2026-11-25T04:00:00Z')
function calendar(startDate = '2026-11-23') {
  return createFixedSchedule({
    split: mock.splits[0],
    routines: mock.routines,
    startDate,
    timeZone: 'Asia/Manila',
    preferredDays: [1, 3, 5],
    generationId: 'fixed-generation',
    now,
  })
}
function app(recommendation = false) {
  return (
    <MemoryRouter initialEntries={['/plan/calendar']}>
      <Routes>
        <Route
          path="/plan/calendar"
          element={recommendation ? <NextWorkoutRecommendation /> : <FixedCalendarPage />}
        />
        <Route path="/train/:id" element={<p>Workout started</p>} />
      </Routes>
    </MemoryRouter>
  )
}
function occurrence(label = 'Upper', date = '2026-11-23') {
  return screen.getAllByRole('article', { name: `${label} on ${date}` })[0]
}
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const metadata = {
    ownerId: 'fixed-user',
    createdAt: now,
    updatedAt: now,
    archived: false,
    schemaVersion: 1 as const,
    revision: 1,
    mutationId: 'seed-mutation',
    previousMutationId: null,
  }
  mock.routines = [
    {
      ...metadata,
      id: 'fixed-routine',
      name: 'Strength session',
      description: '',
      targetMuscles: [],
      exercises: [createRoutineExercise(EXERCISES[0])],
    },
  ]
  mock.splits = [
    {
      ...metadata,
      id: 'fixed-split',
      name: 'Dated strength',
      description: '',
      mode: 'fixed',
      slots: [
        { id: 'upper', label: 'Upper', routineId: 'fixed-routine', isRestDay: false },
        { id: 'rest', label: 'Recovery', routineId: null, isRestDay: true },
        { id: 'lower', label: 'Lower', routineId: 'fixed-routine', isRestDay: false },
      ],
    },
  ]
  mock.calendars = [calendar()]
  mock.activeSplitId = 'fixed-split'
  mock.activeSession = null
  mock.loading = false
  mock.workoutLoading = false
  mock.trainingPending = false
  mock.workoutPending = false
  mock.trainingError = null
  mock.workoutError = null
  mock.writable = true
  mock.build.mockReset().mockResolvedValue(undefined)
  mock.edit.mockReset().mockResolvedValue(undefined)
  mock.start.mockReset().mockResolvedValue('fixed-session')
})

describe('Fixed calendar', () => {
  it('creates a calendar from the selected dates, weekdays, and account timezone', async () => {
    mock.calendars = []
    render(app())
    const user = userEvent.setup()
    fireEvent.change(screen.getByLabelText('Calendar start date'), {
      target: { value: '2026-11-30' },
    })
    await user.click(screen.getByRole('checkbox', { name: 'Tuesday' }))
    await user.click(screen.getByRole('button', { name: 'Create calendar' }))
    expect(mock.build).toHaveBeenCalledWith({
      splitId: 'fixed-split',
      startDate: '2026-11-30',
      timeZone: 'Asia/Manila',
      preferredDays: [1, 3, 5, 2],
      expectedRevision: undefined,
    })
    expect(screen.getByRole('status')).toHaveTextContent('Calendar saved on this device')
  })

  it('shows today, the full week, missed training, and past rest without marking rest overdue', async () => {
    render(app())
    const today = screen.getByRole('region', { name: 'Today, 2026-11-25' })
    expect(within(today).getByText('Lower')).toBeInTheDocument()
    expect(within(today).getByRole('time')).toHaveAttribute('aria-current', 'date')
    expect(screen.getByRole('region', { name: 'Missed workouts' })).toHaveTextContent('Upper')
    expect(occurrence()).toHaveTextContent('Overdue')
    expect(occurrence('Recovery', '2026-11-24')).not.toHaveTextContent('Overdue')
    expect(screen.getByRole('region', { name: 'Calendar day, 2026-11-26' })).toHaveTextContent(
      'No workout scheduled',
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByRole('heading', { name: 'Week of 2026-11-30' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(screen.getByRole('heading', { name: 'Week of 2026-11-23' })).toBeInTheDocument()
  })

  it('moves a planned occurrence using the reviewed revision', async () => {
    render(app())
    const user = userEvent.setup()
    await user.click(within(occurrence()).getByRole('button', { name: 'Move' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Save change' })).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('New date'), {
      target: { value: '2026-11-26' },
    })
    await user.click(within(dialog).getByRole('button', { name: 'Save change' }))
    expect(mock.edit).toHaveBeenCalledWith('fixed-split', 1, {
      kind: 'move',
      occurrenceId: 'fixed-generation_0',
      date: '2026-11-26',
    })
  })

  it('guides occupied dates into an explicit swap and preserves both occurrence identities', async () => {
    render(app())
    const user = userEvent.setup()
    await user.click(within(occurrence()).getByRole('button', { name: 'Move' }))
    fireEvent.change(screen.getByLabelText('New date'), { target: { value: '2026-11-25' } })
    expect(screen.getByRole('dialog')).toHaveTextContent('Lower is already on this date')
    expect(screen.getByRole('button', { name: 'Save change' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Swap these dates instead' }))
    expect(screen.getByLabelText('Swap with')).toHaveValue('fixed-generation_2')
    await user.click(screen.getByRole('button', { name: 'Save change' }))
    expect(mock.edit).toHaveBeenCalledWith('fixed-split', 1, {
      kind: 'swap',
      occurrenceId: 'fixed-generation_0',
      otherOccurrenceId: 'fixed-generation_2',
    })
  })

  it('requires a distinct planned occurrence for a direct swap', async () => {
    render(app())
    const user = userEvent.setup()
    await user.click(within(occurrence()).getByRole('button', { name: 'Swap' }))
    expect(screen.getByRole('button', { name: 'Save change' })).toBeDisabled()
    expect(
      within(screen.getByLabelText('Swap with')).queryByRole('option', { name: /2026-11-23/ }),
    ).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Swap with'), 'fixed-generation_1')
    await user.click(screen.getByRole('button', { name: 'Save change' }))
    expect(mock.edit).toHaveBeenCalledWith('fixed-split', 1, {
      kind: 'swap',
      occurrenceId: 'fixed-generation_0',
      otherOccurrenceId: 'fixed-generation_1',
    })
  })

  it('requires confirmation to skip and reports a failed save once inside the dialog', async () => {
    mock.edit.mockRejectedValue(new Error('The calendar could not sync.'))
    render(app())
    const user = userEvent.setup()
    await user.click(within(occurrence()).getByRole('button', { name: 'Skip' }))
    expect(mock.edit).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm skip' }))
    expect(mock.edit).toHaveBeenCalledWith('fixed-split', 1, {
      kind: 'skip',
      occurrenceId: 'fixed-generation_0',
    })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
      'The calendar could not sync.',
    )
  })

  it.each(['replace', 'skip'] as const)('rejects a stale %s confirmation', async (kind) => {
    const view = render(app())
    const user = userEvent.setup()
    await user.click(
      kind === 'replace'
        ? screen.getByRole('button', { name: 'Replace calendar' })
        : within(occurrence()).getByRole('button', { name: 'Skip' }),
    )
    mock.calendars = [{ ...mock.calendars[0], revision: 2 }]
    view.rerender(app())
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: kind === 'replace' ? 'Replace calendar' : 'Confirm skip',
      }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('The calendar changed')
    expect(mock.build).not.toHaveBeenCalled()
    expect(mock.edit).not.toHaveBeenCalled()
  })

  it('replaces a reviewed calendar using its frozen revision', async () => {
    render(app())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Replace calendar' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Replace calendar' }),
    )
    expect(mock.build).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1 }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each([
    'training-pending',
    'workout-pending',
    'active',
    'read-only',
    'training-error',
    'workout-error',
  ])('blocks calendar writes while %s and explains why', (state) => {
    if (state === 'training-pending') mock.trainingPending = true
    if (state === 'workout-pending') mock.workoutPending = true
    if (state === 'active')
      mock.activeSession = createWorkoutSession(mock.routines[0], 'fixed-user', null, now)
    if (state === 'read-only') mock.writable = false
    if (state === 'training-error') mock.trainingError = 'Training unavailable.'
    if (state === 'workout-error') mock.workoutError = 'Workout unavailable.'
    render(app())
    expect(screen.getByRole('button', { name: 'Replace calendar' })).toBeDisabled()
    expect(within(occurrence()).getByRole('button', { name: 'Move' })).toBeDisabled()
    expect(within(occurrence()).getByRole('button', { name: 'Start workout' })).toBeDisabled()
    if (state.includes('pending'))
      expect(screen.getByRole('status')).toHaveTextContent('waiting for cloud confirmation')
    if (state === 'active')
      expect(screen.getByRole('link', { name: 'Resume workout' })).toBeInTheDocument()
    if (state === 'read-only') expect(screen.getByRole('status')).toHaveTextContent('Another tab')
    if (state.includes('error')) expect(screen.getByRole('alert')).toHaveTextContent('unavailable')
  })

  it('disables a dialog if a sync write begins while it is open', async () => {
    const view = render(app())
    await userEvent.setup().click(within(occurrence()).getByRole('button', { name: 'Skip' }))
    mock.trainingPending = true
    view.rerender(app())
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent(
      'Wait for your latest changes',
    )
    expect(screen.getByRole('button', { name: 'Confirm skip' })).toBeDisabled()
  })

  it('requires regeneration after a split revision changes', () => {
    mock.splits = [{ ...mock.splits[0], revision: 2 }]
    render(app())
    expect(screen.getByText(/Your split changed/)).toBeInTheDocument()
    expect(within(occurrence()).getByRole('button', { name: 'Move' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Replace calendar' })).toBeEnabled()
  })

  it('starts a dated occurrence explicitly and navigates to that session', async () => {
    render(app())
    await userEvent
      .setup()
      .click(within(occurrence()).getByRole('button', { name: 'Start workout' }))
    expect(mock.start).toHaveBeenCalledWith(mock.routines[0], {
      scheduled: true,
      fixedOccurrenceId: 'fixed-generation_0',
    })
    expect(await screen.findByText('Workout started')).toBeInTheDocument()
  })
})

describe('Fixed next-workout recommendation', () => {
  it('starts today’s dated occurrence through the same scheduled API', async () => {
    mock.calendars = [calendar('2026-11-25')]
    render(app(true))
    const region = screen.getByRole('region', { name: 'Your next workout' })
    expect(region).toHaveTextContent('scheduled for today in Asia/Manila')
    await userEvent
      .setup()
      .click(within(region).getByRole('button', { name: 'Start scheduled workout' }))
    expect(mock.start).toHaveBeenCalledWith(mock.routines[0], {
      scheduled: true,
      fixedOccurrenceId: 'fixed-generation_0',
    })
    expect(await screen.findByText('Workout started')).toBeInTheDocument()
  })

  it('keeps missed work actionable and links to calendar adjustments', () => {
    render(app(true))
    expect(screen.getByRole('region', { name: 'Your next workout' })).toHaveTextContent(
      'overdue from 2026-11-23',
    )
    expect(screen.getByRole('link', { name: 'View or adjust calendar' })).toHaveAttribute(
      'href',
      '/plan/calendar',
    )
  })

  it.each(['pending', 'active', 'read-only', 'error'])(
    'prevents scheduled starts while %s',
    (state) => {
      if (state === 'pending') mock.workoutPending = true
      if (state === 'active')
        mock.activeSession = createWorkoutSession(mock.routines[0], 'fixed-user', null, now)
      if (state === 'read-only') mock.writable = false
      if (state === 'error') mock.trainingError = 'Calendar sync failed.'
      render(app(true))
      expect(screen.getByRole('button', { name: 'Start scheduled workout' })).toBeDisabled()
      expect(mock.start).not.toHaveBeenCalled()
    },
  )
})
