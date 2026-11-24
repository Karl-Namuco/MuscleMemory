import { useId, useState } from 'react'
import { useForm, type UseFormRegisterReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useLocation } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  Dumbbell,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
} from 'lucide-react'
import { useAuth } from '../../services/auth/AuthProvider'
import Brand from '../../components/shared/Brand'
import './AuthPage.css'

const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .email('Enter a valid email address.')
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
})
const registerSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(12, 'Use at least 12 characters.'),
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Your passwords do not match.',
    path: ['confirmPassword'],
  })
const resetSchema = z.object({ email: emailSchema })

type LoginFields = z.infer<typeof loginSchema>
type RegisterFields = z.infer<typeof registerSchema>
type ResetFields = z.infer<typeof resetSchema>

type PasswordFieldProps = {
  id: string
  label: string
  autoComplete: 'current-password' | 'new-password'
  error?: string
  hint?: string
  registration: UseFormRegisterReturn
}

function PasswordField({ id, label, autoComplete, error, hint, registration }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  const description =
    [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-password">
        <input
          {...registration}
          id={id}
          className="input"
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={description}
        />
        <button
          className="auth-password-toggle"
          type="button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      {hint && (
        <p className="auth-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="auth-field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  )
}

function SubmitButton({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>
      {busy && <LoaderCircle className="auth-spin" size={18} aria-hidden="true" />}
      {busy ? 'One moment…' : children}
    </button>
  )
}

function LoginForm() {
  const id = useId()
  const { signIn } = useAuth()
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFields>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })
  const submit = handleSubmit(async ({ email, password }) => {
    setError('')
    try {
      await signIn(email, password)
    } catch {
      setError('We couldn’t sign you in. Check your email and password, then try again.')
    }
  })

  return (
    <form className="stack auth-form" onSubmit={submit} noValidate aria-busy={isSubmitting}>
      <div className="field">
        <label htmlFor={`${id}-email`}>Email address</label>
        <input
          {...register('email')}
          id={`${id}-email`}
          className="input"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? `${id}-email-error` : undefined}
        />
        {errors.email && (
          <p className="auth-field-error" id={`${id}-email-error`}>
            {errors.email.message}
          </p>
        )}
      </div>
      <PasswordField
        id={`${id}-password`}
        label="Password"
        autoComplete="current-password"
        registration={register('password')}
        error={errors.password?.message}
      />
      <div className="auth-forgot">
        <Link to="/forgot-password">Forgot password?</Link>
      </div>
      {error && (
        <p className="notice auth-error" role="alert">
          {error}
        </p>
      )}
      <SubmitButton busy={isSubmitting}>Sign in</SubmitButton>
      <p className="auth-switch">
        New here? <Link to="/register">Create an account</Link>
      </p>
    </form>
  )
}

function RegisterForm() {
  const id = useId()
  const { register: createAccount } = useAuth()
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFields>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  })
  const submit = handleSubmit(async ({ email, password }) => {
    setError('')
    try {
      await createAccount(email, password)
    } catch {
      setError('We couldn’t create your account. Check your details or try signing in.')
    }
  })

  return (
    <form className="stack auth-form" onSubmit={submit} noValidate aria-busy={isSubmitting}>
      <div className="field">
        <label htmlFor={`${id}-email`}>Email address</label>
        <input
          {...register('email')}
          id={`${id}-email`}
          className="input"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? `${id}-email-error` : undefined}
        />
        {errors.email && (
          <p className="auth-field-error" id={`${id}-email-error`}>
            {errors.email.message}
          </p>
        )}
      </div>
      <PasswordField
        id={`${id}-password`}
        label="Password"
        autoComplete="new-password"
        registration={register('password')}
        error={errors.password?.message}
        hint="At least 12 characters. A few memorable words work well."
      />
      <PasswordField
        id={`${id}-confirm`}
        label="Confirm password"
        autoComplete="new-password"
        registration={register('confirmPassword')}
        error={errors.confirmPassword?.message}
      />
      <p className="auth-access-note">
        <LockKeyhole size={16} aria-hidden="true" />
        <span>
          Muscle Memory is currently a private launch. Your account needs owner approval before you
          can begin.
        </span>
      </p>
      {error && (
        <p className="notice auth-error" role="alert">
          {error}
        </p>
      )}
      <SubmitButton busy={isSubmitting}>Create account</SubmitButton>
      <p className="auth-switch">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </form>
  )
}

