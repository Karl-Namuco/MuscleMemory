import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { CalendarDays, Clock3, Play } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { getRollingRecommendation } from '../../domain/scheduling/rolling'
import { estimatedRoutineMinutes } from '../../domain/training/helpers'
import { useAuth } from '../../services/auth/AuthProvider'
import { useTraining } from '../../services/training/TrainingProvider'
import { useWorkouts } from '../../services/workouts/WorkoutProvider'
import './workouts.css'

export default function RollingRecommendation({
  disabled = false,
  onStartingChange,
}: {
  disabled?: boolean
  onStartingChange?: (starting: boolean) => void
}) {
  const training = useTraining()
  const workouts = useWorkouts()
  const { account } = useAuth()
  const navigate = useNavigate()
  const [now, setNow] = useState(Date.now)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [confirmEarly, setConfirmEarly] = useState(false)
  const inFlight = useRef(false)
  const split = training.splits.find((item) => item.id === training.activeSplitId) ?? null
  const recommendation = getRollingRecommendation(
    split,
    training.routines,
    workouts.rollingProgress,
    now,
    account?.preferences.timeZone || 'UTC',
  )
  const blocked =
    disabled ||
    starting ||
    Boolean(workouts.activeSession) ||
    workouts.writable === false ||
    Boolean(training.error) ||
    Boolean(workouts.error) ||
    training.hasPendingWrites ||
    workouts.hasPendingWrites

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const interval = window.setInterval(tick, 60000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  async function start(allowEarly = false) {
    if (
      inFlight.current ||
      blocked ||
      (recommendation.kind !== 'workout' && recommendation.kind !== 'rest')
    )
      return
    inFlight.current = true
    setStarting(true)
    onStartingChange?.(true)
    setError('')
    try {
      const id = await workouts.startWorkout(recommendation.routine, {
        scheduled: true,
        ...(allowEarly ? { allowEarly: true } : {}),
      })
      navigate(`/train/${id}`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The workout could not be started.')
      setConfirmEarly(false)
    } finally {
      inFlight.current = false
      setStarting(false)
      onStartingChange?.(false)
    }
  }

  if (training.loading || workouts.loading) return null

  const ready = recommendation.kind === 'workout' || recommendation.kind === 'rest'

  return (
    <section className="card rolling-recommendation" aria-label="Your next workout">
      <div className="rolling-recommendation-heading">
        <CalendarDays size={23} aria-hidden="true" />
        <p className="eyebrow">
          {split ? `${split.name} · ${split.mode} mode` : 'Your next workout'}
        </p>
      </div>
      <div className="rolling-recommendation-copy">
        <h2>
          {ready
            ? recommendation.kind === 'rest'
              ? 'A little room to recover.'
              : recommendation.routine.name
            : recommendation.kind === 'unsupported'
              ? 'More scheduling modes are on the way.'
              : recommendation.kind === 'unavailable'
                ? 'Your next slot needs attention.'
                : 'Put your split in motion.'}
        </h2>
        <p>{recommendation.reason}</p>
        {recommendation.kind === 'unsupported' && (
          <p>
            Adaptive recommendations are coming in a later update. Use a Rolling split to follow
            your routine sequence now.
          </p>
        )}
        {recommendation.kind === 'rest' && (
          <p>
            Next up: <strong>{recommendation.routine.name}</strong>
            {recommendation.availableOn && (
              <>
                {' '}
                · Available on{' '}
                <time dateTime={recommendation.availableOn}>{recommendation.availableOn}</time>
              </>
            )}
          </p>
        )}
      </div>
      {ready ? (
        <>
          <div className="workout-routine-meta">
            <span>
              <Clock3 size={15} /> About {estimatedRoutineMinutes(recommendation.routine.exercises)}{' '}
              min
            </span>
            <span>
              {recommendation.routine.exercises.length}{' '}
              {recommendation.routine.exercises.length === 1 ? 'exercise' : 'exercises'}
            </span>
          </div>
          <button
            className={`btn ${recommendation.kind === 'rest' ? 'btn-secondary' : 'btn-primary'}`}
            disabled={blocked}
            onClick={() => (recommendation.kind === 'rest' ? setConfirmEarly(true) : void start())}
          >
            <Play size={17} />
            {starting
              ? 'Starting…'
              : recommendation.kind === 'rest'
                ? 'Train early'
                : 'Start recommended workout'}
          </button>
          {workouts.activeSession && (
            <p className="subtle-caption">
              Finish or resume your current workout before starting the next one.
            </p>
          )}
          {(training.hasPendingWrites || workouts.hasPendingWrites) && (
            <p className="subtle-caption">
              Your next workout is available to start after the latest changes sync.
            </p>
          )}
          {(training.error || workouts.error) && (
            <p className="subtle-caption">
              Resolve the sync error before starting your next split workout.
            </p>
          )}
        </>
      ) : (
        <Link className="btn btn-secondary" to="/plan/splits">
          Manage splits
        </Link>
      )}
      {error && (
        <p className="workout-error" role="alert">
          {error}
        </p>
      )}
      <Dialog.Root
        open={confirmEarly && recommendation.kind === 'rest'}
        onOpenChange={(open) => {
          if (!starting) setConfirmEarly(open)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="dialog-content"
            onEscapeKeyDown={(event) => {
              if (starting) event.preventDefault()
            }}
            onPointerDownOutside={(event) => {
              if (starting) event.preventDefault()
            }}
          >
            <Dialog.Title>Train before your planned rest ends?</Dialog.Title>
            <Dialog.Description>
              Your split has recovery time planned before this workout. Starting early skips the
              remaining rest days. Completing this workout can advance your split.
            </Dialog.Description>
            <div className="workout-dialog-actions">
              <Dialog.Close asChild>
                <button className="btn btn-secondary" disabled={starting}>
                  Keep resting
                </button>
              </Dialog.Close>
              <button
                className="btn btn-primary"
                disabled={blocked}
                onClick={() => void start(true)}
              >
                {starting ? 'Starting…' : 'Start early workout'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}
