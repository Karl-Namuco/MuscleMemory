import { useRef, useState } from 'react'
import { ArrowRight, Clock3, Dumbbell, History, Play, Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { estimatedRoutineMinutes } from '../../domain/training/helpers'
import { useTraining } from '../../services/training/TrainingProvider'
import { useWorkouts } from '../../services/workouts/WorkoutProvider'
import type { Routine } from '../../types/training'
import WorkoutSyncStatus from './WorkoutSyncStatus'
import './workouts.css'

export default function TrainPage() {
  const training = useTraining()
  const workouts = useWorkouts()
  const navigate = useNavigate()
  const [starting, setStarting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const routines = training.routines.filter((routine) => !routine.archived)

  async function start(routine: Routine) {
    if (inFlight.current) return
    inFlight.current = true
    setStarting(routine.id)
    setError('')
    try {
      const id = await workouts.startWorkout(routine)
      navigate(`/train/${id}`)
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'The workout could not be started. Try again.',
      )
    } finally {
      inFlight.current = false
      setStarting(null)
    }
  }

  return (
    <div className="workout-page page-enter">
      <div className="page-title-row workout-page-title">
        <div>
          <p className="eyebrow">Make your next move</p>
          <h1 className="page-heading">Show up. Start somewhere.</h1>
          <p className="page-description">Choose a routine. Log what you do. Make it count.</p>
        </div>
        <Link className="btn btn-secondary" to="/history">
          <History size={18} /> Workout history
        </Link>
      </div>
      <WorkoutSyncStatus />
      {error && (
        <p className="workout-error" role="alert">
          {error}
        </p>
      )}
      {workouts.activeSession && (
        <section className="card workout-resume">
          <div className="workout-resume-icon">
            <Play size={24} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">Pick up where you left off</p>
            <h2>{workouts.activeSession.routineName}</h2>
            <p>
              Your logged sets are waiting. Continue your current workout before starting another.
            </p>
          </div>
          <Link className="btn btn-primary" to={`/train/${workouts.activeSession.id}`}>
            Resume workout <ArrowRight size={18} />
          </Link>
        </section>
      )}
      <div className="section-label-row">
        <h2 className="section-heading">Your routine library</h2>
        <Link className="text-link" to="/plan/routines">
          Manage routines
        </Link>
      </div>
      {training.loading || workouts.loading ? (
        <p role="status" className="muted">
          Loading your training…
        </p>
      ) : routines.length ? (
        <div className="workout-routine-grid">
          {routines.map((routine) => (
            <section className="card workout-routine" key={routine.id}>
              <div className="workout-routine-top">
                <Dumbbell size={23} aria-hidden="true" />
                <span className="subtle-caption">{routine.exercises.length} exercises</span>
              </div>
              <h3>{routine.name}</h3>
              <p>
                {routine.description ||
                  routine.exercises
                    .slice(0, 3)
                    .map((entry) => entry.exerciseSnapshot.name)
                    .join(' · ')}
              </p>
              <div className="workout-routine-meta">
                <span>
                  <Clock3 size={15} /> About {estimatedRoutineMinutes(routine.exercises)} min
                </span>
                <span>
                  {routine.exercises.reduce((sum, entry) => sum + entry.sets.length, 0)} planned
                  sets
                </span>
              </div>
              <button
                className="btn btn-primary"
                disabled={
                  Boolean(starting) ||
                  Boolean(workouts.activeSession) ||
                  workouts.writable === false ||
                  routine.exercises.length === 0
                }
                onClick={() => void start(routine)}
                aria-label={`Start workout: ${routine.name}`}
              >
                <Play size={16} /> {starting === routine.id ? 'Starting…' : 'Start workout'}
              </button>
            </section>
          ))}
        </div>
      ) : (
        <section className="card workout-empty">
          <Dumbbell size={34} aria-hidden="true" />
          <h2>A good session starts with a plan.</h2>
          <p>Add exercises and planned sets to a routine. Then come back here to train.</p>
          <Link className="btn btn-primary" to="/plan/routines/new">
            <Plus size={18} /> Build your first routine
          </Link>
        </section>
      )}
      <p className="subtle-caption">
        Planned targets are a guide. Only the sets you mark complete become performed work.
      </p>
    </div>
  )
}
