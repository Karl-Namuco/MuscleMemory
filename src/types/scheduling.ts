import type { Routine } from './training'

/** One cursor per split; sequence is the number of qualifying completions. */
export interface RollingCursor {
  splitRevision: number
  sequence: number
  lastSlotId: string
  lastSessionId: string
  completedAt: number
}

export type RollingProgress = Record<string, RollingCursor>

interface RollingSelection {
  splitId: string
  splitRevision: number
  slotId: string
  /** The sequence token a newly started workout must retain. */
  sequence: number
  routine: Routine
  restDays: number
  /** Earliest recommended local calendar date, or null when available immediately. */
  availableOn: string | null
  reason: string
}

export type RollingRecommendation =
  | { kind: 'none'; reason: string }
  | { kind: 'unsupported'; splitId: string; splitRevision: number; reason: string }
  | {
      kind: 'unavailable'
      splitId: string
      splitRevision: number
      slotId: string | null
      sequence: number
      routine: null
      restDays: number
      availableOn: null
      reason: string
    }
  | ({ kind: 'workout' } & RollingSelection)
  | ({ kind: 'rest' } & RollingSelection)
