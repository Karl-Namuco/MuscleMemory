import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Dumbbell,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../services/auth/AuthProvider'
import { useTraining } from '../../services/training/TrainingProvider'
import {
  EXERCISE_EQUIPMENT,
  MUSCLE_GROUPS,
  TRACKING_TYPES,
  type Exercise,
} from '../../types/training'
import { TRACKING_LABELS } from '../../domain/training/helpers'
import { useExerciseFavorites } from './useExerciseFavorites'
import './exercises.css'

export function ExerciseDataStatus() {
  const { error, refresh, loading, fromCache, hasPendingWrites } = useTraining()
  if (error)
    return (
      <div className="notice exercise-notice" role="alert">
        <span>{error}</span>
        <button className="btn btn-secondary" onClick={refresh}>
          Try again
        </button>
      </div>
    )
  if (loading)
    return (
      <p className="exercise-data-status" role="status">
        Loading your exercise library…
      </p>
    )
  if (hasPendingWrites || fromCache)
    return (
      <p className="exercise-data-status" role="status">
        {hasPendingWrites
          ? 'Changes are saved on this device and waiting for cloud confirmation.'
          : 'Showing exercises available on this device. Reconnect to check for changes.'}
      </p>
    )
  return null
}

export function exerciseMatchesQuery(exercise: Exercise, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const searchable = [exercise.name, ...exercise.aliases].join(' ').toLocaleLowerCase()
  return words.every((word) => searchable.includes(word))
}

