import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useForm, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { ArrowLeft, ArrowRight, Check, CheckCheck, Clock3, Dumbbell, History, Save, Target, UserRound } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Brand from '../../components/shared/Brand'
import { useAuth } from '../../services/auth/AuthProvider'
import { profileInputSchema } from '../../schemas/profile'
import { EQUIPMENT, GOALS, MUSCLES, defaultPreferences, type ProfileInput } from '../../types/profile'
import { readOnboardingDraft, recoverDraftInput, saveOnboardingDraft } from './draft'
import { commaSeparatedValues, DAYS, dayNames, EXPERIENCE_LABELS, SCHEDULING_LABELS, SPLIT_LABELS } from './preferences'
import './onboarding.css'

const STEPS = [
  { label: 'About you', title: 'Make it yours.', description: 'A few essentials to make your training feel like your training.' },
  { label: 'Your goals', title: 'What are you working toward?', description: 'Choose what matters to you. You can change your priorities anytime.' },
  { label: 'Your week', title: 'Find your training rhythm.', description: 'Build around the time you actually have. A missed day should be easy to work around.' },
  { label: 'Your setup', title: 'Set up your way to train.', description: 'Tell us how you like to train and what equipment you have available.' },
  { label: 'Ready to go', title: 'Your starting point.', description: 'Check your preferences, add any recent training, and you’re ready.' },
]

const STEP_FIELDS: FieldPath<ProfileInput>[][] = [
  ['displayName', 'preferences.weightUnit', 'preferences.timeZone', 'preferences.weekStartsOn', 'preferences.experience'],
  ['preferences.goals'],
  ['preferences.sessionsPerWeek', 'preferences.preferredDays', 'preferences.restDays', 'preferences.sessionMinutes', 'preferences.flexibility'],
  ['preferences.schedulingMode', 'preferences.preferredSplit', 'preferences.equipment', 'preferences.priorityMuscles', 'preferences.excludedExercises', 'preferences.favoriteExercises', 'preferences.recoveryPreference'],
  ['preferences.initialHistory.lastTrainedDate', 'preferences.initialHistory.lastWorkout', 'preferences.initialHistory.muscles'],
]

