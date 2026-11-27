import {
  fixedDateSchema,
  fixedScheduleSchema,
  fixedTimeZoneSchema,
} from '../../schemas/fixedScheduling'
import { trainingSplitSchema } from '../../schemas/training'
import type {
  CreateFixedScheduleInput,
  FixedOccurrence,
  FixedRecommendation,
  FixedSchedule,
  FixedWorkoutContext,
} from '../../types/fixedScheduling'
import type { Routine, TrainingSplit } from '../../types/training'
import type { WorkoutSession } from '../../types/workout'

export type {
  FixedOccurrence,
  FixedRecommendation,
  FixedSchedule,
  FixedWorkoutContext,
} from '../../types/fixedScheduling'

/** Use the schedule's saved timezone even when the device travels. */
export function localDate(now: number, timeZone: string): string {
  if (!Number.isFinite(now)) throw new Error('Choose a valid timestamp.')
  fixedTimeZoneSchema.parse(timeZone)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** UTC is used only for Gregorian date arithmetic, never elapsed local days. */
export function addDays(date: string, count: number): string {
  fixedDateSchema.parse(date)
  if (!Number.isSafeInteger(count)) throw new Error('Choose a whole number of days.')
  const result = new Date(`${date}T00:00:00.000Z`)
  result.setUTCDate(result.getUTCDate() + count)
  const next = result.toISOString().slice(0, 10)
  fixedDateSchema.parse(next)
  return next
}

function availableRoutine(routines: Routine[], id: string | null, ownerId: string): Routine | null {
  return (
    routines.find(
      (routine) =>
        routine.id === id &&
        routine.ownerId === ownerId &&
        !routine.archived &&
        routine.exercises.length > 0 &&
        routine.exercises.every((entry) => entry.sets.length > 0),
    ) ?? null
  )
}

export function createFixedSchedule(input: CreateFixedScheduleInput): FixedSchedule {
  const { split, routines, startDate, timeZone, generationId, now, previous } = input
  trainingSplitSchema.parse(split)
  fixedDateSchema.parse(startDate)
  fixedTimeZoneSchema.parse(timeZone)
  if (split.mode !== 'fixed' || split.archived) throw new Error('Choose an active Fixed split.')
  if (previous) {
    fixedScheduleSchema.parse(previous)
    if (previous.ownerId !== split.ownerId || previous.splitId !== split.id)
      throw new Error('The existing calendar belongs to another split or owner.')
    if (generationId === previous.generationId)
      throw new Error('Regeneration needs a new calendar identifier.')
  }
  for (const slot of split.slots)
    if (!slot.isRestDay && !availableRoutine(routines, slot.routineId, split.ownerId))
      throw new Error(`${slot.label} needs an available routine with planned sets.`)
  const preferredDays = [...input.preferredDays].sort((a, b) => a - b)
  if (
    preferredDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
    new Set(preferredDays).size !== preferredDays.length
  )
    throw new Error('Choose each preferred weekday once.')
  const occurrences: FixedOccurrence[] = []
  let slotIndex = 0
  for (let day = 0; day < 28; day += 1) {
    const date = addDays(startDate, day)
    const slot = split.slots[slotIndex % split.slots.length]
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
    if (!slot.isRestDay && preferredDays.length > 0 && !preferredDays.includes(weekday)) continue
    const sequence = occurrences.length
    occurrences.push({
      id: `${generationId}_${sequence}`,
      slotId: slot.id,
      routineId: slot.routineId,
      label: slot.label,
      isRestDay: slot.isRestDay,
      scheduledDate: date,
      originalDate: date,
      version: 1,
      sequence,
      status: 'planned',
      completionSessionId: null,
      resolvedAt: null,
    })
    slotIndex += 1
  }
  const schedule: FixedSchedule = {
    id: split.id,
    splitId: split.id,
    ownerId: split.ownerId,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    archived: false,
    schemaVersion: 1,
    revision: (previous?.revision ?? 0) + 1,
    mutationId: generationId,
    previousMutationId: previous?.mutationId ?? null,
    splitRevision: split.revision,
    generationId,
    timeZone,
    startDate,
    endDate: addDays(startDate, 27),
    preferredDays,
    occurrences,
    action: { kind: 'create', occurrenceId: null, otherOccurrenceId: null, sessionId: null },
  }
  return fixedScheduleSchema.parse(schedule)
}

function plannedOccurrence(schedule: FixedSchedule, id: string): FixedOccurrence {
  fixedScheduleSchema.parse(schedule)
  const occurrence = schedule.occurrences.find((entry) => entry.id === id)
  if (!occurrence || occurrence.status !== 'planned')
    throw new Error('Only planned occurrences can be changed.')
  if (occurrence.version >= Number.MAX_SAFE_INTEGER)
    throw new Error('Regenerate this calendar before changing it.')
  return occurrence
}

export function moveFixedOccurrence(
  schedule: FixedSchedule,
  id: string,
  date: string,
): FixedSchedule {
  const occurrence = plannedOccurrence(schedule, id)
  fixedDateSchema.parse(date)
  if (date === occurrence.scheduledDate) return schedule
  if (date < schedule.startDate || date > schedule.endDate)
    throw new Error('Choose a date inside this calendar.')
  if (
    schedule.occurrences.some(
      (entry) => entry.id !== id && entry.status !== 'skipped' && entry.scheduledDate === date,
    )
  )
    throw new Error('That date already has an occurrence. Swap the two dates instead.')
  return {
    ...schedule,
    occurrences: schedule.occurrences.map((entry) =>
      entry.id === id ? { ...entry, scheduledDate: date, version: entry.version + 1 } : entry,
    ),
    action: { kind: 'move', occurrenceId: id, otherOccurrenceId: null, sessionId: null },
  }
}

export function swapFixedOccurrences(
  schedule: FixedSchedule,
  id: string,
  otherId: string,
): FixedSchedule {
  if (id === otherId) throw new Error('Choose two different occurrences to swap.')
  const first = plannedOccurrence(schedule, id)
  const second = plannedOccurrence(schedule, otherId)
  return {
    ...schedule,
    occurrences: schedule.occurrences.map((entry) =>
      entry.id === id
        ? { ...entry, scheduledDate: second.scheduledDate, version: entry.version + 1 }
        : entry.id === otherId
          ? { ...entry, scheduledDate: first.scheduledDate, version: entry.version + 1 }
          : entry,
    ),
    action: { kind: 'swap', occurrenceId: id, otherOccurrenceId: otherId, sessionId: null },
  }
}

export function skipFixedOccurrence(
  schedule: FixedSchedule,
  id: string,
  now: number,
): FixedSchedule {
  plannedOccurrence(schedule, id)
  if (!Number.isSafeInteger(now) || now <= 0)
    throw new Error('Choose a valid resolution timestamp.')
  return {
    ...schedule,
    occurrences: schedule.occurrences.map((entry) =>
      entry.id === id
        ? { ...entry, status: 'skipped', version: entry.version + 1, resolvedAt: now }
        : entry,
    ),
    action: { kind: 'skip', occurrenceId: id, otherOccurrenceId: null, sessionId: null },
  }
}

export function getFixedRecommendation(
  schedule: FixedSchedule | null,
  split: TrainingSplit | null,
  routines: Routine[],
  now: number,
): FixedRecommendation {
  if (!split || split.mode !== 'fixed')
    return {
      kind: 'setup',
      schedule,
      reason: 'Choose an active Fixed split to plan your calendar.',
    }
  if (split.archived)
    return {
      kind: 'unavailable',
      schedule,
      reason: 'This split is archived. Choose an active split.',
    }
  if (!schedule)
    return {
      kind: 'setup',
      schedule: null,
      reason:
        'Create a 28-day calendar for this Fixed split. Leaving preferred days empty allows training on any weekday.',
    }
  if (
    !fixedScheduleSchema.safeParse(schedule).success ||
    schedule.archived ||
    schedule.splitId !== split.id ||
    schedule.ownerId !== split.ownerId ||
    schedule.splitRevision !== split.revision
  )
    return {
      kind: 'stale',
      schedule,
      reason: 'The split or calendar changed. Regenerate its calendar before training.',
    }
  const today = localDate(now, schedule.timeZone)
  const planned = schedule.occurrences
    .filter((entry) => entry.status === 'planned')
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.sequence - b.sequence)
  const occurrence =
    planned.find((entry) => !entry.isRestDay && entry.scheduledDate < today) ??
    planned.find((entry) => entry.scheduledDate === today) ??
    planned.find((entry) => entry.scheduledDate > today)
  if (!occurrence)
    return {
      kind: 'setup',
      schedule,
      reason: 'This calendar has no upcoming workouts. Create the next 28-day calendar.',
    }
  const routine = occurrence.isRestDay
    ? null
    : availableRoutine(routines, occurrence.routineId, split.ownerId)
  if (!occurrence.isRestDay && !routine)
    return {
      kind: 'unavailable',
      schedule,
      reason: `${occurrence.label} needs an available routine with planned sets. Update it before continuing.`,
    }
  if (occurrence.scheduledDate > today)
    return {
      kind: 'upcoming',
      schedule,
      occurrence,
      routine,
      reason: `${occurrence.label} is scheduled for ${occurrence.scheduledDate}. Your calendar uses ${schedule.timeZone}.`,
    }
  if (occurrence.isRestDay)
    return {
      kind: 'rest',
      schedule,
      occurrence,
      routine: null,
      reason: `Today is ${occurrence.label}, a planned rest day. Your calendar uses ${schedule.timeZone}.`,
    }
  return {
    kind: 'workout',
    schedule,
    occurrence,
    routine: routine!,
    reason:
      occurrence.scheduledDate < today
        ? `${occurrence.label} is overdue from ${occurrence.scheduledDate}. Train it, move it, swap it, or explicitly skip it; missed dates never remove workouts.`
        : `${occurrence.label} is scheduled for today in ${schedule.timeZone}.`,
  }
}

