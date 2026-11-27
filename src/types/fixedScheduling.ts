import type { RecordMetadata, Routine, TrainingSplit } from './training'

export interface FixedOccurrence {
  id: string
  slotId: string
  routineId: string | null
  label: string
  isRestDay: boolean
  scheduledDate: string
  originalDate: string
  version: number
  sequence: number
  status: 'planned' | 'completed' | 'skipped'
  completionSessionId: string | null
  resolvedAt: number | null
}

export interface FixedScheduleAction {
  kind: 'create' | 'move' | 'swap' | 'skip' | 'complete'
  occurrenceId: string | null
  otherOccurrenceId: string | null
  sessionId: string | null
}

export interface FixedSchedule extends RecordMetadata {
  splitId: string
  splitRevision: number
  generationId: string
  timeZone: string
  startDate: string
  endDate: string
  /** JavaScript weekdays: Sunday = 0. An empty list permits every weekday. */
  preferredDays: number[]
  occurrences: FixedOccurrence[]
  action: FixedScheduleAction
}

export interface FixedWorkoutContext {
  scheduleId: string
  generationId: string
  occurrenceId: string
  occurrenceVersion: number
}

export type FixedRecommendation =
  | {
      kind: 'setup' | 'stale' | 'unavailable'
      schedule: FixedSchedule | null
      reason: string
    }
  | {
      kind: 'workout'
      schedule: FixedSchedule
      occurrence: FixedOccurrence
      routine: Routine
      reason: string
    }
  | {
      kind: 'rest' | 'upcoming'
      schedule: FixedSchedule
      occurrence: FixedOccurrence
      routine: Routine | null
      reason: string
    }

export interface CreateFixedScheduleInput {
  split: TrainingSplit
  routines: Routine[]
  startDate: string
  timeZone: string
  preferredDays: number[]
  generationId: string
  now: number
  previous?: FixedSchedule
}
