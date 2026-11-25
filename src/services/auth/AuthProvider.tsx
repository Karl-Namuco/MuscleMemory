import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { doc, getDocFromServer, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { profileInputSchema } from '../../schemas/profile'
import type { AccountData, ProfileInput } from '../../types/profile'
import {
  clearPrivateCache,
  firebaseConfigured,
  getFirebaseServices,
  prepareAuthentication,
  usingEmulators,
} from '../firebase/client'
import { watchAccount, writeProfile } from '../repositories/accountRepository'
import { readableAuthError } from './errors'
import { assertCanLogout } from './logoutGuards'
import { clearAllTrainingRecovery, readTrainingRecovery } from '../training/recovery'

async function clearFeatureDrafts(preserveTrainingRecovery = false) {
  const [onboarding, exercises, routines, splits] = await Promise.all([
    import('../../features/onboarding/draft'),
    import('../../features/exercises/draft'),
    import('../../features/routines/draft'),
    import('../../features/splits/draft'),
  ])
  await Promise.all([
    onboarding.clearAllOnboardingDrafts(),
    exercises.clearAllExerciseDrafts(),
    routines.clearAllRoutineDrafts(),
    splits.clearAllSplitDrafts(),
  ])
  if (!preserveTrainingRecovery) clearAllTrainingRecovery()
}

type AuthStatus = 'loading' | 'signed-out' | 'pending-approval' | 'ready' | 'error'
interface AuthContextValue {
  user: User | null
  status: AuthStatus
  account: AccountData | null
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  resetPassword: (email: string) => Promise<void>
  logout: () => Promise<void>
  saveProfile: (input: ProfileInput) => Promise<void>
  refreshAccess: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)
interface LocalSave {
  uid: string
  updatedAt: number
  preferences: string
  resolve: () => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [account, setAccount] = useState<AccountData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const accountRef = useRef<AccountData | null>(null)
  const generation = useRef(0)
  const stops = useRef<Unsubscribe[]>([])
  const currentUid = useRef<string | null>(null)
  const localSaves = useRef(new Set<LocalSave>())
  const disposing = useRef(false)

  const detach = useCallback(() => {
    generation.current += 1
    for (const stop of stops.current) stop()
    stops.current = []
    for (const pending of localSaves.current) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('The account changed before this save finished.'))
    }
    localSaves.current.clear()
    accountRef.current = null
    setAccount(null)
  }, [])

  useEffect(() => {
    if (!firebaseConfigured) {
      setStatus('error')
      return
    }
    let mounted = true
    let stopAuth: Unsubscribe | undefined

    void prepareAuthentication()
      .then(({ auth, db }) => {
        if (!mounted) return
        stopAuth = onAuthStateChanged(auth, (nextUser) => {
          const previousUid = currentUid.current
          detach()
          currentUid.current = nextUser?.uid ?? null
          setUser(nextUser)
          setError(null)
          if (disposing.current) return
          if (previousUid && previousUid !== nextUser?.uid) {
            setStatus('loading')
            void clearPrivateCache()
              .then(async () => {
                await clearFeatureDrafts(true)
                window.location.reload()
              })
              .catch(() => {
                if (mounted) {
                  setError(
                    'Close all other Muscle Memory tabs, then reload to clear the previous account’s local cache.',
                  )
                  setStatus('error')
                }
              })
            return
          }
          if (!nextUser) {
            setStatus('signed-out')
            return
          }
          setStatus('loading')
          const token = generation.current
          let stopAccount: Unsubscribe | undefined
          const stillCurrent = () =>
            mounted && generation.current === token && currentUid.current === nextUser.uid
          const loadingTimeout = setTimeout(() => {
            if (stillCurrent() && !accountRef.current) {
              setError(
                usingEmulators
                  ? 'Your account could not finish loading. Make sure both local Firebase emulators are running, then try again.'
                  : 'Your account could not finish loading. Check your connection and try again.',
              )
              setStatus('error')
            }
          }, 8_000)
          const reportError = (failure: unknown) => {
            if (!stillCurrent()) return
            clearTimeout(loadingTimeout)
            const message =
              failure instanceof Error && failure.message === 'incomplete-account'
                ? 'Your account setup is incomplete. Contact the project owner before continuing.'
                : readableAuthError(failure)
            setError(message)
            if (!accountRef.current) setStatus('error')
          }
          const stopApproval = onSnapshot(
            doc(db, 'approvedUsers', nextUser.uid),
            { includeMetadataChanges: true },
            (snapshot) => {
              if (!stillCurrent()) return
              if (!snapshot.exists() || snapshot.data().active !== true) {
                stopAccount?.()
                stopAccount = undefined
                accountRef.current = null
                setAccount(null)
                if (!snapshot.exists() && snapshot.metadata.fromCache) {
                  setStatus('loading')
                  return
                }
                clearTimeout(loadingTimeout)
                setStatus('pending-approval')
                return
              }
              if (stopAccount) return
              stopAccount = watchAccount(db, nextUser.uid, {
                data: (data) => {
                  if (!stillCurrent()) return
                  clearTimeout(loadingTimeout)
                  accountRef.current = data
                  setAccount(data)
                  setStatus('ready')
                  setError(null)
                  for (const pending of localSaves.current) {
                    if (
                      pending.uid === nextUser.uid &&
                      pending.updatedAt === data.profile.updatedAt &&
                      pending.preferences === JSON.stringify(data.preferences)
                    ) {
                      clearTimeout(pending.timeout)
                      localSaves.current.delete(pending)
                      pending.resolve()
                    }
                  }
                },
                error: reportError,
                needsConnection: () => {
                  if (stillCurrent() && !accountRef.current && !navigator.onLine) {
                    setError(
                      'Connect to the internet to finish setting up this account for the first time.',
                    )
                    setStatus('error')
                  }
                },
              })
            },
            reportError,
          )
          stops.current.push(
            stopApproval,
            () => stopAccount?.(),
            () => clearTimeout(loadingTimeout),
          )
        })
      })
      .catch((failure: unknown) => {
        if (mounted) {
          setError(readableAuthError(failure))
          setStatus('error')
        }
      })
    return () => {
      mounted = false
      stopAuth?.()
      detach()
    }
  }, [detach, retry])

  const runAuthAction = useCallback(async (operation: () => Promise<unknown>) => {
    setError(null)
    try {
      await operation()
    } catch (failure) {
      const message = readableAuthError(failure)
      setError(message)
      throw new Error(message, { cause: failure })
    }
  }, [])

  const signIn = useCallback(
    (email: string, password: string) =>
      runAuthAction(async () => {
        const { auth } = await prepareAuthentication()
        await signInWithEmailAndPassword(auth, email.trim(), password)
      }),
    [runAuthAction],
  )
  const register = useCallback(
    (email: string, password: string) =>
      runAuthAction(async () => {
        const { auth } = await prepareAuthentication()
        await createUserWithEmailAndPassword(auth, email.trim(), password)
      }),
    [runAuthAction],
  )
  const resetPassword = useCallback(
    (email: string) =>
      runAuthAction(async () => {
        const { auth } = await prepareAuthentication()
        try {
          await sendPasswordResetEmail(auth, email.trim())
        } catch (failure) {
          if (
            typeof failure === 'object' &&
            failure !== null &&
            'code' in failure &&
            failure.code === 'auth/user-not-found'
          )
            return
          throw failure
        }
      }),
    [runAuthAction],
  )

  const refreshAccess = useCallback(
    () =>
      runAuthAction(async () => {
        try {
          const { auth, db } = await prepareAuthentication()
          if (auth.currentUser)
            await getDocFromServer(doc(db, 'approvedUsers', auth.currentUser.uid))
        } finally {
          // Restart failed observers even when authentication has not resolved yet.
          setRetry((value) => value + 1)
        }
      }),
    [runAuthAction],
  )

  const logout = useCallback(async () => {
    if (accountRef.current?.hasPendingWrites || localSaves.current.size > 0) {
      const message =
        'Your changes are saved on this device and waiting to sync. Reconnect and wait for cloud confirmation before signing out.'
      setError(message)
      throw new Error(message)
    }
    try {
      if (currentUid.current) await assertCanLogout(currentUid.current)
      if (currentUid.current && readTrainingRecovery(currentUid.current).length)
        throw new Error(
          'Training drafts are waiting for cloud confirmation. Open your training plan and resolve pending or failed saves before signing out.',
        )
    } catch (failure) {
      const message =
        failure instanceof Error
          ? failure.message
          : 'Wait for your training changes to sync before signing out.'
      setError(message)
      throw new Error(message, { cause: failure })
    }
    disposing.current = true
    detach()
    setStatus('loading')
    setError(null)
    try {
      await signOut(getFirebaseServices().auth)
      await clearPrivateCache()
      await clearFeatureDrafts()
      window.location.assign('/login')
    } catch (failure) {
      setError(
        'Sign-out needs to finish clearing local data. Close other Muscle Memory tabs and reload before using another account.',
      )
      setStatus('error')
      throw new Error(readableAuthError(failure), { cause: failure })
    }
  }, [detach])

  const saveProfile = useCallback(async (input: ProfileInput) => {
    const parsed = profileInputSchema.parse(input)
    const previous = accountRef.current
    if (!previous || previous.profile.uid !== currentUid.current)
      throw new Error('Sign in and wait for your profile to load before saving.')
    const uid = previous.profile.uid
    const token = generation.current
    const updatedAt = Math.max(Date.now(), previous.profile.updatedAt + 1)
    setError(null)
    await new Promise<void>((resolve, reject) => {
      const pending: LocalSave = {
        uid,
        updatedAt,
        preferences: JSON.stringify(parsed.preferences),
        resolve,
        reject,
        timeout: setTimeout(() => {
          localSaves.current.delete(pending)
          reject(
            new Error(
              'This device could not confirm the local save. Keep this page open and try again.',
            ),
          )
        }, 15_000),
      }
      localSaves.current.add(pending)
      void writeProfile(getFirebaseServices().db, previous, parsed, updatedAt).catch(
        (failure: unknown) => {
          clearTimeout(pending.timeout)
          localSaves.current.delete(pending)
          const message = readableAuthError(failure)
          reject(new Error(message))
          if (generation.current === token && currentUid.current === uid) setError(message)
        },
      )
    })
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        account,
        error,
        signIn,
        register,
        resetPassword,
        logout,
        saveProfile,
        refreshAccess,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be called inside AuthProvider.')
  return value
}
