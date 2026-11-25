import { afterEach, describe, expect, it } from 'vitest'
import { EXERCISES } from '../src/data/exercises'
import { SPLIT_TEMPLATES } from '../src/data/splitTemplates'
import {
  createPlannedSet,
  createRoutineExercise,
  weightFromKg,
  weightToKg,
} from '../src/domain/training/helpers'
import {
  customExerciseInputSchema,
  routineInputSchema,
  splitInputSchema,
} from '../src/schemas/training'
import { assertCanLogout, registerLogoutGuard } from '../src/services/auth/logoutGuards'
import { readTrainingRecovery, saveTrainingRecovery } from '../src/services/training/recovery'
import { EXERCISE_EQUIPMENT, MUSCLE_GROUPS, TRACKING_TYPES } from '../src/types/training'

const firstExercise = EXERCISES[0]
const exerciseInput = () => ({
  name: firstExercise.name,
  aliases: [],
  description: firstExercise.description,
  instructions: firstExercise.instructions,
  primaryMuscles: firstExercise.primaryMuscles,
  secondaryMuscles: firstExercise.secondaryMuscles,
  equipment: firstExercise.equipment,
  movementPattern: firstExercise.movementPattern,
  category: firstExercise.category,
  difficulty: firstExercise.difficulty,
  trackingType: firstExercise.trackingType,
  alternativeIds: [],
  notes: '',
})
const routineInput = () => ({
  name: 'Push',
  description: '',
  targetMuscles: ['Chest' as const],
  exercises: [createRoutineExercise(firstExercise)],
})

