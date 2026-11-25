import { Link } from 'react-router-dom'
import { CalendarDays, Clock3, Dumbbell, Layers3, Plus } from 'lucide-react'
import { useTraining } from '../../services/training/TrainingProvider'
import { useAuth } from '../../services/auth/AuthProvider'
import { estimatedRoutineMinutes } from '../../domain/training/helpers'
import PlanNavigation from './PlanNavigation'
import './plan.css'

export default function PlanPage() {
  const { account } = useAuth()
  const training = useTraining()
  const split = training.splits.find((item) => item.id === training.activeSplitId)
  const routines = training.routines.filter((item) => !item.archived)
  const prefs = account!.preferences
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return (
    <div className="training-page page-enter">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">Your training blueprint</p>
          <h1 className="page-heading">Built around your life.</h1>
          <p className="page-description">Your routines, your sequence, your room to adapt.</p>
        </div>
        <Link className="btn btn-primary" to="/plan/routines/new">
          <Plus size={18} /> New routine
        </Link>
      </div>
      <PlanNavigation />
      {training.loading ? (
        <p className="muted" role="status">
          Loading your training setup…
        </p>
      ) : (
        <section className="card active-plan-panel">
          <div className="section-label-row">
            <span className="card-icon">
              <Layers3 size={25} />
            </span>
            <span className={split ? 'active-badge' : 'quiet-badge'}>
              {split ? 'Active split' : 'No active split'}
            </span>
          </div>
          <h2>{split?.name || 'Find a rhythm that fits.'}</h2>
          <p className="muted">
            {split
              ? split.description || 'Your saved sequence, with training and rest in order.'
              : 'Create your own split or start with an editable template. Your routines will stay yours as your schedule changes.'}
          </p>
          {split && (
            <ol className="plan-sequence">
              {split.slots.map((slot, index) => {
                const routine = training.routines.find((item) => item.id === slot.routineId)
                return (
                  <li key={slot.id}>
                    <span className="slot-number">{index + 1}</span>
                    <div>
                      <strong>{slot.label}</strong>
                      <small>
                        {slot.isRestDay ? 'Rest' : routine?.name || 'Routine unavailable'}
                      </small>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
          <Link className="btn btn-secondary" to="/plan/splits">
            {split ? 'Manage your split' : 'Choose a split'}
          </Link>
        </section>
      )}
      <div className="section-label-row">
        <h2 className="section-heading">Your routines</h2>
        <Link className="text-link" to="/plan/routines">
          View all routines
        </Link>
      </div>
      {routines.length ? (
        <div className="plan-routine-grid">
          {routines.slice(0, 6).map((routine) => (
            <Link
              className="card plan-routine-card"
              to={`/plan/routines/${routine.id}`}
              key={routine.id}
            >
              <Dumbbell size={22} />
              <h3>{routine.name}</h3>
              <p>
                {routine.exercises.length}{' '}
                {routine.exercises.length === 1 ? 'exercise' : 'exercises'} ·{' '}
                {routine.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0)} planned
                sets
              </p>
              <span className="subtle-caption">
                About {estimatedRoutineMinutes(routine.exercises)} min · estimate
              </span>
            </Link>
          ))}
        </div>
      ) : (
        !training.loading && (
          <div className="card training-empty">
            <Dumbbell size={32} />
            <h3>Start with one good routine.</h3>
            <p>
              Choose exercises, plan your sets, and make a session you will want to come back to.
            </p>
            <Link className="btn btn-primary" to="/plan/routines/new">
              Build your first routine
            </Link>
          </div>
        )
      )}
      <div className="settings-grid plan-preferences">
        <section className="card">
          <h2 className="section-heading">Your training window</h2>
          <div className="plan-facts">
            <span>
              <CalendarDays size={17} />
              {prefs.sessionsPerWeek} sessions / week
            </span>
            <span>
              <Clock3 size={17} />
              {prefs.sessionMinutes} minutes / session
            </span>
          </div>
          <Link className="text-link" to="/onboarding?edit=1">
            Edit availability preferences
          </Link>
        </section>
        <section className="card">
          <h2 className="section-heading">Preferred days</h2>
          <div className="availability-list">
            {prefs.preferredDays.length ? (
              prefs.preferredDays.map((day) => (
                <div key={day}>
                  <span>{weekdays[day]}</span>
                  <span className="lime-text">Preferred</span>
                </div>
              ))
            ) : (
              <p className="muted">Your days are flexible.</p>
            )}
          </div>
          <p className="subtle-caption">
            These are preferences. Calendar sessions and adaptive scheduling are coming later.
          </p>
        </section>
      </div>
    </div>
  )
}
