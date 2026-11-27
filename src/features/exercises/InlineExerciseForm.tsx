import { useEffect, useRef, useState, type FormEvent } from 'react'
import { TRACKING_LABELS } from '../../domain/training/helpers'
import { customExerciseInputSchema } from '../../schemas/training'
import { useTraining } from '../../services/training/TrainingProvider'
import {
  EXERCISE_EQUIPMENT,
  MUSCLE_GROUPS,
  TRACKING_TYPES,
  type CustomExerciseInput,
  type Exercise,
} from '../../types/training'
import {
  clearExerciseDraft,
  emptyExercise,
  formValues,
  inputFromForm,
  readExerciseDraft,
  recoverExerciseDraft,
  saveExerciseDraft,
} from './draft'

const normalizedName = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

/** Keep routine building in place while using the library's existing recovery storage. */
export function InlineExerciseForm({
  uid,
  draftKey,
  initialName,
  onAdd,
  onCancel,
  onSavingChange,
}: {
  uid: string
  draftKey: string
  initialName: string
  onAdd: (exercise: Exercise) => void
  onCancel: () => void
  onSavingChange: (saving: boolean) => void
}) {
  const training = useTraining()
  const [input, setInput] = useState<CustomExerciseInput>({
    ...emptyExercise,
    name: initialName.slice(0, 120),
    equipment: 'Other',
  })
  const [recordId, setRecordId] = useState(() => crypto.randomUUID())
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [draftNotice, setDraftNotice] = useState('')
  const saveInFlight = useRef(false)
  const draftQueue = useRef<Promise<unknown>>(Promise.resolve())
  const alert = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    void readExerciseDraft(draftKey)
      .then((stored) => {
        if (!active) return
        const draft = recoverExerciseDraft(stored, uid)
        if (draft) {
          setInput(inputFromForm(draft.values))
          setRecordId(draft.id)
          setDraftNotice('Your unfinished custom exercise was restored from this device.')
        }
      })
      .catch(() => {
        if (active)
          setDraftNotice(
            'Local exercise recovery is unavailable. Keep this dialog open until saving finishes.',
          )
      })
      .finally(() => {
        if (active) setReady(true)
      })
    return () => {
      active = false
    }
  }, [draftKey, uid])

  useEffect(() => {
    if (!ready || saving) return
    draftQueue.current = draftQueue.current
      .catch(() => undefined)
      .then(() =>
        saveExerciseDraft({
          key: draftKey,
          uid,
          id: recordId,
          expectedRevision: 0,
          values: formValues(input),
          pending: false,
          savedAt: Date.now(),
        }),
      )
      .catch(() =>
        setDraftNotice(
          'This device could not save an exercise recovery copy. Keep this dialog open until saving finishes.',
        ),
      )
  }, [ready, saving, draftKey, uid, recordId, input])

  function update<K extends keyof CustomExerciseInput>(key: K, value: CustomExerciseInput[K]) {
    setInput((previous) => ({ ...previous, [key]: value }))
    setErrors({})
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saveInFlight.current || !ready) return
    const parsed = customExerciseInputSchema.safeParse(input)
    const nextErrors: Record<string, string> = {}
    if (!parsed.success)
      for (const issue of parsed.error.issues) nextErrors[String(issue.path[0])] ||= issue.message
    const duplicate = training.exercises.find(
      (exercise) =>
        exercise.id !== recordId && normalizedName(exercise.name) === normalizedName(input.name),
    )
    if (duplicate)
      nextErrors.name = duplicate.archived
        ? 'This name belongs to an archived exercise. Restore it in the exercise library or choose another name.'
        : 'An exercise with this name already exists. Choose it from the list or use a different name.'
    if (!parsed.success || Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      setError('Check the highlighted fields before creating your exercise.')
      setTimeout(() => alert.current?.focus(), 0)
      return
    }
    saveInFlight.current = true
    setSaving(true)
    onSavingChange(true)
    setError('')
    setErrors({})
    try {
      await draftQueue.current.catch(() => undefined)
      const draft = {
        key: draftKey,
        uid,
        id: recordId,
        expectedRevision: 0,
        values: formValues(parsed.data),
        pending: true,
        savedAt: Date.now(),
      }
      await saveExerciseDraft(draft).catch(() => undefined)
      // Write under the library editor key before dispatch so a cloud acknowledgement
      // can clear this recovery copy even if it arrives before saveCustomExercise resolves.
      await saveExerciseDraft({ ...draft, key: `${uid}:${recordId}` }).catch(() => undefined)
      const id = await training.saveCustomExercise(parsed.data, {
        id: recordId,
        expectedRevision: 0,
      })
      if (id !== recordId)
        await saveExerciseDraft({ ...draft, key: `${uid}:${id}`, id })
          .then(() => clearExerciseDraft(`${uid}:${recordId}`))
          .catch(() => undefined)
      await clearExerciseDraft(draftKey).catch(() => undefined)
      const timestamp = Date.now()
      onAdd({
        ...parsed.data,
        id,
        source: 'custom',
        ownerId: uid,
        createdAt: timestamp,
        updatedAt: timestamp,
        archived: false,
        schemaVersion: 1,
        revision: 1,
        mutationId: crypto.randomUUID(),
        previousMutationId: null,
      })
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not create this exercise. Your form is still here; try again.',
      )
      setTimeout(() => alert.current?.focus(), 0)
    } finally {
      saveInFlight.current = false
      setSaving(false)
      onSavingChange(false)
    }
  }

  if (!ready) return <p role="status">Recovering your custom exercise…</p>
  return (
    <form className="routine-custom-exercise" onSubmit={(event) => void submit(event)} noValidate>
      <div>
        <h3>Create your own exercise</h3>
        <p className="muted">
          Save it to your exercise library and add it to this routine. You can edit more details in
          the library later.
        </p>
      </div>
      {draftNotice && (
        <p className="notice" role="status">
          {draftNotice}
        </p>
      )}
      {(error || training.error) && (
        <div className="notice" role="alert" tabIndex={-1} ref={alert}>
          {error || training.error}
        </div>
      )}
      <fieldset className="routine-fieldset" disabled={saving}>
        <div className="field">
          <label htmlFor="inline-exercise-name">Exercise name</label>
          <input
            id="inline-exercise-name"
            className="input"
            maxLength={120}
            autoComplete="off"
            required
            value={input.name}
            onChange={(event) => update('name', event.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'inline-error-name' : undefined}
          />
          {errors.name && (
            <p id="inline-error-name" className="routine-field-error">
              {errors.name}
            </p>
          )}
        </div>
        <div className="routine-picker-filters">
          <div className="field">
            <label htmlFor="inline-exercise-equipment">Equipment</label>
            <select
              id="inline-exercise-equipment"
              className="select"
              value={input.equipment}
              onChange={(event) =>
                update('equipment', event.target.value as CustomExerciseInput['equipment'])
              }
            >
              {EXERCISE_EQUIPMENT.map((equipment) => (
                <option key={equipment}>{equipment}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="inline-exercise-tracking">Track</label>
            <select
              id="inline-exercise-tracking"
              className="select"
              value={input.trackingType}
              onChange={(event) =>
                update('trackingType', event.target.value as CustomExerciseInput['trackingType'])
              }
            >
              {TRACKING_TYPES.map((tracking) => (
                <option key={tracking} value={tracking}>
                  {TRACKING_LABELS[tracking]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="inline-exercise-muscle">Primary muscle</label>
          <select
            id="inline-exercise-muscle"
            className="select"
            value={input.primaryMuscles[0] || ''}
            required
            onChange={(event) =>
              update(
                'primaryMuscles',
                event.target.value
                  ? [event.target.value as CustomExerciseInput['primaryMuscles'][number]]
                  : [],
              )
            }
            aria-invalid={Boolean(errors.primaryMuscles)}
            aria-describedby={errors.primaryMuscles ? 'inline-error-muscle' : undefined}
          >
            <option value="">Choose a primary muscle</option>
            {MUSCLE_GROUPS.map((muscle) => (
              <option key={muscle}>{muscle}</option>
            ))}
          </select>
          {errors.primaryMuscles && (
            <p id="inline-error-muscle" className="routine-field-error">
              Choose a primary muscle.
            </p>
          )}
        </div>
        <div className="routine-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Back to exercise list
          </button>
          <button type="submit" className="btn btn-primary">
            {saving ? 'Creating exercise…' : 'Create and add exercise'}
          </button>
        </div>
      </fieldset>
    </form>
  )
}
