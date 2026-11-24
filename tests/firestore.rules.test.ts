// Execute with the Firestore emulator: npm run test:rules.
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { defaultPreferences } from '../src/types/profile'

let environment: RulesTestEnvironment
const profile = (uid: string) => ({ uid, displayName: 'Alex', onboardingCompleted: false, schemaVersion: 1, createdAt: 1, updatedAt: 1 })
const userDb = (uid: string) => environment.authenticatedContext(uid).firestore()

async function approve(uid: string) {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'approvedUsers', uid), { active: true })
  })
}
async function createAccount(db: ReturnType<typeof userDb>, uid: string, overrides = {}) {
  const batch = writeBatch(db)
  batch.set(doc(db, 'users', uid), { ...profile(uid), ...overrides })
  batch.set(doc(db, 'users', uid, 'preferences', 'main'), defaultPreferences())
  return batch.commit()
}

describe('private account rules', () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: 'demo-muscle-memory',
      firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
    })
  }, 30_000)
  beforeEach(async () => { await environment.clearFirestore() })
  afterAll(async () => { await environment?.cleanup() })

  it('allows an approved owner to create and read an atomic profile', async () => {
    await approve('alex')
    const db = userDb('alex')
    await assertSucceeds(createAccount(db, 'alex'))
    await assertSucceeds(getDoc(doc(db, 'users', 'alex')))
    await assertSucceeds(getDoc(doc(db, 'users', 'alex', 'preferences', 'main')))
    await assertSucceeds(updateDoc(doc(db, 'users', 'alex'), { displayName: 'Taylor', updatedAt: 2 }))
  })
  it('requires approval even for authenticated owners', async () => {
    const db = userDb('unapproved')
    await assertFails(createAccount(db, 'unapproved'))
    await assertFails(getDoc(doc(db, 'users', 'unapproved')))
    await assertSucceeds(getDoc(doc(db, 'approvedUsers', 'unapproved')))
    await assertFails(setDoc(doc(db, 'approvedUsers', 'unapproved'), { active: true }))
  })
  it('denies unauthenticated and cross-user access', async () => {
    await approve('alex'); await approve('other')
    await createAccount(userDb('alex'), 'alex')
    const anonymous = environment.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(anonymous, 'users', 'alex')))
    await assertFails(getDoc(doc(userDb('other'), 'users', 'alex')))
    await assertFails(getDoc(doc(userDb('other'), 'users', 'alex', 'preferences', 'main')))
    await assertFails(createAccount(userDb('other'), 'alex'))
    await assertFails(getDoc(doc(userDb('other'), 'approvedUsers', 'alex')))
  })
  it('rejects ownership changes, immutable timestamps and unknown profile fields', async () => {
    await approve('alex')
    const db = userDb('alex')
    await createAccount(db, 'alex')
    await assertFails(updateDoc(doc(db, 'users', 'alex'), { uid: 'other', updatedAt: 2 }))
    await assertFails(updateDoc(doc(db, 'users', 'alex'), { createdAt: 2, updatedAt: 2 }))
    await assertFails(updateDoc(doc(db, 'users', 'alex'), { updatedAt: 2, admin: true }))
    await assertFails(updateDoc(doc(db, 'users', 'alex'), { schemaVersion: 2, updatedAt: 2 }))
    await assertFails(updateDoc(doc(db, 'users', 'alex'), { updatedAt: 1 }))
  })
  it('rejects malformed or contradictory preferences', async () => {
    await approve('alex')
    const db = userDb('alex')
    await createAccount(db, 'alex')
    const reference = doc(db, 'users', 'alex', 'preferences', 'main')
    await assertFails(updateDoc(reference, { equipment: ['Unknown equipment'] }))
    await assertFails(updateDoc(reference, { sessionsPerWeek: 8 }))
    await assertFails(updateDoc(reference, { sessionMinutes: 20.5 }))
    await assertFails(updateDoc(reference, { goals: [] }))
    await assertFails(updateDoc(reference, { preferredDays: [1, 1] }))
    await assertFails(updateDoc(reference, { restDays: [1] }))
    await assertFails(updateDoc(reference, { priorityMuscles: ['Brain'] }))
    await assertFails(updateDoc(reference, { favoriteExercises: [123] }))
    await assertFails(updateDoc(reference, { favoriteExercises: ['Squat'], excludedExercises: ['Squat'] }))
    await assertFails(updateDoc(reference, { admin: true }))
  })
  it('validates every arbitrary exercise string up to the final allowed position', async () => {
    await approve('alex')
    const db = userDb('alex')
    await createAccount(db, 'alex')
    const reference = doc(db, 'users', 'alex', 'preferences', 'main')
    await assertSucceeds(updateDoc(reference, { favoriteExercises: Array.from({ length: 10 }, (_, index) => `Exercise ${index}`) }))
    await assertSucceeds(updateDoc(reference, { excludedExercises: Array.from({ length: 10 }, (_, index) => `Avoid ${index}`) }))
    await assertFails(updateDoc(reference, { favoriteExercises: [...Array.from({ length: 9 }, (_, index) => `Exercise ${index}`), 42] }))
    await assertFails(updateDoc(reference, { favoriteExercises: Array.from({ length: 11 }, (_, index) => `Exercise ${index}`) }))
  })
  it('denies unimplemented collections, enumeration and client deletion', async () => {
    await approve('alex')
    const db = userDb('alex')
    await createAccount(db, 'alex')
    await assertFails(getDocs(collection(db, 'users')))
    await assertFails(getDocs(collection(db, 'approvedUsers')))
    await assertFails(setDoc(doc(db, 'config', 'global'), { public: true }))
    await assertFails(setDoc(doc(db, 'users', 'alex', 'workouts', 'new'), { anything: true }))
    await assertFails(setDoc(doc(db, 'users', 'alex', 'preferences', 'other'), defaultPreferences()))
    await assertFails(deleteDoc(doc(db, 'users', 'alex')))
    await assertFails(deleteDoc(doc(db, 'users', 'alex', 'preferences', 'main')))
  })
  it('revokes private data access when approval is removed', async () => {
    await approve('alex')
    const db = userDb('alex')
    await createAccount(db, 'alex')
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'approvedUsers', 'alex'), { active: false })
    })
    await assertFails(getDoc(doc(db, 'users', 'alex')))
    await assertFails(updateDoc(doc(db, 'users', 'alex'), { updatedAt: 2 }))
  })
})
