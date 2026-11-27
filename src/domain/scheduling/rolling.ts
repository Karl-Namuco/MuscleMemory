import type { RollingCursor, RollingProgress, RollingRecommendation } from '../../types/scheduling'
import type { SplitSlot, TrainingSplit, Routine } from '../../types/training'
import type { WorkoutSession } from '../../types/workout'

export type { RollingCursor, RollingProgress, RollingRecommendation } from '../../types/scheduling'

function matchingCursor(split: TrainingSplit, progress: RollingProgress): RollingCursor | null {
  const cursor = progress[split.id]
  return cursor &&
    cursor.splitRevision === split.revision &&
    split.slots.some((slot) => slot.id === cursor.lastSlotId)
    ? cursor
    : null
}

function nextTrainingSlot(split: TrainingSplit, cursor: RollingCursor | null) {
  const start = cursor ? split.slots.findIndex((slot) => slot.id === cursor.lastSlotId) + 1 : 0
  let restDays = 0
  for (let offset = 0; offset < split.slots.length; offset += 1) {
    const slot = split.slots[(start + offset) % split.slots.length]
    if (!slot.isRestDay) return { slot, restDays: cursor ? restDays : 0 }
    restDays += 1
  }
  return { slot: null, restDays: 0 }
}

function calendarDate(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(timestamp)
  const value = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

/** Add calendar days using UTC solely as date arithmetic, never as a local-day duration. */
function addCalendarDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

function unavailable(
  split: TrainingSplit,
  sequence: number,
  slot: SplitSlot | null,
  restDays: number,
  reason: string,
): RollingRecommendation {
  return {
    kind: 'unavailable',
    splitId: split.id,
    splitRevision: split.revision,
    slotId: slot?.id ?? null,
    sequence,
    routine: null,
    restDays,
    availableOn: null,
    reason,
  }
}

/** Deterministic rolling selection. Missed dates never consume training slots. */
export function getRollingRecommendation(
  split: TrainingSplit | null,
  routines: Routine[],
  progress: RollingProgress,
  now: number,
  timeZone: string,
): RollingRecommendation {
  if (!split) return { kind: 'none', reason: 'Choose an active split to see your next workout.' }
  if (split.mode !== 'rolling') {
    return {
      kind: 'unsupported',
      splitId: split.id,
      splitRevision: split.revision,
      reason: 'Next-workout recommendations are currently available for Rolling splits.',
    }
  }

  const cursor = matchingCursor(split, progress)
  const sequence = cursor?.sequence ?? 0
  const { slot, restDays } = nextTrainingSlot(split, cursor)
  if (split.archived) {
    return unavailable(
      split,
      sequence,
      slot,
      restDays,
      'This split is archived. Choose an active split.',
    )
  }
  if (!slot) {
    return unavailable(
      split,
      sequence,
      null,
      0,
      'Add a training slot to this split to get started.',
    )
  }
  const routine = routines.find((candidate) => candidate.id === slot.routineId)
  if (!routine || routine.archived || !routine.exercises.some((entry) => entry.sets.length > 0)) {
    return unavailable(
      split,
      sequence,
      slot,
      restDays,
      `The next slot, ${slot.label}, needs an available routine with planned sets. Update this slot to continue.`,
    )
  }

  const availableOn =
    cursor && restDays > 0
      ? addCalendarDays(calendarDate(cursor.completedAt, timeZone), restDays + 1)
      : null
  const selection = {
    splitId: split.id,
    splitRevision: split.revision,
    slotId: slot.id,
    sequence,
    routine,
    restDays,
    availableOn,
  }
  if (availableOn && calendarDate(now, timeZone) < availableOn) {
    return {
      kind: 'rest',
      ...selection,
      reason: `${restDays} planned rest ${restDays === 1 ? 'day follows' : 'days follow'} your last completion. ${routine.name} is next on ${availableOn}.`,
    }
  }
  if (!cursor) {
    const restart = progress[split.id]
      ? `The split changed, so the rolling cycle restarts at ${slot.label}.`
      : `${routine.name} starts your rolling cycle.`
    return {
      kind: 'workout',
      ...selection,
      reason: `${restart} Rest days apply after a completed workout.`,
    }
  }
  return {
    kind: 'workout',
    ...selection,
    reason: `${routine.name} follows your last qualifying completion. Missed days do not skip workouts.${restDays > 0 ? ' Your planned rest days are complete.' : ''}`,
  }
}

/**
 * Compare performed-set counts with the frozen plan for each exercise entry.
 * Actual-set IDs differ from planned-set IDs. Optional exercises and warmups
 * count consistently; removing actual sets does not shrink the original plan.
 */
export function isPartialWorkout(session: WorkoutSession): boolean {
  return session.exercises.some(
    (entry) =>
      entry.sets.filter((set) => set.completedAt !== null).length < entry.plannedSets.length,
  )
}

/** Only the current slot and sequence can advance, once, after explicit inclusion. */
export function canAdvanceRolling(
  session: WorkoutSession,
  split: TrainingSplit | null,
  progress: RollingProgress,
): boolean {
  const context = session.splitContext
  if (
    !split ||
    split.archived ||
    split.mode !== 'rolling' ||
    session.countsForSplit !== true ||
    session.status !== 'completed' ||
    session.completionKey !== session.id ||
    session.endedAt === null ||
    !Number.isFinite(session.endedAt) ||
    session.endedAt < session.startedAt ||
    !session.exercises.some((entry) => entry.sets.some((set) => set.completedAt !== null)) ||
    session.ownerId !== split.ownerId ||
    context?.splitId !== split.id ||
    context.splitRevision !== split.revision
  ) {
    return false
  }
  const cursor = matchingCursor(split, progress)
  const sequence = cursor?.sequence ?? 0
  const { slot } = nextTrainingSlot(split, cursor)
  return (
    Number.isSafeInteger(sequence) &&
    sequence < Number.MAX_SAFE_INTEGER &&
    context.sequence === sequence &&
    slot !== null &&
    slot.id === context.slotId &&
    slot.routineId === session.routineId &&
    cursor?.lastSessionId !== session.id &&
    (cursor === null || session.endedAt >= cursor.completedAt)
  )
}

/** Preserve unrelated split progress and return the same map for ineligible sessions. */
export function advanceRollingProgress(
  session: WorkoutSession,
  split: TrainingSplit | null,
  progress: RollingProgress,
): RollingProgress {
  if (!canAdvanceRolling(session, split, progress)) return progress
  const context = session.splitContext!
  return {
    ...progress,
    [split!.id]: {
      splitRevision: context.splitRevision,
      sequence: context.sequence! + 1,
      lastSlotId: context.slotId,
      lastSessionId: session.id,
      completedAt: session.endedAt!,
    },
  }
}
