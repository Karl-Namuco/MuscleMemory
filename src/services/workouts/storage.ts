import Dexie, { type Table } from 'dexie'
import { z } from 'zod'
import { workoutSessionSchema } from '../../schemas/workout'
import type { WorkoutSession } from '../../types/workout'
import type { RollingProgress } from '../../types/scheduling'
import type { FixedSchedule } from '../../types/fixedScheduling'
import { fixedScheduleSchema } from '../../schemas/fixedScheduling'

export interface WorkoutState {
  id: 'current'
  ownerId: string
  createdAt: number
  updatedAt: number
  schemaVersion: 1
  revision: number
  mutationId: string
  previousMutationId: string | null
  activeSessionId: string | null
  rollingProgress?: RollingProgress
}

export interface WorkoutAttempt {
  session: WorkoutSession
  state: WorkoutState | null
  version: number
  fixedSchedule?: FixedSchedule
}

export interface WorkoutCheckpoint {
  key: string
  uid: string
  session: WorkoutSession
  baseRevision: number
  baseMutationId: string | null
  version: number
  dirty: boolean
  attempt: WorkoutAttempt | null
  stateBase: WorkoutState | null
  error: string | null
  conflict: boolean
}

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const workoutStateSchema = z
  .strictObject({
    id: z.literal('current'),
    ownerId: z.string().min(1).max(128),
    createdAt: timestamp,
    updatedAt: timestamp,
    schemaVersion: z.literal(1),
    revision: z.number().int().min(1),
    mutationId: identifier,
    previousMutationId: identifier.nullable(),
    activeSessionId: identifier.nullable(),
    rollingProgress: z
      .record(
        identifier,
        z.strictObject({
          splitRevision: z.number().int().min(1),
          sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          lastSlotId: identifier,
          lastSessionId: identifier,
          completedAt: timestamp,
        }),
      )
      .optional(),
  })
  .superRefine((state, context) => {
    if (state.updatedAt < state.createdAt)
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'Workout state timestamps must be in order.',
      })
    if (
      state.revision === 1
        ? state.previousMutationId !== null
        : state.previousMutationId === null || state.previousMutationId === state.mutationId
    )
      context.addIssue({
        code: 'custom',
        path: ['previousMutationId'],
        message: 'Invalid workout state revision metadata.',
      })
  })

// Parse local records as well as remote records: a corrupt checkpoint must never look synced.
export const workoutCheckpointSchema = z
  .strictObject({
    key: z.string().min(1).max(257),
    uid: z.string().min(1).max(128),
    session: workoutSessionSchema,
    baseRevision: z.number().int().min(0),
    baseMutationId: identifier.nullable(),
    version: z.number().int().min(0),
    dirty: z.boolean(),
    attempt: z
      .strictObject({
        session: workoutSessionSchema,
        state: workoutStateSchema.nullable(),
        version: z.number().int().min(0),
        fixedSchedule: fixedScheduleSchema.optional(),
      })
      .nullable(),
    stateBase: workoutStateSchema.nullable(),
    error: z.string().nullable(),
    conflict: z.boolean(),
  })
  .superRefine((checkpoint, context) => {
    if (checkpoint.key !== `${checkpoint.uid}:${checkpoint.session.id}`)
      context.addIssue({
        code: 'custom',
        path: ['key'],
        message: 'The workout checkpoint does not match its account and session path.',
      })
    if (checkpoint.session.ownerId !== checkpoint.uid)
      context.addIssue({
        code: 'custom',
        path: ['session', 'ownerId'],
        message: 'The workout checkpoint belongs to another account.',
      })
    if (checkpoint.stateBase !== null && checkpoint.stateBase.ownerId !== checkpoint.uid)
      context.addIssue({
        code: 'custom',
        path: ['stateBase', 'ownerId'],
        message: 'The saved workout state belongs to another account.',
      })
    if (checkpoint.attempt !== null) {
      if (checkpoint.attempt.session.id !== checkpoint.session.id)
        context.addIssue({
          code: 'custom',
          path: ['attempt', 'session', 'id'],
          message: 'The interrupted write belongs to a different workout.',
        })
      if (checkpoint.attempt.session.ownerId !== checkpoint.uid)
        context.addIssue({
          code: 'custom',
          path: ['attempt', 'session', 'ownerId'],
          message: 'The interrupted write belongs to another account.',
        })
      if (checkpoint.attempt.state !== null && checkpoint.attempt.state.ownerId !== checkpoint.uid)
        context.addIssue({
          code: 'custom',
          path: ['attempt', 'state', 'ownerId'],
          message: 'The interrupted workout state belongs to another account.',
        })
      if (
        checkpoint.attempt.fixedSchedule &&
        checkpoint.attempt.fixedSchedule.ownerId !== checkpoint.uid
      )
        context.addIssue({
          code: 'custom',
          path: ['attempt', 'fixedSchedule'],
          message: 'The attempted calendar belongs to another account.',
        })
    }
  })

const database = new Dexie('muscle-memory-workouts')
database.version(1).stores({ checkpoints: 'key,uid' })
const checkpoints: Table<unknown, string> = database.table('checkpoints')

export async function readWorkoutCheckpoints(uid: string): Promise<WorkoutCheckpoint[]> {
  const values = await readWorkoutRecoveryRaw(uid)
  return values.map((value) => workoutCheckpointSchema.parse(value))
}

/** Preserve unreadable account records for an explicit recovery download. */
export async function readWorkoutRecoveryRaw(uid: string): Promise<unknown[]> {
  return checkpoints.where('uid').equals(uid).toArray()
}

export async function saveWorkoutCheckpoint(checkpoint: WorkoutCheckpoint): Promise<void> {
  workoutCheckpointSchema.parse(checkpoint)
  await checkpoints.put(structuredClone(checkpoint))
}

export async function deleteWorkoutCheckpoint(uid: string, id: string): Promise<void> {
  await checkpoints.delete(`${uid}:${id}`)
}

export async function clearAllWorkoutCheckpoints(): Promise<void> {
  await checkpoints.clear()
}

/** Authentication cleanup may remove confirmed cache entries, but must retain every account's recovery work. */
export async function clearConfirmedWorkoutCheckpoints(): Promise<void> {
  await checkpoints
    .filter((value) => {
      const parsed = workoutCheckpointSchema.safeParse(value)
      return (
        parsed.success &&
        !parsed.data.dirty &&
        parsed.data.attempt === null &&
        parsed.data.error === null &&
        !parsed.data.conflict
      )
    })
    .delete()
}

/** An explicit recovery action may remove corrupt rows, but never another account or a usable draft. */
export async function clearMalformedWorkoutCheckpoints(uid: string): Promise<void> {
  await checkpoints
    .where('uid')
    .equals(uid)
    .filter((value) => !workoutCheckpointSchema.safeParse(value).success)
    .delete()
}

export async function hasUnsyncedWorkoutCheckpoints(uid: string): Promise<boolean> {
  const values = await readWorkoutRecoveryRaw(uid)
  return values.some((value) => {
    const parsed = workoutCheckpointSchema.safeParse(value)
    return (
      !parsed.success ||
      parsed.data.dirty ||
      parsed.data.attempt !== null ||
      parsed.data.error !== null ||
      parsed.data.conflict
    )
  })
}
