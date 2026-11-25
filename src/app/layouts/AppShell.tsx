import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, Link, useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  ChartNoAxesCombined,
  CircleHelp,
  Dumbbell,
  House,
  UserRound,
  WifiOff,
  CloudCheck,
  CloudUpload,
  ShieldCheck,
} from 'lucide-react'
import Brand from '../../components/shared/Brand'
import PwaFeedback from '../../components/shared/PwaFeedback'
import { useAuth } from '../../services/auth/AuthProvider'
import { usingEmulators } from '../../services/firebase/client'
import { useOnline } from '../../hooks/useOnline'
import { useTraining } from '../../services/training/TrainingProvider'
import { useWorkouts } from '../../services/workouts/WorkoutProvider'

const links = [
  { to: '/today', label: 'Today', icon: House },
  { to: '/plan', label: 'Plan', icon: CalendarDays },
  { to: '/train', label: 'Train', icon: Dumbbell },
  { to: '/progress', label: 'Progress', icon: ChartNoAxesCombined },
  { to: '/profile', label: 'Profile', icon: UserRound },
]
export default function AppShell() {
  const { account, error, refreshAccess } = useAuth()
  const training = useTraining()
  const workouts = useWorkouts()
  const navigate = useNavigate()
  const [recoveryError, setRecoveryError] = useState('')
  const online = useOnline()
  const location = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
    document.getElementById('page-content')?.focus({ preventScroll: true })
  }, [location.pathname])
  const syncLabel = !online
    ? 'Offline · cached data'
    : account?.hasPendingWrites || training.hasPendingWrites || workouts.hasPendingWrites
      ? 'Saved locally · sync pending'
      : account?.fromCache || training.fromCache || workouts.fromCache
        ? 'Showing cached data'
        : training.loading || workouts.loading
          ? 'Loading training setup'
          : 'Changes synced'
  const SyncIcon = !online
    ? WifiOff
    : account?.hasPendingWrites || training.hasPendingWrites || workouts.hasPendingWrites
      ? CloudUpload
      : CloudCheck
  return (
    <div className="app-shell">
      <a className="skip-link" href="#page-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-section-label">Your training space</div>
        <nav className="desktop-navigation" aria-label="Main navigation">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                isActive ||
                (to === '/plan' && location.pathname.startsWith('/exercises')) ||
                (to === '/train' && location.pathname.startsWith('/history'))
                  ? 'active'
                  : undefined
              }
            >
              <Icon size={20} strokeWidth={1.7} />
              <span>{label}</span>
              {to === '/train' && <span className="nav-training-dot" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="small-orbit" aria-hidden="true" />
            <p>
              Your schedule forgets.
              <br />
              <strong>Your muscles don’t.</strong>
            </p>
          </div>
          <Link className="help-link" to="/settings">
            <CircleHelp size={18} /> Help & installation
          </Link>
          <Link className="sidebar-profile" to="/profile">
            <span className="avatar">
              {account?.profile.displayName.charAt(0).toUpperCase() || 'M'}
            </span>
            <span>
              <strong>{account?.profile.displayName || 'Your profile'}</strong>
              <small>Make it your own</small>
            </span>
          </Link>
        </div>
      </aside>
      <div className="main-region">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand />
          </div>
          <span className="desktop-context">A little consistency. A lot of possibility.</span>
          <div className="topbar-status">
            <span className="sync-status" role="status">
              <SyncIcon size={14} />
              <span>{syncLabel}</span>
            </span>
            {usingEmulators && (
              <span className="environment-label">
                <ShieldCheck size={13} /> Local development
              </span>
            )}
            <Link className="header-avatar" to="/profile" aria-label="Open profile">
              {account?.profile.displayName.charAt(0).toUpperCase() || 'M'}
            </Link>
          </div>
        </header>
        <main id="page-content" className="page-content" tabIndex={-1}>
          {workouts.activeSession && !location.pathname.startsWith('/train/') && (
            <section className="notice workout-global-banner" aria-label="Active workout">
              <div>
                <strong>{workouts.activeSession.routineName}</strong>
                <p>Your workout is still open. Pick up where you left off.</p>
              </div>
              <Link className="btn btn-primary" to={`/train/${workouts.activeSession.id}`}>
                Resume workout
              </Link>
            </section>
          )}
          {workouts.error && (
            <section className="notice" aria-label="Workout recovery">
              <p role="alert">{workouts.error}</p>
              <div className="workout-recovery-actions">
                <button className="btn btn-secondary" onClick={workouts.retrySync}>
                  Retry synchronization
                </button>
                {workouts.recoveryCount > 0 && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      try {
                        workouts.downloadRecovery()
                      } catch (failure) {
                        setRecoveryError(
                          failure instanceof Error
                            ? failure.message
                            : 'The recovery copy could not be downloaded.',
                        )
                      }
                    }}
                  >
                    Download workout recovery
                  </button>
                )}
              </div>
              {workouts.rejectedSessions.map((session) => (
                <div className="workout-recovery-actions" key={session.id}>
                  <span>{session.routineName}</span>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Use the cloud version and remove this local recovery copy? Download the workout recovery first if you need its performed sets.',
                        )
                      )
                        return
                      void workouts
                        .discardLocalChanges(session.id)
                        .then(() => navigate('/train', { replace: true }))
                        .catch((failure) =>
                          setRecoveryError(
                            failure instanceof Error
                              ? failure.message
                              : 'This recovery copy could not be cleared.',
                          ),
                        )
                    }}
                  >
                    Use cloud version
                  </button>
                </div>
              ))}
              {workouts.unreadableCount > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Clear unreadable local workout records? Download workout recovery before clearing them. Valid checkpoints and cloud workouts are preserved.',
                      )
                    )
                      void workouts
                        .clearUnreadableRecovery()
                        .catch((failure) =>
                          setRecoveryError(
                            failure instanceof Error
                              ? failure.message
                              : 'Unreadable records could not be cleared.',
                          ),
                        )
                  }}
                >
                  Clear unreadable workout copies
                </button>
              )}
              {recoveryError && <p role="alert">{recoveryError}</p>}
            </section>
          )}
          {error && (
            <div className="notice sync-error" role="alert">
              <span>{error}</span>
              <button
                className="btn btn-secondary"
                onClick={() => void refreshAccess().catch(() => undefined)}
              >
                Try again
              </button>
            </div>
          )}
          {training.error && (
            <div className="notice sync-error" role="alert">
              <span>{training.error}</span>
              <button className="btn btn-secondary" onClick={training.refresh}>
                Try again
              </button>
            </div>
          )}
          {training.recoveryCount > 0 && (
            <section className="notice" aria-label="Training save recovery">
              <p>
                {training.recoveryCount} training changes on this device are awaiting cloud
                confirmation. You can download a recovery copy before resolving rejected saves.
              </p>
              <div className="record-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    try {
                      training.downloadRecovery()
                      setRecoveryError('')
                    } catch (failure) {
                      setRecoveryError(
                        failure instanceof Error
                          ? failure.message
                          : 'The recovery copy could not be downloaded.',
                      )
                    }
                  }}
                >
                  Download recovery copy
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    if (
                      !window.confirm(
                        'Clear rejected training saves from this device? Download a recovery copy first if you need it. Editor drafts and cloud records are preserved.',
                      )
                    )
                      return
                    try {
                      training.discardRejectedChanges()
                      setRecoveryError('')
                    } catch (failure) {
                      setRecoveryError(
                        failure instanceof Error
                          ? failure.message
                          : 'These saves could not be cleared.',
                      )
                    }
                  }}
                >
                  Clear rejected saves
                </button>
              </div>
              {recoveryError && <p role="alert">{recoveryError}</p>}
            </section>
          )}
          <Outlet />
        </main>
        <footer className="desktop-footer">
          <span>muscle memory</span>
          <span>Built around your life.</span>
        </footer>
      </div>
      <nav className="mobile-navigation" aria-label="Mobile navigation">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              isActive ||
              (to === '/plan' && location.pathname.startsWith('/exercises')) ||
              (to === '/train' && location.pathname.startsWith('/history'))
                ? 'active'
                : undefined
            }
          >
            <Icon size={21} strokeWidth={1.7} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <PwaFeedback />
    </div>
  )
}
