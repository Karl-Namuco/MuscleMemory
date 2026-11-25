import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Archive, ArrowRight, Clock3, Copy, Dumbbell, Plus, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { estimatedRoutineMinutes } from '../../domain/training/helpers'
import { useTraining } from '../../services/training/TrainingProvider'
import type { Routine } from '../../types/training'
import './routines.css'

export default function RoutineListPage() {
  const training = useTraining()
  const [query, setQuery] = useState('')
  const [archived, setArchived] = useState(false)
  const [confirm, setConfirm] = useState<Routine | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const routines = training.routines.filter(
    (routine) =>
      routine.archived === archived &&
      `${routine.name} ${routine.targetMuscles.join(' ')}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  )

  async function archive(routine: Routine) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await training.archiveRoutine(routine.id, !routine.archived, routine.revision)
      setMessage(
        `${routine.name} ${routine.archived ? 'restored' : 'archived'} on this device. Cloud confirmation appears in the sync indicator.`,
      )
      setConfirm(null)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not update this routine. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="routines-page">
      <Link to="/plan" className="text-link">
        ← Training plan
      </Link>
      <div className="page-title-row routine-page-heading">
        <div>
          <p className="eyebrow">Your training toolkit</p>
          <h1 className="page-heading">Routines</h1>
          <p className="page-description">Build sessions that fit the way you train.</p>
        </div>
        <Link to="/plan/routines/new" className="btn btn-primary">
          <Plus size={18} aria-hidden="true" /> New routine
        </Link>
      </div>
      <div className="routine-toolbar">
        <label className="routine-search">
          <Search size={18} aria-hidden="true" />
          <span className="routine-visually-hidden">Search routines</span>
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search routines or muscles"
          />
        </label>
        <div className="routine-filter" aria-label="Routine status">
          <button
            className="choice-chip"
            aria-pressed={!archived}
            onClick={() => setArchived(false)}
          >
            Current
          </button>
          <button className="choice-chip" aria-pressed={archived} onClick={() => setArchived(true)}>
            Archived
          </button>
        </div>
      </div>
      {error && (
        <div role="alert" className="notice">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="notice">
          {message}
        </div>
      )}
      {training.error && (
        <div role="alert" className="notice">
          {training.error}
        </div>
      )}
      {training.loading ? (
        <p role="status">Loading routines…</p>
      ) : routines.length === 0 ? (
        <section className="card routine-empty">
          <Dumbbell size={32} aria-hidden="true" />
          <h2>
            {query
              ? 'No matching routines'
              : archived
                ? 'No archived routines'
                : 'Your next session starts here.'}
          </h2>
          <p>
            {query
              ? 'Try another name or muscle group.'
              : archived
                ? 'Archived routines stay available here for restoring.'
                : 'Choose your exercises, set your targets, and save a routine you can use in a split.'}
          </p>
          {!archived && !query && (
            <Link to="/plan/routines/new" className="btn btn-primary">
              Create your first routine <ArrowRight size={16} aria-hidden="true" />
            </Link>
          )}
        </section>
      ) : (
        <div className="routine-card-grid">
          {routines.map((routine) => (
            <article className="card routine-card" key={routine.id}>
              <div>
                <span className="routine-card-kicker">
                  {routine.exercises.length} exercises ·{' '}
                  {routine.exercises.reduce((sum, entry) => sum + entry.sets.length, 0)} sets
                </span>
                <h2>
                  <Link to={`/plan/routines/${routine.id}`}>{routine.name}</Link>
                </h2>
                <p>{routine.description || 'A session built around your training.'}</p>
                <div className="routine-tags">
                  {routine.targetMuscles.map((muscle) => (
                    <span key={muscle}>{muscle}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="routine-estimate">
                  <Clock3 size={15} aria-hidden="true" /> Estimated{' '}
                  {estimatedRoutineMinutes(routine.exercises)} min
                </p>
                <div className="routine-card-actions">
                  {!archived && (
                    <>
                      <Link to={`/plan/routines/${routine.id}`} className="btn btn-secondary">
                        Edit
                      </Link>
                      <Link
                        to={`/plan/routines/new?duplicate=${encodeURIComponent(routine.id)}`}
                        className="icon-button"
                        aria-label={`Duplicate ${routine.name}`}
                      >
                        <Copy size={18} aria-hidden="true" />
                      </Link>
                    </>
                  )}
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label={`${archived ? 'Restore' : 'Archive'} ${routine.name}`}
                    onClick={() => (archived ? void archive(routine) : setConfirm(routine))}
                  >
                    <Archive size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <Dialog.Root
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>Archive {confirm?.name}?</Dialog.Title>
            <Dialog.Description>
              Its configuration will leave your current routines. Training history stays intact, and
              you can restore it later. A routine used in your active split must be removed from
              that split first.
            </Dialog.Description>
            <div className="routine-dialog-actions">
              <Dialog.Close asChild>
                <button className="btn btn-secondary" disabled={busy}>
                  Keep routine
                </button>
              </Dialog.Close>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => confirm && void archive(confirm)}
              >
                {busy ? 'Archiving…' : 'Archive routine'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
