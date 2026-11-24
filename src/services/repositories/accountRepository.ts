import { doc, onSnapshot, writeBatch, type DocumentSnapshot, type Firestore, type Unsubscribe } from 'firebase/firestore'
import { preferencesSchema, userProfileSchema } from '../../schemas/profile'
import { defaultPreferences, type AccountData, type ProfileInput, type UserProfile } from '../../types/profile'

export interface AccountObserver {
  data: (account: AccountData) => void
  error: (error: unknown) => void
  needsConnection: () => void
}

/** Both documents are written as one batch; metadata reports local writes honestly. */
export function watchAccount(db: Firestore, uid: string, observer: AccountObserver): Unsubscribe {
  let profileSnapshot: DocumentSnapshot | undefined
  let preferencesSnapshot: DocumentSnapshot | undefined
  let stopped = false
  let initializing = false
  const profileRef = doc(db, 'users', uid)
  const preferencesRef = doc(db, 'users', uid, 'preferences', 'main')

  const publish = () => {
    if (stopped || !profileSnapshot || !preferencesSnapshot) return
    if (!profileSnapshot.exists() || !preferencesSnapshot.exists()) {
      if (profileSnapshot.metadata.fromCache || preferencesSnapshot.metadata.fromCache) {
        observer.needsConnection()
        return
      }
      if (initializing) return
      if (profileSnapshot.exists() !== preferencesSnapshot.exists()) {
        observer.error(new Error('incomplete-account'))
        return
      }
      initializing = true
      const now = Date.now()
      const profile: UserProfile = { uid, displayName: '', onboardingCompleted: false, schemaVersion: 1, createdAt: now, updatedAt: now }
      const batch = writeBatch(db)
      batch.set(profileRef, profile)
      batch.set(preferencesRef, defaultPreferences())
      void batch.commit().catch((error: unknown) => { if (!stopped) observer.error(error) })
      return
    }
    try {
      const profile = userProfileSchema.parse(profileSnapshot.data())
      if (profile.uid !== uid) throw new Error('invalid-account-owner')
      const preferences = preferencesSchema.parse(preferencesSnapshot.data())
      observer.data({
        profile, preferences,
        hasPendingWrites: profileSnapshot.metadata.hasPendingWrites || preferencesSnapshot.metadata.hasPendingWrites,
        fromCache: profileSnapshot.metadata.fromCache || preferencesSnapshot.metadata.fromCache,
      })
    } catch (error) {
      observer.error(error)
    }
  }
  const stopProfile = onSnapshot(profileRef, { includeMetadataChanges: true }, (snapshot) => {
    profileSnapshot = snapshot
    publish()
  }, observer.error)
  const stopPreferences = onSnapshot(preferencesRef, { includeMetadataChanges: true }, (snapshot) => {
    preferencesSnapshot = snapshot
    publish()
  }, observer.error)
  return () => { stopped = true; stopProfile(); stopPreferences() }
}

export function writeProfile(db: Firestore, account: AccountData, input: ProfileInput, updatedAt: number): Promise<void> {
  const uid = account.profile.uid
  const batch = writeBatch(db)
  batch.set(doc(db, 'users', uid), { ...account.profile, displayName: input.displayName, onboardingCompleted: input.onboardingCompleted, updatedAt })
  batch.set(doc(db, 'users', uid, 'preferences', 'main'), input.preferences)
  return batch.commit()
}
