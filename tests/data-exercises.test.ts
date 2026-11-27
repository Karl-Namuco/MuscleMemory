import { describe, expect, it } from 'vitest'
import { EXERCISES } from '../src/data/exercises'
import { createRoutineExercise } from '../src/domain/training/helpers'
import { exerciseInput } from '../src/features/exercises/draft'
import { customExerciseInputSchema, routineExerciseSchema } from '../src/schemas/training'

describe('Included exercise catalogue', () => {
  it('keeps every movement valid for the library and routine builder with unique identifiers', () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(69)
    expect(new Set(EXERCISES.map((exercise) => exercise.id)).size).toBe(EXERCISES.length)
    expect(new Set(EXERCISES.map((exercise) => exercise.name.toLowerCase())).size).toBe(
      EXERCISES.length,
    )
    for (const exercise of EXERCISES) {
      expect(
        customExerciseInputSchema.safeParse(exerciseInput(exercise)).success,
        exercise.id,
      ).toBe(true)
      expect(
        routineExerciseSchema.safeParse(createRoutineExercise(exercise)).success,
        exercise.id,
      ).toBe(true)
    }
    expect(EXERCISES.find((exercise) => exercise.id === 'bench-press')?.name).toBe(
      'Barbell bench press',
    )
    expect(EXERCISES.find((exercise) => exercise.id === 'leg-curl')?.name).toBe('Seated leg curl')
  })

  it('includes common machine, cable, Smith, unilateral and bodyweight variations and aliases', () => {
    for (const id of [
      'pec-deck',
      'machine-row',
      'cable-lateral-raise',
      'smith-incline-press',
      'bulgarian-split-squat',
      'single-leg-press',
      'lying-leg-curl',
      'hanging-knee-raise',
    ])
      expect(
        EXERCISES.find((exercise) => exercise.id === id),
        id,
      ).toBeDefined()
    expect(EXERCISES.find((exercise) => exercise.id === 'pec-deck')?.aliases).toContain(
      'Butterfly machine',
    )
    expect(EXERCISES.find((exercise) => exercise.id === 'machine-hip-thrust')?.aliases).toContain(
      'Glute drive',
    )
    expect(EXERCISES.find((exercise) => exercise.id === 'assisted-dip')?.trackingType).toBe(
      'assisted-reps',
    )
  })
})
