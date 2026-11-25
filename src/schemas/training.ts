import { z } from 'zod'
import {
  EXERCISE_EQUIPMENT,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  TRACKING_TYPES,
} from '../types/training'

const text = (max: number) => z.string().trim().max(max)
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Use a valid record identifier.')
const unique = <T>(items: T[]) => new Set(items).size === items.length
const muscleList = z
  .array(z.enum(MUSCLE_GROUPS))
  .max(17)
  .refine(unique, 'Choose each muscle only once.')
const nonnegative = z.number().finite().min(0).max(10000).nullable()
const repetitions = z.number().int().min(1).max(1000).nullable()
const trackingFields = {
  name: text(120).min(1, 'Enter an exercise name.'),
  trackingType: z.enum(TRACKING_TYPES),
  primaryMuscles: muscleList.min(1).max(4),
  secondaryMuscles: muscleList.max(8),
  equipment: z.enum(EXERCISE_EQUIPMENT),
  movementPattern: z.enum(MOVEMENT_PATTERNS),
}
export const exerciseSnapshotSchema = z
  .strictObject(trackingFields)
  .refine(
    (value) => !value.primaryMuscles.some((muscle) => value.secondaryMuscles.includes(muscle)),
    'A muscle cannot be both primary and secondary.',
  )
export const customExerciseInputSchema = z
  .strictObject({
    ...trackingFields,
    aliases: z.array(text(120).min(1)).max(10).refine(unique, 'Aliases must be unique.'),
    description: text(1000),
    instructions: z.array(text(500).min(1)).max(12),
    category: z.enum(['compound', 'isolation', 'cardio', 'mobility']),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
    alternativeIds: z.array(identifier).max(10).refine(unique, 'Alternatives must be unique.'),
    notes: text(1000),
  })
  .refine(
    (value) => !value.primaryMuscles.some((muscle) => value.secondaryMuscles.includes(muscle)),
    'A muscle cannot be both primary and secondary.',
  )
export const plannedSetSchema = z
  .strictObject({
    id: identifier,
    type: z.enum(['warmup', 'working', 'drop', 'other']),
    repsMin: repetitions,
    repsMax: repetitions,
    targetWeightKg: nonnegative,
    durationSeconds: z.number().int().min(1).max(86400).nullable(),
    distanceMeters: z.number().finite().min(1).max(1000000).nullable(),
  })
  .refine(
    (value) => value.repsMin === null || value.repsMax === null || value.repsMin <= value.repsMax,
    'Minimum reps cannot exceed maximum reps.',
  )
export const routineExerciseSchema = z
  .strictObject({
    id: identifier,
    exerciseId: identifier,
    exerciseSnapshot: exerciseSnapshotSchema,
    sets: z
      .array(plannedSetSchema)
      .min(1)
      .max(12)
      .refine((sets) => unique(sets.map((set) => set.id)), 'Set identifiers must be unique.'),
    restSeconds: z.number().int().min(0).max(1800),
    notes: text(1000),
    optional: z.boolean(),
    supersetGroup: identifier.nullable(),
  })
  .superRefine((value, context) => {
    const tracking = value.exerciseSnapshot.trackingType
    for (const [index, set] of value.sets.entries()) {
      const reps = ['weight-reps', 'reps', 'assisted-reps'].includes(tracking)
      const valid = reps
        ? set.repsMin !== null &&
          set.repsMax !== null &&
          set.durationSeconds === null &&
          set.distanceMeters === null &&
          (tracking !== 'reps' || set.targetWeightKg === null)
        : set.repsMin === null &&
          set.repsMax === null &&
          set.targetWeightKg === null &&
          set.durationSeconds !== null &&
          (tracking === 'distance-duration'
            ? set.distanceMeters !== null
            : set.distanceMeters === null)
      if (!valid)
        context.addIssue({
          code: 'custom',
          path: ['sets', index],
          message: 'Set fields do not match this exercise’s tracking type.',
        })
    }
  })
export const routineInputSchema = z
  .strictObject({
    name: text(120).min(1, 'Enter a routine name.'),
    description: text(1000),
    targetMuscles: muscleList,
    exercises: z.array(routineExerciseSchema).min(1).max(20),
  })
  .superRefine((value, context) => {
    if (!unique(value.exercises.map((exercise) => exercise.id)))
      context.addIssue({
        code: 'custom',
        path: ['exercises'],
        message: 'Exercise entry identifiers must be unique.',
      })
    if (!unique(value.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id))))
      context.addIssue({
        code: 'custom',
        path: ['exercises'],
        message: 'Set identifiers must be unique across the routine.',
      })
    const groups = value.exercises
      .map((exercise) => exercise.supersetGroup)
      .filter((group) => group !== null)
    for (const group of new Set(groups))
      if (groups.filter((candidate) => candidate === group).length < 2)
        context.addIssue({
          code: 'custom',
          path: ['exercises'],
          message: 'A superset must contain at least two exercises.',
        })
  })
export const splitInputSchema = z
  .strictObject({
    name: text(120).min(1, 'Enter a split name.'),
    description: text(1000),
    mode: z.enum(['fixed', 'rolling', 'adaptive']),
    slots: z
      .array(
        z
          .strictObject({
            id: identifier,
            label: text(80).min(1),
            routineId: identifier.nullable(),
            isRestDay: z.boolean(),
          })
          .refine(
            (slot) => (slot.isRestDay ? slot.routineId === null : slot.routineId !== null),
            'Choose a routine for every training day; rest days cannot reference one.',
          ),
      )
      .min(1)
      .max(12),
  })
  .refine(
    (value) => unique(value.slots.map((slot) => slot.id)),
    'Split slot identifiers must be unique.',
  )
const metadata = {
  id: identifier,
  ownerId: z.string().min(1).max(128),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  archived: z.boolean(),
  schemaVersion: z.literal(1),
  revision: z.number().int().min(1),
  mutationId: identifier,
  previousMutationId: identifier.nullable(),
}
const metadataValid = (value: {
  updatedAt: number
  createdAt: number
  revision: number
  mutationId: string
  previousMutationId: string | null
}) =>
  value.updatedAt >= value.createdAt &&
  (value.revision === 1
    ? value.previousMutationId === null
    : value.previousMutationId !== null && value.previousMutationId !== value.mutationId)
export const customExerciseSchema = customExerciseInputSchema
  .safeExtend({ ...metadata, source: z.literal('custom') })
  .refine(metadataValid, 'Invalid record metadata.')
export const routineSchema = routineInputSchema
  .safeExtend(metadata)
  .refine(metadataValid, 'Invalid record metadata.')
export const trainingSplitSchema = splitInputSchema
  .safeExtend(metadata)
  .refine(metadataValid, 'Invalid record metadata.')
export const trainingSettingsSchema = z
  .strictObject({ ...metadata, activeSplitId: identifier.nullable() })
  .refine(metadataValid, 'Invalid record metadata.')
