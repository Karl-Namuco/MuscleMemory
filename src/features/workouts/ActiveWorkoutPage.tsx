import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, Check, Flag, Plus, Repeat2, Timer, Trash2, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { canCompleteFixed } from '../../domain/scheduling/fixed'
import { canAdvanceRolling, isPartialWorkout } from '../../domain/scheduling/rolling'
import {
  createPlannedSet,
  TRACKING_LABELS,
  weightFromKg,
  weightToKg,
} from '../../domain/training/helpers'
import {
  createLoggedSet,
  previousExercisePerformance,
  substituteWorkoutExercise,
  workoutElapsedSeconds,
  workoutTotals,
} from '../../domain/workout/helpers'
import { workoutExerciseSchema } from '../../schemas/workout'
import { useAuth } from '../../services/auth/AuthProvider'
import { registerLogoutGuard } from '../../services/auth/logoutGuards'
import { useTraining } from '../../services/training/TrainingProvider'
import { useWorkouts } from '../../services/workouts/WorkoutProvider'
import type { Exercise } from '../../types/training'
import type { LoggedSet, WorkoutExercise, WorkoutSession } from '../../types/workout'
import { formatClock, formatSet, formatTarget, formatWorkoutDate } from './format'
import WorkoutSyncStatus from './WorkoutSyncStatus'
import './workouts.css'

// Failed device saves survive an in-app back/forward navigation until the user retries.
// Successful checkpoints are owned by the provider and are removed from this memory fallback.
const failedEditorInputs = new Map<string, { session: WorkoutSession; error: string }>()

export default function ActiveWorkoutPage() {
  const { sessionId } = useParams()
  const workouts = useWorkouts()
  const session =
    workouts.sessions.find((item) => item.id === sessionId) ||
    (workouts.activeSession?.id === sessionId ? workouts.activeSession : null)
  if (workouts.loading && !session) return <p role="status">Loading your workout…</p>
  if (!session)
    return (
      <section className="card workout-empty">
        <h1>Workout unavailable</h1>
        <p>This workout is not available on this device or account.</p>
        <Link className="btn btn-primary" to="/train">
          Back to training
        </Link>
      </section>
    )
  if (session.status !== 'active')
    return (
      <section className="card workout-empty">
        <h1>This workout has ended.</h1>
        <p>Your performed sets are saved in workout history.</p>
        <Link className="btn btn-primary" to={`/history/${session.id}`}>
          View workout
        </Link>
      </section>
    )
  return <WorkoutEditor key={session.id} initial={session} />
}

