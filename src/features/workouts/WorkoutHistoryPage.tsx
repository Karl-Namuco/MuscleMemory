import { ArrowLeft, ArrowRight, Dumbbell, History } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { weightFromKg } from '../../domain/training/helpers'
import { workoutTotals } from '../../domain/workout/helpers'
import { useAuth } from '../../services/auth/AuthProvider'
import { useWorkouts } from '../../services/workouts/WorkoutProvider'
import { formatClock, formatSet, formatWorkoutDate } from './format'
import WorkoutSyncStatus from './WorkoutSyncStatus'
import './workouts.css'

export default function WorkoutHistoryPage() {
  const { sessionId } = useParams()
  const workouts = useWorkouts()
  const { account } = useAuth()
  const weightUnit = account?.preferences.weightUnit || 'kg'
  const sessions = workouts.sessions
    .filter((session) => session.status !== 'active')
    .sort((a, b) => (b.endedAt || b.startedAt) - (a.endedAt || a.startedAt))
  const session = sessionId ? workouts.sessions.find((item) => item.id === sessionId) : null
  if (workouts.loading && (!sessionId || !session))
    return <p role="status">Loading workout history…</p>
  if (sessionId && !session)
    return (
      <section className="card workout-empty">
        <History size={32} />
        <h1>Workout unavailable</h1>
        <p>This workout is not available on this device or account.</p>
        <Link className="btn btn-primary" to="/history">
          Back to history
        </Link>
      </section>
    )
  if (session?.status === 'active')
    return (
      <section className="card workout-empty">
        <h1>This workout is still open.</h1>
        <p>Resume your workout to log more sets or finish it.</p>
        <Link className="btn btn-primary" to={`/train/${session.id}`}>
          Resume workout
        </Link>
      </section>
    )
  if (session) {
    const totals = workoutTotals(session)
    return (
      <div className="workout-page page-enter">
        <Link className="workout-back text-link" to="/history">
          <ArrowLeft size={16} /> All workout history
        </Link>
        <div className="page-title-row workout-page-title">
          <div>
            <p className="eyebrow">{formatWorkoutDate(session.endedAt || session.startedAt)}</p>
            <h1 className="page-heading">{session.routineName}</h1>
            <p className="page-description">
              Your session as you performed it, with the exercise details saved at the time.
            </p>
          </div>
          <span
            className={`workout-status-badge ${session.status === 'abandoned' ? 'abandoned' : ''}`}
          >
            {session.status === 'abandoned' ? 'Ended early' : 'Completed'}
          </span>
        </div>
        <WorkoutSyncStatus />
        <section className="card workout-progress" aria-label="Workout totals">
          <div className="workout-stat">
            <strong>{totals.completedSets}</strong>
            <span>Completed sets</span>
          </div>
          <div className="workout-stat">
            <strong>{formatClock(session.elapsedSeconds)}</strong>
            <span>Elapsed time</span>
          </div>
          <div className="workout-stat">
            <strong>{totals.completedExercises}</strong>
            <span>Exercises logged</span>
          </div>
          {totals.volumeKg > 0 && (
            <div className="workout-stat">
              <strong>
                {weightFromKg(totals.volumeKg, weightUnit).toLocaleString()} {weightUnit}
              </strong>
              <span>External load volume</span>
            </div>
          )}
          {totals.distanceMeters > 0 && (
            <div className="workout-stat">
              <strong>{totals.distanceMeters.toLocaleString()} m</strong>
              <span>Distance logged</span>
            </div>
          )}
        </section>
        {session.notes && (
          <section className="card">
            <h2 className="section-heading">Session notes</h2>
            <p className="workout-plan-note">{session.notes}</p>
          </section>
        )}
        {session.exercises.map((entry, index) => (
          <section
            className="card workout-exercise"
            key={entry.id}
            aria-labelledby={`history-${entry.id}`}
          >
            <div className="workout-exercise-top">
              <span className="workout-exercise-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="workout-exercise-heading">
                <h2 id={`history-${entry.id}`}>{entry.snapshot.name}</h2>
                <p>
                  {entry.snapshot.equipment}
                  {entry.originalExerciseId ? ' · Substituted during this session' : ''}
                  {entry.optional ? ' · Optional' : ''}
                </p>
                {entry.supersetGroup && (
                  <span className="workout-superset">Superset {entry.supersetGroup}</span>
                )}
              </div>
              <span className="subtle-caption">
                {entry.sets.filter((set) => set.completedAt !== null).length} / {entry.sets.length}{' '}
                sets completed
              </span>
            </div>
            <ul className="workout-history-sets">
              {entry.sets.map((set, setIndex) => (
                <li key={set.id} className={set.completedAt === null ? 'incomplete' : ''}>
                  <span>
                    Set {setIndex + 1} · {set.type === 'warmup' ? 'warm-up' : set.type}
                  </span>
                  <span>
                    {set.completedAt === null
                      ? 'Incomplete · excluded from totals'
                      : `${formatSet(set, entry.snapshot, weightUnit)}${set.rpe === null ? '' : ` · RPE ${set.rpe}`}`}
                  </span>
                </li>
              ))}
            </ul>
            {entry.notes && <p className="workout-plan-note">{entry.notes}</p>}
          </section>
        ))}
        <p className="subtle-caption">
          Only completed sets contribute to these totals. Assistance is recorded separately and does
          not count as lifted volume.
        </p>
        <Link className="btn btn-primary" to="/train">
          Back to training <ArrowRight size={17} />
        </Link>
      </div>
    )
  }
  return (
    <div className="workout-page page-enter">
      <div className="page-title-row workout-page-title">
        <div>
          <p className="eyebrow">The work you put in</p>
          <h1 className="page-heading">One session at a time.</h1>
          <p className="page-description">Your completed workouts and sessions you ended early.</p>
        </div>
        <Link className="btn btn-primary" to="/train">
          <Dumbbell size={18} /> Train
        </Link>
      </div>
      <WorkoutSyncStatus />
      {workouts.activeSession && (
        <div className="notice">
          You have a workout in progress.{' '}
          <Link className="text-link" to={`/train/${workouts.activeSession.id}`}>
            Resume workout
          </Link>
        </div>
      )}
      {sessions.length ? (
        <div className="workout-history-list">
          {sessions.map((item) => {
            const totals = workoutTotals(item)
            return (
              <Link className="card workout-history-row" key={item.id} to={`/history/${item.id}`}>
                <div>
                  <h2>{item.routineName}</h2>
                  <p>
                    {formatWorkoutDate(item.endedAt || item.startedAt)} ·{' '}
                    {formatClock(item.elapsedSeconds)} elapsed
                  </p>
                </div>
                <div className="workout-history-result">
                  <span
                    className={`workout-status-badge ${item.status === 'abandoned' ? 'abandoned' : ''}`}
                  >
                    {item.status === 'abandoned' ? 'Ended early' : 'Completed'}
                  </span>
                  <p>
                    {totals.completedSets} completed sets · {totals.completedExercises} exercises
                  </p>
                </div>
                <ArrowRight size={19} aria-hidden="true" />
              </Link>
            )
          })}
        </div>
      ) : (
        <section className="card workout-empty">
          <History size={35} aria-hidden="true" />
          <h2>Your first session belongs here.</h2>
          <p>
            Finish a workout or end one early, and its performed sets will appear in your history.
          </p>
          <Link className="btn btn-primary" to="/train">
            Choose a routine
          </Link>
        </section>
      )}
    </div>
  )
}
