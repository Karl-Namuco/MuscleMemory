import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { LoaderCircle, Settings2 } from 'lucide-react'
import { AuthProvider, useAuth } from '../services/auth/AuthProvider'
import { firebaseConfigured } from '../services/firebase/client'
import AppShell from './layouts/AppShell'
import Brand from '../components/shared/Brand'
import AuthPage, { PendingApprovalPage } from '../features/auth/AuthPage'
import { TrainingProvider } from '../services/training/TrainingProvider'
import { WorkoutProvider } from '../services/workouts/WorkoutProvider'
import TrainPage from '../features/workouts/TrainPage'
import ActiveWorkoutPage from '../features/workouts/ActiveWorkoutPage'
import WorkoutHistoryPage from '../features/workouts/WorkoutHistoryPage'
const TodayPage = lazy(() => import('../features/dashboard/TodayPage'))
const OnboardingPage = lazy(() => import('../features/onboarding/OnboardingPage'))
const ProfilePage = lazy(() => import('../features/profile/ProfilePage'))
const PlanPage = lazy(() => import('../features/plan/PlanPage'))
const SplitsPage = lazy(() => import('../features/splits/SplitsPage'))
const RoutineListPage = lazy(() => import('../features/routines/RoutineListPage'))
const RoutineEditorPage = lazy(() => import('../features/routines/RoutineEditorPage'))
const ExerciseLibraryPage = lazy(() => import('../features/exercises/ExerciseLibraryPage'))
const ExerciseDetailPage = lazy(() => import('../features/exercises/ExerciseDetailPage'))
const CustomExercisePage = lazy(() => import('../features/exercises/CustomExercisePage'))
const ProgressPage = lazy(() =>
  import('../features/foundation/FoundationPages').then((m) => ({ default: m.ProgressPage })),
)
const SettingsPage = lazy(() =>
  import('../features/foundation/FoundationPages').then((m) => ({ default: m.SettingsPage })),
)
const NotFoundPage = lazy(() =>
  import('../features/foundation/FoundationPages').then((m) => ({ default: m.NotFoundPage })),
)
export function LoadingScreen() {
  return (
    <div className="loading-screen" role="status">
      <LoaderCircle size={24} className="loading-spinner" />
      <span>Finding your place…</span>
    </div>
  )
}
function RequireAccount() {
  const { status, account } = useAuth()
  if (status === 'loading') return <LoadingScreen />
  if (status === 'signed-out') return <Navigate to="/login" replace />
  if (status === 'pending-approval') return <PendingApprovalPage />
  if (status === 'error') return <AccountErrorScreen />
  if (!account) return <LoadingScreen />
  return <Outlet />
}
function RequireOnboarding() {
  const { account } = useAuth()
  return account?.profile.onboardingCompleted ? <Outlet /> : <Navigate to="/onboarding" replace />
}
function PublicRoute() {
  const { status, account } = useAuth()
  if (status === 'loading') return <LoadingScreen />
  if (status === 'pending-approval') return <PendingApprovalPage />
  if (status === 'error') return <AccountErrorScreen />
  if (status === 'ready')
    return <Navigate to={account?.profile.onboardingCompleted ? '/today' : '/onboarding'} replace />
  return <AuthPage />
}
function AccountErrorScreen() {
  const { error, refreshAccess, logout } = useAuth()
  return (
    <main className="standalone-state">
      <Brand />
      <h1>We couldn’t open your training space.</h1>
      <p role="alert">{error || 'Please check your connection and try again.'}</p>
      <button
        className="btn btn-primary"
        onClick={() => void refreshAccess().catch(() => undefined)}
      >
        Try again
      </button>
      <button className="btn btn-secondary" onClick={() => void logout().catch(() => undefined)}>
        Sign out
      </button>
    </main>
  )
}
function ConfigurationScreen() {
  return (
    <main className="standalone-state">
      <Brand />
      <Settings2 size={36} />
      <h1>A little setup before we begin.</h1>
      <p>
        Connect Firebase to open your private training space. Configure the public web app values
        listed in the environment example, or use the local Firebase emulators for development.
      </p>
      <p className="notice">
        No account data is being loaded or saved while configuration is missing.
      </p>
    </main>
  )
}
export default function App() {
  if (!firebaseConfigured)
    return (
      <BrowserRouter>
        <ConfigurationScreen />
      </BrowserRouter>
    )
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/login" element={<PublicRoute />} />
            <Route path="/register" element={<PublicRoute />} />
            <Route path="/forgot-password" element={<PublicRoute />} />
            <Route element={<RequireAccount />}>
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route element={<RequireOnboarding />}>
                <Route
                  element={
                    <TrainingProvider>
                      <WorkoutProvider>
                        <AppShell />
                      </WorkoutProvider>
                    </TrainingProvider>
                  }
                >
                  <Route index element={<Navigate to="/today" replace />} />
                  <Route path="/today" element={<TodayPage />} />
                  <Route path="/plan" element={<PlanPage />} />
                  <Route path="/plan/splits" element={<SplitsPage />} />
                  <Route path="/plan/routines" element={<RoutineListPage />} />
                  <Route path="/plan/routines/new" element={<RoutineEditorPage />} />
                  <Route path="/plan/routines/:routineId" element={<RoutineEditorPage />} />
                  <Route path="/exercises" element={<ExerciseLibraryPage />} />
                  <Route path="/exercises/new" element={<CustomExercisePage />} />
                  <Route path="/exercises/:exerciseId" element={<ExerciseDetailPage />} />
                  <Route path="/exercises/:exerciseId/edit" element={<CustomExercisePage />} />
                  <Route path="/train" element={<TrainPage />} />
                  <Route path="/train/:sessionId" element={<ActiveWorkoutPage />} />
                  <Route path="/history" element={<WorkoutHistoryPage />} />
                  <Route path="/history/:sessionId" element={<WorkoutHistoryPage />} />
                  <Route path="/progress" element={<ProgressPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
