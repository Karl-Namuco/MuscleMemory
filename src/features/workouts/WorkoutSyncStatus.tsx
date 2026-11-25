import { CloudCheck, CloudOff, Download, RefreshCw } from 'lucide-react'
import { useWorkouts } from '../../services/workouts/WorkoutProvider'

export default function WorkoutSyncStatus({ saving = false }: { saving?: boolean }) {
  const workouts = useWorkouts()
  return (
    <div className={`workout-sync ${workouts.error ? 'workout-sync-warning' : ''}`}>
      {workouts.error ? (
        <CloudOff size={18} aria-hidden="true" />
      ) : (
        <CloudCheck size={18} aria-hidden="true" />
      )}
      <div role={workouts.error ? 'alert' : 'status'}>
        {workouts.error ||
          (saving
            ? 'Saving on this device…'
            : workouts.hasPendingWrites
              ? 'Saved on this device · waiting for cloud confirmation'
              : workouts.fromCache
                ? 'Showing saved device data · cloud confirmation unavailable'
                : 'Changes synced')}
      </div>
      {workouts.error && (
        <div className="workout-sync-actions">
          <button className="btn btn-ghost" onClick={workouts.retrySync}>
            <RefreshCw size={16} /> Retry sync
          </button>
          <button className="btn btn-ghost" onClick={workouts.downloadRecovery}>
            <Download size={16} /> Download recovery
          </button>
        </div>
      )}
    </div>
  )
}