describe('exercise and routine contracts', () => {
  it('ships unique exercise identifiers and coverage for every declared muscle, equipment, and tracking type', () => {
    expect(new Set(EXERCISES.map((exercise) => exercise.id)).size).toBe(EXERCISES.length)
    for (const muscle of MUSCLE_GROUPS)
      expect(EXERCISES.some((exercise) => exercise.primaryMuscles.includes(muscle))).toBe(true)
    for (const equipment of EXERCISE_EQUIPMENT)
      expect(EXERCISES.some((exercise) => exercise.equipment === equipment)).toBe(true)
    for (const tracking of TRACKING_TYPES)
      expect(EXERCISES.some((exercise) => exercise.trackingType === tracking)).toBe(true)
    const metadataKeys = new Set([
      'id',
      'ownerId',
      'createdAt',
      'updatedAt',
      'archived',
      'schemaVersion',
      'revision',
      'mutationId',
      'previousMutationId',
      'source',
    ])
    for (const exercise of EXERCISES)
      expect(
        customExerciseInputSchema.safeParse(
          Object.fromEntries(Object.entries(exercise).filter(([key]) => !metadataKeys.has(key))),
        ).success,
      ).toBe(true)
  })
  it('rejects duplicate or overlapping muscle selections', () => {
    expect(
      customExerciseInputSchema.safeParse({
        ...exerciseInput(),
        primaryMuscles: ['Chest', 'Chest'],
      }).success,
    ).toBe(false)
    expect(
      customExerciseInputSchema.safeParse({ ...exerciseInput(), secondaryMuscles: ['Chest'] })
        .success,
    ).toBe(false)
    expect(
      customExerciseInputSchema.safeParse({ ...exerciseInput(), primaryMuscles: [] }).success,
    ).toBe(false)
  })
  it('rejects arbitrary fields and invalid exercise input limits', () => {
    expect(
      customExerciseInputSchema.safeParse({ ...exerciseInput(), name: ' '.repeat(4) }).success,
    ).toBe(false)
    expect(
      customExerciseInputSchema.safeParse({ ...exerciseInput(), ownerId: 'another-user' }).success,
    ).toBe(false)
    expect(
      customExerciseInputSchema.safeParse({ ...exerciseInput(), aliases: Array(11).fill('alias') })
        .success,
    ).toBe(false)
  })
  it('creates tracking-specific set fields and rejects incompatible targets', () => {
    for (const tracking of TRACKING_TYPES) {
      const exercise = EXERCISES.find((item) => item.trackingType === tracking)!
      const input = { ...routineInput(), exercises: [createRoutineExercise(exercise)] }
      expect(routineInputSchema.safeParse(input).success).toBe(true)
      const set = input.exercises[0].sets[0]
      if (['duration', 'distance-duration'].includes(tracking)) set.repsMin = 5
      else set.durationSeconds = 60
      expect(routineInputSchema.safeParse(input).success).toBe(false)
    }
    const repsExercise = EXERCISES.find((item) => item.trackingType === 'reps')!
    const entry = createRoutineExercise(repsExercise)
    entry.sets[0].targetWeightKg = 10
    expect(routineInputSchema.safeParse({ ...routineInput(), exercises: [entry] }).success).toBe(
      false,
    )
  })
  it('enforces rep ordering, finite canonical weights, and entry/set bounds', () => {
    const input = routineInput()
    input.exercises[0].sets[0] = { ...createPlannedSet('weight-reps'), repsMin: 12, repsMax: 8 }
    expect(routineInputSchema.safeParse(input).success).toBe(false)
    input.exercises[0].sets[0] = { ...createPlannedSet('weight-reps'), targetWeightKg: Number.NaN }
    expect(routineInputSchema.safeParse(input).success).toBe(false)
    input.exercises[0].sets = Array.from({ length: 13 }, () => createPlannedSet('weight-reps'))
    expect(routineInputSchema.safeParse(input).success).toBe(false)
    input.exercises = Array.from({ length: 21 }, () => createRoutineExercise(firstExercise))
    expect(routineInputSchema.safeParse(input).success).toBe(false)
    input.exercises = Array.from({ length: 20 }, () => ({
      ...createRoutineExercise(firstExercise),
      sets: Array.from({ length: 12 }, () => createPlannedSet('weight-reps')),
    }))
    expect(routineInputSchema.safeParse(input).success).toBe(true)
  })
  it('rejects repeated entry or set identifiers and orphan superset groups', () => {
    const input = routineInput(),
      second = createRoutineExercise(firstExercise)
    input.exercises.push(second)
    second.id = input.exercises[0].id
    expect(routineInputSchema.safeParse(input).success).toBe(false)
    second.id = crypto.randomUUID()
    second.sets[0].id = input.exercises[0].sets[0].id
    expect(routineInputSchema.safeParse(input).success).toBe(false)
    second.sets[0].id = crypto.randomUUID()
    second.supersetGroup = 'group-1'
    expect(routineInputSchema.safeParse(input).success).toBe(false)
    input.exercises[0].supersetGroup = 'group-1'
    expect(routineInputSchema.safeParse(input).success).toBe(true)
  })
  it('round-trips display weights through canonical kg within display precision', () => {
    expect(weightToKg(100, 'lb')).toBeCloseTo(45.3592, 4)
    expect(weightFromKg(weightToKg(100, 'lb'), 'lb')).toBe(100)
    expect(weightToKg(50, 'kg')).toBe(50)
  })
  it('ships six usable split templates with resolvable exercises', () => {
    expect(SPLIT_TEMPLATES).toHaveLength(6)
    for (const template of SPLIT_TEMPLATES)
      for (const day of template.days) {
        const exercises = day.exerciseIds.map((id) => {
          const exercise = EXERCISES.find((candidate) => candidate.id === id)
          expect(exercise).toBeDefined()
          return createRoutineExercise(exercise!)
        })
        expect(
          routineInputSchema.safeParse({
            name: day.label,
            description: '',
            targetMuscles: [],
            exercises,
          }).success,
        ).toBe(true)
      }
  })
  it('validates split rest semantics, unique slots, and the twelve-slot limit', () => {
    const input = {
      name: 'Training',
      description: '',
      mode: 'rolling' as const,
      slots: [{ id: 'slot', label: 'Push', routineId: 'routine', isRestDay: false }],
    }
    expect(splitInputSchema.safeParse(input).success).toBe(true)
    expect(
      splitInputSchema.safeParse({ ...input, slots: [{ ...input.slots[0], isRestDay: true }] })
        .success,
    ).toBe(false)
    expect(
      splitInputSchema.safeParse({ ...input, slots: [{ ...input.slots[0], routineId: null }] })
        .success,
    ).toBe(false)
    expect(
      splitInputSchema.safeParse({ ...input, slots: [input.slots[0], input.slots[0]] }).success,
    ).toBe(false)
    expect(
      splitInputSchema.safeParse({
        ...input,
        slots: Array.from({ length: 13 }, (_, id) => ({ ...input.slots[0], id: `slot-${id}` })),
      }).success,
    ).toBe(false)
  })
})

describe('private training recovery', () => {
  afterEach(() => localStorage.clear())
  it('isolates recovery drafts by owner and clears only confirmed drafts', () => {
    saveTrainingRecovery('alex', [
      { collection: 'routines', id: 'routine', mutationId: 'mutation', payload: { name: 'Push' } },
    ])
    expect(readTrainingRecovery('other')).toEqual([])
    expect(readTrainingRecovery('alex')[0].payload.name).toBe('Push')
    saveTrainingRecovery('alex', [])
    expect(readTrainingRecovery('alex')).toEqual([])
  })
  it('guards sign-out per account and unregisters after provider detaches', async () => {
    const unregister = registerLogoutGuard('alex', () => {
      throw new Error('Pending training writes')
    })
    await expect(assertCanLogout('alex')).rejects.toThrow('Pending training writes')
    await expect(assertCanLogout('other')).resolves.toBeUndefined()
    unregister()
    await expect(assertCanLogout('alex')).resolves.toBeUndefined()
  })
})
