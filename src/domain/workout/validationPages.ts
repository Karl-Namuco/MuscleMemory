import type { WorkoutSession } from '../../types/workout'

/** Bounded validation records are committed atomically with the full workout session. */
export function workoutValidationPages(session: WorkoutSession) {
  return Array.from({ length: Math.ceil(session.exercises.length / 5) }, (_, index) => ({
    id: `p${index}`,
    value: {
      ownerId: session.ownerId,
      sessionId: session.id,
      revision: session.revision,
      mutationId: session.mutationId,
      exercises: session.exercises.slice(index * 5, (index + 1) * 5),
    },
  }))
}
