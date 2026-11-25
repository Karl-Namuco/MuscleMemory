import { z } from 'zod'
import { exerciseSnapshotSchema, plannedSetSchema } from './training'

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const unique = (items: string[]) => new Set(items).size === items.length

export const loggedSetSchema = z.strictObject({
  id: identifier,
  type: z.enum(['warmup', 'working', 'drop', 'other']),
  weightKg: z.number().finite().min(0).max(10000).nullable(),
  reps: z.number().int().min(1).max(1000).nullable(),
  durationSeconds: z.number().int().min(1).max(86400).nullable(),
  distanceMeters: z.number().finite().min(1).max(1000000).nullable(),
  rpe: z.number().finite().min(1).max(10).nullable(),
  completedAt: timestamp.nullable(),
})

export const workoutExerciseSchema = z
  .strictObject({
    id: identifier,
    exerciseId: identifier,
    snapshot: exerciseSnapshotSchema,
    originalExerciseId: identifier.nullable(),
    plannedSets: z.array(plannedSetSchema).min(1).max(12),
    sets: z.array(loggedSetSchema).min(1).max(12),
    restSeconds: z.number().int().min(0).max(1800),
    optional: z.boolean(),
    supersetGroup: identifier.nullable(),
    notes: z.string().trim().max(1000),
  })
  .superRefine((exercise, context) => {
    if (!unique(exercise.sets.map((set) => set.id)))
      context.addIssue({
        code: 'custom',
        path: ['sets'],
        message: 'Set identifiers must be unique.',
      })
    if (!unique(exercise.plannedSets.map((set) => set.id)))
      context.addIssue({
        code: 'custom',
        path: ['plannedSets'],
        message: 'Planned set identifiers must be unique.',
      })
    if (exercise.originalExerciseId === exercise.exerciseId)
      context.addIssue({
        code: 'custom',
        path: ['originalExerciseId'],
        message: 'The original exercise must differ from its substitute.',
      })
    const tracking = exercise.snapshot.trackingType
    for (const [index, set] of exercise.sets.entries()) {
      const repetitionBased = ['weight-reps', 'assisted-reps', 'reps'].includes(tracking)
      const compatible = repetitionBased
        ? set.durationSeconds === null &&
          set.distanceMeters === null &&
          (tracking !== 'reps' || set.weightKg === null)
        : set.weightKg === null &&
          set.reps === null &&
          (tracking === 'distance-duration' || set.distanceMeters === null)
      const complete =
        set.completedAt === null ||
        (repetitionBased
          ? set.reps !== null && (tracking === 'reps' || set.weightKg !== null)
          : set.durationSeconds !== null &&
            (tracking !== 'distance-duration' || set.distanceMeters !== null))
      if (!compatible || !complete)
        context.addIssue({
          code: 'custom',
          path: ['sets', index],
          message:
            'Logged fields must match the exercise tracking type, and completed sets need actual values.',
        })
    }
    for (const [index, set] of exercise.plannedSets.entries()) {
      const repetitionBased = ['weight-reps', 'assisted-reps', 'reps'].includes(tracking)
      const compatible = repetitionBased
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
      if (!compatible)
        context.addIssue({
          code: 'custom',
          path: ['plannedSets', index],
          message: 'Planned fields must match the exercise tracking type.',
        })
    }
  })

export const workoutSessionSchema = z
  .strictObject({
    id: identifier,
    ownerId: z.string().min(1).max(128),
    schemaVersion: z.literal(1),
    revision: z.number().int().min(1),
    mutationId: identifier,
    previousMutationId: identifier.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: z.enum(['active', 'completed', 'abandoned']),
    startedAt: timestamp,
    endedAt: timestamp.nullable(),
    elapsedSeconds: z.number().int().min(0).max(31536000),
    timerEndAt: timestamp.nullable(),
    routineId: identifier,
    routineRevision: z.number().int().min(1),
    routineName: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(2000),
    exercises: z.array(workoutExerciseSchema).min(1).max(20),
    splitContext: z
      .strictObject({
        splitId: identifier,
        splitRevision: z.number().int().min(1),
        slotId: identifier,
      })
      .nullable(),
    completionKey: identifier.nullable(),
  })
  .superRefine((session, context) => {
    if (
      session.updatedAt < session.createdAt ||
      session.startedAt < session.createdAt ||
      session.updatedAt < session.startedAt
    )
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'Workout timestamps must be in order.',
      })
    if (
      session.revision === 1
        ? session.previousMutationId !== null
        : session.previousMutationId === null || session.previousMutationId === session.mutationId
    )
      context.addIssue({
        code: 'custom',
        path: ['previousMutationId'],
        message: 'Invalid workout revision metadata.',
      })
    if (
      session.status === 'active'
        ? session.endedAt !== null || session.completionKey !== null
        : session.endedAt === null ||
          session.endedAt < session.startedAt ||
          session.endedAt > session.updatedAt
    )
      context.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: 'Active workouts cannot have an end time; finished workouts need one.',
      })
    if (
      session.status === 'completed'
        ? session.completionKey === null
        : session.completionKey !== null
    )
      context.addIssue({
        code: 'custom',
        path: ['completionKey'],
        message: 'Only completed workouts have a completion key.',
      })
    if (
      session.timerEndAt !== null &&
      (session.status !== 'active' || session.timerEndAt < session.startedAt)
    )
      context.addIssue({
        code: 'custom',
        path: ['timerEndAt'],
        message: 'Only active workouts can have a rest timer.',
      })
    if (
      session.status === 'completed' &&
      !session.exercises.some((exercise) => exercise.sets.some((set) => set.completedAt !== null))
    )
      context.addIssue({
        code: 'custom',
        path: ['exercises'],
        message: 'Complete at least one performed set before finishing a workout.',
      })
    if (!unique(session.exercises.map((exercise) => exercise.id)))
      context.addIssue({
        code: 'custom',
        path: ['exercises'],
        message: 'Workout exercise entry identifiers must be unique.',
      })
    if (!unique(session.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id))))
      context.addIssue({
        code: 'custom',
        path: ['exercises'],
        message: 'Logged set identifiers must be unique across a workout.',
      })
    if (!unique(session.exercises.flatMap((exercise) => exercise.plannedSets.map((set) => set.id))))
      context.addIssue({
        code: 'custom',
        path: ['exercises'],
        message: 'Planned set identifiers must be unique across a workout.',
      })
    for (const [exerciseIndex, exercise] of session.exercises.entries())
      for (const [setIndex, set] of exercise.sets.entries())
        if (
          set.completedAt !== null &&
          (set.completedAt < session.startedAt ||
            set.completedAt > (session.endedAt ?? session.updatedAt))
        )
          context.addIssue({
            code: 'custom',
            path: ['exercises', exerciseIndex, 'sets', setIndex, 'completedAt'],
            message: 'A performed set must fall within this workout.',
          })
  })