export default function ExerciseLibraryPage() {
  const { exercises, loading } = useTraining()
  const { account } = useAuth()
  const { toggleFavorite, busy: favoriteBusy, error: favoriteError } = useExerciseFavorites()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [muscle, setMuscle] = useState('')
  const [muscleRole, setMuscleRole] = useState('any')
  const [equipment, setEquipment] = useState('')
  const [tracking, setTracking] = useState('')
  const [category, setCategory] = useState('')
  const [source, setSource] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 180)
    return () => clearTimeout(timer)
  }, [search])
  const favorites = useMemo(
    () =>
      new Set(account?.preferences.favoriteExercises.map((name) => name.toLocaleLowerCase()) || []),
    [account?.preferences.favoriteExercises],
  )
  const filtered = useMemo(
    () =>
      exercises
        .filter((exercise) => {
          const muscles =
            muscleRole === 'primary'
              ? exercise.primaryMuscles
              : muscleRole === 'secondary'
                ? exercise.secondaryMuscles
                : [...exercise.primaryMuscles, ...exercise.secondaryMuscles]
          return (
            (includeArchived || !exercise.archived) &&
            exerciseMatchesQuery(exercise, query) &&
            (!muscle || muscles.some((item) => item === muscle)) &&
            (!equipment || exercise.equipment === equipment) &&
            (!tracking || exercise.trackingType === tracking) &&
            (!category || exercise.category === category) &&
            (!source || exercise.source === source) &&
            (!favoritesOnly || favorites.has(exercise.name.toLocaleLowerCase()))
          )
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [
      exercises,
      includeArchived,
      query,
      muscle,
      muscleRole,
      equipment,
      tracking,
      category,
      source,
      favoritesOnly,
      favorites,
    ],
  )
  const filterCount = [
    muscle,
    equipment,
    tracking,
    category,
    source,
    favoritesOnly,
    includeArchived,
  ].filter(Boolean).length
  const clearFilters = () => {
    setSearch('')
    setQuery('')
    setMuscle('')
    setMuscleRole('any')
    setEquipment('')
    setTracking('')
    setCategory('')
    setSource('')
    setIncludeArchived(false)
    setFavoritesOnly(false)
  }

  return (
    <div className="exercise-page">
      <div className="page-title-row exercise-title-row">
        <div>
          <p className="eyebrow">Build your movement library</p>
          <h1 className="page-heading">
            Exercises<span className="lime-period">.</span>
          </h1>
          <p className="page-description">Find the right movement. Make it part of your plan.</p>
        </div>
        <Link to="/exercises/new" className="btn btn-primary">
          <Plus size={18} aria-hidden="true" />
          Create exercise
        </Link>
      </div>
      <ExerciseDataStatus />
      {favoriteError && (
        <p className="notice" role="alert">
          {favoriteError}
        </p>
      )}
      <div className="exercise-library-layout">
        <aside className="card exercise-filters" aria-label="Exercise filters">
          <div className="section-label-row">
            <h2 className="section-heading">
              <SlidersHorizontal size={17} aria-hidden="true" /> Refine your library
            </h2>
            {filterCount > 0 && (
              <button className="exercise-reset" onClick={clearFilters}>
                Reset
              </button>
            )}
          </div>
          <div className="field">
            <label htmlFor="exercise-muscle">Muscle group</label>
            <select
              id="exercise-muscle"
              className="select"
              value={muscle}
              onChange={(event) => setMuscle(event.target.value)}
            >
              <option value="">All muscles</option>
              {MUSCLE_GROUPS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          {muscle && (
            <div className="field">
              <label htmlFor="exercise-muscle-role">Muscle involvement</label>
              <select
                id="exercise-muscle-role"
                className="select"
                value={muscleRole}
                onChange={(event) => setMuscleRole(event.target.value)}
              >
                <option value="any">Primary or secondary</option>
                <option value="primary">Primary muscle</option>
                <option value="secondary">Secondary muscle</option>
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="exercise-equipment">Equipment</label>
            <select
              id="exercise-equipment"
              className="select"
              value={equipment}
              onChange={(event) => setEquipment(event.target.value)}
            >
              <option value="">All equipment</option>
              {EXERCISE_EQUIPMENT.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="exercise-category">Category</label>
            <select
              id="exercise-category"
              className="select"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">All categories</option>
              {['compound', 'isolation', 'cardio', 'mobility'].map((item) => (
                <option key={item} value={item}>
                  {item[0].toUpperCase() + item.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="exercise-tracking">Tracking</label>
            <select
              id="exercise-tracking"
              className="select"
              value={tracking}
              onChange={(event) => setTracking(event.target.value)}
            >
              <option value="">All tracking types</option>
              {TRACKING_TYPES.map((item) => (
                <option key={item} value={item}>
                  {TRACKING_LABELS[item]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="exercise-source">Library</label>
            <select
              id="exercise-source"
              className="select"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="">All exercises</option>
              <option value="builtin">Included exercises</option>
              <option value="custom">My custom exercises</option>
            </select>
          </div>
          <label className="exercise-checkbox">
            <input
              type="checkbox"
              checked={favoritesOnly}
              onChange={(event) => setFavoritesOnly(event.target.checked)}
            />
            Favorites from preferences
          </label>
          <label className="exercise-checkbox">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            Include archived exercises
          </label>
          <p className="exercise-filter-note">
            Save up to 10 favorites with the star on each exercise.
          </p>
        </aside>
        <section className="exercise-results" aria-label="Exercise results">
          <div className="exercise-search">
            <Search size={20} aria-hidden="true" />
            <label className="exercise-sr-only" htmlFor="exercise-search">
              Search exercises
            </label>
            <input
              id="exercise-search"
              value={search}
              placeholder="Search movements or alternate names…"
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                className="icon-button"
                onClick={() => {
                  setSearch('')
                  setQuery('')
                }}
                aria-label="Clear search"
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="exercise-result-heading">
            <p aria-live="polite">
              {filtered.length} {filtered.length === 1 ? 'exercise' : 'exercises'}
              {query.trim() ? ` matching “${query.trim()}”` : ' in your library'}
            </p>
            <span>
              <BookOpen size={15} aria-hidden="true" />
              Made for your training
            </span>
          </div>
          {!filtered.length ? (
            <div className="card exercise-empty">
              <Search size={32} aria-hidden="true" />
              <h2>{loading ? 'Loading your exercises' : 'No matching movements'}</h2>
              <p>
                {loading
                  ? 'Your custom exercises will appear here shortly.'
                  : 'Try a different search or loosen your filters. You can also create your own exercise.'}
              </p>
              <div className="exercise-actions">
                <button className="btn btn-secondary" onClick={clearFilters}>
                  Clear filters
                </button>
                <Link className="btn btn-primary" to="/exercises/new">
                  Create exercise
                </Link>
              </div>
            </div>
          ) : (
            <div className="exercise-card-grid">
              {filtered.map((exercise) => (
                <article className="exercise-card" key={exercise.id}>
                  <div className="exercise-card-top">
                    <div className="exercise-card-symbol">
                      <Dumbbell size={23} aria-hidden="true" />
                    </div>
                    <div className="exercise-card-badges">
                      {exercise.source === 'custom' && <span>Custom</span>}
                      {exercise.archived && <span>Archived</span>}
                      <span>{exercise.equipment}</span>
                    </div>
                    <button
                      className={`icon-button exercise-favorite ${favorites.has(exercise.name.toLocaleLowerCase()) ? 'is-favorite' : ''}`}
                      disabled={favoriteBusy}
                      aria-label={`${favorites.has(exercise.name.toLocaleLowerCase()) ? 'Remove' : 'Add'} ${exercise.name} ${favorites.has(exercise.name.toLocaleLowerCase()) ? 'from' : 'to'} favorites`}
                      aria-pressed={favorites.has(exercise.name.toLocaleLowerCase())}
                      onClick={() => void toggleFavorite(exercise.name)}
                    >
                      <Star size={18} aria-hidden="true" />
                    </button>
                  </div>
                  <h2>
                    <Link to={`/exercises/${exercise.id}`}>{exercise.name}</Link>
                  </h2>
                  <p className="exercise-card-description">
                    {exercise.description ||
                      `${exercise.movementPattern} with ${exercise.equipment.toLowerCase()}.`}
                  </p>
                  <p className="exercise-card-muscles">{exercise.primaryMuscles.join(' · ')}</p>
                  <div className="exercise-card-footer">
                    <span>{TRACKING_LABELS[exercise.trackingType]}</span>
                    <Link
                      to={`/exercises/${exercise.id}`}
                      aria-label={`View ${exercise.name}`}
                      className="icon-button"
                    >
                      <ArrowRight size={19} aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
