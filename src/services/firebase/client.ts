import { initializeApp, type FirebaseApp } from 'firebase/app'
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence, type Auth } from 'firebase/auth'
import {
  clearIndexedDbPersistence, connectFirestoreEmulator, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager, terminate, type Firestore,
} from 'firebase/firestore'

export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === 'true'
  || (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS !== 'false')

const productionConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = usingEmulators || Object.values(productionConfig).every(Boolean)

export interface FirebaseServices { app: FirebaseApp; auth: Auth; db: Firestore }
let services: FirebaseServices | null = null
let authPersistence: Promise<void> | null = null

export function getFirebaseServices(): FirebaseServices {
  if (!firebaseConfigured) throw new Error('Firebase configuration is missing. Follow the setup instructions before signing in.')
  if (services) return services
  const app = initializeApp(usingEmulators ? {
    apiKey: 'demo-api-key', authDomain: 'demo-muscle-memory.firebaseapp.com',
    projectId: 'demo-muscle-memory', storageBucket: 'demo-muscle-memory.firebasestorage.app',
    messagingSenderId: '123456789', appId: '1:123456789:web:musclememory',
  } : productionConfig)
  const auth = getAuth(app)
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
  if (usingEmulators) {
    const host = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1'
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
    connectFirestoreEmulator(db, host, 8080)
  }
  services = { app, auth, db }
  authPersistence = setPersistence(auth, browserLocalPersistence)
  return services
}

export async function prepareAuthentication(): Promise<FirebaseServices> {
  const result = getFirebaseServices()
  await authPersistence
  return result
}

/** Call only after sign-out and all Firestore listeners have been detached. */
export async function clearPrivateCache(): Promise<void> {
  if (!services) return
  await terminate(services.db)
  await clearIndexedDbPersistence(services.db)
}
