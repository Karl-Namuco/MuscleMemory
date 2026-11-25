import { useEffect, useRef, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowDown, ArrowUp, Clock3, Plus, Search, Trash2, X } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  createPlannedSet,
  createRoutineExercise,
  estimatedRoutineMinutes,
  TRACKING_LABELS,
  weightFromKg,
  weightToKg,
} from '../../domain/training/helpers'
import { routineInputSchema } from '../../schemas/training'
import { useAuth } from '../../services/auth/AuthProvider'
import { useTraining } from '../../services/training/TrainingProvider'
import {
  EXERCISE_EQUIPMENT,
  MUSCLE_GROUPS,
  type Exercise,
  type PlannedSet,
  type Routine,
  type RoutineExercise,
  type RoutineInput,
} from '../../types/training'
import { clearRoutineDraft, readRoutineDraft, saveRoutineDraft } from './draft'
import './routines.css'

const emptyRoutine = (): RoutineInput => ({
  name: '',
  description: '',
  targetMuscles: [],
  exercises: [],
})
const inputFromRoutine = (routine: Routine): RoutineInput =>
  structuredClone({
    name: routine.name,
    description: routine.description,
    targetMuscles: routine.targetMuscles,
    exercises: routine.exercises,
  })
type FieldErrors = Record<string, string>

export default function RoutineEditorPage() {
  const { routineId } = useParams()
  const [params] = useSearchParams()
  return (
    <RoutineEditor
      key={`${routineId || 'new'}:${params.toString()}`}
      routineId={routineId}
      duplicateId={params.get('duplicate')}
      exerciseId={params.get('exercise')}
    />
  )
}

