import { z } from 'zod'

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const positiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

/** Reject normalized dates such as February 30 rather than rolling them forward. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export const fixedDateSchema = z.string().refine(isCalendarDate, 'Choose a valid calendar date.')
export const fixedTimeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
      return true
    } catch {
      return false
    }
  }, 'Choose a valid timezone.')

export const fixedWorkoutContextSchema = z.strictObject({
  scheduleId: identifier,
  generationId: identifier,
  occurrenceId: identifier,
  occurrenceVersion: positiveInteger,
})

export const fixedOccurrenceSchema = z
  .strictObject({
    id: identifier,
    slotId: identifier,
    routineId: identifier.nullable(),
    label: z.string().trim().min(1).max(80),
    isRestDay: z.boolean(),
    scheduledDate: fixedDateSchema,
    originalDate: fixedDateSchema,
    version: positiveInteger,
    sequence: z.number().int().min(0).max(27),
    status: z.enum(['planned', 'completed', 'skipped']),
    completionSessionId: identifier.nullable(),
    resolvedAt: timestamp.nullable(),
  })
  .superRefine((value, context) => {
    if (value.isRestDay ? value.routineId !== null : value.routineId === null)
      context.addIssue({ code: 'custom', message: 'Only training occurrences reference routines.' })
    if (
      value.status === 'planned'
        ? value.completionSessionId !== null || value.resolvedAt !== null
        : value.resolvedAt === null ||
          (value.status === 'completed'
            ? value.completionSessionId === null || value.isRestDay
            : value.completionSessionId !== null)
    )
      context.addIssue({
        code: 'custom',
        message: 'Occurrence resolution does not match its status.',
      })
  })

export const fixedScheduleActionSchema = z
  .strictObject({
    kind: z.enum(['create', 'move', 'swap', 'skip', 'complete']),
    occurrenceId: identifier.nullable(),
    otherOccurrenceId: identifier.nullable(),
    sessionId: identifier.nullable(),
  })
  .refine((action) => {
    if (action.kind === 'create')
      return (
        action.occurrenceId === null &&
        action.otherOccurrenceId === null &&
        action.sessionId === null
      )
    return (
      action.occurrenceId !== null &&
      (action.kind === 'swap'
        ? action.otherOccurrenceId !== null && action.otherOccurrenceId !== action.occurrenceId
        : action.otherOccurrenceId === null) &&
      (action.kind === 'complete' ? action.sessionId !== null : action.sessionId === null)
    )
  }, 'Invalid calendar action.')

export const fixedScheduleSchema = z
  .strictObject({
    id: identifier,
    ownerId: z.string().min(1).max(128),
    createdAt: timestamp,
    updatedAt: timestamp,
    archived: z.boolean(),
    schemaVersion: z.literal(1),
    revision: positiveInteger,
    mutationId: identifier,
    previousMutationId: identifier.nullable(),
    splitId: identifier,
    splitRevision: positiveInteger,
    generationId: identifier,
    timeZone: fixedTimeZoneSchema,
    startDate: fixedDateSchema,
    endDate: fixedDateSchema,
    preferredDays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .refine((days) => new Set(days).size === days.length),
    occurrences: z.array(fixedOccurrenceSchema).min(1).max(28),
    action: fixedScheduleActionSchema,
  })
  .superRefine((value, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message })
    if (value.id !== value.splitId) issue('The schedule must use its split identifier.')
    if (
      value.updatedAt < value.createdAt ||
      (value.revision === 1
        ? value.previousMutationId !== null
        : value.previousMutationId === null || value.previousMutationId === value.mutationId)
    )
      issue('Invalid calendar revision metadata.')
    if (isCalendarDate(value.startDate) && isCalendarDate(value.endDate)) {
      const days =
        (Date.parse(`${value.endDate}T00:00:00Z`) - Date.parse(`${value.startDate}T00:00:00Z`)) /
        86400000
      if (days !== 27) issue('The calendar must cover 28 inclusive dates.')
    }
    const ids = new Set<string>()
    const occupied = new Set<string>()
    const completions = new Set<string>()
    for (const [index, occurrence] of value.occurrences.entries()) {
      if (ids.has(occurrence.id)) issue('Occurrence identifiers must be unique.')
      ids.add(occurrence.id)
      if (occurrence.sequence !== index || occurrence.id !== `${value.generationId}_${index}`)
        issue('Occurrences must retain their generation and ordered sequence.')
      if (
        occurrence.originalDate < value.startDate ||
        occurrence.originalDate > value.endDate ||
        occurrence.scheduledDate < value.startDate ||
        occurrence.scheduledDate > value.endDate
      )
        issue('Occurrences must stay inside the calendar window.')
      if (index > 0 && occurrence.originalDate <= value.occurrences[index - 1].originalDate)
        issue('Original occurrence dates must be strictly increasing.')
      if (occurrence.status !== 'skipped') {
        if (occupied.has(occurrence.scheduledDate))
          issue('Two active occurrences cannot share a date.')
        occupied.add(occurrence.scheduledDate)
      }
      if (occurrence.completionSessionId) {
        if (completions.has(occurrence.completionSessionId))
          issue('A workout can complete only one occurrence.')
        completions.add(occurrence.completionSessionId)
      }
    }
    const primary = value.occurrences.find((entry) => entry.id === value.action.occurrenceId)
    if (value.action.kind !== 'create' && !primary)
      issue('The action must reference an occurrence.')
    if (value.action.kind === 'swap' && !ids.has(value.action.otherOccurrenceId!))
      issue('The swap must reference another occurrence.')
    if (value.action.kind === 'skip' && primary?.status !== 'skipped')
      issue('The skipped occurrence must be resolved.')
    if (
      value.action.kind === 'complete' &&
      (primary?.status !== 'completed' || primary.completionSessionId !== value.action.sessionId)
    )
      issue('The completion action must match its workout.')
  })
