import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, Info, Save, X } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { useTraining } from '../../services/training/TrainingProvider'
import { useAuth } from '../../services/auth/AuthProvider'
import { customExerciseInputSchema } from '../../schemas/training'
import {
  EXERCISE_EQUIPMENT,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  TRACKING_TYPES,
  type Exercise,
  type MuscleGroup,
} from '../../types/training'
import { TRACKING_LABELS } from '../../domain/training/helpers'
import {
  clearExerciseDraft,
  emptyExercise,
  formValues,
  inputFromForm,
  readExerciseDraft,
  recoverExerciseDraft,
  saveExerciseDraft,
  type ExerciseFormValues,
} from './draft'
import { ExerciseDataStatus, exerciseMatchesQuery } from './ExerciseLibraryPage'
import './exercises.css'

export default function CustomExercisePage() {
  const { exerciseId } = useParams()
  const [params] = useSearchParams()
  const { exercises, loading } = useTraining()
  const { user } = useAuth()
  const existing = exercises.find((item) => item.id === exerciseId)
  const copy = !exerciseId ? exercises.find((item) => item.id === params.get('copy')) : undefined
  if (!user || loading)
    return (
      <div className="exercise-page">
        <ExerciseDataStatus />
        <p className="muted" role="status">
          Preparing your exercise editor…
        </p>
      </div>
    )
  if (exerciseId && (!existing || existing.source !== 'custom'))
    return (
      <div className="card exercise-empty">
        <h1>This exercise cannot be edited</h1>
        <p>Included exercises are read-only. Make a custom copy to adapt one to your training.</p>
        <Link
          className="btn btn-primary"
          to={existing ? `/exercises/new?copy=${existing.id}` : '/exercises'}
        >
          {existing ? 'Customize a copy' : 'Back to exercises'}
        </Link>
      </div>
    )
  return (
    <ExerciseForm
      key={`${user.uid}:${exerciseId || `new:${params.get('copy') || ''}`}`}
      uid={user.uid}
      existing={existing}
      copy={copy}
    />
  )
}