function WorkoutEditor({ initial }: { initial: WorkoutSession }) {
  const workouts = useWorkouts()
  const training = useTraining()
  const { account, user } = useAuth()
  const navigate = useNavigate()
  const editorKey = `${initial.ownerId}:${initial.id}`
  // A frozen session copy keeps incoming sync snapshots from replacing unfinished input.
  const [session, setSession] = useState(() =>
    structuredClone(failedEditorInputs.get(editorKey)?.session ?? initial),
  )
  const current = useRef(session)
  const [now, setNow] = useState(Date.now)
  const [localSaves, setLocalSaves] = useState(0)
  const [localError, setLocalError] = useState(() => failedEditorInputs.get(editorKey)?.error ?? '')
  const [navigationWarning, setNavigationWarning] = useState(false)
  const saveSequence = useRef(0)
  const [setErrors, setSetErrors] = useState<Record<string, string>>({})
  const [finishStatus, setFinishStatus] = useState<'completed' | 'abandoned' | null>(null)
  const [countForSplit, setCountForSplit] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const finishInFlight = useRef(false)
  const [pickerEntry, setPickerEntry] = useState<string | null>(null)
  const [replacement, setReplacement] = useState<Exercise | null>(null)
  const [removeSet, setRemoveSet] = useState<{ entryId: string; setId: string } | null>(null)
  const weightUnit = account?.preferences.weightUnit || 'kg'
  const readOnly = workouts.loading || workouts.writable === false
  const totals = workoutTotals(session)
  const totalSets = session.exercises.reduce((sum, entry) => sum + entry.sets.length, 0)
  const scheduled = Boolean(session.fixedContext) || session.splitContext?.sequence !== undefined
  const partialScheduled = scheduled && isPartialWorkout(session)
  const resolvingTraining = training.loading || Boolean(training.error) || training.hasPendingWrites
  const activeSplit = training.splits.find((split) => split.id === training.activeSplitId) ?? null
  const completedCandidate: WorkoutSession = {
    ...session,
    status: 'completed',
    completionKey: session.id,
    endedAt: now,
    countsForSplit: true,
  }
  const canCountForSplit =
    scheduled &&
    (session.fixedContext
      ? canCompleteFixed(
          completedCandidate,
          training.fixedSchedules?.find(
            (schedule) => schedule.id === session.fixedContext?.scheduleId,
          ) ?? null,
          activeSplit,
        )
      : canAdvanceRolling(completedCandidate, activeSplit, workouts.rollingProgress))
  const restRemaining =
    session.timerEndAt === null ? 0 : Math.max(0, Math.ceil((session.timerEndAt - now) / 1000))

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const interval = window.setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  useEffect(() => {
    if (!localError && !localSaves) return
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const preventNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return
      const anchor = event.target.closest('a[href]')
      if (!anchor || anchor.getAttribute('href')?.startsWith('#')) return
      if (anchor.hasAttribute('download') || anchor.getAttribute('target') === '_blank') return
      event.preventDefault()
      event.stopPropagation()
      setNavigationWarning(true)
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', preventNavigation, true)
    const unregister = user?.uid
      ? registerLogoutGuard(user.uid, () => {
          throw new Error(
            'Your latest workout edits have not been saved on this device. Return to your workout and retry saving before signing out.',
          )
        })
      : undefined
    return () => {
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', preventNavigation, true)
      unregister?.()
    }
  }, [localError, localSaves, user?.uid])

  function persist(next: WorkoutSession) {
    current.current = next
    setSession(next)
    const failedCopy = failedEditorInputs.get(editorKey)
    if (failedCopy) failedEditorInputs.set(editorKey, { ...failedCopy, session: next })
    const sequence = ++saveSequence.current
    setLocalSaves((count) => count + 1)
    void workouts
      .saveWorkout(next)
      .then(() => {
        if (sequence === saveSequence.current) {
          failedEditorInputs.delete(editorKey)
          setLocalError('')
        }
      })
      .catch((failure: unknown) => {
        if (sequence === saveSequence.current) {
          const error =
            failure instanceof Error
              ? failure.message
              : 'Your latest edit could not be saved on this device. Keep this page open and retry.'
          failedEditorInputs.set(editorKey, { session: next, error })
          setLocalError(error)
        }
      })
      .finally(() => setLocalSaves((count) => count - 1))
  }

  function updateEntry(entryId: string, update: Partial<WorkoutExercise>) {
    persist({
      ...current.current,
      exercises: current.current.exercises.map((entry) =>
        entry.id === entryId ? { ...entry, ...update } : entry,
      ),
    })
  }

  function updateSet(entryId: string, setId: string, update: Partial<LoggedSet>) {
    const entry = current.current.exercises.find((item) => item.id === entryId)!
    updateEntry(entryId, {
      sets: entry.sets.map((set) => (set.id === setId ? { ...set, ...update } : set)),
    })
    setSetErrors((errors) => ({ ...errors, [setId]: '' }))
  }

  function completeSet(entryId: string, setId: string, completed: boolean) {
    const entry = current.current.exercises.find((item) => item.id === entryId)!
    const sets = entry.sets.map((set) =>
      set.id === setId ? { ...set, completedAt: completed ? Date.now() : null } : set,
    )
    const result = workoutExerciseSchema.safeParse({ ...entry, sets })
    if (!result.success) {
      setSetErrors((errors) => ({
        ...errors,
        [setId]:
          'Enter valid actual values for this set before marking it complete. Reps and seconds must be whole numbers; RPE is optional, from 1 to 10.',
      }))
      return
    }
    setSetErrors((errors) => ({ ...errors, [setId]: '' }))
    persist({
      ...current.current,
      timerEndAt:
        completed && entry.restSeconds > 0
          ? Date.now() + entry.restSeconds * 1000
          : current.current.timerEndAt,
      exercises: current.current.exercises.map((item) =>
        item.id === entryId ? { ...entry, sets } : item,
      ),
    })
    setNow(Date.now())
  }

  function addSet(entry: WorkoutExercise) {
    if (entry.sets.length >= 12) return
    updateEntry(entry.id, {
      sets: [
        ...entry.sets,
        createLoggedSet(createPlannedSet(entry.snapshot.trackingType), entry.snapshot.trackingType),
      ],
    })
  }

  function confirmRemoveSet() {
    if (!removeSet) return
    const entry = current.current.exercises.find((item) => item.id === removeSet.entryId)!
    if (entry.sets.length > 1)
      updateEntry(entry.id, { sets: entry.sets.filter((set) => set.id !== removeSet.setId) })
    setRemoveSet(null)
  }

  function substitute() {
    if (!pickerEntry || !replacement) return
    const entry = current.current.exercises.find((item) => item.id === pickerEntry)!
    try {
      updateEntry(entry.id, substituteWorkoutExercise(entry, replacement))
      setPickerEntry(null)
      setReplacement(null)
    } catch (failure) {
      setLocalError(
        failure instanceof Error ? failure.message : 'This exercise could not be substituted.',
      )
    }
  }

  function beginFinish(status: 'completed' | 'abandoned') {
    setCountForSplit(false)
    setFinishStatus(status)
  }

  async function finish() {
    if (!finishStatus || finishInFlight.current) return
    finishInFlight.current = true
    setFinishing(true)
    setLocalError('')
    try {
      if (
        finishStatus === 'completed' &&
        (current.current.fixedContext || current.current.splitContext?.sequence !== undefined) &&
        isPartialWorkout(current.current)
      ) {
        await workouts.finishWorkout(current.current, finishStatus, {
          countForSplit: countForSplit && (canCountForSplit || resolvingTraining),
        })
      } else {
        await workouts.finishWorkout(current.current, finishStatus)
      }
      failedEditorInputs.delete(editorKey)
      navigate(`/history/${current.current.id}`)
    } catch (failure) {
      setLocalError(
        failure instanceof Error
          ? failure.message
          : 'Could not finish this workout. Your input is still here.',
      )
      setFinishStatus(null)
    } finally {
      finishInFlight.current = false
      setFinishing(false)
    }
  }

  return (
    <div className="workout-page page-enter">
      <Link className="workout-back text-link" to="/train">
        <ArrowLeft size={16} /> Back to training · workout stays open
      </Link>
      <div className="page-title-row workout-page-title">
        <div>
          <p className="eyebrow">One set at a time</p>
          <h1 className="page-heading">{session.routineName}</h1>
          <p className="page-description">
            Log the work you actually do. Your plan is here to guide you.
          </p>
        </div>
        <span className="workout-status-badge">Workout in progress</span>
      </div>
      <WorkoutSyncStatus saving={localSaves > 0} />
      {navigationWarning && (localError || localSaves > 0) && (
        <p className="workout-error" role="alert">
          Your latest edits have not been saved on this device. Wait for saving to finish, or
          correct the values and retry before leaving this workout.
        </p>
      )}
      {localError && (
        <div className="workout-error" role="alert">
          {localError}
          <p>Keep this page open until your latest edit is saved.</p>
          <button
            className="btn btn-secondary"
            disabled={readOnly}
            onClick={() => persist(current.current)}
          >
            Retry saving on this device
          </button>
        </div>
      )}
      <section className="card workout-progress" aria-label="Workout progress">
        <div className="workout-stat">
          <strong>
            {totals.completedSets} / {totalSets}
          </strong>
          <span>Sets completed</span>
        </div>
        <div className="workout-stat">
          <strong>{formatClock(workoutElapsedSeconds(session, now))}</strong>
          <span>Elapsed time</span>
        </div>
        <div className="workout-stat">
          <strong>
            {totals.completedExercises} / {session.exercises.length}
          </strong>
          <span>Exercises logged</span>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => beginFinish('completed')}
          disabled={readOnly || finishing || localSaves > 0 || totals.completedSets === 0}
        >
          <Flag size={17} /> Finish workout
        </button>
        <div className="workout-progress-track" aria-hidden="true">
          <span style={{ width: `${totalSets ? (totals.completedSets / totalSets) * 100 : 0}%` }} />
        </div>
      </section>
      {session.timerEndAt !== null && (
        <section className="card workout-rest" aria-label="Rest timer">
          <Timer size={24} aria-hidden="true" />
          <div className="workout-rest-copy">
            <strong>{formatClock(restRemaining)}</strong>
            <span>
              {restRemaining > 0 ? 'Rest between sets' : 'Rest complete. Ready when you are.'}
            </span>
          </div>
          <div className="workout-rest-controls">
            <button
              className="btn btn-secondary"
              disabled={readOnly || finishing}
              onClick={() => {
                persist({
                  ...current.current,
                  timerEndAt: Math.max(Date.now(), current.current.timerEndAt || 0) + 30000,
                })
                setNow(Date.now())
              }}
            >
              +30 seconds
            </button>
            <button
              className="btn btn-ghost"
              disabled={readOnly || finishing}
              onClick={() => persist({ ...current.current, timerEndAt: null })}
            >
              Dismiss timer
            </button>
          </div>
          <p className="subtle-caption">
            The timer uses elapsed time and resumes after a reload. It does not send background
            alerts.
          </p>
        </section>
      )}
      <div className="workout-exercise-list">
        {session.exercises.map((entry, index) => {
          const tracking = entry.snapshot.trackingType
          const hasReps = ['weight-reps', 'reps', 'assisted-reps'].includes(tracking)
          const hasWeight = tracking === 'weight-reps' || tracking === 'assisted-reps'
          const previous = previousExercisePerformance(
            workouts.sessions,
            entry.exerciseId,
            session.id,
          )
          const hasCompleted = entry.sets.some((set) => set.completedAt !== null)
          return (
            <section
              className="card workout-exercise"
              key={entry.id}
              aria-labelledby={`workout-exercise-${entry.id}`}
            >
              <div className="workout-exercise-top">
                <span className="workout-exercise-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="workout-exercise-heading">
                  <h2 id={`workout-exercise-${entry.id}`}>{entry.snapshot.name}</h2>
                  <p>
                    {entry.snapshot.equipment} · {TRACKING_LABELS[tracking]}
                    {entry.optional ? ' · Optional' : ''}
                    {entry.originalExerciseId ? ' · Substituted this session' : ''}
                  </p>
                  {entry.supersetGroup && (
                    <span className="workout-superset">
                      Superset {entry.supersetGroup} · alternate with your group
                    </span>
                  )}
                </div>
                <button
                  className="btn btn-secondary compact-button"
                  aria-label={`Substitute ${entry.snapshot.name}`}
                  disabled={readOnly || hasCompleted || finishing}
                  onClick={() => {
                    setReplacement(null)
                    setPickerEntry(entry.id)
                  }}
                >
                  <Repeat2 size={16} /> Substitute
                </button>
              </div>
              <p className="workout-plan-note">
                Planned:{' '}
                {entry.plannedSets
                  .map((set) => formatTarget(set, entry.snapshot, weightUnit))
                  .join(' / ')}
                . Rest {entry.restSeconds} sec.
              </p>
              {hasCompleted && (
                <p className="subtle-caption">
                  Substitution is locked while this exercise has completed sets, so performed work
                  stays with the correct exercise.
                </p>
              )}
              {previous ? (
                <div className="workout-previous">
                  <strong>Last time · {formatWorkoutDate(previous.performedAt)}</strong>
                  <br />
                  {previous.sets
                    .map((set) => formatSet(set, previous.snapshot, weightUnit))
                    .join(' / ')}
                  <br />
                  <Link className="text-link" to={`/history/${previous.sessionId}`}>
                    View previous workout
                  </Link>
                </div>
              ) : (
                <p className="subtle-caption">
                  No completed performance recorded for this exercise yet.
                </p>
              )}
              <div className="workout-sets">
                {entry.sets.map((set, setIndex) => {
                  const done = set.completedAt !== null
                  return (
                    <fieldset
                      className={`workout-set ${done ? 'workout-set-done' : ''}`}
                      key={set.id}
                      disabled={readOnly || finishing}
                    >
                      <legend className="workout-sr-only">
                        {entry.snapshot.name}, set {setIndex + 1}
                      </legend>
                      <span className="workout-set-number">{setIndex + 1}</span>
                      <div className="workout-set-fields">
                        {hasWeight && (
                          <ActualWeight
                            label={tracking === 'assisted-reps' ? 'Assistance' : 'Weight'}
                            id={`${set.id}-weight`}
                            unitLabel={`Weight unit for set ${setIndex + 1} of ${entry.snapshot.name}`}
                            unit={set.inputWeightUnit ?? weightUnit}
                            weightKg={set.weightKg}
                            disabled={done}
                            changeUnit={(unit) =>
                              updateSet(entry.id, set.id, { inputWeightUnit: unit })
                            }
                            update={(value, unit) =>
                              updateSet(entry.id, set.id, {
                                weightKg: value,
                                inputWeightUnit: unit,
                              })
                            }
                          />
                        )}
                        {hasReps && (
                          <ActualNumber
                            label="Reps"
                            id={`${set.id}-reps`}
                            value={set.reps}
                            min={1}
                            max={1000}
                            disabled={done}
                            update={(value) => updateSet(entry.id, set.id, { reps: value })}
                          />
                        )}
                        {!hasReps && (
                          <ActualNumber
                            label="Duration (sec)"
                            id={`${set.id}-duration`}
                            value={set.durationSeconds}
                            min={1}
                            max={86400}
                            disabled={done}
                            update={(value) =>
                              updateSet(entry.id, set.id, { durationSeconds: value })
                            }
                          />
                        )}
                        {tracking === 'distance-duration' && (
                          <ActualNumber
                            label="Distance (m)"
                            id={`${set.id}-distance`}
                            value={set.distanceMeters}
                            min={1}
                            max={1000000}
                            step="any"
                            disabled={done}
                            update={(value) =>
                              updateSet(entry.id, set.id, { distanceMeters: value })
                            }
                          />
                        )}
                        <ActualNumber
                          label="RPE (optional)"
                          id={`${set.id}-rpe`}
                          value={set.rpe}
                          min={1}
                          max={10}
                          step={0.5}
                          disabled={done}
                          update={(value) => updateSet(entry.id, set.id, { rpe: value })}
                        />
                      </div>
                      <label className="workout-set-check">
                        <input
                          type="checkbox"
                          aria-label={`Complete set ${setIndex + 1} of ${entry.snapshot.name}`}
                          checked={done}
                          onChange={(event) => completeSet(entry.id, set.id, event.target.checked)}
                        />
                        <Check size={20} aria-hidden="true" />
                      </label>
                      <button
                        className="icon-button"
                        disabled={entry.sets.length <= 1}
                        aria-label={`Remove set ${setIndex + 1} from ${entry.snapshot.name}`}
                        onClick={() => setRemoveSet({ entryId: entry.id, setId: set.id })}
                      >
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                      <div className="workout-set-target">
                        <span>
                          {set.type === 'warmup'
                            ? 'Warm-up'
                            : set.type === 'drop'
                              ? 'Drop set'
                              : set.type === 'other'
                                ? 'Other set'
                                : 'Working set'}
                        </span>
                        {done
                          ? ' · Uncheck to edit actuals'
                          : ' · Enter actuals, then check to complete'}
                      </div>
                      {setErrors[set.id] && (
                        <p className="workout-field-error" role="alert">
                          {setErrors[set.id]}
                        </p>
                      )}
                    </fieldset>
                  )
                })}
              </div>
              <div className="workout-set-footer">
                <button
                  className="btn btn-ghost"
                  disabled={readOnly || entry.sets.length >= 12 || finishing}
                  onClick={() => addSet(entry)}
                  aria-label={`Add set to ${entry.snapshot.name}`}
                >
                  <Plus size={16} /> Add set
                </button>
                <span className="subtle-caption">
                  {entry.sets.length} / 12 sets · RPE is effort from 1 to 10
                </span>
              </div>
              {tracking === 'assisted-reps' && (
                <p className="subtle-caption">
                  Assistance is the weight helping you move. Less assistance means more resistance.
                </p>
              )}
              <div className="field">
                <label htmlFor={`${entry.id}-notes`}>Exercise notes (optional)</label>
                <textarea
                  className="input"
                  id={`${entry.id}-notes`}
                  maxLength={1000}
                  value={entry.notes}
                  disabled={readOnly || finishing}
                  onChange={(event) => updateEntry(entry.id, { notes: event.target.value })}
                  placeholder="Cues, equipment setup, how it felt"
                />
              </div>
            </section>
          )
        })}
      </div>
      <section className="card workout-session-notes">
        <h2>Your session notes</h2>
        <div className="field">
          <label htmlFor="workout-notes">Workout notes (optional)</label>
          <textarea
            id="workout-notes"
            className="input"
            value={session.notes}
            disabled={readOnly || finishing}
            maxLength={2000}
            onChange={(event) => persist({ ...current.current, notes: event.target.value })}
            placeholder="A little context for your next session"
          />
        </div>
        <div className="subtle-caption">
          Your notes belong to this workout. Your routine stays as you planned it.
        </div>
      </section>
      <div className="workout-bottom-actions">
        <p>
          Finish when you are done. Incomplete sets stay incomplete, and only performed sets count
          toward your totals.
        </p>
        <div>
          <button
            className="btn btn-ghost"
            disabled={readOnly || finishing || localSaves > 0}
            onClick={() => beginFinish('abandoned')}
          >
            End early
          </button>
          <button
            className="btn btn-primary"
            disabled={readOnly || finishing || localSaves > 0 || totals.completedSets === 0}
            onClick={() => beginFinish('completed')}
          >
            Finish workout
          </button>
        </div>
      </div>
      <Dialog.Root
        open={finishStatus !== null}
        onOpenChange={(open) => {
          if (!open && !finishing) setFinishStatus(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="dialog-content"
            onEscapeKeyDown={(event) => {
              if (finishing) event.preventDefault()
            }}
            onPointerDownOutside={(event) => {
              if (finishing) event.preventDefault()
            }}
          >
            <Dialog.Title>
              {finishStatus === 'abandoned' ? 'End this workout early?' : 'Finish this workout?'}
            </Dialog.Title>
            <Dialog.Description>
              {totals.completedSets} of {totalSets} sets completed across{' '}
              {totals.completedExercises} exercises. {totalSets - totals.completedSets} sets are
              incomplete.{' '}
              {finishStatus === 'abandoned'
                ? 'Your performed work and notes will be kept in history with an ended early label.'
                : 'Your actual completed sets and notes will be kept in history. This workout cannot be edited after it ends.'}
            </Dialog.Description>
            {finishStatus === 'completed' &&
              partialScheduled &&
              (canCountForSplit || resolvingTraining) && (
                <div className="workout-split-choice">
                  <p>
                    {resolvingTraining
                      ? 'Split progress will be checked after your training plan finishes loading or synchronizing. Choose whether to count this partial workout when it can be checked.'
                      : 'This is a partial workout. Your split stays on this slot unless you choose to count it.'}
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={countForSplit}
                      disabled={readOnly || finishing}
                      onChange={(event) => setCountForSplit(event.target.checked)}
                    />
                    Count this workout toward my split
                  </label>
                </div>
              )}
            {scheduled &&
              (finishStatus === 'abandoned' ||
                !partialScheduled ||
                (!canCountForSplit && !resolvingTraining)) && (
                <p className="subtle-caption">
                  {finishStatus === 'abandoned'
                    ? 'Ending early saves your performed work without advancing your split.'
                    : resolvingTraining
                      ? 'Split progress will be checked after your training plan finishes loading or synchronizing.'
                      : canCountForSplit
                        ? 'Completing all planned work counts this workout toward your split.'
                        : 'Your performed work will be saved without advancing your split because its active plan or next slot has changed.'}
                </p>
              )}
            <div className="workout-dialog-actions">
              <Dialog.Close asChild>
                <button className="btn btn-secondary" disabled={finishing}>
                  Keep training
                </button>
              </Dialog.Close>
              <button
                className="btn btn-primary"
                disabled={readOnly || finishing}
                onClick={() => void finish()}
              >
                {finishing
                  ? 'Saving workout…'
                  : finishStatus === 'abandoned'
                    ? 'End early and keep work'
                    : 'Finish and save'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={removeSet !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveSet(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>Remove this logged set?</Dialog.Title>
            <Dialog.Description>
              Its entered values and completion will be removed from this workout. Your original
              routine and planned targets stay the same.
            </Dialog.Description>
            <div className="workout-dialog-actions">
              <Dialog.Close asChild>
                <button className="btn btn-secondary">Keep set</button>
              </Dialog.Close>
              <button className="btn btn-primary" disabled={readOnly} onClick={confirmRemoveSet}>
                Remove set
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <SubstitutionPicker
        open={pickerEntry !== null}
        close={() => {
          setPickerEntry(null)
          setReplacement(null)
        }}
        exercises={training.exercises}
        currentExerciseId={session.exercises.find((entry) => entry.id === pickerEntry)?.exerciseId}
        replacement={replacement}
        choose={setReplacement}
        confirm={substitute}
        disabled={readOnly || finishing}
      />
    </div>
  )
}

function ActualNumber({
  label,
  id,
  value,
  min,
  max,
  step = 1,
  disabled,
  update,
}: {
  label: string
  id: string
  value: number | null
  min: number
  max: number
  step?: number | 'any'
  disabled: boolean
  update: (value: number | null) => void
}) {
  const invalid =
    value !== null && (value < min || value > max || (step === 1 && !Number.isInteger(value)))
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type="number"
        inputMode={step === 1 ? 'numeric' : 'decimal'}
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        placeholder="—"
        onChange={(event) =>
          update(
            event.target.value === '' || !Number.isFinite(event.target.valueAsNumber)
              ? null
              : event.target.valueAsNumber,
          )
        }
      />
      {invalid && (
        <small id={`${id}-error`} className="workout-field-error">
          Enter {step === 1 ? 'a whole number' : 'a number'} from {min} to {max}.
        </small>
      )}
    </div>
  )
}

function ActualWeight({
  label,
  id,
  unitLabel,
  unit,
  weightKg,
  disabled,
  changeUnit,
  update,
}: {
  label: string
  id: string
  unitLabel: string
  unit: 'kg' | 'lb'
  weightKg: number | null
  disabled: boolean
  changeUnit: (unit: 'kg' | 'lb') => void
  update: (value: number | null, unit: 'kg' | 'lb') => void
}) {
  // Preserve decimal input while deriving unit changes from canonical kg. A rounded
  // display value never feeds back into saved performance just because units change.
  const [draft, setDraft] = useState(() => ({
    unit,
    weightKg,
    text: weightKg === null ? '' : String(weightFromKg(weightKg, unit)),
  }))
  const input =
    draft.unit === unit && draft.weightKg === weightKg
      ? draft.text
      : weightKg === null
        ? ''
        : String(weightFromKg(weightKg, unit))
  const invalid = weightKg !== null && (weightKg < 0 || weightKg > 10000)
  const conversion = unit === 'lb' && weightKg !== null && !invalid
  return (
    <div className="field workout-weight-field">
      <label htmlFor={id}>
        {label} ({unit})
      </label>
      <div className="workout-weight-controls">
        <input
          id={id}
          className="input"
          type="number"
          inputMode="decimal"
          value={input}
          min={0}
          step="any"
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : conversion ? `${id}-conversion` : undefined}
          placeholder="—"
          onChange={(event) => {
            const value =
              event.target.value === '' || !Number.isFinite(event.target.valueAsNumber)
                ? null
                : weightToKg(event.target.valueAsNumber, unit)
            setDraft({ unit, weightKg: value, text: event.target.value })
            update(value, unit)
          }}
        />
        <select
          className="input"
          aria-label={unitLabel}
          value={unit}
          disabled={disabled}
          onChange={(event) => changeUnit(event.target.value as 'kg' | 'lb')}
        >
          <option value="kg">kg</option>
          <option value="lb">lb</option>
        </select>
      </div>
      {conversion && (
        <small id={`${id}-conversion`} className="workout-weight-conversion">
          ≈ {weightKg} kg
        </small>
      )}
      {invalid && (
        <small id={`${id}-error`} className="workout-field-error">
          Enter a weight equivalent to 0–10,000 kg.
        </small>
      )}
    </div>
  )
}

function SubstitutionPicker({
  open,
  close,
  exercises,
  currentExerciseId,
  replacement,
  choose,
  confirm,
  disabled,
}: {
  open: boolean
  close: () => void
  exercises: Exercise[]
  currentExerciseId: string | undefined
  replacement: Exercise | null
  choose: (exercise: Exercise) => void
  confirm: () => void
  disabled: boolean
}) {
  const [query, setQuery] = useState('')
  const matches = exercises.filter(
    (exercise) =>
      !exercise.archived &&
      exercise.id !== currentExerciseId &&
      `${exercise.name} ${exercise.aliases.join(' ')} ${exercise.equipment}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  )
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) close()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content workout-picker">
          <Dialog.Title>
            {replacement ? `Use ${replacement.name}?` : 'Substitute an exercise'}
          </Dialog.Title>
          <Dialog.Description>
            {replacement
              ? 'This changes only the current workout. Any incomplete actual values for this exercise will be cleared, and the replacement gets fresh planning targets. Enter fresh actual values for the replacement.'
              : 'Choose the movement you will actually perform. Your original routine stays the same.'}
          </Dialog.Description>
          <Dialog.Close asChild>
            <button
              className="icon-button workout-dialog-close"
              aria-label="Close substitution picker"
            >
              <X size={20} />
            </button>
          </Dialog.Close>
          {replacement ? (
            <div className="workout-dialog-actions">
              <button className="btn btn-secondary" onClick={close}>
                Keep original
              </button>
              <button className="btn btn-primary" disabled={disabled} onClick={confirm}>
                Use replacement
              </button>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="workout-exercise-search">Search exercises</label>
                <input
                  id="workout-exercise-search"
                  className="input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name or equipment"
                />
              </div>
              <div className="workout-picker-list">
                {matches.slice(0, 80).map((exercise) => (
                  <button key={exercise.id} onClick={() => choose(exercise)}>
                    <strong>{exercise.name}</strong>
                    <small>
                      {exercise.equipment} · {TRACKING_LABELS[exercise.trackingType]} ·{' '}
                      {exercise.primaryMuscles.join(', ')}
                    </small>
                  </button>
                ))}
                {matches.length === 0 && (
                  <p className="muted">No matching exercises. Try a different name or equipment.</p>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
