import type { FixedOccurrence, FixedSchedule } from '../../types/fixedScheduling'

export interface FixedScheduleValidationPage {
  ownerId: string
  scheduleId: string
  revision: number
  mutationId: string
  occurrences: FixedOccurrence[]
}

/** Six bounded pages keep full-calendar validation within Firestore rule limits. */
export function fixedScheduleValidationPages(
  schedule: FixedSchedule,
): { id: string; value: FixedScheduleValidationPage }[] {
  return Array.from({ length: Math.ceil(schedule.occurrences.length / 5) }, (_, index) => ({
    id: `p${index}`,
    value: {
      ownerId: schedule.ownerId,
      scheduleId: schedule.id,
      revision: schedule.revision,
      mutationId: schedule.mutationId,
      occurrences: schedule.occurrences.slice(index * 5, (index + 1) * 5),
    },
  }))
}