function ResetForm() {
  const id = useId()
  const { resetPassword } = useAuth()
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetFields>({
    resolver: zodResolver(resetSchema),
    defaultValues: { email: '' },
  })
  const submit = handleSubmit(async ({ email }) => {
    setError('')
    try {
      await resetPassword(email)
      setSent(true)
    } catch {
      setError('We couldn’t send your request. Check your connection and try again.')
    }
  })

  if (sent) {
    return (
      <div className="stack auth-reset-success" role="status">
        <span className="auth-status-icon">
          <Mail size={25} aria-hidden="true" />
        </span>
        <p>
          If an account exists for that email address, you’ll receive a password reset link. Check
          your inbox and spam folder.
        </p>
        <Link className="btn btn-primary auth-submit" to="/login">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <form className="stack auth-form" onSubmit={submit} noValidate aria-busy={isSubmitting}>
      <div className="field">
        <label htmlFor={`${id}-email`}>Email address</label>
        <input
          {...register('email')}
          id={`${id}-email`}
          className="input"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? `${id}-email-error` : undefined}
        />
        {errors.email && (
          <p className="auth-field-error" id={`${id}-email-error`}>
            {errors.email.message}
          </p>
        )}
      </div>
      {error && (
        <p className="notice auth-error" role="alert">
          {error}
        </p>
      )}
      <SubmitButton busy={isSubmitting}>Send reset link</SubmitButton>
      <Link className="auth-back-link" to="/login">
        <ArrowLeft size={16} aria-hidden="true" /> Back to sign in
      </Link>
    </form>
  )
}

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-layout">
      <section className="auth-story" aria-label="Muscle Memory">
        <Brand />
        <div className="auth-story-content">
          <span className="auth-pill">
            <span /> YOUR NEXT REP STARTS HERE
          </span>
          <h2>
            Build strength.
            <br />
            Keep your
            <br />
            <em>momentum.</em>
          </h2>
          <p>
            Make room for progress. A little structure, a clear next step, and a place to make every
            session count.
          </p>
          <div className="auth-progress-visual" aria-hidden="true">
            <div className="auth-progress-line" />
            <div>
              <span className="auth-progress-dot is-done">
                <Check size={15} />
              </span>
              <span>SHOW UP</span>
            </div>
            <div>
              <span className="auth-progress-dot is-current">
                <Dumbbell size={16} />
              </span>
              <span>PUT IN THE WORK</span>
            </div>
            <div>
              <span className="auth-progress-dot">03</span>
              <span>BUILD ON IT</span>
            </div>
          </div>
        </div>
        <p className="auth-story-footer">YOUR TRAINING. YOUR PACE. YOUR PROGRESS.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-panel-content">{children}</div>
        <p className="auth-panel-footer">
          <LockKeyhole size={13} aria-hidden="true" /> A private space for your training.
        </p>
      </section>
    </main>
  )
}

export default function AuthPage() {
  const { pathname } = useLocation()
  const mode =
    pathname === '/register' ? 'register' : pathname === '/forgot-password' ? 'reset' : 'login'
  const copy = {
    login: {
      eyebrow: 'LET’S GET BACK TO IT',
      title: 'Welcome back.',
      description: 'Your next chapter starts with your next session.',
    },
    register: {
      eyebrow: 'START SOMETHING STRONG',
      title: 'Make it a habit.',
      description: 'Create your personal space for a stronger routine.',
    },
    reset: {
      eyebrow: 'A FRESH START',
      title: 'Forgot your password?',
      description: 'Enter your email and we’ll help you get back in.',
    },
  }[mode]

  return (
    <AuthLayout>
      <header className="auth-heading">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1 className="page-heading">{copy.title}</h1>
        <p className="page-description">{copy.description}</p>
      </header>
      {mode === 'register' ? <RegisterForm /> : mode === 'reset' ? <ResetForm /> : <LoginForm />}
    </AuthLayout>
  )
}

export function PendingApprovalPage() {
  const { user, refreshAccess, logout } = useAuth()
  const [action, setAction] = useState<'refresh' | 'logout' | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function checkAccess() {
    if (action) return
    setAction('refresh')
    setError('')
    setMessage('')
    try {
      await refreshAccess()
      setMessage('Access checked. If you’re still here, approval is still pending.')
    } catch {
      setError('We couldn’t check your access. Check your connection and try again.')
    } finally {
      setAction(null)
    }
  }

  async function signOut() {
    if (action) return
    setAction('logout')
    setError('')
    try {
      await logout()
    } catch {
      setError('We couldn’t sign you out. Please try again.')
    } finally {
      setAction(null)
    }
  }

  return (
    <AuthLayout>
      <div className="stack auth-pending" aria-busy={Boolean(action)}>
        <span className="auth-status-icon">
          <LockKeyhole size={25} aria-hidden="true" />
        </span>
        <header className="auth-heading">
          <p className="eyebrow">ACCOUNT CREATED</p>
          <h1 className="page-heading">
            A little patience.
            <br />A stronger start.
          </h1>
          <p className="page-description">
            Your account is created. This private launch requires owner approval before you can
            access your training space.
          </p>
        </header>
        {user?.email && (
          <p className="auth-account-email">
            <Mail size={16} aria-hidden="true" />
            {user.email}
          </p>
        )}
        <p className="auth-pending-detail">
          Once the owner approves your account, check your access here to continue.
        </p>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="notice auth-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="btn btn-primary auth-submit"
          type="button"
          onClick={() => void checkAccess()}
          disabled={Boolean(action)}
        >
          {action === 'refresh' && (
            <LoaderCircle className="auth-spin" size={18} aria-hidden="true" />
          )}
          {action === 'refresh' ? 'Checking access…' : 'Check my access'}
        </button>
        <button
          className="btn btn-ghost auth-signout"
          type="button"
          onClick={() => void signOut()}
          disabled={Boolean(action)}
        >
          {action === 'logout' ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </AuthLayout>
  )
}
