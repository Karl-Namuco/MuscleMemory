import { useState } from 'react'
import {
  Clock3,
  Cloud,
  CloudUpload,
  Dumbbell,
  LogOut,
  Pencil,
  Settings2,
  Target,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../services/auth/AuthProvider'
import {
  dayNames,
  EXPERIENCE_LABELS,
  SCHEDULING_LABELS,
  SPLIT_LABELS,
} from '../onboarding/preferences'
import '../onboarding/onboarding.css'

export default function ProfilePage() {
  const { user, account, logout } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  if (!account || !user)
    return (
      <div className="setup-loading" role="status">
        Loading your profile…
      </div>
    )
  const { profile, preferences } = account
  const initials =
    profile.displayName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((name) => name[0])
      .join('')
      .toUpperCase() || 'M'

  async function handleLogout() {
    setSigningOut(true)
    setError('')
    try {
      await logout()
    } catch {
      setError(
        'Sign out could not finish. Check your connection and allow pending changes to synchronize, then try again.',
      )
      setSigningOut(false)
    }
  }

  return (
    <div className="profile-page">
      <div className="profile-heading-row">
        <div className="profile-identity">
          <div className="profile-avatar" aria-hidden="true">
            {initials}
          </div>
          <div>
            <p className="eyebrow" style={{ margin: '0 0 7px' }}>
              Your profile
            </p>
            <h1>{profile.displayName}</h1>
            <p className="profile-email">{user.email}</p>
          </div>
        </div>
        <Link to="/onboarding?edit=1" className="btn btn-primary">
          <Pencil size={15} aria-hidden="true" /> Edit preferences
        </Link>
      </div>

      <div className="profile-status" role="status">
        {account.hasPendingWrites ? (
          <CloudUpload aria-hidden="true" />
        ) : (
          <Cloud aria-hidden="true" />
        )}
        <span>
          {account.hasPendingWrites
            ? 'Your preferences are saved on this device and waiting to sync to your account.'
            : account.fromCache
              ? 'Showing preferences stored on this device. Cloud confirmation will update when connected.'
              : 'Your preferences are saved to your account.'}
        </span>
      </div>

      <div className="profile-grid">
        <section className="profile-card" aria-labelledby="profile-goals">
          <h2 id="profile-goals">
            <Target aria-hidden="true" /> Goals & priorities
          </h2>
          <div className="profile-tags">
            {preferences.goals.map((goal) => (
              <span className="profile-tag" data-goal="true" key={goal}>
                {goal}
              </span>
            ))}
          </div>
          <p className="profile-subheading">Priority muscles</p>
          <div className="profile-tags">
            {preferences.priorityMuscles.length ? (
              preferences.priorityMuscles.map((muscle) => (
                <span className="profile-tag" key={muscle}>
                  {muscle}
                </span>
              ))
            ) : (
              <span className="muted" style={{ fontSize: 16 }}>
                No specific priority
              </span>
            )}
          </div>
          <p className="profile-subheading">Experience</p>
          <p style={{ fontSize: 16, margin: 0 }}>{EXPERIENCE_LABELS[preferences.experience]}</p>
        </section>
        <section className="profile-card" aria-labelledby="profile-week">
          <h2 id="profile-week">
            <Clock3 aria-hidden="true" /> Your training week
          </h2>
          <dl className="profile-facts">
            <div>
              <dt>Training target</dt>
              <dd>
                {preferences.sessionsPerWeek}{' '}
                {preferences.sessionsPerWeek === 1 ? 'session' : 'sessions'} / week
              </dd>
            </div>
            <div>
              <dt>Workout length</dt>
              <dd>{preferences.sessionMinutes} minutes</dd>
            </div>
            <div>
              <dt>Preferred days</dt>
              <dd>{dayNames(preferences.preferredDays, preferences.weekStartsOn) || 'Open'}</dd>
            </div>
            <div>
              <dt>Rest days</dt>
              <dd>
                {dayNames(preferences.restDays, preferences.weekStartsOn) || 'No fixed rest days'}
              </dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>{preferences.flexibility === 'flexible' ? 'Flexible' : 'Mostly consistent'}</dd>
            </div>
          </dl>
        </section>
        <section className="profile-card" aria-labelledby="profile-setup">
          <h2 id="profile-setup">
            <Dumbbell aria-hidden="true" /> Training setup
          </h2>
          <dl className="profile-facts">
            <div>
              <dt>Scheduling</dt>
              <dd>{SCHEDULING_LABELS[preferences.schedulingMode]}</dd>
            </div>
            <div>
              <dt>Preferred split</dt>
              <dd>{SPLIT_LABELS[preferences.preferredSplit]}</dd>
            </div>
            <div>
              <dt>Recovery</dt>
              <dd>
                {preferences.recoveryPreference === 'balanced' ? 'Balanced' : 'More recovery'}
              </dd>
            </div>
          </dl>
          <p className="profile-subheading">Available equipment</p>
          <div className="profile-tags">
            {preferences.equipment.map((item) => (
              <span className="profile-tag" key={item}>
                {item}
              </span>
            ))}
          </div>
          {preferences.favoriteExercises.length > 0 && (
            <>
              <p className="profile-subheading">Exercises you enjoy</p>
              <p style={{ fontSize: 16, lineHeight: 1.7, margin: 0 }}>
                {preferences.favoriteExercises.join(', ')}
              </p>
            </>
          )}
          {preferences.excludedExercises.length > 0 && (
            <>
              <p className="profile-subheading">Exercises to avoid</p>
              <p style={{ fontSize: 16, lineHeight: 1.7, margin: 0 }}>
                {preferences.excludedExercises.join(', ')}
              </p>
            </>
          )}
        </section>
        <section className="profile-card" aria-labelledby="profile-settings">
          <h2 id="profile-settings">
            <Settings2 aria-hidden="true" /> Display & calendar
          </h2>
          <dl className="profile-facts">
            <div>
              <dt>Weight unit</dt>
              <dd>{preferences.weightUnit === 'kg' ? 'Kilograms (kg)' : 'Pounds (lb)'}</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>{preferences.timeZone.replaceAll('_', ' ')}</dd>
            </div>
            <div>
              <dt>Week starts on</dt>
              <dd>{preferences.weekStartsOn === 1 ? 'Monday' : 'Sunday'}</dd>
            </div>
          </dl>
        </section>
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      <section className="profile-account" aria-labelledby="account-access">
        <div>
          <h2 id="account-access">Account access</h2>
          <p>
            Your preferences are private to your account. Pending changes need to sync before
            signing out.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handleLogout()}
          disabled={signingOut}
        >
          <LogOut size={15} aria-hidden="true" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </section>
    </div>
  )
}