type FixedSession = WorkoutSession & { fixedContext?: FixedWorkoutContext | null }

/** Frozen generation and occurrence versions prevent replay after edits or regeneration. */
export function canCompleteFixed(
  session: FixedSession,
  schedule: FixedSchedule | null,
  split: TrainingSplit | null,
): boolean {
  const context = session.fixedContext
  const splitContext = session.splitContext
  if (
    !schedule ||
    !split ||
    !context ||
    !splitContext ||
    !fixedScheduleSchema.safeParse(schedule).success ||
    split.mode !== 'fixed' ||
    split.archived ||
    schedule.archived ||
    schedule.ownerId !== split.ownerId ||
    session.ownerId !== split.ownerId ||
    schedule.splitId !== split.id ||
    schedule.splitRevision !== split.revision ||
    context.scheduleId !== schedule.id ||
    context.generationId !== schedule.generationId ||
    splitContext.splitId !== split.id ||
    splitContext.splitRevision !== split.revision ||
    session.countsForSplit !== true ||
    session.status !== 'completed' ||
    session.completionKey !== session.id ||
    session.endedAt === null ||
    !Number.isFinite(session.endedAt) ||
    !Number.isFinite(session.startedAt) ||
    session.endedAt < session.startedAt ||
    !session.exercises.some((entry) => entry.sets.some((set) => set.completedAt !== null)) ||
    schedule.occurrences.some((entry) => entry.completionSessionId === session.id)
  )
    return false
  const occurrence = schedule.occurrences.find((entry) => entry.id === context.occurrenceId)
  return (
    !!occurrence &&
    occurrence.status === 'planned' &&
    !occurrence.isRestDay &&
    occurrence.version < Number.MAX_SAFE_INTEGER &&
    occurrence.version === context.occurrenceVersion &&
    occurrence.slotId === splitContext.slotId &&
    occurrence.sequence === splitContext.sequence &&
    occurrence.routineId === session.routineId &&
    split.slots.some(
      (slot) =>
        slot.id === occurrence.slotId && !slot.isRestDay && slot.routineId === occurrence.routineId,
    ) &&
    localDate(session.startedAt, schedule.timeZone) >= occurrence.scheduledDate
  )
}

export function completeFixedOccurrence(
  schedule: FixedSchedule,
  session: FixedSession,
  split: TrainingSplit | null,
): FixedSchedule {
  if (!canCompleteFixed(session, schedule, split)) return schedule
  const id = session.fixedContext!.occurrenceId
  return {
    ...schedule,
    occurrences: schedule.occurrences.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            status: 'completed',
            version: entry.version + 1,
            completionSessionId: session.id,
            resolvedAt: session.endedAt!,
          }
        : entry,
    ),
    action: { kind: 'complete', occurrenceId: id, otherOccurrenceId: null, sessionId: session.id },
  }
}
