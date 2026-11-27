import type { FixedOccurrence, FixedSchedule } from '../../types/fixedScheduling'

export interface FixedScheduleValidationPage {
  ownerId: string
  scheduleId: string
  revision: number
  mutationId: string
  occurrences: FixedOccurrence[]
}

/** Four bounded pages let Firestore rules verify every occurrence in one batch. */
export function fixedScheduleValidationPages(
  schedule: FixedSchedule,
): { id: string; value: FixedScheduleValidationPage }[] {
  return Array.from({ length: Math.ceil(schedule.occurrences.length / 7) }, (_, index) => ({
      id: `p${index}`,
      value: {
        ownerId: schedule.ownerId,
        scheduleId: schedule.id,
        revision: schedule.revision,
        mutationId: schedule.mutationId,
        occurrences: schedule.occurrences.slice(index * 7, (index + 1) * 7),
      },
    }))
}
