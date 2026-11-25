import Dexie, { type Table } from 'dexie'
import {
  EXERCISE_EQUIPMENT,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  TRACKING_TYPES,
  type CustomExerciseInput,
  type Exercise,
} from '../../types/training'

export interface ExerciseFormValues extends CustomExerciseInput {
  aliasesText: string
  instructionsText: string
}
export interface ExerciseDraft {
  key: string
  uid: string
  id: string
  expectedRevision: number
  values: ExerciseFormValues
  pending: boolean
  savedAt: number
}

class ExerciseDraftDatabase extends Dexie {
  drafts!: Table<ExerciseDraft, string>
  constructor() {
    super('muscle-memory-exercise-drafts')
    this.version(1).stores({ drafts: '&key, uid, id, savedAt' })
  }
}
const database = new ExerciseDraftDatabase()

export const emptyExercise: CustomExerciseInput = {
  name: '',
  aliases: [],
  description: '',
  instructions: [],
  primaryMuscles: [],
  secondaryMuscles: [],
  equipment: 'Dumbbell',
  movementPattern: 'Other',
  category: 'compound',
  difficulty: 'beginner',
  trackingType: 'weight-reps',
  alternativeIds: [],
  notes: '',
}

export function exerciseInput(exercise: CustomExerciseInput): CustomExerciseInput {
  return {
    name: exercise.name,
    aliases: [...exercise.aliases],
    description: exercise.description,
    instructions: [...exercise.instructions],
    primaryMuscles: [...exercise.primaryMuscles],
    secondaryMuscles: [...exercise.secondaryMuscles],
    equipment: exercise.equipment,
    movementPattern: exercise.movementPattern,
    category: exercise.category,
    difficulty: exercise.difficulty,
    trackingType: exercise.trackingType,
    alternativeIds: [...exercise.alternativeIds],
    notes: exercise.notes,
  }
}
export function formValues(input: CustomExerciseInput): ExerciseFormValues {
  return {
    ...exerciseInput(input),
    aliasesText: input.aliases.join(', '),
    instructionsText: input.instructions.join('\n'),
  }
}
export function inputFromForm(values: ExerciseFormValues): CustomExerciseInput {
  return {
    ...exerciseInput(values),
    aliases: [
      ...new Set(
        values.aliasesText
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ],
    instructions: values.instructionsText
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean),
  }
}

/** Incomplete fields are recoverable, but corrupt storage must never crash the editor. */
export function recoverExerciseDraft(value: unknown, uid: string): ExerciseDraft | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Record<string, unknown>
  if (
    draft.uid !== uid ||
    typeof draft.key !== 'string' ||
    typeof draft.id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(draft.id) ||
    !Number.isInteger(draft.expectedRevision) ||
    (draft.expectedRevision as number) < 0 ||
    typeof draft.pending !== 'boolean' ||
    typeof draft.savedAt !== 'number' ||
    !draft.values ||
    typeof draft.values !== 'object'
  )
    return null
  const values = draft.values as Record<string, unknown>
  for (const field of ['name', 'description', 'notes', 'aliasesText', 'instructionsText'])
    if (typeof values[field] !== 'string') return null
  for (const field of [
    'aliases',
    'instructions',
    'primaryMuscles',
    'secondaryMuscles',
    'alternativeIds',
  ]) {
    const list = values[field]
    if (!Array.isArray(list) || list.some((item: unknown) => typeof item !== 'string')) return null
  }
  if (
    !EXERCISE_EQUIPMENT.some((item) => item === values.equipment) ||
    !MOVEMENT_PATTERNS.some((item) => item === values.movementPattern) ||
    !TRACKING_TYPES.some((item) => item === values.trackingType) ||
    !['compound', 'isolation', 'cardio', 'mobility'].includes(values.category as string) ||
    !['beginner', 'intermediate', 'advanced'].includes(values.difficulty as string) ||
    [...(values.primaryMuscles as string[]), ...(values.secondaryMuscles as string[])].some(
      (muscle) => !MUSCLE_GROUPS.some((item) => item === muscle),
    )
  )
    return null
  return structuredClone(value) as ExerciseDraft
}
export const readExerciseDraft = (key: string) => database.drafts.get(key)
export const saveExerciseDraft = (draft: ExerciseDraft) =>
  database.drafts.put(structuredClone(draft))
export const clearExerciseDraft = (key: string) => database.drafts.delete(key)
export const clearAllExerciseDrafts = () => database.drafts.clear()

/** Only an acknowledged matching record can remove a queued form recovery copy. */
export async function acknowledgeExerciseDrafts(uid: string, exercise: Exercise): Promise<void> {
  const drafts = await database.drafts.where('uid').equals(uid).toArray()
  const acknowledged = JSON.stringify(exerciseInput(exercise))
  for (const draft of drafts) {
    if (
      draft.id === exercise.id &&
      draft.pending &&
      exercise.revision > draft.expectedRevision &&
      JSON.stringify(inputFromForm(draft.values)) === acknowledged
    )
      await database.drafts.delete(draft.key)
  }
}
