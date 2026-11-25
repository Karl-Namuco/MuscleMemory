import { z } from 'zod'
import { EQUIPMENT, GOALS, MUSCLES } from '../types/profile'

const unique = <T>(values: T[]) => new Set(values).size === values.length
const boundedStrings = z
  .array(z.string().trim().min(1).max(120))
  .max(10, 'Use at most 10 exercises.')
  .refine(unique, 'Remove duplicate exercises.')
const muscles = z
  .array(z.enum(MUSCLES))
  .max(MUSCLES.length)
  .refine(unique, 'Choose each muscle only once.')
const days = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .refine(unique, 'Choose each day only once.')

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function isCalendarDate(value: string): boolean {
  if (value === '') return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export const preferencesSchema = z
  .object({
    weightUnit: z.enum(['kg', 'lb']),
    timeZone: z.string().min(1).max(100).refine(isTimeZone, 'Choose a valid time zone.'),
    weekStartsOn: z.union([z.literal(0), z.literal(1)]),
    experience: z.enum(['beginner', 'intermediate', 'advanced']),
    goals: z
      .array(z.enum(GOALS))
      .min(1, 'Choose at least one goal.')
      .max(GOALS.length)
      .refine(unique, 'Choose each goal only once.'),
    sessionsPerWeek: z.number().int().min(1).max(7),
    preferredDays: days,
    restDays: days,
    sessionMinutes: z.number().int().min(15).max(180),
    flexibility: z.enum(['fixed', 'flexible']),
    schedulingMode: z.enum(['fixed', 'rolling', 'adaptive']),
    preferredSplit: z.enum(['push-pull-legs', 'upper-lower', 'full-body', 'custom']),
    equipment: z
      .array(z.enum(EQUIPMENT))
      .min(1, 'Choose at least one equipment option.')
      .max(EQUIPMENT.length)
      .refine(unique, 'Choose each option only once.'),
    priorityMuscles: muscles,
    excludedExercises: boundedStrings,
    favoriteExercises: boundedStrings,
    recoveryPreference: z.enum(['balanced', 'conservative']),
    initialHistory: z
      .object({
        lastTrainedDate: z.string().refine(isCalendarDate, 'Choose a valid date.'),
        lastWorkout: z.string().trim().max(120),
        muscles,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.preferredDays.some((day) => value.restDays.includes(day))) {
      ctx.addIssue({
        code: 'custom',
        path: ['restDays'],
        message: 'A training day cannot also be a rest day.',
      })
    }
    if (value.favoriteExercises.some((exercise) => value.excludedExercises.includes(exercise))) {
      ctx.addIssue({
        code: 'custom',
        path: ['excludedExercises'],
        message: 'An exercise cannot be both a favorite and excluded.',
      })
    }
    const history = value.initialHistory
    if (!history.lastTrainedDate && (history.lastWorkout || history.muscles.length > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['initialHistory', 'lastTrainedDate'],
        message: 'Add the date of this previous workout.',
      })
    }
    if (history.lastTrainedDate && isTimeZone(value.timeZone)) {
      const parts = new Intl.DateTimeFormat('en', {
        timeZone: value.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date())
      const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
      const today = `${part('year')}-${part('month')}-${part('day')}`
      if (history.lastTrainedDate > today) {
        ctx.addIssue({
          code: 'custom',
          path: ['initialHistory', 'lastTrainedDate'],
          message: 'Your previous workout cannot be in the future.',
        })
      }
    }
  })

export const userPreferencesSchema = preferencesSchema

export const profileInputSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, 'Enter your name.')
      .max(60, 'Use 60 characters or fewer.'),
    onboardingCompleted: z.boolean(),
    preferences: preferencesSchema,
  })
  .strict()

export const userProfileSchema = z
  .object({
    uid: z.string().min(1).max(128),
    displayName: z.string().max(60),
    onboardingCompleted: z.boolean(),
    schemaVersion: z.literal(1),
    createdAt: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
  })
  .strict()
  .refine((value) => value.updatedAt >= value.createdAt, 'The profile timestamps are invalid.')
