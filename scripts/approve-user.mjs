import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

// This helper is deliberately restricted to loopback emulators and a demo project.
const email = process.argv[2]
if (!email || !email.includes('@')) {
  console.error('Usage: npm run emulators:approve -- you@example.com')
  process.exit(1)
}
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const app = initializeApp({ projectId: 'demo-muscle-memory' })
try {
  const user = await getAuth(app).getUserByEmail(email)
  await getFirestore(app).doc(`approvedUsers/${user.uid}`).set({ active: true })
  console.log('Local emulator account approved. Return to the application to continue.')
} catch {
  console.error('Could not approve the local account. Start the emulators and register first.')
  process.exitCode = 1
}
