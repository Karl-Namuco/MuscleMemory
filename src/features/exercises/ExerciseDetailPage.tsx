import { useEffect, useState } from 'react'
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Copy,
  Dumbbell,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  Target,
  Timer,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { useTraining } from '../../services/training/TrainingProvider'
import { useAuth } from '../../services/auth/AuthProvider'
import { TRACKING_LABELS } from '../../domain/training/helpers'
import { ExerciseDataStatus } from './ExerciseLibraryPage'
import { acknowledgeExerciseDrafts } from './draft'
import { useExerciseFavorites } from './useExerciseFavorites'
import './exercises.css'

export default function ExerciseDetailPage() {
  const { exerciseId } = useParams()
  const { exercises, archiveCustomExercise, loading, hasPendingWrites, fromCache } = useTraining()
  const { user } = useAuth()
  const {
    isFavorite,
    toggleFavorite,
    busy: favoriteBusy,
    error: favoriteError,
  } = useExerciseFavorites()
  const exercise = exercises.find((item) => item.id === exerciseId)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (user && exercise?.source === 'custom' && !hasPendingWrites && !fromCache && !loading)
      void acknowledgeExerciseDrafts(user.uid, exercise).catch(() => undefined)
  }, [user, exercise, hasPendingWrites, fromCache, loading])
  async function archive() {
    if (!exercise || busy) return
    setBusy(true)
    setError('')
    try {
      await archiveCustomExercise(exercise.id, !exercise.archived, exercise.revision)
      setConfirmArchive(false)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'This exercise could not be updated. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }
  if (!exercise)
    return (
      <div className="exercise-page">
        <Link to="/exercises" className="exercise-back">
          <ArrowLeft size={17} aria-hidden="true" />
          Exercise library
        </Link>
        <ExerciseDataStatus />
        {!loading && (
          <div className="card exercise-empty">
            <Dumbbell size={32} aria-hidden="true" />
            <h1>Exercise unavailable</h1>
            <p>
              This exercise is not in the library available to this account. Check your connection
              or return to your exercises.
            </p>
            <Link to="/exercises" className="btn btn-primary">
              Browse exercises
            </Link>
          </div>
        )}
      </div>
    )
  const alternatives = exercise.alternativeIds
    .map((id) => exercises.find((item) => item.id === id))
    .filter((item) => item && !item.archived)
  const favorite = isFavorite(exercise.name)
  return (
    <div className="exercise-page">
      <Link to="/exercises" className="exercise-back">
        <ArrowLeft size={17} aria-hidden="true" />
        Exercise library
      </Link>
      <div className="page-title-row exercise-title-row">
        <div>
          <div className="exercise-detail-label">
            <p className="eyebrow">
              {exercise.source === 'custom' ? 'Your custom exercise' : 'Included exercise'}
            </p>
            {exercise.archived && <span className="exercise-tag">Archived</span>}
          </div>
          <h1 className="page-heading">{exercise.name}</h1>
          <p className="page-description">{exercise.description}</p>
        </div>
        <button
          className={`btn btn-secondary ${favorite ? 'exercise-favorite-active' : ''}`}
          disabled={favoriteBusy}
          aria-pressed={favorite}
          onClick={() => void toggleFavorite(exercise.name)}
        >
          <Star size={17} aria-hidden="true" />
          {favorite ? 'Favorited' : 'Add favorite'}
        </button>
      </div>
      <ExerciseDataStatus />
      {favoriteError && (
        <div className="notice" role="alert">
          {favoriteError}
        </div>
      )}
      {error && !confirmArchive && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {exercise.archived && (
        <p className="notice">
          This exercise is archived and hidden from the default library. Existing routines keep
          their exercise snapshots. Restore it to add it to new routines.
        </p>
      )}
      <div className="exercise-detail-actions">
        {!exercise.archived && (
          <Link className="btn btn-primary" to={`/plan/routines/new?exercise=${exercise.id}`}>
            <Plus size={17} aria-hidden="true" />
            Build a routine with this
          </Link>
        )}
        {exercise.source === 'custom' ? (
          <>
            <Link className="btn btn-secondary" to={`/exercises/${exercise.id}/edit`}>
              <Pencil size={16} aria-hidden="true" />
              Edit exercise
            </Link>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setError('')
                setConfirmArchive(true)
              }}
            >
              {exercise.archived ? (
                <RotateCcw size={17} aria-hidden="true" />
              ) : (
                <Archive size={17} aria-hidden="true" />
              )}
              {exercise.archived ? 'Restore exercise' : 'Archive exercise'}
            </button>
          </>
        ) : (
          <Link className="btn btn-secondary" to={`/exercises/new?copy=${exercise.id}`}>
            <Copy size={16} aria-hidden="true" />
            Customize a copy
          </Link>
        )}
      </div>
      <div className="exercise-detail-facts">
        <div>
          <Dumbbell size={19} aria-hidden="true" />
          <span>Equipment</span>
          <strong>{exercise.equipment}</strong>
        </div>
        <div>
          <Target size={19} aria-hidden="true" />
          <span>Movement</span>
          <strong>{exercise.movementPattern}</strong>
        </div>
        <div>
          <Timer size={19} aria-hidden="true" />
          <span>Tracking</span>
          <strong>{TRACKING_LABELS[exercise.trackingType]}</strong>
        </div>
      </div>
      <div className="exercise-detail-columns">
        <div className="stack">
          <section className="card exercise-instructions">
            <p className="eyebrow">Movement guide</p>
            <h2>How to perform it</h2>
            {exercise.instructions.length ? (
              <ol>
                {exercise.instructions.map((instruction, index) => (
                  <li key={`${index}-${instruction}`}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <p>{instruction}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">
                No instructions added yet. You can add your own cues by editing this custom
                exercise.
              </p>
            )}
          </section>
          {exercise.notes && (
            <section className="card">
              <h2 className="section-heading">Training notes</h2>
              <p className="exercise-notes">{exercise.notes}</p>
            </section>
          )}
          {alternatives.length > 0 && (
            <section className="card">
              <p className="eyebrow">Keep your options open</p>
              <h2 className="section-heading">Alternative movements</h2>
              <div className="exercise-alternatives">
                {alternatives.map(
                  (alternative) =>
                    alternative && (
                      <Link key={alternative.id} to={`/exercises/${alternative.id}`}>
                        <div>
                          <strong>{alternative.name}</strong>
                          <span>
                            {alternative.equipment} · {TRACKING_LABELS[alternative.trackingType]}
                          </span>
                        </div>
                        <ArrowRight size={18} aria-hidden="true" />
                      </Link>
                    ),
                )}
              </div>
              <p className="exercise-filter-note">
                Check equipment and tracking before using an alternative.
              </p>
            </section>
          )}
        </div>
        <aside className="stack">
          <section className="card exercise-muscle-card">
            <p className="eyebrow">Muscle involvement</p>
            <h2 className="section-heading">What it trains</h2>
            <p className="exercise-small-label">Primary</p>
            <div className="exercise-tags">
              {exercise.primaryMuscles.map((muscle) => (
                <span className="exercise-tag primary" key={muscle}>
                  {muscle}
                </span>
              ))}
            </div>
            <p className="exercise-small-label">Secondary</p>
            <div className="exercise-tags">
              {exercise.secondaryMuscles.length ? (
                exercise.secondaryMuscles.map((muscle) => (
                  <span className="exercise-tag" key={muscle}>
                    {muscle}
                  </span>
                ))
              ) : (
                <p className="muted">None specified</p>
              )}
            </div>
          </section>
          <section className="card">
            <h2 className="section-heading">Exercise details</h2>
            <dl className="exercise-definition-list">
              <div>
                <dt>Category</dt>
                <dd>{exercise.category}</dd>
              </div>
              <div>
                <dt>Difficulty</dt>
                <dd>{exercise.difficulty}</dd>
              </div>
              <div>
                <dt>Library</dt>
                <dd>{exercise.source === 'builtin' ? 'Included' : 'Custom'}</dd>
              </div>
            </dl>
            {exercise.aliases.length > 0 && (
              <>
                <p className="exercise-small-label">Also known as</p>
                <p className="exercise-notes">{exercise.aliases.join(', ')}</p>
              </>
            )}
          </section>
        </aside>
      </div>
      <Dialog.Root
        open={confirmArchive}
        onOpenChange={(open) => {
          if (!busy) setConfirmArchive(open)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>
              {exercise.archived ? 'Restore this exercise?' : 'Archive this exercise?'}
            </Dialog.Title>
            <Dialog.Description>
              {exercise.archived
                ? `${exercise.name} will be available in the library and routine builder again.`
                : `${exercise.name} will be hidden from the default library. Existing routines and exercise history will be preserved.`}
            </Dialog.Description>
            {error && (
              <p className="notice" role="alert">
                {error}
              </p>
            )}
            <div className="exercise-actions">
              <Dialog.Close asChild>
                <button className="btn btn-secondary" disabled={busy}>
                  Cancel
                </button>
              </Dialog.Close>
              <button className="btn btn-primary" disabled={busy} onClick={() => void archive()}>
                {busy ? 'Saving…' : exercise.archived ? 'Restore exercise' : 'Archive exercise'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
