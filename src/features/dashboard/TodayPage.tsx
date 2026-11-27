import { Link } from 'react-router-dom'
import { CalendarDays, Clock3, Layers3, SlidersHorizontal, Target } from 'lucide-react'
import { useAuth } from '../../services/auth/AuthProvider'
import { useTraining } from '../../services/training/TrainingProvider'
import { Button } from '../../components/ui/button'
import NextWorkoutRecommendation from '../workouts/NextWorkoutRecommendation'

export const splitLabels = {
  'push-pull-legs': 'Push / Pull / Legs',
  'upper-lower': 'Upper / Lower',
  'full-body': 'Full body',
  custom: 'Custom split',
}
export const modeLabels = {
  rolling: 'Rolling split',
  fixed: 'Fixed schedule',
  adaptive: 'Smart adaptive',
}
export default function TodayPage() {
  const { account } = useAuth()
  const { activeSplitId } = useTraining()
  if (!account) return null
  const { preferences: prefs, profile } = account
  const date = new Date()
  const hour = Number(
    new Intl.DateTimeFormat('en', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: prefs.timeZone,
    }).format(date),
  )
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dateLabel = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: prefs.timeZone,
  }).format(date)
  const days = prefs.weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]
  const today = new Intl.DateTimeFormat('en', {
    weekday: 'short',
    timeZone: prefs.timeZone,
  }).format(date)
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return (
    <div className="today-page page-enter">
      <div className="page-title-row">
        <div>
          <p className="eyebrow date-label">{dateLabel}</p>
          <h1 className="page-heading">
            {greeting}, {profile.displayName.split(' ')[0]}
            <span className="lime-period">.</span>
          </h1>
          <p className="page-description">Let’s find your rhythm.</p>
        </div>
        <Link to="/onboarding?edit=1" className="btn btn-secondary compact-button">
          <SlidersHorizontal size={16} /> Preferences
        </Link>
      </div>
      {activeSplitId && <NextWorkoutRecommendation />}
      <section className="welcome-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="hero-label">
            <span className="tiny-square" /> Your next chapter
          </span>
          <h2 id="hero-title">
            Your training.
            <br />
            Your pace.
            <br />
            <span>Your life.</span>
          </h2>
          <p>
            A strong routine starts with what works for you.
            <br className="desktop-break" /> Your training preferences are in place.
          </p>
          <Button asChild>
            <Link to="/plan">
              <Layers3 size={17} /> View your training plan
            </Link>
          </Button>
          <span className="hero-footnote">A little planning. A stronger start.</span>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-grid" />
          <svg viewBox="0 0 420 430">
            <defs>
              <linearGradient id="ribbon" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#c6f36b" />
                <stop offset="0.5" stopColor="#91b84a" />
                <stop offset="1" stopColor="#33431f" />
              </linearGradient>
            </defs>
            <ellipse cx="227" cy="373" rx="121" ry="18" fill="#000" opacity=".45" />
            <g transform="rotate(-24 215 215)">
              <path
                d="M126 296V133l88 90 89-90v163"
                fill="none"
                stroke="#171c11"
                strokeWidth="49"
                strokeLinejoin="round"
                transform="translate(12 17)"
              />
              <path
                d="M126 296V133l88 90 89-90v163"
                fill="none"
                stroke="url(#ribbon)"
                strokeWidth="49"
                strokeLinejoin="round"
              />
              <path
                d="M178 112l36 37 37-37"
                fill="none"
                stroke="#c6f36b"
                strokeWidth="18"
                strokeLinejoin="round"
              />
            </g>
          </svg>
          <span className="art-coordinate art-coordinate-top">Consistency, reimagined.</span>
          <span className="art-coordinate art-coordinate-bottom">MOVE. REMEMBER. REPEAT.</span>
        </div>
      </section>
      <div className="section-label-row">
        <h2 className="section-heading">Made for your routine</h2>
        <span className="subtle-caption">Your preferences, at a glance</span>
      </div>
      <div className="preference-grid">
        <Preference
          icon={Target}
          label="Your focus"
          value={prefs.goals[0] || 'General fitness'}
          detail={
            prefs.goals.length > 1
              ? `+ ${prefs.goals.length - 1} more ${prefs.goals.length === 2 ? 'goal' : 'goals'}`
              : 'One session at a time'
          }
        />
        <Preference
          icon={CalendarDays}
          label="Your rhythm"
          value={`${prefs.sessionsPerWeek} days / week`}
          detail={
            prefs.flexibility === 'flexible'
              ? 'Room for life to happen'
              : 'Your preferred weekly schedule'
          }
        />
        <Preference
          icon={Clock3}
          label="Your time"
          value={`${prefs.sessionMinutes} minutes`}
          detail="Your usual session window"
        />
      </div>
      <div className="today-lower-grid">
        <section className="card week-card">
          <div className="section-label-row">
            <h2 className="section-heading">A week that fits</h2>
            <Link to="/plan" className="text-link">
              View plan
            </Link>
          </div>
          <p className="muted">Your preferred training days. No workouts scheduled yet.</p>
          <div className="week-strip">
            {days.map((day) => (
              <div
                key={day}
                className={`week-day ${prefs.preferredDays.includes(day) ? 'preferred' : ''} ${today === names[day] ? 'current-day' : ''}`}
              >
                <span>{names[day]}</span>
                <span className="day-marker">
                  {prefs.preferredDays.includes(day) ? (
                    <span className="day-bar" />
                  ) : (
                    <span className="day-rest">—</span>
                  )}
                </span>
                <small>
                  {prefs.preferredDays.includes(day)
                    ? 'Train'
                    : prefs.restDays.includes(day)
                      ? 'Rest'
                      : 'Open'}
                </small>
              </div>
            ))}
          </div>
        </section>
        {!activeSplitId && <NextWorkoutRecommendation />}
      </div>
    </div>
  )
}
function Preference({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Target
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="preference-card">
      <div className="preference-label">
        <Icon size={17} strokeWidth={1.7} />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}
