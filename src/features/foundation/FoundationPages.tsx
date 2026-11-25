import { Link } from 'react-router-dom'
import { Activity, Layers3, ShieldCheck, Smartphone, Target } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { useWorkouts } from '../../services/workouts/WorkoutProvider'
import { workoutTotals } from '../../domain/workout/helpers'
import '../plan/plan.css'

export function ProgressPage() {
  const workouts = useWorkouts()
  const ended = workouts.sessions.filter((session) => session.status !== 'active')
  const completed = ended.filter((session) => session.status === 'completed')
  const performedSets = ended.reduce(
    (sum, session) => sum + workoutTotals(session).completedSets,
    0,
  )
  return (
    <div className="page-enter">
      <PageTitle
        eyebrow="Every session adds up"
        title="Your story, in progress."
        description="Your saved training, one session at a time."
      />
      {workouts.loading ? (
        <p role="status">Loading your workout history…</p>
      ) : ended.length ? (
        <>
          <div className="preference-grid">
            <section className="card">
              <p className="eyebrow">Completed workouts</p>
              <h2>{completed.length}</h2>
              <p className="muted">Based on your saved sessions.</p>
            </section>
            <section className="card">
              <p className="eyebrow">Performed sets</p>
              <h2>{performedSets}</h2>
              <p className="muted">Includes the work saved in sessions ended early.</p>
            </section>
            <section className="card">
              <p className="eyebrow">Your latest session</p>
              <h2>{ended[0].routineName}</h2>
              <Link className="text-link" to={`/history/${ended[0].id}`}>
                View the saved workout
              </Link>
            </section>
          </div>
          <Link className="btn btn-primary" to="/history">
            View workout history
          </Link>
        </>
      ) : (
        <section className="empty-training card">
          <div className="empty-icon">
            <Activity size={40} strokeWidth={1.2} />
          </div>
          <h2>Your first chapter is ahead.</h2>
          <p>
            Start a routine, record the sets you perform, and save your workout. Your history will
            appear here.
          </p>
          <Link className="btn btn-secondary" to="/train">
            <Target size={17} /> Choose a workout
          </Link>
        </section>
      )}
      <div className="honest-note">
        <ShieldCheck size={18} />
        <p>
          Workout history preserves the sets you performed. Detailed trends, personal records, and
          recovery insights are coming later.
        </p>
      </div>
    </div>
  )
}
export function SettingsPage() {
  return (
    <div className="page-enter">
      <PageTitle
        eyebrow="Make yourself at home"
        title="A little peace of mind."
        description="Your application, your data, your device."
      />
      <div className="settings-grid">
        <section className="card">
          <span className="card-icon">
            <Smartphone size={24} />
          </span>
          <h2 className="section-heading">On the screen that suits you.</h2>
          <p className="muted">
            Muscle Memory works in a browser on desktop, tablet, and mobile. You can also install
            the production application where your browser supports it.
          </p>
          <ol className="installation-steps">
            <li>
              <strong>Desktop:</strong> use your browser’s Install application action, when offered.
            </li>
            <li>
              <strong>Android:</strong> open the browser menu and choose Install app or Add to Home
              screen.
            </li>
            <li>
              <strong>iPhone or iPad:</strong> in Safari, tap Share, then Add to Home Screen.
            </li>
          </ol>
          <p className="subtle-caption">
            Installation and offline application assets require a production build served over
            HTTPS. Local development uses the browser.
          </p>
        </section>
        <section className="card">
          <h2 className="section-heading">Private by design.</h2>
          <p className="muted">
            Your exercises, routines, splits, and preferences belong to your account. Database rules
            enforce account isolation.
          </p>
          <p className="muted">
            Browser storage can be cleared by your device. A local save is only confirmed in the
            cloud after synchronization.
          </p>
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <button className="btn btn-secondary">About this release</button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content className="dialog-content">
                <Dialog.Title>Your training setup, ready.</Dialog.Title>
                <Dialog.Description>
                  Build routines and splits, log your actual sets, resume an interrupted workout,
                  and review saved sessions. Adaptive scheduling, detailed analytics, complete data
                  export, and account deletion are coming later.
                </Dialog.Description>
                <Dialog.Close asChild>
                  <button className="btn btn-primary">Got it</button>
                </Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </section>
      </div>
      <Link to="/profile" className="text-link">
        Return to profile
      </Link>
    </div>
  )
}
export function NotFoundPage() {
  return (
    <div className="empty-training">
      <Layers3 size={36} />
      <h1 className="page-heading">A little off track.</h1>
      <p className="muted">This page could not be found.</p>
      <Link className="btn btn-primary" to="/today">
        Back to Today
      </Link>
    </div>
  )
}
function PageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="page-title-row">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="page-heading">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
    </div>
  )
}
