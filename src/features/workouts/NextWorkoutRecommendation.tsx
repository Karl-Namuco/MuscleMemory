import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarDays, Play } from 'lucide-react'
import { getFixedRecommendation } from '../../domain/scheduling/fixed'
import { useTraining } from '../../services/training/TrainingProvider'
import { useWorkouts } from '../../services/workouts/WorkoutProvider'
import RollingRecommendation from './RollingRecommendation'
import './workouts.css'

type Props = { disabled?: boolean; onStartingChange?: (starting: boolean) => void }
export default function NextWorkoutRecommendation(props: Props) {
  const training = useTraining()
  const split = training.splits.find((item) => item.id === training.activeSplitId)
  return split?.mode === 'fixed' ? (
    <FixedRecommendation {...props} />
  ) : (
    <RollingRecommendation {...props} />
  )
}

function FixedRecommendation({ disabled = false, onStartingChange }: Props) {
  const training = useTraining()
  const workouts = useWorkouts()
  const navigate = useNavigate()
  const [now, setNow] = useState(Date.now)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const split = training.splits.find((item) => item.id === training.activeSplitId) ?? null
  const calendar = training.fixedSchedules?.find((item) => item.id === split?.id) ?? null
  const recommendation = getFixedRecommendation(calendar, split, training.routines, now)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = window.setInterval(tick, 60000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  const blocked =
    disabled ||
    starting ||
    workouts.writable === false ||
    Boolean(workouts.activeSession) ||
    Boolean(training.error || workouts.error) ||
    training.hasPendingWrites ||
    workouts.hasPendingWrites
  async function start() {
    if (inFlight.current || blocked || recommendation.kind !== 'workout') return
    inFlight.current = true
    setStarting(true)
    onStartingChange?.(true)
    setError('')
    try {
      const id = await workouts.startWorkout(recommendation.routine, {
        scheduled: true,
        fixedOccurrenceId: recommendation.occurrence.id,
      })
      navigate(`/train/${id}`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'This workout could not be started.')
    } finally {
      inFlight.current = false
      setStarting(false)
      onStartingChange?.(false)
    }
  }
  if (training.loading || workouts.loading) return null
  return (
    <section className="card rolling-recommendation" aria-label="Your next workout">
      <div className="rolling-recommendation-heading">
        <CalendarDays size={23} aria-hidden="true" />
        <p className="eyebrow">{split?.name} · Fixed calendar</p>
      </div>
      <div className="rolling-recommendation-copy">
        <h2>
          {recommendation.kind === 'workout'
            ? recommendation.routine.name
            : recommendation.kind === 'rest'
              ? 'A planned day to recover.'
              : recommendation.kind === 'upcoming'
                ? recommendation.occurrence.label
                : 'Put your calendar in place.'}
        </h2>
        <p>{recommendation.reason}</p>
      </div>
      {recommendation.kind === 'workout' && (
        <button className="btn btn-primary" disabled={blocked} onClick={() => void start()}>
          <Play size={17} />
          {starting ? 'Starting…' : 'Start scheduled workout'}
        </button>
      )}
      {workouts.activeSession && (
        <Link className="text-link" to={`/train/${workouts.activeSession.id}`}>
          Resume current workout
        </Link>
      )}
      {(training.hasPendingWrites || workouts.hasPendingWrites) && (
        <p className="subtle-caption">
          Wait for your latest changes to sync before starting another scheduled workout.
        </p>
      )}
      {workouts.writable === false && (
        <p className="subtle-caption">
          Another tab is editing your workouts. Close it to start a scheduled workout here.
        </p>
      )}
      {(training.error || workouts.error) && (
        <p role="alert" className="workout-error">
          {training.error || workouts.error}
        </p>
      )}
      {error && (
        <p role="alert" className="workout-error">
          {error}
        </p>
      )}
      <Link className="text-link" to="/plan/calendar">
        View or adjust calendar
      </Link>
    </section>
  )
}