function getTimeZones(): string[] {
  const current = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  try {
    return [...new Set([current, 'UTC', ...Intl.supportedValuesOf('timeZone')])].sort()
  } catch {
    return [...new Set([current, 'UTC', 'Asia/Manila', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Australia/Sydney'])].sort()
  }
}

const TIME_ZONES = getTimeZones()
const formSchema: z.ZodType<ProfileInput, ProfileInput> = profileInputSchema

function toggle<T>(values: T[], item: T): T[] {
  return values.includes(item) ? values.filter((value) => value !== item) : [...values, item]
}

function Choice({ selected, children, description, onClick }: { selected: boolean; children: ReactNode; description?: string; onClick: () => void }) {
  return <button type="button" className="setup-choice" aria-pressed={selected} onClick={onClick}>
    <span className="setup-check" aria-hidden="true">{selected && <Check size={13} strokeWidth={3} />}</span>
    <span className="setup-choice-copy">{children}{description && <small>{description}</small>}</span>
  </button>
}

function FieldMessage({ message, id }: { message?: string; id?: string }) {
  return message ? <p className="setup-error" role="alert" id={id}>{message}</p> : null
}

function readableSaveError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code.includes('permission-denied')) return 'Your account cannot save these preferences yet. Check your access and try again.'
  if (code.includes('unavailable') || code.includes('network')) return 'The save could not finish. Your setup is still on this device. Try again when your connection is available.'
  return 'Your preferences could not be saved. Your setup is still here; please try again.'
}

export default function OnboardingPage() {
  const { user, account, saveProfile, logout } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isEditing = searchParams.get('edit') === '1' && Boolean(account?.profile.onboardingCompleted)
  const [step, setStep] = useState(0)
  const [ready, setReady] = useState(false)
  const [draftState, setDraftState] = useState<'saved' | 'saving' | 'unavailable'>('saved')
  const [restored, setRestored] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const savingRef = useRef(false)
  const draftWrites = useRef<Promise<void>>(Promise.resolve())
  const accountRef = useRef(account)
  const userRef = useRef(user)
  accountRef.current = account
  userRef.current = user

  const { register, watch, reset, setValue, trigger, getFieldState, handleSubmit, formState: { errors, isSubmitting } } = useForm<ProfileInput>({
    resolver: zodResolver(formSchema),
    defaultValues: { displayName: '', onboardingCompleted: false, preferences: defaultPreferences() },
    mode: 'onTouched',
  })
  const values = watch()
  const preferences = values.preferences
  const uid = user?.uid

  useEffect(() => {
    let cancelled = false
    if (!uid) return
    setReady(false)
    const currentAccount = accountRef.current
    const initial: ProfileInput = {
      displayName: currentAccount?.profile.displayName || userRef.current?.displayName || '',
      preferences: currentAccount?.preferences || defaultPreferences(),
      onboardingCompleted: Boolean(currentAccount?.profile.onboardingCompleted),
    }
    async function restore() {
      try {
        const draft = await readOnboardingDraft(uid!)
        if (cancelled) return
        if (draft && (!currentAccount || draft.savedAt > currentAccount.profile.updatedAt)) {
          const recoveredInput = recoverDraftInput(draft.input)
          if (recoveredInput) {
            reset({ ...recoveredInput, onboardingCompleted: initial.onboardingCompleted })
            setStep(Math.max(0, Math.min(4, draft.step)))
            setRestored(true)
          } else reset(initial)
        } else reset(initial)
      } catch {
        if (cancelled) return
        reset(initial)
        setDraftState('unavailable')
      }
      if (!cancelled) setReady(true)
    }
    void restore()
    return () => { cancelled = true }
  }, [uid, isEditing, reset])

  // Writes are serialized so the recovery checkpoint is durable before leaving.
  const serializedValues = JSON.stringify(values)
  useEffect(() => {
    if (!ready || !uid || savingRef.current) return
    const input = JSON.parse(serializedValues) as ProfileInput
    setDraftState((state) => state === 'unavailable' ? state : 'saving')
    draftWrites.current = draftWrites.current.catch(() => undefined).then(async () => {
      try {
        await saveOnboardingDraft(uid, input, step)
        if (!savingRef.current) setDraftState('saved')
      } catch {
        setDraftState('unavailable')
      }
    })
  }, [serializedValues, step, ready, uid])

  useEffect(() => {
    if (ready) headingRef.current?.focus({ preventScroll: true })
  }, [step, ready])

  async function nextStep() {
    setSaveError('')
    if (await trigger(STEP_FIELDS[step], { shouldFocus: true })) {
      setStep((current) => Math.min(4, current + 1))
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }

  async function finish(input: ProfileInput) {
    if (!uid) return
    savingRef.current = true
    setSaveError('')
    try {
      await saveProfile({ ...input, onboardingCompleted: true })
      await draftWrites.current.catch(() => undefined)
      // A local Firestore write can still be rejected by the server. Retain the
      // checkpoint; newer account data makes it inert after synchronization.
      navigate(isEditing ? '/profile' : '/today', { replace: true })
    } catch (error) {
      savingRef.current = false
      setSaveError(readableSaveError(error))
    }
  }

  const submit = handleSubmit(finish, () => {
    const firstInvalidStep = STEP_FIELDS.findIndex((fields) => fields.some((field) => getFieldState(field).invalid))
    if (firstInvalidStep >= 0) setStep(firstInvalidStep)
    setSaveError('Check the highlighted fields before saving your preferences.')
  })

  async function leaveAccount() {
    setSigningOut(true)
    savingRef.current = true
    try {
      await draftWrites.current.catch(() => undefined)
      await logout()
    } catch {
      savingRef.current = false
      setSigningOut(false)
      setSaveError('Sign out could not finish. Allow pending account changes to sync, then try again.')
    }
  }

  function setPreferredDay(day: number) {
    setValue('preferences.preferredDays', toggle(preferences.preferredDays, day), { shouldDirty: true, shouldValidate: true })
    if (preferences.restDays.includes(day)) setValue('preferences.restDays', preferences.restDays.filter((value) => value !== day), { shouldDirty: true, shouldValidate: true })
  }

  function setRestDay(day: number) {
    setValue('preferences.restDays', toggle(preferences.restDays, day), { shouldDirty: true, shouldValidate: true })
    if (preferences.preferredDays.includes(day)) setValue('preferences.preferredDays', preferences.preferredDays.filter((value) => value !== day), { shouldDirty: true, shouldValidate: true })
  }

  if (!user || !ready) return <div className="setup-loading" role="status">Loading your training preferences…</div>

  const visibleDays = preferences.weekStartsOn === 0 ? [DAYS[6], ...DAYS.slice(0, 6)] : DAYS
  const historyErrors = errors.preferences?.initialHistory
  const today = new Date()
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  return <main className="setup-page">
    <header className="setup-brandbar"><Brand /><button type="button" className="btn btn-ghost" onClick={() => void leaveAccount()} disabled={signingOut || isSubmitting}>{signingOut ? 'Signing out…' : 'Sign out'}</button></header>
    <div className="setup-topline">
      <span className="eyebrow">{isEditing ? 'Training preferences' : 'Your training, in sync'}</span>
      <span className="setup-step-count">{step + 1} / {STEPS.length} · {STEPS[step].label}</span>
    </div>
    <div className="setup-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
      {STEPS.map((item, index) => <span key={item.label} data-active={index <= step} />)}
    </div>
    <h1 className="setup-heading" ref={headingRef} tabIndex={-1}>{STEPS[step].title}</h1>
    <p className="setup-description">{STEPS[step].description}</p>

    {restored && <div className="notice" role="status" style={{ marginBottom: 20 }}>Your unfinished setup was restored from this device.</div>}

    <form className="setup-form" onSubmit={(event) => {
      if (step < 4) { event.preventDefault(); void nextStep() }
      else void submit(event)
    }} noValidate>
      {step === 0 && <div className="setup-fields">
        <div className="setup-field setup-full">
          <label htmlFor="display-name">What should we call you?</label>
          <input id="display-name" autoComplete="given-name" placeholder="Your name" maxLength={60} {...register('displayName')} aria-invalid={Boolean(errors.displayName)} aria-describedby={errors.displayName ? 'name-error' : undefined} />
          <FieldMessage message={errors.displayName?.message} id="name-error" />
        </div>
        <div className="setup-field">
          <label htmlFor="weight-unit">Weight unit</label>
          <select id="weight-unit" {...register('preferences.weightUnit')}><option value="kg">Kilograms (kg)</option><option value="lb">Pounds (lb)</option></select>
          <FieldMessage message={errors.preferences?.weightUnit?.message} />
        </div>
        <div className="setup-field">
          <label htmlFor="week-start">Start of your week</label>
          <select id="week-start" {...register('preferences.weekStartsOn', { valueAsNumber: true })}><option value={1}>Monday</option><option value={0}>Sunday</option></select>
          <FieldMessage message={errors.preferences?.weekStartsOn?.message} />
        </div>
        <div className="setup-field setup-full">
          <label htmlFor="time-zone">Time zone</label>
          <select id="time-zone" {...register('preferences.timeZone')} aria-invalid={Boolean(errors.preferences?.timeZone)}>{TIME_ZONES.map((zone) => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}</select>
          <small>Used for your training days and workout history.</small>
          <FieldMessage message={errors.preferences?.timeZone?.message} />
        </div>
        <fieldset className="setup-fieldset setup-full">
          <legend className="setup-legend">Training experience</legend>
          <div className="setup-choice-grid">
            <Choice selected={preferences.experience === 'beginner'} onClick={() => setValue('preferences.experience', 'beginner', { shouldDirty: true })} description="Finding my routine, or returning after a break.">Beginner</Choice>
            <Choice selected={preferences.experience === 'intermediate'} onClick={() => setValue('preferences.experience', 'intermediate', { shouldDirty: true })} description="Training consistently and building on the basics.">Intermediate</Choice>
            <Choice selected={preferences.experience === 'advanced'} onClick={() => setValue('preferences.experience', 'advanced', { shouldDirty: true })} description="Years of consistent, structured training.">Advanced</Choice>
          </div>
        </fieldset>
      </div>}

      {step === 1 && <fieldset className="setup-fieldset">
        <legend className="setup-legend">Your goals <span className="muted">· choose one or more</span></legend>
        <div className="setup-choice-grid">
          {GOALS.map((goal) => <Choice key={goal} selected={preferences.goals.includes(goal)} onClick={() => setValue('preferences.goals', toggle(preferences.goals, goal), { shouldDirty: true, shouldValidate: true })} description={{ 'Build muscle': 'Add muscle and develop your physique.', 'Get stronger': 'Build strength in the movements you care about.', 'General fitness': 'Feel capable and make training a habit.', Endurance: 'Improve your capacity to keep going.', 'Body recomposition': 'Build muscle while working on body composition.' }[goal]}>{goal}</Choice>)}
        </div>
        <FieldMessage message={errors.preferences?.goals?.message} />
        <p className="setup-help" style={{ marginTop: 16 }}>Your goals guide future recommendations. There’s no single right combination.</p>
      </fieldset>}

      {step === 2 && <div className="setup-fields">
        <div className="setup-field">
          <label htmlFor="sessions-per-week">Sessions per week</label>
          <select id="sessions-per-week" {...register('preferences.sessionsPerWeek', { valueAsNumber: true })}>{[1, 2, 3, 4, 5, 6, 7].map((count) => <option key={count} value={count}>{count} {count === 1 ? 'session' : 'sessions'}</option>)}</select>
          <FieldMessage message={errors.preferences?.sessionsPerWeek?.message} />
        </div>
        <div className="setup-field">
          <label htmlFor="session-minutes">Usual workout length</label>
          <input id="session-minutes" type="number" inputMode="numeric" min={15} max={180} step={5} {...register('preferences.sessionMinutes', { valueAsNumber: true })} aria-invalid={Boolean(errors.preferences?.sessionMinutes)} aria-describedby="duration-help" />
          <small id="duration-help">Minutes, including your rests and warm-up.</small>
          <FieldMessage message={errors.preferences?.sessionMinutes?.message} />
        </div>
        <fieldset className="setup-fieldset setup-full">
          <legend className="setup-legend">Preferred training days</legend>
          <div className="setup-days">{visibleDays.map((day) => <button type="button" className="setup-day" key={day.value} aria-label={day.name} aria-pressed={preferences.preferredDays.includes(day.value)} onClick={() => setPreferredDay(day.value)}>{day.short}</button>)}</div>
          <p className="setup-help">Choose the days you usually have time. You can leave this open.</p>
          <FieldMessage message={errors.preferences?.preferredDays?.message} />
        </fieldset>
        <fieldset className="setup-fieldset setup-full">
          <legend className="setup-legend">Protected rest days</legend>
          <div className="setup-days">{visibleDays.map((day) => <button type="button" className="setup-day" data-rest="true" key={day.value} aria-label={`${day.name} rest day`} aria-pressed={preferences.restDays.includes(day.value)} onClick={() => setRestDay(day.value)}>{day.short}</button>)}</div>
          <p className="setup-help">Optional. A rest day is removed from your preferred training days.</p>
          <FieldMessage message={errors.preferences?.restDays?.message} />
        </fieldset>
        <fieldset className="setup-fieldset setup-full">
          <legend className="setup-legend">How flexible is your week?</legend>
          <div className="setup-choice-grid">
            <Choice selected={preferences.flexibility === 'flexible'} onClick={() => setValue('preferences.flexibility', 'flexible', { shouldDirty: true })} description="My available days can change week to week.">Flexible</Choice>
            <Choice selected={preferences.flexibility === 'fixed'} onClick={() => setValue('preferences.flexibility', 'fixed', { shouldDirty: true })} description="I usually train on the same days.">Mostly consistent</Choice>
          </div>
        </fieldset>
      </div>}

      {step === 3 && <>
        <fieldset className="setup-fieldset">
          <legend className="setup-legend">Scheduling style</legend>
          <div className="setup-choice-grid">
            <Choice selected={preferences.schedulingMode === 'rolling'} onClick={() => setValue('preferences.schedulingMode', 'rolling', { shouldDirty: true })} description="Keep your split in order, even when life moves a workout.">Rolling split</Choice>
            <Choice selected={preferences.schedulingMode === 'adaptive'} onClick={() => setValue('preferences.schedulingMode', 'adaptive', { shouldDirty: true })} description="Consider your time, recent training, and recovery.">Smart adaptive</Choice>
            <Choice selected={preferences.schedulingMode === 'fixed'} onClick={() => setValue('preferences.schedulingMode', 'fixed', { shouldDirty: true })} description="Give workouts a regular place on your calendar.">Fixed schedule</Choice>
          </div>
        </fieldset>
        <div className="setup-field">
          <label htmlFor="preferred-split">Preferred training split</label>
          <select id="preferred-split" {...register('preferences.preferredSplit')}>{Object.entries(SPLIT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <small>Saved as a preference. Routine and split building will be available in a later phase.</small>
        </div>
        <fieldset className="setup-fieldset">
          <legend className="setup-legend">Available equipment</legend>
          <div className="setup-options">{EQUIPMENT.map((item) => <button type="button" className="setup-chip" key={item} aria-pressed={preferences.equipment.includes(item)} onClick={() => setValue('preferences.equipment', toggle(preferences.equipment, item), { shouldDirty: true, shouldValidate: true })}>{item}</button>)}</div>
          <FieldMessage message={errors.preferences?.equipment?.message} />
        </fieldset>
        <fieldset className="setup-fieldset">
          <legend className="setup-legend">Muscles to prioritize <span className="muted">· optional</span></legend>
          <div className="setup-options">{MUSCLES.map((muscle) => <button type="button" className="setup-chip" key={muscle} aria-pressed={preferences.priorityMuscles.includes(muscle)} onClick={() => setValue('preferences.priorityMuscles', toggle(preferences.priorityMuscles, muscle), { shouldDirty: true, shouldValidate: true })}>{muscle}</button>)}</div>
          <FieldMessage message={errors.preferences?.priorityMuscles?.message} />
        </fieldset>
        <div className="setup-fields">
          <div className="setup-field">
            <label htmlFor="favorite-exercises">Exercises you enjoy <span className="muted">· optional</span></label>
            <textarea id="favorite-exercises" placeholder="e.g. Dumbbell bench press, pull-ups" defaultValue={preferences.favoriteExercises.join(', ')} onChange={(event) => setValue('preferences.favoriteExercises', commaSeparatedValues(event.target.value), { shouldDirty: true })} />
            <small>Add up to 10 exercise names, separated by commas.</small>
            <FieldMessage message={errors.preferences?.favoriteExercises?.message} />
          </div>
          <div className="setup-field">
            <label htmlFor="excluded-exercises">Exercises to avoid <span className="muted">· optional</span></label>
            <textarea id="excluded-exercises" placeholder="e.g. Barbell back squat" defaultValue={preferences.excludedExercises.join(', ')} onChange={(event) => setValue('preferences.excludedExercises', commaSeparatedValues(event.target.value), { shouldDirty: true })} />
            <small>Up to 10 exercise names. This does not assess injury or pain.</small>
            <FieldMessage message={errors.preferences?.excludedExercises?.message} />
          </div>
        </div>
        <fieldset className="setup-fieldset">
          <legend className="setup-legend">Recovery preference</legend>
          <div className="setup-choice-grid">
            <Choice selected={preferences.recoveryPreference === 'balanced'} onClick={() => setValue('preferences.recoveryPreference', 'balanced', { shouldDirty: true })} description="Balance training frequency and time to recover.">Balanced</Choice>
            <Choice selected={preferences.recoveryPreference === 'conservative'} onClick={() => setValue('preferences.recoveryPreference', 'conservative', { shouldDirty: true })} description="Allow more recovery between similar sessions.">More recovery</Choice>
          </div>
        </fieldset>
      </>}

      {step === 4 && <>
        <section className="setup-panel" aria-labelledby="recent-training-heading">
          <h2 className="setup-panel-title" id="recent-training-heading"><History aria-hidden="true" /> Recent training <span className="setup-optional">Optional</span></h2>
          <p className="setup-help" style={{ margin: '0 0 20px' }}>If you remember your last workout, add it here. Otherwise, leave this blank and start fresh.</p>
          <div className="setup-fields">
            <div className="setup-field">
              <label htmlFor="last-trained-date">Last trained</label>
              <input id="last-trained-date" type="date" max={todayString} {...register('preferences.initialHistory.lastTrainedDate')} aria-invalid={Boolean(historyErrors?.lastTrainedDate)} />
              <FieldMessage message={historyErrors?.lastTrainedDate?.message} />
            </div>
            <div className="setup-field">
              <label htmlFor="last-workout">Workout name</label>
              <input id="last-workout" placeholder="e.g. Push" maxLength={100} {...register('preferences.initialHistory.lastWorkout')} />
              <FieldMessage message={historyErrors?.lastWorkout?.message} />
            </div>
            <fieldset className="setup-fieldset setup-full">
              <legend className="setup-legend">Muscles trained</legend>
              <div className="setup-options">{MUSCLES.map((muscle) => <button type="button" className="setup-chip" key={muscle} aria-pressed={preferences.initialHistory.muscles.includes(muscle)} onClick={() => setValue('preferences.initialHistory.muscles', toggle(preferences.initialHistory.muscles, muscle), { shouldDirty: true, shouldValidate: true })}>{muscle}</button>)}</div>
              <FieldMessage message={historyErrors?.muscles?.message} />
            </fieldset>
          </div>
        </section>
        <section className="setup-panel" aria-labelledby="about-review-heading">
          <div className="setup-review-heading"><h2 className="setup-panel-title" id="about-review-heading"><UserRound aria-hidden="true" /> About you</h2><button type="button" className="setup-review-edit" onClick={() => setStep(0)}>Edit</button></div>
          <dl className="setup-summary"><div><dt>Name</dt><dd>{values.displayName || 'Add your name'}</dd></div><div><dt>Experience</dt><dd>{EXPERIENCE_LABELS[preferences.experience]}</dd></div><div><dt>Units & week</dt><dd>{preferences.weightUnit === 'kg' ? 'Kilograms' : 'Pounds'} · starts {preferences.weekStartsOn === 1 ? 'Monday' : 'Sunday'}</dd></div><div><dt>Time zone</dt><dd>{preferences.timeZone.replaceAll('_', ' ')}</dd></div></dl>
        </section>
        <section className="setup-panel" aria-labelledby="goals-review-heading">
          <div className="setup-review-heading"><h2 className="setup-panel-title" id="goals-review-heading"><Target aria-hidden="true" /> Your goals</h2><button type="button" className="setup-review-edit" onClick={() => setStep(1)}>Edit</button></div>
          <dl className="setup-summary"><div className="setup-full"><dt>Working toward</dt><dd>{preferences.goals.join(' · ') || 'Choose at least one goal'}</dd></div></dl>
        </section>
        <section className="setup-panel" aria-labelledby="week-review-heading">
          <div className="setup-review-heading"><h2 className="setup-panel-title" id="week-review-heading"><Clock3 aria-hidden="true" /> Your week</h2><button type="button" className="setup-review-edit" onClick={() => setStep(2)}>Edit</button></div>
          <dl className="setup-summary"><div><dt>Training target</dt><dd>{preferences.sessionsPerWeek} sessions / week · {preferences.sessionMinutes} min</dd></div><div><dt>Availability</dt><dd>{preferences.flexibility === 'flexible' ? 'Flexible' : 'Mostly consistent'}</dd></div><div><dt>Preferred days</dt><dd>{dayNames(preferences.preferredDays, preferences.weekStartsOn) || 'Open'}</dd></div><div><dt>Rest days</dt><dd>{dayNames(preferences.restDays, preferences.weekStartsOn) || 'No fixed rest days'}</dd></div></dl>
        </section>
        <section className="setup-panel" aria-labelledby="setup-review-heading">
          <div className="setup-review-heading"><h2 className="setup-panel-title" id="setup-review-heading"><Dumbbell aria-hidden="true" /> Your setup</h2><button type="button" className="setup-review-edit" onClick={() => setStep(3)}>Edit</button></div>
          <dl className="setup-summary"><div><dt>Scheduling</dt><dd>{SCHEDULING_LABELS[preferences.schedulingMode]}</dd></div><div><dt>Preferred split</dt><dd>{SPLIT_LABELS[preferences.preferredSplit]}</dd></div><div className="setup-full"><dt>Equipment</dt><dd>{preferences.equipment.join(' · ') || 'Choose your equipment'}</dd></div><div><dt>Priority muscles</dt><dd>{preferences.priorityMuscles.join(', ') || 'No specific priority'}</dd></div><div><dt>Recovery</dt><dd>{preferences.recoveryPreference === 'balanced' ? 'Balanced' : 'More recovery'}</dd></div><div><dt>Enjoy</dt><dd>{preferences.favoriteExercises.join(', ') || 'No preferences added'}</dd></div><div><dt>Avoid</dt><dd>{preferences.excludedExercises.join(', ') || 'No exclusions added'}</dd></div></dl>
        </section>
        <div className="setup-callout">These preferences are your starting point. You can edit them from your profile as your training changes.</div>
      </>}

      {saveError && <div className="notice notice-error" role="alert">{saveError}</div>}
      <div className="setup-footer">
        {step > 0 ? <button type="button" className="btn btn-secondary" onClick={() => { setSaveError(''); setStep((current) => current - 1) }} disabled={isSubmitting}><ArrowLeft aria-hidden="true" /> Back</button> : isEditing ? <Link className="btn btn-secondary" to="/profile"><ArrowLeft aria-hidden="true" /> Cancel</Link> : <span />}
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : step < 4 ? 'Continue' : isEditing ? 'Save preferences' : 'Let’s get started'}{step < 4 ? <ArrowRight aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}</button>
      </div>
      <p className="setup-save-hint" role="status"><Save aria-hidden="true" />{draftState === 'unavailable' ? 'Local draft storage is unavailable. Keep this page open until you save.' : draftState === 'saving' ? 'Saving your setup on this device…' : 'Your setup is saved on this device as you go.'}</p>
    </form>
  </main>
}
