import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingPage from '../src/features/onboarding/OnboardingPage'
import ProfilePage from '../src/features/profile/ProfilePage'
import { defaultPreferences, type AccountData, type ProfileInput } from '../src/types/profile'

const mock = vi.hoisted(() => ({
  saveProfile: vi.fn(),
  logout: vi.fn(),
  readDraft: vi.fn(),
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
  account: null as AccountData | null,
  training: { loading: false, hasPendingWrites: false },
  workouts: { loading: false, hasPendingWrites: false, localSaving: false },
}))

vi.mock('../src/services/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'user-1', email: 'athlete@example.com', displayName: null },
    account: mock.account,
    saveProfile: mock.saveProfile,
    logout: mock.logout,
  }),
}))
vi.mock('../src/services/training/TrainingProvider', () => ({
  useTraining: () => mock.training,
}))
vi.mock('../src/services/workouts/WorkoutProvider', () => ({
  useWorkouts: () => mock.workouts,
}))
vi.mock('../src/features/onboarding/draft', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/features/onboarding/draft')>()
  return {
    ...original,
    readOnboardingDraft: mock.readDraft,
    saveOnboardingDraft: mock.saveDraft,
    clearOnboardingDraft: mock.clearDraft,
    clearAllOnboardingDrafts: vi.fn().mockResolvedValue(undefined),
  }
})

