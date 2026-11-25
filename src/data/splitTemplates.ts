import type { SplitTemplate } from '../types/training'

export const SPLIT_TEMPLATE_VERSION = 1
const push = [
  'bench-press',
  'incline-dumbbell-press',
  'dumbbell-shoulder-press',
  'lateral-raise',
  'triceps-pushdown',
]
const pull = ['lat-pulldown', 'seated-cable-row', 'rear-delt-fly', 'barbell-curl', 'hammer-curl']
const legs = ['back-squat', 'romanian-deadlift', 'leg-curl', 'calf-raise', 'plank']
const upper = [
  'dumbbell-bench-press',
  'lat-pulldown',
  'one-arm-row',
  'dumbbell-shoulder-press',
  'barbell-curl',
  'triceps-pushdown',
]
const lower = ['leg-press', 'romanian-deadlift', 'reverse-lunge', 'calf-raise', 'cable-crunch']
export const SPLIT_TEMPLATES: SplitTemplate[] = [
  {
    id: 'push-pull-legs',
    name: 'Push / Pull / Legs',
    description: 'Three sessions grouped by pushing, pulling, and lower-body movements.',
    days: [
      { label: 'Push', exerciseIds: push },
      { label: 'Pull', exerciseIds: pull },
      { label: 'Legs', exerciseIds: legs },
    ],
  },
  {
    id: 'upper-lower',
    name: 'Upper / Lower',
    description: 'Four sessions alternating upper and lower body with two variations.',
    days: [
      { label: 'Upper A', exerciseIds: upper },
      { label: 'Lower A', exerciseIds: legs },
      {
        label: 'Upper B',
        exerciseIds: [
          'incline-dumbbell-press',
          'barbell-row',
          'face-pull',
          'lateral-raise',
          'hammer-curl',
          'overhead-triceps-extension',
        ],
      },
      { label: 'Lower B', exerciseIds: lower },
    ],
  },
  {
    id: 'full-body',
    name: 'Full Body',
    description: 'Three sessions each covering pushing, pulling, and lower-body work.',
    days: [
      {
        label: 'Full Body A',
        exerciseIds: [
          'goblet-squat',
          'dumbbell-bench-press',
          'seated-cable-row',
          'romanian-deadlift',
          'plank',
        ],
      },
      {
        label: 'Full Body B',
        exerciseIds: [
          'reverse-lunge',
          'dumbbell-shoulder-press',
          'lat-pulldown',
          'hip-thrust',
          'side-plank',
        ],
      },
      {
        label: 'Full Body C',
        exerciseIds: ['leg-press', 'push-up', 'one-arm-row', 'leg-curl', 'calf-raise'],
      },
    ],
  },
  {
    id: 'arnold',
    name: 'Arnold Split',
    description:
      'Chest and back, shoulders and arms, then legs. Repeat the sequence at your own pace.',
    days: [
      {
        label: 'Chest & Back',
        exerciseIds: ['bench-press', 'lat-pulldown', 'incline-dumbbell-press', 'seated-cable-row'],
      },
      {
        label: 'Shoulders & Arms',
        exerciseIds: [
          'dumbbell-shoulder-press',
          'lateral-raise',
          'rear-delt-fly',
          'barbell-curl',
          'triceps-pushdown',
        ],
      },
      { label: 'Legs', exerciseIds: legs },
    ],
  },
  {
    id: 'bro',
    name: 'Body Part Split',
    description: 'Five focused sessions for chest, back, shoulders, legs, and arms.',
    days: [
      { label: 'Chest', exerciseIds: ['bench-press', 'incline-dumbbell-press', 'cable-fly'] },
      {
        label: 'Back',
        exerciseIds: ['lat-pulldown', 'barbell-row', 'seated-cable-row', 'back-extension'],
      },
      {
        label: 'Shoulders',
        exerciseIds: ['dumbbell-shoulder-press', 'lateral-raise', 'rear-delt-fly', 'shrug'],
      },
      { label: 'Legs', exerciseIds: legs },
      {
        label: 'Arms',
        exerciseIds: [
          'barbell-curl',
          'hammer-curl',
          'triceps-pushdown',
          'overhead-triceps-extension',
        ],
      },
    ],
  },
  {
    id: 'ppl-upper-lower',
    name: 'PPL + Upper / Lower',
    description:
      'Five sessions combining focused push, pull, and legs with upper and lower sessions.',
    days: [
      { label: 'Push', exerciseIds: push },
      { label: 'Pull', exerciseIds: pull },
      { label: 'Legs', exerciseIds: legs },
      { label: 'Upper', exerciseIds: upper },
      { label: 'Lower', exerciseIds: lower },
    ],
  },
]