function RoutineEditor({
  routineId,
  duplicateId,
  exerciseId,
}: {
  routineId?: string
  duplicateId: string | null
  exerciseId: string | null
}) {
  const training = useTraining()
  const { user, account } = useAuth()
  const navigate = useNavigate()
  const uid = user?.uid
  const routeKey = routineId || `new:${duplicateId || exerciseId || 'blank'}`
  const [input, setInput] = useState<RoutineInput>(emptyRoutine)
  const [recordId, setRecordId] = useState(() => routineId || crypto.randomUUID())
  const [expectedRevision, setExpectedRevision] = useState<number | undefined>()
  const [initialized, setInitialized] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [savedInput, setSavedInput] = useState<string | null>(null)
  const [baseline, setBaseline] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [removeEntry, setRemoveEntry] = useState<RoutineExercise | null>(null)
  const inFlight = useRef(false)
  const initializedRef = useRef(false)
  const errorSummary = useRef<HTMLDivElement>(null)
  const allowNavigation = useRef(false)
  const liveRoutine = training.routines.find((routine) => routine.id === recordId)
  const archived = Boolean(liveRoutine?.archived)
  const weightUnit = account?.preferences.weightUnit || 'kg'
  const dirty = initialized && JSON.stringify(input) !== baseline
  const concurrentlyChanged =
    initialized &&
    expectedRevision !== undefined &&
    liveRoutine &&
    liveRoutine.revision !== expectedRevision &&
    !saving

  useEffect(() => {
    if (!uid || training.loading || initializedRef.current) return
    initializedRef.current = true
    let cancelled = false
    const original = routineId
      ? training.routines.find((routine) => routine.id === routineId)
      : duplicateId
        ? training.routines.find((routine) => routine.id === duplicateId)
        : undefined
    if ((routineId || duplicateId) && !original) {
      setNotFound(true)
      setInitialized(true)
      return
    }
    let initial = original ? inputFromRoutine(original) : emptyRoutine()
    if (duplicateId && original) {
      initial = {
        ...initial,
        name: `${original.name} copy`.slice(0, 80),
        exercises: initial.exercises.map((entry) => ({
          ...entry,
          id: crypto.randomUUID(),
          sets: entry.sets.map((set) => ({ ...set, id: crypto.randomUUID() })),
        })),
      }
    }
    if (!routineId && !duplicateId && exerciseId) {
      const exercise = training.exercises.find((item) => item.id === exerciseId && !item.archived)
      if (exercise) initial.exercises = [createRoutineExercise(exercise)]
    }
    setBaseline(JSON.stringify(routineId && original ? inputFromRoutine(original) : emptyRoutine()))
    setInput(initial)
    setExpectedRevision(routineId ? original?.revision : undefined)
    void readRoutineDraft(uid, routeKey)
      .then((draft) => {
        if (cancelled) return
        if (
          draft &&
          typeof draft.recordId === 'string' &&
          draft.input &&
          typeof draft.input.name === 'string' &&
          Array.isArray(draft.input.exercises) &&
          Array.isArray(draft.input.targetMuscles)
        ) {
          setInput(draft.input)
          setRecordId(draft.recordId)
          setExpectedRevision(draft.expectedRevision)
          setSavedInput(draft.savedInput)
          if (draft.savedInput) setBaseline(draft.savedInput)
          setDraftMessage('Your routine draft was restored from this device.')
        }
      })
      .catch(() => {
        if (!cancelled)
          setDraftMessage(
            'Local draft storage is unavailable. Keep this page open until your routine is saved.',
          )
      })
      .finally(() => {
        if (!cancelled) setInitialized(true)
      })
    return () => {
      cancelled = true
      initializedRef.current = false
    }
    // Initialization takes a frozen copy: live changes must never overwrite edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, training.loading, routeKey])

  useEffect(() => {
    if (!initialized || !uid || notFound || (!dirty && !savedInput)) return
    const timeout = setTimeout(() => {
      void saveRoutineDraft({
        key: `${uid}:${routeKey}`,
        uid,
        recordId,
        expectedRevision,
        input,
        savedInput,
        savedAt: Date.now(),
      }).catch(() =>
        setDraftMessage(
          'Local draft storage is unavailable. Keep this page open until your routine is saved.',
        ),
      )
    }, 250)
    return () => clearTimeout(timeout)
  }, [initialized, uid, routeKey, recordId, expectedRevision, input, savedInput, dirty, notFound])

  useEffect(() => {
    if (
      !uid ||
      !savedInput ||
      dirty ||
      !liveRoutine ||
      training.hasPendingWrites ||
      training.fromCache
    )
      return
    if (JSON.stringify(inputFromRoutine(liveRoutine)) === savedInput) {
      void clearRoutineDraft(uid, routeKey).catch(() => undefined)
      setSavedInput(null)
      setDraftMessage('Saved to your account. Your routine is ready to use in a split.')
    }
  }, [uid, savedInput, dirty, liveRoutine, training.hasPendingWrites, training.fromCache, routeKey])

  useEffect(() => {
    if (!dirty) return
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const navigateClick = (event: MouseEvent) => {
      if (allowNavigation.current || event.defaultPrevented) return
      const anchor = (event.target as Element | null)?.closest('a[href]')
      if (!anchor || anchor.getAttribute('href')?.startsWith('#')) return
      if (!window.confirm('Leave this routine? Your unfinished draft will stay on this device.')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', navigateClick, true)
    return () => {
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', navigateClick, true)
    }
  }, [dirty])

  function updateEntry(id: string, update: Partial<RoutineExercise>) {
    setInput((current) => ({
      ...current,
      exercises: current.exercises.map((entry) =>
        entry.id === id ? { ...entry, ...update } : entry,
      ),
    }))
    setErrors({})
  }
  function updateSet(entry: RoutineExercise, setId: string, update: Partial<PlannedSet>) {
    updateEntry(entry.id, {
      sets: entry.sets.map((set) => (set.id === setId ? { ...set, ...update } : set)),
    })
  }
  function move(index: number, direction: number) {
    setInput((current) => {
      const exercises = [...current.exercises]
      ;[exercises[index], exercises[index + direction]] = [
        exercises[index + direction],
        exercises[index],
      ]
      return { ...current, exercises }
    })
    setErrors({})
  }
  function remove(id: string) {
    setInput((current) => ({
      ...current,
      exercises: current.exercises.filter((entry) => entry.id !== id),
    }))
    setRemoveEntry(null)
    setErrors({})
  }
  function leave() {
    if (
      dirty &&
      !window.confirm('Leave this routine? Your unfinished draft will stay on this device.')
    )
      return
    allowNavigation.current = true
    navigate('/plan/routines')
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || archived || !uid) return
    const result = routineInputSchema.safeParse(input)
    if (!result.success) {
      const next: FieldErrors = {}
      for (const issue of result.error.issues) next[issue.path.join('.')] ||= issue.message
      setErrors(next)
      setError('Check the highlighted fields before saving your routine.')
      setTimeout(() => errorSummary.current?.focus(), 0)
      return
    }
    inFlight.current = true
    setSaving(true)
    setError('')
    setErrors({})
    try {
      const serialized = JSON.stringify(result.data)
      // Persist before dispatch. A cloud rejection must not discard the builder.
      await saveRoutineDraft({
        key: `${uid}:${routeKey}`,
        uid,
        recordId,
        expectedRevision,
        input: result.data,
        savedInput: null,
        savedAt: Date.now(),
      })
      await training.saveRoutine(result.data, { id: recordId, expectedRevision })
      const nextRevision = expectedRevision === undefined ? 1 : expectedRevision + 1
      setExpectedRevision(nextRevision)
      setInput(result.data)
      setBaseline(serialized)
      setSavedInput(serialized)
      setDraftMessage('Saved on this device. Waiting for cloud confirmation.')
      await saveRoutineDraft({
        key: `${uid}:${routeKey}`,
        uid,
        recordId,
        expectedRevision: nextRevision,
        input: result.data,
        savedInput: serialized,
        savedAt: Date.now(),
      })
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not save this routine. Your draft is still on this device.',
      )
    } finally {
      setSaving(false)
      inFlight.current = false
    }
  }

  if (!initialized) return <p role="status">Loading routine builder…</p>
  if (notFound)
    return (
      <section className="card routine-empty">
        <h1>Routine unavailable</h1>
        <p>It may have been removed or is not stored on this device.</p>
        <button className="btn btn-primary" onClick={leave}>
          Back to routines
        </button>
      </section>
    )

  return (
    <div className="routines-page routine-editor">
      <button className="text-link routine-back" type="button" onClick={leave}>
        ← Routines
      </button>
      <div className="page-title-row routine-page-heading">
        <div>
          <p className="eyebrow">Make it your own</p>
          <h1 className="page-heading">
            {routineId ? 'Edit routine' : duplicateId ? 'Duplicate routine' : 'Build a routine'}
          </h1>
          <p className="page-description">A clear plan for every set.</p>
        </div>
        <span className="routine-estimate">
          <Clock3 size={17} aria-hidden="true" />{' '}
          {input.exercises.length
            ? `Estimated ${estimatedRoutineMinutes(input.exercises)} min`
            : 'Add exercises to estimate time'}
        </span>
      </div>
      {draftMessage && (
        <div className="notice" role="status">
          {draftMessage}
        </div>
      )}
      {concurrentlyChanged && (
        <div className="notice" role="alert">
          This routine changed in another tab or device. Your edits are preserved, but saving may be
          rejected. Return to routines and reopen the latest version before editing again.
        </div>
      )}
      {archived && (
        <div className="notice">
          This routine is archived. Restore it from the routine list before editing.
        </div>
      )}
      {(error || training.error) && (
        <div ref={errorSummary} tabIndex={-1} role="alert" className="notice">
          <p>{error || training.error}</p>
          {Object.keys(errors).length > 0 && (
            <ul>
              {Object.entries(errors).map(([path, message]) => (
                <li key={path}>
                  <a href={`#routine-${path.replaceAll('.', '-')}`}>{message}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <form onSubmit={(event) => void save(event)} noValidate>
        <fieldset disabled={saving || archived} className="routine-fieldset">
          <section className="card routine-basics">
            <h2>Routine details</h2>
            <div className="field">
              <label htmlFor="routine-name">Routine name</label>
              <input
                id="routine-name"
                className="input"
                value={input.name}
                maxLength={80}
                placeholder="e.g. Upper body A"
                onChange={(event) => setInput({ ...input, name: event.target.value })}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'error-name' : undefined}
              />
              <FieldError path="name" errors={errors} />
            </div>
            <div className="field">
              <label htmlFor="routine-description">
                Description <span className="muted">(optional)</span>
              </label>
              <textarea
                id="routine-description"
                className="input"
                value={input.description}
                maxLength={1000}
                placeholder="What is the focus of this session?"
                onChange={(event) => setInput({ ...input, description: event.target.value })}
                aria-invalid={Boolean(errors.description)}
              />
              <FieldError path="description" errors={errors} />
            </div>
            <fieldset className="routine-fieldset">
              <legend>
                Target muscles <span className="muted">(optional)</span>
              </legend>
              <div className="routine-muscle-options" id="routine-targetMuscles">
                {MUSCLE_GROUPS.map((muscle) => (
                  <button
                    type="button"
                    className="choice-chip"
                    aria-pressed={input.targetMuscles.includes(muscle)}
                    key={muscle}
                    onClick={() =>
                      setInput({
                        ...input,
                        targetMuscles: input.targetMuscles.includes(muscle)
                          ? input.targetMuscles.filter((item) => item !== muscle)
                          : [...input.targetMuscles, muscle],
                      })
                    }
                  >
                    {muscle}
                  </button>
                ))}
              </div>
              <FieldError path="targetMuscles" errors={errors} />
            </fieldset>
          </section>
          <div className="routine-section-heading">
            <div>
              <h2>Exercises</h2>
              <p className="muted">Arrange the session in the order you plan to train.</p>
            </div>
            <span className="routine-meta">{input.exercises.length} / 20</span>
          </div>
          <div id="routine-exercises">
            <FieldError path="exercises" errors={errors} />
          </div>
          {input.exercises.length === 0 && (
            <div className="routine-empty routine-add-empty">
              <Plus size={26} aria-hidden="true" />
              <p>Your routine is a blank slate.</p>
              <p className="muted">
                Add an exercise from the library to set up your first working sets.
              </p>
            </div>
          )}
          <div className="routine-exercise-list">
            {input.exercises.map((entry, index) => {
              const prefix = `exercises.${index}`
              const tracking = entry.exerciseSnapshot.trackingType
              const hasReps = ['weight-reps', 'reps', 'assisted-reps'].includes(tracking)
              const hasWeight = tracking === 'weight-reps' || tracking === 'assisted-reps'
              return (
                <section
                  className="card routine-exercise-card"
                  key={entry.id}
                  aria-labelledby={`exercise-${entry.id}`}
                >
                  <div className="routine-exercise-top">
                    <span className="routine-order">{String(index + 1).padStart(2, '0')}</span>
                    <div className="routine-exercise-title">
                      <h3 id={`exercise-${entry.id}`}>{entry.exerciseSnapshot.name}</h3>
                      <p>
                        {entry.exerciseSnapshot.equipment} · {TRACKING_LABELS[tracking]}
                      </p>
                    </div>
                    <div className="routine-order-controls">
                      <button
                        type="button"
                        className="icon-button"
                        disabled={index === 0}
                        aria-label={`Move ${entry.exerciseSnapshot.name} up`}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp size={18} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={index === input.exercises.length - 1}
                        aria-label={`Move ${entry.exerciseSnapshot.name} down`}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown size={18} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove ${entry.exerciseSnapshot.name}`}
                        onClick={() => setRemoveEntry(entry)}
                      >
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <FieldError path={`${prefix}.exerciseSnapshot`} errors={errors} />
                  <div className="routine-set-list">
                    {entry.sets.map((set, setIndex) => (
                      <fieldset
                        className="routine-set-row"
                        id={`routine-exercises-${index}-sets-${setIndex}`}
                        key={set.id}
                      >
                        <legend className="routine-visually-hidden">
                          {entry.exerciseSnapshot.name}, set {setIndex + 1}
                        </legend>
                        <span className="routine-set-number">{setIndex + 1}</span>
                        <div className="field">
                          <label htmlFor={`routine-exercises-${index}-sets-${setIndex}-type`}>
                            Set type
                          </label>
                          <select
                            className="select"
                            id={`routine-exercises-${index}-sets-${setIndex}-type`}
                            value={set.type}
                            onChange={(event) =>
                              updateSet(entry, set.id, {
                                type: event.target.value as PlannedSet['type'],
                              })
                            }
                          >
                            <option value="warmup">Warm-up</option>
                            <option value="working">Working</option>
                            <option value="drop">Drop</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        {hasReps && (
                          <>
                            <NumberField
                              label="Min reps"
                              path={`${prefix}.sets.${setIndex}.repsMin`}
                              value={set.repsMin}
                              min={1}
                              max={1000}
                              step={1}
                              errors={errors}
                              update={(value) => updateSet(entry, set.id, { repsMin: value })}
                            />
                            <NumberField
                              label="Max reps"
                              path={`${prefix}.sets.${setIndex}.repsMax`}
                              value={set.repsMax}
                              min={1}
                              max={1000}
                              step={1}
                              errors={errors}
                              update={(value) => updateSet(entry, set.id, { repsMax: value })}
                            />
                          </>
                        )}
                        {hasWeight && (
                          <NumberField
                            label={`${tracking === 'assisted-reps' ? 'Assistance' : 'Weight'} (${weightUnit})`}
                            path={`${prefix}.sets.${setIndex}.targetWeightKg`}
                            value={
                              set.targetWeightKg === null
                                ? null
                                : weightFromKg(set.targetWeightKg, weightUnit)
                            }
                            min={0}
                            max={weightUnit === 'kg' ? 2000 : 4409}
                            step={0.25}
                            optional
                            errors={errors}
                            update={(value) =>
                              updateSet(entry, set.id, {
                                targetWeightKg:
                                  value === null ? null : weightToKg(value, weightUnit),
                              })
                            }
                          />
                        )}
                        {!hasReps && (
                          <NumberField
                            label="Duration (sec)"
                            path={`${prefix}.sets.${setIndex}.durationSeconds`}
                            value={set.durationSeconds}
                            min={1}
                            max={86400}
                            step={1}
                            errors={errors}
                            update={(value) => updateSet(entry, set.id, { durationSeconds: value })}
                          />
                        )}
                        {tracking === 'distance-duration' && (
                          <NumberField
                            label="Distance (m)"
                            path={`${prefix}.sets.${setIndex}.distanceMeters`}
                            value={set.distanceMeters}
                            min={1}
                            max={1000000}
                            step={1}
                            errors={errors}
                            update={(value) => updateSet(entry, set.id, { distanceMeters: value })}
                          />
                        )}
                        <button
                          type="button"
                          className="icon-button routine-remove-set"
                          disabled={entry.sets.length <= 1}
                          aria-label={`Remove set ${setIndex + 1} from ${entry.exerciseSnapshot.name}`}
                          onClick={() =>
                            updateEntry(entry.id, {
                              sets: entry.sets.filter((item) => item.id !== set.id),
                            })
                          }
                        >
                          <X size={17} aria-hidden="true" />
                        </button>
                        <FieldError path={`${prefix}.sets.${setIndex}`} errors={errors} />
                      </fieldset>
                    ))}
                  </div>
                  {tracking === 'assisted-reps' && (
                    <p className="routine-meta">
                      Assistance is the amount helping you complete the movement. Less assistance
                      means more resistance.
                    </p>
                  )}
                  <div className="routine-set-footer">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={entry.sets.length >= 12}
                      onClick={() =>
                        updateEntry(entry.id, { sets: [...entry.sets, createPlannedSet(tracking)] })
                      }
                    >
                      <Plus size={16} aria-hidden="true" /> Add set
                    </button>
                    <span className="routine-meta">{entry.sets.length} / 12 sets</span>
                  </div>
                  <FieldError path={`${prefix}.sets`} errors={errors} />
                  <div className="routine-entry-options">
                    <NumberField
                      label="Rest between sets (sec)"
                      path={`${prefix}.restSeconds`}
                      value={entry.restSeconds}
                      min={0}
                      max={1800}
                      step={5}
                      errors={errors}
                      update={(value) =>
                        updateEntry(entry.id, { restSeconds: value ?? Number.NaN })
                      }
                    />
                    <div className="field">
                      <label htmlFor={`routine-exercises-${index}-supersetGroup`}>Superset</label>
                      <select
                        className="select"
                        id={`routine-exercises-${index}-supersetGroup`}
                        value={entry.supersetGroup || ''}
                        onChange={(event) =>
                          updateEntry(entry.id, { supersetGroup: event.target.value || null })
                        }
                      >
                        <option value="">No superset</option>
                        {['A', 'B', 'C', 'D', 'E'].map((group) => (
                          <option value={group} key={group}>
                            Group {group}
                          </option>
                        ))}
                      </select>
                      <FieldError path={`${prefix}.supersetGroup`} errors={errors} />
                    </div>
                    <label className="routine-checkbox">
                      <input
                        type="checkbox"
                        checked={entry.optional}
                        onChange={(event) =>
                          updateEntry(entry.id, { optional: event.target.checked })
                        }
                      />{' '}
                      Optional accessory
                    </label>
                  </div>
                  <div className="field">
                    <label htmlFor={`routine-exercises-${index}-notes`}>
                      Exercise notes <span className="muted">(optional)</span>
                    </label>
                    <textarea
                      className="input"
                      id={`routine-exercises-${index}-notes`}
                      value={entry.notes}
                      maxLength={1000}
                      placeholder="Cues, equipment setup, or substitutions"
                      onChange={(event) => updateEntry(entry.id, { notes: event.target.value })}
                    />
                    <FieldError path={`${prefix}.notes`} errors={errors} />
                  </div>
                </section>
              )
            })}
          </div>
          <button
            type="button"
            className="routine-add-exercise"
            disabled={input.exercises.length >= 20}
            onClick={() => setPickerOpen(true)}
          >
            <Plus size={20} aria-hidden="true" />
            {input.exercises.length >= 20 ? '20 exercise limit reached' : 'Add exercise'}
          </button>
          <p className="routine-meta">
            Supersets need at least two exercises in the same group. Duration includes a warm-up
            allowance, setup, working time, and planned rests; it is an estimate.
          </p>
          <div className="routine-save-bar">
            <div>
              <strong>
                {input.exercises.length} exercises ·{' '}
                {input.exercises.reduce((sum, entry) => sum + entry.sets.length, 0)} sets
              </strong>
              <span>
                {dirty ? 'Unsaved changes · draft kept on this device' : 'No unsaved changes'}
              </span>
            </div>
            <div className="routine-save-actions">
              <button type="button" className="btn btn-secondary" onClick={leave}>
                Back to routines
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save routine'}
              </button>
            </div>
          </div>
        </fieldset>
      </form>
      <ExercisePicker
        open={pickerOpen && !saving}
        onOpenChange={setPickerOpen}
        exercises={training.exercises}
        add={(exercise) => {
          setInput((current) => ({
            ...current,
            exercises: [...current.exercises, createRoutineExercise(exercise)],
          }))
          setErrors({})
          setPickerOpen(false)
        }}
      />
      <Dialog.Root
        open={removeEntry !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveEntry(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>Remove {removeEntry?.exerciseSnapshot.name}?</Dialog.Title>
            <Dialog.Description>
              Its planned sets and notes will be removed from this routine. Existing workout history
              will remain unchanged.
            </Dialog.Description>
            <div className="routine-dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="btn btn-secondary">
                  Keep exercise
                </button>
              </Dialog.Close>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => removeEntry && remove(removeEntry.id)}
              >
                Remove exercise
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function FieldError({ path, errors }: { path: string; errors: FieldErrors }) {
  return errors[path] ? (
    <p className="routine-field-error" id={`error-${path.replaceAll('.', '-')}`}>
      {errors[path]}
    </p>
  ) : null
}

function NumberField({
  label,
  path,
  value,
  min,
  max,
  step,
  optional,
  errors,
  update,
}: {
  label: string
  path: string
  value: number | null
  min: number
  max: number
  step: number
  optional?: boolean
  errors: FieldErrors
  update: (value: number | null) => void
}) {
  const id = `routine-${path.replaceAll('.', '-')}`
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {optional && <span className="routine-visually-hidden"> (optional)</span>}
      </label>
      <input
        className="input"
        id={id}
        type="number"
        inputMode={step < 1 ? 'decimal' : 'numeric'}
        min={min}
        max={max}
        step={step}
        placeholder={optional ? 'Optional' : undefined}
        value={value === null || !Number.isFinite(value) ? '' : value}
        onChange={(event) =>
          update(
            event.target.value === '' ? (optional ? null : Number.NaN) : event.target.valueAsNumber,
          )
        }
        aria-invalid={Boolean(errors[path])}
        aria-describedby={errors[path] ? `error-${path.replaceAll('.', '-')}` : undefined}
      />
      <FieldError path={path} errors={errors} />
    </div>
  )
}

function ExercisePicker({
  open,
  onOpenChange,
  exercises,
  add,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  exercises: Exercise[]
  add: (exercise: Exercise) => void
}) {
  const [query, setQuery] = useState('')
  const [equipment, setEquipment] = useState('')
  const [muscle, setMuscle] = useState('')
  const matches = exercises.filter(
    (exercise) =>
      !exercise.archived &&
      (!equipment || exercise.equipment === equipment) &&
      (!muscle || exercise.primaryMuscles.some((item) => item === muscle)) &&
      `${exercise.name} ${exercise.aliases.join(' ')}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  )
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content routine-picker">
          <div className="routine-picker-heading">
            <div>
              <Dialog.Title>Add an exercise</Dialog.Title>
              <Dialog.Description>
                Choose a movement and customize its planned sets.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="icon-button" aria-label="Close exercise picker">
                <X aria-hidden="true" size={20} />
              </button>
            </Dialog.Close>
          </div>
          <label className="routine-search">
            <Search size={18} aria-hidden="true" />
            <span className="routine-visually-hidden">Search exercises</span>
            <input
              className="input"
              placeholder="Search exercises"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="routine-picker-filters">
            <label className="field">
              <span>Equipment</span>
              <select
                className="select"
                value={equipment}
                onChange={(event) => setEquipment(event.target.value)}
              >
                <option value="">All equipment</option>
                {EXERCISE_EQUIPMENT.map((item) => (
                  <option value={item} key={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Primary muscle</span>
              <select
                className="select"
                value={muscle}
                onChange={(event) => setMuscle(event.target.value)}
              >
                <option value="">All muscles</option>
                {MUSCLE_GROUPS.map((item) => (
                  <option value={item} key={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="routine-meta" aria-live="polite">
            {matches.length} {matches.length === 1 ? 'exercise' : 'exercises'}
          </p>
          <div className="routine-picker-results">
            {matches.map((exercise) => (
              <button
                type="button"
                className="routine-picker-item"
                key={exercise.id}
                onClick={() => add(exercise)}
                aria-label={`Add ${exercise.name}`}
              >
                <span>
                  <strong>{exercise.name}</strong>
                  <small>
                    {exercise.equipment} · {exercise.primaryMuscles.join(', ')}
                  </small>
                </span>
                <Plus size={20} aria-hidden="true" />
              </button>
            ))}
            {matches.length === 0 && (
              <p className="muted">No exercises match. Try another search or filter.</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
