import type { Routine } from '../../types/training'

/** Bounded validation records are committed atomically with the full routine. */
export function routineValidationPages(routine: Routine) {
  return Array.from({ length: Math.ceil(routine.exercises.length / 6) }, (_, index) => ({
    id: `p${index}`,
    value: {
      ownerId: routine.ownerId,
      routineId: routine.id,
      mutationId: routine.mutationId,
      revision: routine.revision,
      exercises: routine.exercises.slice(index * 6, (index + 1) * 6),
    },
  }))
}
