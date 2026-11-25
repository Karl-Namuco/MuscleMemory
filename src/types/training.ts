export const MUSCLE_GROUPS = [
  'Chest',
  'Front deltoids',
  'Side deltoids',
  'Rear deltoids',
  'Upper back',
  'Lats',
  'Lower back',
  'Trapezius',
  'Biceps',
  'Triceps',
  'Forearms',
  'Quadriceps',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Abdominals',
  'Obliques',
] as const
export const EXERCISE_EQUIPMENT = [
  'Barbell',
  'Dumbbell',
  'Cable',
  'Machine',
  'Smith machine',
  'Bodyweight',
  'Resistance band',
  'Kettlebell',
  'Other',
] as const
export const TRACKING_TYPES = [
  'weight-reps',
  'reps',
  'assisted-reps',
  'duration',
  'distance-duration',
] as const
export const MOVEMENT_PATTERNS = [
  'Horizontal push',
  'Vertical push',
  'Horizontal pull',
  'Vertical pull',
  'Squat',
  'Hinge',
  'Lunge',
  'Carry',
  'Rotation',
  'Core stability',
  'Elbow flexion',
  'Elbow extension',
  'Shoulder isolation',
  'Calf raise',
  'Locomotion',
  'Other',
] as const
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]
export type ExerciseEquipment = (typeof EXERCISE_EQUIPMENT)[number]
export type TrackingType = (typeof TRACKING_TYPES)[number]
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number]
export type SchedulingMode = 'fixed' | 'rolling' | 'adaptive'
export interface RecordMetadata {
  id: string
  ownerId: string
  createdAt: number
  updatedAt: number
  archived: boolean
  schemaVersion: 1
  revision: number
  mutationId: string
  previousMutationId: string | null
}
export interface CustomExerciseInput {
  name: string
  aliases: string[]
  description: string
  instructions: string[]
  primaryMuscles: MuscleGroup[]
  secondaryMuscles: MuscleGroup[]
  equipment: ExerciseEquipment
  movementPattern: MovementPattern
  category: 'compound' | 'isolation' | 'cardio' | 'mobility'
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  trackingType: TrackingType
  alternativeIds: string[]
  notes: string
}
export interface Exercise extends CustomExerciseInput, RecordMetadata {
  source: 'builtin' | 'custom'
}
export type ExerciseSnapshot = Pick<
  Exercise,
  'name' | 'trackingType' | 'primaryMuscles' | 'secondaryMuscles' | 'equipment' | 'movementPattern'
>
export interface PlannedSet {
  id: string
  type: 'warmup' | 'working' | 'drop' | 'other'
  repsMin: number | null
  repsMax: number | null
  targetWeightKg: number | null
  durationSeconds: number | null
  distanceMeters: number | null
}
export interface RoutineExercise {
  id: string
  exerciseId: string
  exerciseSnapshot: ExerciseSnapshot
  sets: PlannedSet[]
  restSeconds: number
  notes: string
  optional: boolean
  supersetGroup: string | null
}
export interface RoutineInput {
  name: string
  description: string
  targetMuscles: MuscleGroup[]
  exercises: RoutineExercise[]
}
export interface Routine extends RoutineInput, RecordMetadata {}
export interface SplitSlot {
  id: string
  label: string
  routineId: string | null
  isRestDay: boolean
}
export interface SplitInput {
  name: string
  description: string
  mode: SchedulingMode
  slots: SplitSlot[]
}
export interface TrainingSplit extends SplitInput, RecordMetadata {}
export interface WriteOptions {
  id?: string
  expectedRevision?: number
}
export interface SplitTemplate {
  id: string
  name: string
  description: string
  days: { label: string; exerciseIds: string[] }[]
}
export interface TrainingData {
  exercises: Exercise[]
  customExercises: Exercise[]
  routines: Routine[]
  splits: TrainingSplit[]
  activeSplitId: string | null
  loading: boolean
  error: string | null
  hasPendingWrites: boolean
  fromCache: boolean
  recoveryCount: number
  downloadRecovery: () => void
  discardRejectedChanges: () => void
  saveCustomExercise: (input: CustomExerciseInput, options?: WriteOptions) => Promise<string>
  archiveCustomExercise: (id: string, archived: boolean, expectedRevision: number) => Promise<void>
  saveRoutine: (input: RoutineInput, options?: WriteOptions) => Promise<string>
  archiveRoutine: (id: string, archived: boolean, expectedRevision: number) => Promise<void>
  saveSplit: (input: SplitInput, options?: WriteOptions) => Promise<string>
  archiveSplit: (id: string, archived: boolean, expectedRevision: number) => Promise<void>
  setActiveSplit: (id: string | null) => Promise<void>
  createSplitFromTemplate: (templateId: string) => Promise<string>
  refresh: () => void
  clearError: () => void
}
