import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Download, X } from 'lucide-react'
import { useWorkouts } from '../../services/workouts/WorkoutProvider'
export default function PwaFeedback() {
  const workouts = useWorkouts()
  const [dismissed, setDismissed] = useState(false)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  if (!needRefresh || dismissed) return null
  return (
    <aside className="update-banner" aria-label="Application update">
      <Download size={20} aria-hidden="true" />
      <div>
        <strong>A fresh version is ready.</strong>
        <p>
          {workouts.activeSession || workouts.hasPendingWrites
            ? 'Finish or end your workout and let its changes sync before updating.'
            : 'Your saved data will be here after the application updates.'}
        </p>
      </div>
      <button
        className="btn btn-secondary"
        disabled={
          Boolean(workouts.activeSession) || workouts.hasPendingWrites || workouts.localSaving
        }
        onClick={() => void updateServiceWorker(true)}
      >
        Update
      </button>
      <button
        className="icon-button"
        aria-label="Postpone update"
        onClick={() => setDismissed(true)}
      >
        <X size={18} />
      </button>
    </aside>
  )
}
