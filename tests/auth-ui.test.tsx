import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AuthPage, { PendingApprovalPage } from '../src/features/auth/AuthPage'

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  register: vi.fn(),
  resetPassword: vi.fn(),
  refreshAccess: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('../src/services/auth/AuthProvider', () => ({
  useAuth: () => ({ ...auth, user: { email: 'athlete@example.com' }, status: 'signed-out' }),
}))

function renderAuth(path = '/login') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  for (const method of Object.values(auth)) method.mockReset().mockResolvedValue(undefined)
})

describe('Authentication forms', () => {
  it('validates credentials before contacting authentication', async () => {
    const user = userEvent.setup()
    renderAuth()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your email address.')).toBeVisible()
    expect(screen.getByText('Enter your password.')).toBeVisible()
    expect(auth.signIn).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true')
  })

  it('requires a long password and matching confirmation for registration', async () => {
    const user = userEvent.setup()
    renderAuth('/register')
    await user.type(screen.getByLabelText('Email address'), 'athlete@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'short')
    await user.type(screen.getByLabelText('Confirm password', { exact: true }), 'different')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Use at least 12 characters.')).toBeVisible()
    expect(screen.getByText('Your passwords do not match.')).toBeVisible()
    expect(auth.register).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('Password', { exact: true }))
    await user.clear(screen.getByLabelText('Confirm password', { exact: true }))
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a strong passphrase')
    await user.type(
      screen.getByLabelText('Confirm password', { exact: true }),
      'a strong passphrase',
    )
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() =>
      expect(auth.register).toHaveBeenCalledExactlyOnceWith(
        'athlete@example.com',
        'a strong passphrase',
      ),
    )
  })

  it('prevents a second sign-in while the first request is pending', async () => {
    let finish: (() => void) | undefined
    auth.signIn.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const user = userEvent.setup()
    renderAuth()
    await user.type(screen.getByLabelText('Email address'), 'athlete@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a strong passphrase')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    const pendingButton = await screen.findByRole('button', { name: 'One moment…' })
    expect(pendingButton).toBeDisabled()
    await user.click(pendingButton)
    expect(auth.signIn).toHaveBeenCalledTimes(1)
    await act(async () => finish?.())
  })

  it('shows a safe error instead of raw provider diagnostics', async () => {
    auth.signIn.mockRejectedValue(new Error('Firebase: auth/user-not-found private@example.com'))
    const user = userEvent.setup()
    renderAuth()
    await user.type(screen.getByLabelText('Email address'), 'athlete@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'incorrect')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t sign you in.')
    expect(screen.queryByText(/Firebase:/)).not.toBeInTheDocument()
  })

  it('lets users reveal the password with an explicitly labeled button', async () => {
    const user = userEvent.setup()
    renderAuth()
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('uses a generic reset confirmation that does not disclose account existence', async () => {
    const user = userEvent.setup()
    renderAuth('/forgot-password')
    await user.type(screen.getByLabelText('Email address'), 'athlete@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'If an account exists for that email address',
    )
    expect(auth.resetPassword).toHaveBeenCalledExactlyOnceWith('athlete@example.com')
  })
})

describe('Private launch approval', () => {
  it('allows checking approval and signing out without a browser approval control', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <PendingApprovalPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('athlete@example.com')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Check my access' }))
    expect(await screen.findByRole('status')).toHaveTextContent('approval is still pending')
    expect(auth.refreshAccess).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: /approve account/i })).not.toBeInTheDocument()
  })
})