function renderSetup(path = '/onboarding') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/today" element={<div>Training space</div>} />
        <Route path="/profile" element={<div>Profile saved</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function continueToReview(user: ReturnType<typeof userEvent.setup>) {
  for (const heading of [
    'What are you working toward?',
    'Find your training rhythm.',
    'Set up your way to train.',
    'Your starting point.',
  ]) {
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
  }
  await waitFor(() =>
    expect(mock.saveDraft).toHaveBeenLastCalledWith('user-1', expect.any(Object), 4),
  )
}

beforeEach(() => {
  for (const method of [mock.saveProfile, mock.logout, mock.saveDraft, mock.clearDraft])
    method.mockReset().mockResolvedValue(undefined)
  mock.readDraft.mockReset().mockResolvedValue(undefined)
  mock.training = { loading: false, hasPendingWrites: false }
  mock.workouts = { loading: false, hasPendingWrites: false, localSaving: false }
  mock.account = {
    profile: {
      uid: 'user-1',
      displayName: '',
      onboardingCompleted: false,
      schemaVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    preferences: defaultPreferences(),
    fromCache: false,
    hasPendingWrites: false,
  }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})

describe('Training preferences setup', () => {
  it('requires a name before advancing and keeps input in the UID-scoped draft', async () => {
    const user = userEvent.setup()
    renderSetup()
    await screen.findByLabelText('What should we call you?')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Enter your name.')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Make it yours.' })).toBeVisible()
    await user.type(screen.getByLabelText('What should we call you?'), 'Alex')
    await waitFor(() =>
      expect(mock.saveDraft).toHaveBeenLastCalledWith(
        'user-1',
        expect.objectContaining({ displayName: 'Alex' }),
        0,
      ),
    )
    const form = screen.getByRole('button', { name: 'Continue' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(
      await screen.findByRole('heading', { name: 'What are you working toward?' }),
    ).toBeVisible()
    await waitFor(() =>
      expect(mock.saveDraft).toHaveBeenLastCalledWith(
        'user-1',
        expect.objectContaining({ displayName: 'Alex' }),
        1,
      ),
    )
    expect(mock.saveProfile).not.toHaveBeenCalled()
  }, 15_000)

  it('saves a complete setup without inventing training history', async () => {
    let acknowledgeSave!: () => void
    mock.saveProfile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          acknowledgeSave = resolve
        }),
    )
    const user = userEvent.setup()
    renderSetup()
    await user.type(await screen.findByLabelText('What should we call you?'), 'Alex')
    await continueToReview(user)
    expect(screen.getByLabelText('Last trained')).toHaveValue('')
    expect(screen.getByLabelText('Workout name')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Let’s get started' }))
    await waitFor(() => expect(mock.saveProfile).toHaveBeenCalledTimes(1))
    const savingButton = screen.getByRole('button', { name: 'Saving…' })
    expect(savingButton).toBeDisabled()
    expect(screen.getByLabelText('Workout name')).toBeDisabled()
    for (const backButton of screen.getAllByRole('button', { name: 'Back' }))
      expect(backButton).toBeDisabled()
    for (const editButton of screen.getAllByRole('button', { name: 'Edit' }))
      expect(editButton).toBeDisabled()
    fireEvent.submit(savingButton.closest('form')!)
    expect(mock.saveProfile).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Training space')).not.toBeInTheDocument()
    await act(async () => acknowledgeSave())
    expect(await screen.findByText('Training space')).toBeVisible()
    expect(mock.saveProfile).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        displayName: 'Alex',
        onboardingCompleted: true,
        preferences: expect.objectContaining({
          initialHistory: { lastTrainedDate: '', lastWorkout: '', muscles: [] },
        }),
      }),
    )
    // Firestore's local acknowledgment is not a cloud acknowledgment.
    expect(mock.clearDraft).not.toHaveBeenCalled()
  }, 15_000)

  it('prevents overlapping preferred days and protected rest days', async () => {
    const user = userEvent.setup()
    renderSetup()
    await user.type(await screen.findByLabelText('What should we call you?'), 'Alex')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByRole('heading', { name: 'What are you working toward?' }),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Find your training rhythm.' })).toBeVisible()
    const monday = screen.getByRole('button', { name: /^Monday$/ })
    expect(monday).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Monday rest day' }))
    expect(monday).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Monday rest day' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }, 15_000)

  it('restores an unfinished setup and its exact step without a cloud write', async () => {
    mock.readDraft.mockResolvedValue({
      uid: 'user-1',
      savedAt: 20,
      step: 2,
      input: {
        displayName: 'Recovered Alex',
        onboardingCompleted: false,
        preferences: { ...defaultPreferences(), sessionMinutes: 45 },
      },
    })
    renderSetup()
    expect(await screen.findByRole('heading', { name: 'Find your training rhythm.' })).toBeVisible()
    expect(screen.getByLabelText('Usual workout length')).toHaveValue(45)
    expect(screen.getByText('Your unfinished setup was restored from this device.')).toBeVisible()
    expect(mock.readDraft).toHaveBeenCalledWith('user-1')
    expect(mock.saveProfile).not.toHaveBeenCalled()
  })

  it('preserves completed onboarding while editing and returns to the profile', async () => {
    mock.account!.profile = {
      ...mock.account!.profile,
      displayName: 'Alex',
      onboardingCompleted: true,
    }
    const user = userEvent.setup()
    renderSetup('/onboarding?edit=1')
    expect(await screen.findByLabelText('What should we call you?')).toHaveValue('Alex')
    await continueToReview(user)
    await user.click(screen.getByRole('button', { name: 'Save preferences' }))
    expect(await screen.findByText('Profile saved')).toBeVisible()
    expect((mock.saveProfile.mock.calls[0][0] as ProfileInput).onboardingCompleted).toBe(true)
  }, 15_000)

  it('keeps local work available when saving fails', async () => {
    mock.saveProfile.mockRejectedValue(new Error('connection failed'))
    const user = userEvent.setup()
    renderSetup()
    await user.type(await screen.findByLabelText('What should we call you?'), 'Alex')
    await continueToReview(user)
    await user.click(screen.getByRole('button', { name: 'Let’s get started' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your preferences could not be saved.',
    )
    expect(mock.clearDraft).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Let’s get started' })).toBeEnabled()
  }, 15_000)
})

describe('Profile', () => {
  it('shows actual preferences and clearly labels pending cloud synchronization', () => {
    mock.account!.profile.displayName = 'Alex'
    mock.account!.preferences.sessionMinutes = 45
    mock.account!.hasPendingWrites = true
    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Alex' })).toBeVisible()
    expect(screen.getByText('45 minutes')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('waiting to sync')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Edit preferences' })).toHaveAttribute(
      'href',
      '/onboarding?edit=1',
    )
    expect(screen.queryByRole('button', { name: /export|delete/i })).not.toBeInTheDocument()
  })

  it.each([
    ['training data is loading', (): boolean => (mock.training.loading = true)],
    [
      'training changes await cloud confirmation',
      (): boolean => (mock.training.hasPendingWrites = true),
    ],
    ['workout data is loading', (): boolean => (mock.workouts.loading = true)],
    [
      'workout changes await cloud confirmation',
      (): boolean => (mock.workouts.hasPendingWrites = true),
    ],
    [
      'a workout checkpoint is saving on this device',
      (): boolean => (mock.workouts.localSaving = true),
    ],
  ] as const)('allows sign out only after %s finishes', async (_label, blockSignOut) => {
    blockSignOut()
    const user = userEvent.setup()
    const profile = (
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    )
    const view = render(profile)
    const signOut = screen.getByRole('button', { name: 'Sign out' })
    expect(signOut).toBeDisabled()
    await user.click(signOut)
    expect(mock.logout).not.toHaveBeenCalled()

    mock.training = { loading: false, hasPendingWrites: false }
    mock.workouts = { loading: false, hasPendingWrites: false, localSaving: false }
    view.rerender(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    )
    expect(signOut).toBeEnabled()
    await user.click(signOut)
    expect(mock.logout).toHaveBeenCalledOnce()
  })
})