function ExerciseForm({
  uid,
  existing,
  copy,
}: {
  uid: string
  existing?: Exercise
  copy?: Exercise
}) {
  const navigate = useNavigate()
  const { exercises, saveCustomExercise } = useTraining()
  const { account } = useAuth()
  const draftKey = `${uid}:${existing?.id || `new:${copy?.id || ''}`}`
  const initial = formValues(
    existing || (copy ? { ...copy, name: `${copy.name} (custom)`.slice(0, 120) } : emptyExercise),
  )
  const [values, setValues] = useState<ExerciseFormValues>(initial)
  const [recordId, setRecordId] = useState(existing?.id || crypto.randomUUID())
  const [expectedRevision, setExpectedRevision] = useState(existing?.revision || 0)
  const [hydrated, setHydrated] = useState(false)
  const [recovered, setRecovered] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [error, setError] = useState('')
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [discard, setDiscard] = useState(false)
  const [alternativeQuery, setAlternativeQuery] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    void readExerciseDraft(draftKey)
      .then((stored) => {
        if (!active) return
        const draft = recoverExerciseDraft(stored, uid)
        if (draft) {
          setValues(draft.values)
          setRecordId(draft.id)
          setExpectedRevision(draft.expectedRevision)
          setRecovered(true)
          setSavedAt(draft.savedAt)
        } else if (stored)
          setDraftError(
            'The local draft could not be read. The latest available exercise is shown below.',
          )
      })
      .catch(() => {
        if (active)
          setDraftError(
            'Local draft recovery is unavailable. Keep this page open until your exercise is saved.',
          )
      })
      .finally(() => {
        if (active) setHydrated(true)
      })
    return () => {
      active = false
    }
  }, [draftKey, uid])
  useEffect(() => {
    if (!hydrated || saving) return
    const timer = setTimeout(() => {
      const timestamp = Date.now()
      void saveExerciseDraft({
        key: draftKey,
        uid,
        id: recordId,
        expectedRevision,
        values,
        pending: false,
        savedAt: timestamp,
      })
        .then(() => {
          setSavedAt(timestamp)
          setDraftError('')
        })
        .catch(() =>
          setDraftError(
            'This device could not save a recovery draft. Keep this page open until your exercise is saved.',
          ),
        )
    }, 350)
    return () => clearTimeout(timer)
  }, [values, hydrated, saving, draftKey, uid, recordId, expectedRevision])

  function update<K extends keyof ExerciseFormValues>(key: K, value: ExerciseFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }))
    setIssues((previous) => {
      const next = { ...previous }
      delete next[key]
      return next
    })
  }
  function toggleMuscle(role: 'primaryMuscles' | 'secondaryMuscles', muscle: MuscleGroup) {
    const other = role === 'primaryMuscles' ? 'secondaryMuscles' : 'primaryMuscles'
    setValues((previous) => ({
      ...previous,
      [role]: previous[role].includes(muscle)
        ? previous[role].filter((item) => item !== muscle)
        : [...previous[role], muscle],
      [other]: previous[other].filter((item) => item !== muscle),
    }))
    setIssues((previous) => {
      const next = { ...previous }
      delete next[role]
      return next
    })
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (savingRef.current) return
    const parsed = customExerciseInputSchema.safeParse(inputFromForm(values))
    if (!parsed.success) {
      const errors: Record<string, string> = {}
      for (const issue of parsed.error.issues) errors[String(issue.path[0])] ||= issue.message
      setIssues(errors)
      setError('Review the highlighted fields before saving.')
      setTimeout(() => errorRef.current?.focus(), 0)
      return
    }
    savingRef.current = true
    setSaving(true)
    setError('')
    setIssues({})
    const cleanValues = formValues(parsed.data)
    try {
      // Keep the same ID and base revision for retries and interruption recovery.
      await saveExerciseDraft({
        key: draftKey,
        uid,
        id: recordId,
        expectedRevision,
        values: cleanValues,
        pending: true,
        savedAt: Date.now(),
      }).catch(() => {
        setDraftError(
          'A local recovery copy could not be written. Keep this page open until saving finishes.',
        )
      })
      const savedId = await saveCustomExercise(parsed.data, { id: recordId, expectedRevision })
      navigate(`/exercises/${savedId}`)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Your exercise could not be saved. Your form is still here. Please try again.',
      )
      setTimeout(() => errorRef.current?.focus(), 0)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const labelError = (key: string) =>
    issues[key] ? (
      <span className="exercise-field-error" id={`error-${key}`}>
        {issues[key]}
      </span>
    ) : null
  const ariaError = (key: string) => ({
    'aria-invalid': Boolean(issues[key]),
    'aria-describedby': issues[key] ? `error-${key}` : undefined,
  })
  const alternatives = exercises.filter(
    (exercise) =>
      exercise.id !== recordId &&
      !exercise.archived &&
      exerciseMatchesQuery(exercise, alternativeQuery),
  )
  const favoriteRename = Boolean(
    existing &&
    existing.name !== values.name &&
    account?.preferences.favoriteExercises.includes(existing.name),
  )

  if (!hydrated)
    return (
      <p className="muted" role="status">
        Recovering your exercise draft…
      </p>
    )
  return (
    <div className="exercise-page exercise-editor">
      <Link to={existing ? `/exercises/${existing.id}` : '/exercises'} className="exercise-back">
        <ArrowLeft size={17} aria-hidden="true" />
        {existing ? 'Exercise details' : 'Exercise library'}
      </Link>
      <div className="page-title-row exercise-title-row">
        <div>
          <p className="eyebrow">Your training, your way</p>
          <h1 className="page-heading">
            {existing ? 'Edit exercise' : copy ? 'Customize an exercise' : 'Create an exercise'}
            <span className="lime-period">.</span>
          </h1>
          <p className="page-description">
            Capture the movement and the details you want to track.
          </p>
        </div>
      </div>
      <ExerciseDataStatus />
      {recovered && (
        <p className="notice" role="status">
          Your unfinished exercise draft was recovered from this device.
          {existing && expectedRevision !== existing.revision
            ? ' The account copy has changed since this draft began. Saving will check for a conflict; discard this draft to reopen the latest copy.'
            : ''}
        </p>
      )}
      {draftError && (
        <p className="notice" role="alert">
          {draftError}
        </p>
      )}
      <form onSubmit={(event) => void submit(event)} noValidate>
        {error && (
          <div className="notice exercise-form-error" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </div>
        )}
        <fieldset disabled={saving} className="exercise-form-fieldset">
          <section className="card exercise-form-section">
            <div className="exercise-form-section-heading">
              <span>01</span>
              <div>
                <h2>Movement essentials</h2>
                <p>A clear name makes your exercise easy to find.</p>
              </div>
            </div>
            <div className="field">
              <label htmlFor="custom-exercise-name">
                Exercise name <span aria-hidden="true">*</span>
              </label>
              <input
                id="custom-exercise-name"
                className="input"
                value={values.name}
                maxLength={120}
                required
                autoComplete="off"
                placeholder="e.g. Single-arm cable row"
                onChange={(event) => update('name', event.target.value)}
                {...ariaError('name')}
              />
              {labelError('name')}
              {favoriteRename && (
                <span className="exercise-field-help">
                  This exercise is favorited under its previous name. After saving, remove that name
                  in preferences and favorite the renamed exercise.
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="custom-exercise-description">Description</label>
              <textarea
                id="custom-exercise-description"
                className="input"
                value={values.description}
                maxLength={1000}
                placeholder="What makes this variation useful?"
                onChange={(event) => update('description', event.target.value)}
                {...ariaError('description')}
              />
              {labelError('description')}
            </div>
            <div className="field">
              <label htmlFor="custom-exercise-aliases">Alternate names</label>
              <input
                id="custom-exercise-aliases"
                className="input"
                value={values.aliasesText}
                maxLength={1220}
                placeholder="e.g. One-arm row, unilateral cable row"
                onChange={(event) => update('aliasesText', event.target.value)}
                {...ariaError('aliases')}
              />
              <span className="exercise-field-help">
                Separate names with commas. Up to 10 names, 120 characters each.
              </span>
              {labelError('aliases')}
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="custom-exercise-equipment">Equipment</label>
                <select
                  id="custom-exercise-equipment"
                  className="select"
                  value={values.equipment}
                  onChange={(event) =>
                    update('equipment', event.target.value as ExerciseFormValues['equipment'])
                  }
                >
                  {EXERCISE_EQUIPMENT.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="custom-exercise-movement">Movement pattern</label>
                <select
                  id="custom-exercise-movement"
                  className="select"
                  value={values.movementPattern}
                  onChange={(event) =>
                    update(
                      'movementPattern',
                      event.target.value as ExerciseFormValues['movementPattern'],
                    )
                  }
                >
                  {MOVEMENT_PATTERNS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="custom-exercise-category">Category</label>
                <select
                  id="custom-exercise-category"
                  className="select"
                  value={values.category}
                  onChange={(event) =>
                    update('category', event.target.value as ExerciseFormValues['category'])
                  }
                >
                  {['compound', 'isolation', 'cardio', 'mobility'].map((item) => (
                    <option key={item} value={item}>
                      {item[0].toUpperCase() + item.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="custom-exercise-difficulty">Difficulty</label>
                <select
                  id="custom-exercise-difficulty"
                  className="select"
                  value={values.difficulty}
                  onChange={(event) =>
                    update('difficulty', event.target.value as ExerciseFormValues['difficulty'])
                  }
                >
                  {['beginner', 'intermediate', 'advanced'].map((item) => (
                    <option key={item} value={item}>
                      {item[0].toUpperCase() + item.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>
          <section className="card exercise-form-section">
            <div className="exercise-form-section-heading">
              <span>02</span>
              <div>
                <h2>Muscles & tracking</h2>
                <p>Use primary muscles for the main focus and secondary muscles for support.</p>
              </div>
            </div>
            <fieldset className="exercise-muscle-fieldset">
              <legend>
                Primary muscles <span className="exercise-field-help">Choose 1–4</span>
              </legend>
              <div className="exercise-muscle-choices">
                {MUSCLE_GROUPS.map((muscle) => (
                  <button
                    key={muscle}
                    type="button"
                    className="choice-chip"
                    aria-pressed={values.primaryMuscles.includes(muscle)}
                    disabled={
                      !values.primaryMuscles.includes(muscle) && values.primaryMuscles.length >= 4
                    }
                    onClick={() => toggleMuscle('primaryMuscles', muscle)}
                  >
                    {values.primaryMuscles.includes(muscle) && (
                      <Check size={14} aria-hidden="true" />
                    )}
                    {muscle}
                  </button>
                ))}
              </div>
              {labelError('primaryMuscles')}
            </fieldset>
            <fieldset className="exercise-muscle-fieldset">
              <legend>
                Secondary muscles <span className="exercise-field-help">Optional, up to 8</span>
              </legend>
              <div className="exercise-muscle-choices">
                {MUSCLE_GROUPS.map((muscle) => (
                  <button
                    key={muscle}
                    type="button"
                    className="choice-chip"
                    aria-pressed={values.secondaryMuscles.includes(muscle)}
                    disabled={
                      !values.secondaryMuscles.includes(muscle) &&
                      values.secondaryMuscles.length >= 8
                    }
                    onClick={() => toggleMuscle('secondaryMuscles', muscle)}
                  >
                    {values.secondaryMuscles.includes(muscle) && (
                      <Check size={14} aria-hidden="true" />
                    )}
                    {muscle}
                  </button>
                ))}
              </div>
              {labelError('secondaryMuscles')}
            </fieldset>
            <div className="field">
              <label htmlFor="custom-exercise-tracking">What do you want to log?</label>
              <select
                id="custom-exercise-tracking"
                className="select"
                value={values.trackingType}
                onChange={(event) =>
                  update('trackingType', event.target.value as ExerciseFormValues['trackingType'])
                }
              >
                {TRACKING_TYPES.map((item) => (
                  <option value={item} key={item}>
                    {TRACKING_LABELS[item]}
                  </option>
                ))}
              </select>
              <span className="exercise-field-help">
                {values.trackingType === 'assisted-reps'
                  ? 'Track assistance provided and repetitions. Less assistance means a more difficult set.'
                  : values.trackingType === 'distance-duration'
                    ? 'Track distance and elapsed time. Distance is stored in meters.'
                    : values.trackingType === 'duration'
                      ? 'Track time under effort, such as a hold.'
                      : values.trackingType === 'reps'
                        ? 'Track repetitions without an external weight.'
                        : 'Track external load and repetitions. Weight is displayed in your preferred unit.'}
              </span>
            </div>
          </section>
          <section className="card exercise-form-section">
            <div className="exercise-form-section-heading">
              <span>03</span>
              <div>
                <h2>Technique & alternatives</h2>
                <p>Keep the cues you want to remember, right where you train.</p>
              </div>
            </div>
            <div className="field">
              <label htmlFor="custom-exercise-instructions">Instructions</label>
              <textarea
                id="custom-exercise-instructions"
                className="input exercise-instructions-input"
                value={values.instructionsText}
                maxLength={6100}
                placeholder={
                  'Set up your equipment and stance.\nPerform the movement with control.\nReturn to the starting position.'
                }
                onChange={(event) => update('instructionsText', event.target.value)}
                {...ariaError('instructions')}
              />
              <span className="exercise-field-help">
                One step per line. Up to 12 steps, 500 characters each.
              </span>
              {labelError('instructions')}
            </div>
            <div className="field">
              <label htmlFor="custom-exercise-notes">Training notes</label>
              <textarea
                id="custom-exercise-notes"
                className="input"
                value={values.notes}
                maxLength={1000}
                placeholder="Grip, setup, load convention, or cues that work for you…"
                onChange={(event) => update('notes', event.target.value)}
                {...ariaError('notes')}
              />
              {labelError('notes')}
            </div>
            <div className="field">
              <label htmlFor="alternative-search">Alternative exercises</label>
              <p className="exercise-field-help">
                Choose up to 10 movements from your library. These are suggestions you can evaluate
                when building a routine.
              </p>
              <div className="exercise-tags">
                {values.alternativeIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="exercise-tag exercise-selected-alternative"
                    aria-label={`Remove alternative ${exercises.find((item) => item.id === id)?.name || id}`}
                    onClick={() =>
                      update(
                        'alternativeIds',
                        values.alternativeIds.filter((item) => item !== id),
                      )
                    }
                  >
                    {exercises.find((item) => item.id === id)?.name || 'Unavailable exercise'}
                    <X size={14} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <input
                id="alternative-search"
                className="input"
                placeholder="Find an alternative…"
                value={alternativeQuery}
                onChange={(event) => setAlternativeQuery(event.target.value)}
              />
              <div className="exercise-alternative-picker">
                {alternatives.length ? (
                  alternatives.map((exercise) => (
                    <label className="exercise-checkbox" key={exercise.id}>
                      <input
                        type="checkbox"
                        checked={values.alternativeIds.includes(exercise.id)}
                        disabled={
                          !values.alternativeIds.includes(exercise.id) &&
                          values.alternativeIds.length >= 10
                        }
                        onChange={() =>
                          update(
                            'alternativeIds',
                            values.alternativeIds.includes(exercise.id)
                              ? values.alternativeIds.filter((item) => item !== exercise.id)
                              : [...values.alternativeIds, exercise.id],
                          )
                        }
                      />
                      <span>
                        {exercise.name}
                        <small>{exercise.equipment}</small>
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="muted">No matching exercises.</p>
                )}
              </div>
              {labelError('alternativeIds')}
            </div>
          </section>
        </fieldset>
        <div className="exercise-form-footer">
          <div>
            <Info size={17} aria-hidden="true" />
            <p>
              {savedAt
                ? 'Recovery draft saved on this device.'
                : 'Your recovery draft saves as you edit.'}
              <span>Save the exercise to add it to your account library.</span>
            </p>
          </div>
          <div className="exercise-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving}
              onClick={() => setDiscard(true)}
            >
              Discard draft
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Save size={17} aria-hidden="true" />
              {saving ? 'Saving exercise…' : 'Save exercise'}
            </button>
          </div>
        </div>
      </form>
      <Dialog.Root open={discard} onOpenChange={setDiscard}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>Discard your draft?</Dialog.Title>
            <Dialog.Description>
              Your unsaved form changes will be removed from this device. Any previously saved
              exercise remains in your account.
            </Dialog.Description>
            <div className="exercise-actions">
              <Dialog.Close asChild>
                <button className="btn btn-secondary">Keep editing</button>
              </Dialog.Close>
              <button
                className="btn btn-primary"
                onClick={() =>
                  void clearExerciseDraft(draftKey)
                    .then(() => navigate(existing ? `/exercises/${existing.id}` : '/exercises'))
                    .catch(() => {
                      setDiscard(false)
                      setError('This device could not remove the draft. Please try again.')
                    })
                }
              >
                Discard draft
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
