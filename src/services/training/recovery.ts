export interface TrainingRecovery {
  collection: 'customExercises' | 'routines' | 'splits' | 'trainingSettings' | 'fixedSchedules'
  id: string
  mutationId: string
  payload: Record<string, unknown>
}
const key = (uid: string) => `muscle-memory:training-recovery:${uid}`

/** Recovery records stay until a matching mutation is confirmed by the server. */
export function readTrainingRecovery(uid: string): TrainingRecovery[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(uid)) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter(
      (item): item is TrainingRecovery =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.mutationId === 'string' &&
        ['customExercises', 'routines', 'splits', 'trainingSettings', 'fixedSchedules'].includes(
          item.collection,
        ) &&
        item.payload &&
        typeof item.payload === 'object',
    )
  } catch {
    return []
  }
}
export function saveTrainingRecovery(uid: string, records: TrainingRecovery[]): void {
  // If durable storage fails, abort before enqueueing the write so an editor can keep its draft.
  if (records.length) localStorage.setItem(key(uid), JSON.stringify(records))
  else localStorage.removeItem(key(uid))
}
export function clearAllTrainingRecovery(): void {
  for (const item of Object.keys(localStorage))
    if (item.startsWith('muscle-memory:training-recovery:')) localStorage.removeItem(item)
}
