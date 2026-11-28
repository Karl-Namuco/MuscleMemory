import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CalendarDays } from 'lucide-react'
import { addDays, localDate } from '../../domain/scheduling/fixed'
import { useAuth } from '../../services/auth/AuthProvider'
import { useTraining } from '../../services/training/TrainingProvider'
import { useWorkouts } from '../../services/workouts/WorkoutProvider'
import type { FixedOccurrence } from '../../types/fixedScheduling'
import PlanNavigation from './PlanNavigation'
import './plan.css'
import './fixed-calendar.css'

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
type Action = { kind: 'move' | 'swap' | 'skip'; occurrence: FixedOccurrence } | { kind: 'replace' }

export default function FixedCalendarPage() {
  const training = useTraining()
  const workouts = useWorkouts()
  const { account } = useAuth()
  const navigate = useNavigate()
  const split = training.splits.find((item) => item.id === training.activeSplitId) ?? null
  const calendar = training.fixedSchedules?.find((item) => item.id === split?.id) ?? null
  const [now, setNow] = useState(Date.now)
  const timeZone = calendar?.timeZone ?? account?.preferences.timeZone ?? 'UTC'
  const today = localDate(now, timeZone)
  const [startDate, setStartDate] = useState(() =>
    localDate(Date.now(), account?.preferences.timeZone ?? 'UTC'),
  )
  const [preferredDays, setPreferredDays] = useState<number[]>(
    account?.preferences.preferredDays ?? [],
  )
  const [weekDate, setWeekDate] = useState(today)
  const [action, setAction] = useState<Action | null>(null)
  const [targetDate, setTargetDate] = useState('')
  const [otherId, setOtherId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const inFlight = useRef(false)
  const dialogRevision = useRef<number | undefined>(undefined)
  const dialogCalendarId = useRef<string | null>(null)
  const dialogSplitRevision = useRef<number | undefined>(undefined)
  const stale = Boolean(calendar && calendar.splitRevision !== split?.revision)
  const blocked =
    busy ||
    training.loading ||
    workouts.loading ||
    training.hasPendingWrites ||
    workouts.hasPendingWrites ||
    Boolean(training.error || workouts.error || workouts.activeSession) ||
    workouts.writable === false
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = window.setInterval(tick, 60000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  function open(next: Action) {
    dialogRevision.current = calendar?.revision
    dialogCalendarId.current = calendar?.id ?? null
    dialogSplitRevision.current = split?.revision
    setError('')
    setAction(next)
    if (next.kind !== 'replace') {
      setTargetDate(next.occurrence.scheduledDate)
      setOtherId('')
    }
  }
  async function run(operation: () => Promise<void>) {
    if (inFlight.current || blocked) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
      setAction(null)
      setNotice(
        'Calendar saved on this device. Wait for Changes synced before using another device.',
      )
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The calendar could not be saved.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  async function build(expectedRevision = calendar?.revision) {
    if (!split) return
    await run(() =>
      training.buildFixedSchedule({
        splitId: split.id,
        startDate,
        timeZone: account?.preferences.timeZone ?? 'UTC',
        preferredDays,
        expectedRevision,
      }),
    )
  }
  async function confirm() {
    if (!action) return
    if (
      !calendar ||
      calendar.id !== dialogCalendarId.current ||
      calendar.revision !== dialogRevision.current ||
      split?.revision !== dialogSplitRevision.current
    ) {
      setError('The calendar changed. Close this dialog and review its latest dates.')
      return
    }
    if (action.kind === 'replace') {
      await build(dialogRevision.current)
      return
    }
    const selected = action
    await run(() =>
      training.editFixedSchedule(
        calendar.id,
        calendar.revision,
        selected.kind === 'move'
          ? { kind: 'move', occurrenceId: selected.occurrence.id, date: targetDate }
          : selected.kind === 'swap'
            ? { kind: 'swap', occurrenceId: selected.occurrence.id, otherOccurrenceId: otherId }
            : { kind: 'skip', occurrenceId: selected.occurrence.id },
      ),
    )
  }
  async function start(occurrence: FixedOccurrence) {
    const routine = training.routines.find(
      (item) => item.id === occurrence.routineId && !item.archived,
    )
    if (!routine) {
      setError('This routine is unavailable. Review your split.')
      return
    }
    await run(async () => {
      const id = await workouts.startWorkout(routine, {
        scheduled: true,
        fixedOccurrenceId: occurrence.id,
      })
      navigate(`/train/${id}`)
    })
  }
  const weekStartsOn = account?.preferences.weekStartsOn ?? 1
  const weekStart = addDays(
    weekDate,
    -((new Date(`${weekDate}T00:00:00Z`).getUTCDay() - weekStartsOn + 7) % 7),
  )
  const dates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const overdue =
    calendar?.occurrences
      .filter((item) => item.status === 'planned' && !item.isRestDay && item.scheduledDate < today)
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)) ?? []
  const moveConflict =
    action?.kind === 'move'
      ? calendar?.occurrences.find(
          (item) =>
            item.id !== action.occurrence.id &&
            item.status !== 'skipped' &&
            item.scheduledDate === targetDate,
        )
      : undefined
  const invalidMove =
    action?.kind === 'move' &&
    (!targetDate ||
      targetDate < (calendar?.startDate ?? '') ||
      targetDate > (calendar?.endDate ?? '') ||
      targetDate === action.occurrence.scheduledDate ||
      Boolean(moveConflict))
  function row(occurrence: FixedOccurrence) {
    const routine = training.routines.find((item) => item.id === occurrence.routineId)
    return (
      <article
        className={`fixed-occurrence ${occurrence.status}`}
        key={occurrence.id}
        aria-label={`${occurrence.label} on ${occurrence.scheduledDate}`}
      >
        <div>
          <strong>{occurrence.label}</strong>
          <p>{occurrence.isRestDay ? 'Rest' : (routine?.name ?? 'Routine unavailable')}</p>
          <span className="subtle-caption">
            {occurrence.status === 'planned' &&
            !occurrence.isRestDay &&
            occurrence.scheduledDate < today
              ? 'Overdue'
              : occurrence.status}{' '}
            · {occurrence.scheduledDate}
          </span>
        </div>
        {occurrence.status === 'planned' && (
          <div className="fixed-actions">
            {!occurrence.isRestDay && occurrence.scheduledDate <= today && (
              <button
                className="btn btn-primary"
                disabled={blocked || stale}
                onClick={() => void start(occurrence)}
              >
                Start workout
              </button>
            )}
            <button
              className="btn btn-secondary"
              disabled={blocked || stale}
              onClick={() => open({ kind: 'move', occurrence })}
            >
              Move
            </button>
            <button
              className="btn btn-secondary"
              disabled={blocked || stale}
              onClick={() => open({ kind: 'swap', occurrence })}
            >
              Swap
            </button>
            <button
              className="btn btn-ghost"
              disabled={blocked || stale}
              onClick={() => open({ kind: 'skip', occurrence })}
            >
              Skip
            </button>
          </div>
        )}
        {occurrence.completionSessionId && (
          <Link className="text-link" to={`/history/${occurrence.completionSessionId}`}>
            View completed workout
          </Link>
        )}
      </article>
    )
  }
  return (
    <div className="training-page page-enter">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">Make room for your training</p>
          <h1 className="page-heading">Your training calendar.</h1>
          <p className="page-description">Dated workouts, clear rest days, and room to adjust.</p>
        </div>
        <CalendarDays size={30} />
      </div>
      <PlanNavigation />
      {!action && (training.error || workouts.error) && (
        <p role="alert" className="workout-error">
          {training.error || workouts.error}
        </p>
      )}
      {training.loading || workouts.loading ? (
        <p role="status">Loading your calendar…</p>
      ) : split?.mode !== 'fixed' ? (
        <section className="card">
          <h2>Choose a Fixed split first.</h2>
          <p>Your calendar follows the active split's ordered training and rest slots.</p>
          <Link className="btn btn-primary" to="/plan/splits">
            Manage splits
          </Link>
        </section>
      ) : (
        <>
          <section className="card fixed-builder">
            <h2>{calendar ? 'Start a new calendar' : 'Plan the next four weeks'}</h2>
            <p>
              Training uses your chosen weekdays. Rest slots occupy the following calendar day.
              Missed workouts remain visible until you resolve them.
            </p>
            {stale && (
              <p className="notice">
                Your split changed. Create a new calendar for its current revision.
              </p>
            )}
            <div className="field">
              <label htmlFor="fixed-start">Calendar start date</label>
              <input
                className="input"
                id="fixed-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                disabled={blocked}
              />
            </div>
            <fieldset className="fixed-weekdays">
              <legend>Training weekdays</legend>
              {weekdays.map((name, index) => (
                <label key={name}>
                  <input
                    type="checkbox"
                    aria-label={name}
                    checked={preferredDays.includes(index)}
                    disabled={blocked}
                    onChange={() =>
                      setPreferredDays((current) =>
                        current.includes(index)
                          ? current.filter((day) => day !== index)
                          : [...current, index],
                      )
                    }
                  />
                  {name.slice(0, 3)}
                </label>
              ))}
            </fieldset>
            <p className="subtle-caption">
              No weekdays selected allows training on any day. New calendars use{' '}
              {account?.preferences.timeZone ?? 'UTC'}; an existing calendar keeps its original
              timezone.
            </p>
            <button
              className="btn btn-primary"
              disabled={blocked || !startDate}
              onClick={() => (calendar ? open({ kind: 'replace' }) : void build())}
            >
              {busy ? 'Saving…' : calendar ? 'Replace calendar' : 'Create calendar'}
            </button>
          </section>
          {workouts.activeSession && (
            <p className="notice">
              Finish or end your current workout before changing calendar dates.{' '}
              <Link className="text-link" to={`/train/${workouts.activeSession.id}`}>
                Resume workout
              </Link>
            </p>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {(training.hasPendingWrites || workouts.hasPendingWrites) && (
            <p role="status">
              Your latest changes are saved locally and waiting for cloud confirmation. Calendar
              actions will be available after they sync.
            </p>
          )}
          {workouts.writable === false && (
            <p role="status">
              Another tab is editing your workouts. Close it to change this calendar.
            </p>
          )}
          {calendar && (
            <>
              <div className="fixed-week-navigation">
                <button
                  className="btn btn-secondary"
                  aria-label="Previous week"
                  onClick={() => setWeekDate(addDays(weekDate, -7))}
                >
                  <ArrowLeft size={18} />
                </button>
                <h2>Week of {weekStart}</h2>
                <button
                  className="btn btn-secondary"
                  aria-label="Next week"
                  onClick={() => setWeekDate(addDays(weekDate, 7))}
                >
                  <ArrowRight size={18} />
                </button>
                <button className="btn btn-ghost" onClick={() => setWeekDate(today)}>
                  This week
                </button>
              </div>
              <p className="subtle-caption">
                {calendar.startDate} – {calendar.endDate} · {calendar.timeZone}. Earlier missed
                workouts are listed below.
              </p>
              <div className="fixed-week-grid">
                {dates.map((date) => (
                  <section
                    className={`card fixed-day ${date === today ? 'today' : ''}`}
                    key={date}
                    aria-label={`${date === today ? 'Today' : 'Calendar day'}, ${date}`}
                  >
                    <h3>
                      <span>
                        {weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()].slice(0, 3)}
                        {date === today ? ' · Today' : ''}
                      </span>
                      <time dateTime={date} aria-current={date === today ? 'date' : undefined}>
                        {date}
                      </time>
                    </h3>
                    {calendar.occurrences.filter((item) => item.scheduledDate === date).map(row)}
                    {!calendar.occurrences.some((item) => item.scheduledDate === date) && (
                      <p className="subtle-caption">No workout scheduled</p>
                    )}
                  </section>
                ))}
              </div>
              {overdue.length > 0 && (
                <section className="card fixed-overdue" aria-label="Missed workouts">
                  <h2>Missed workouts</h2>
                  <p>
                    These dates passed. Choose what happens next; your calendar does not
                    automatically add catch-up work.
                  </p>
                  {overdue.map(row)}
                </section>
              )}
            </>
          )}
        </>
      )}
      {error && !action && (
        <p role="alert" className="workout-error">
          {error}
        </p>
      )}
      <Dialog.Root
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="dialog-content"
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault()
            }}
            onPointerDownOutside={(event) => {
              if (busy) event.preventDefault()
            }}
          >
            <Dialog.Title>
              {action?.kind === 'replace'
                ? 'Replace this calendar?'
                : action?.kind === 'move'
                  ? 'Move this occurrence?'
                  : action?.kind === 'swap'
                    ? 'Swap two dates?'
                    : 'Skip this occurrence?'}
            </Dialog.Title>
            <Dialog.Description>
              {action?.kind === 'replace'
                ? 'This replaces the current calendar, including unresolved dates. Saved workout history remains available. The new calendar starts at the first split slot.'
                : action?.kind === 'skip'
                  ? 'This marks the occurrence skipped. It will stay visible in this calendar; it does not create a completed workout.'
                  : 'Only planned occurrences can change. Completed workout history stays on its original occurrence.'}
            </Dialog.Description>
            {(training.hasPendingWrites || workouts.hasPendingWrites) && (
              <p role="status">Wait for your latest changes to sync before saving this change.</p>
            )}
            {workouts.writable === false && (
              <p role="status">
                Another tab is editing your workouts. Close it to save this change.
              </p>
            )}
            {workouts.activeSession && (
              <p role="status">Finish or end your current workout before saving this change.</p>
            )}
            {(training.error || workouts.error) && (
              <p role="alert" className="workout-error">
                {training.error || workouts.error}
              </p>
            )}
            {action?.kind === 'move' && (
              <div className="field">
                <label htmlFor="fixed-target">New date</label>
                <input
                  className="input"
                  id="fixed-target"
                  type="date"
                  min={calendar?.startDate}
                  max={calendar?.endDate}
                  value={targetDate}
                  onChange={(event) => {
                    setTargetDate(event.target.value)
                    setError('')
                  }}
                  disabled={busy}
                />
              </div>
            )}
            {action?.kind === 'move' && moveConflict && (
              <div className="fixed-move-conflict" role="status">
                <p>
                  {moveConflict.label} is already on this date.
                  {moveConflict.status === 'planned'
                    ? ' Choose an explicit swap to exchange their dates.'
                    : ' Choose another date; completed workouts keep their original dates.'}
                </p>
                {moveConflict.status === 'planned' && (
                  <button
                    className="btn btn-secondary"
                    disabled={blocked}
                    onClick={() => {
                      setAction({ kind: 'swap', occurrence: action.occurrence })
                      setOtherId(moveConflict.id)
                    }}
                  >
                    Swap these dates instead
                  </button>
                )}
              </div>
            )}
            {action?.kind === 'swap' && (
              <div className="field">
                <label htmlFor="fixed-other">Swap with</label>
                <select
                  className="input"
                  id="fixed-other"
                  value={otherId}
                  onChange={(event) => setOtherId(event.target.value)}
                  disabled={busy}
                >
                  <option value="">Choose another planned occurrence</option>
                  {calendar?.occurrences
                    .filter((item) => item.status === 'planned' && item.id !== action.occurrence.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.scheduledDate} · {item.label}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {error && (
              <p role="alert" className="workout-error">
                {error}
              </p>
            )}
            <div className="fixed-dialog-actions">
              <Dialog.Close asChild>
                <button className="btn btn-secondary" disabled={busy}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                className="btn btn-primary"
                disabled={blocked || invalidMove || (action?.kind === 'swap' && !otherId)}
                onClick={() => void confirm()}
              >
                {busy
                  ? 'Saving…'
                  : action?.kind === 'replace'
                    ? 'Replace calendar'
                    : action?.kind === 'skip'
                      ? 'Confirm skip'
                      : 'Save change'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
