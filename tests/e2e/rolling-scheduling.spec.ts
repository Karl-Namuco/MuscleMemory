import { test, expect } from '@playwright/test'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { EXERCISES } from '../../src/data/exercises'
import { createRoutineExercise } from '../../src/domain/training/helpers'
import { defaultPreferences } from '../../src/types/profile'
import type { Routine, TrainingSplit } from '../../src/types/training'
import type { WorkoutSession } from '../../src/types/workout'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const admin = initializeApp({ projectId: 'demo-muscle-memory' }, 'rolling-scheduling-e2e')

test('Rolling completion survives offline save, respects partial choices, and retains distinct repeated slots', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240_000)
  const db = getFirestore(admin)
  const email = `rolling-${testInfo.project.name}-${Date.now()}@example.com`
  const password = 'a memorable training passphrase'
  const registered = await request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',
    { data: { email, password, returnSecureToken: true } },
  )
  expect(registered.ok()).toBeTruthy()
  const { localId: uid } = (await registered.json()) as { localId: string }
  const now = Date.now()
  const metadata = {
    ownerId: uid,
    schemaVersion: 1 as const,
    revision: 1,
    mutationId: 'rolling-seed',
    previousMutationId: null,
    createdAt: now,
    updatedAt: now,
    archived: false,
  }
  const exercise = EXERCISES.find((candidate) => candidate.trackingType === 'weight-reps')!
  const entry = createRoutineExercise(exercise)
  const routine: Routine = {
    ...metadata,
    id: 'rolling-routine',
    name: 'Repeatable strength',
    description: '',
    targetMuscles: [],
    exercises: [{ ...entry, restSeconds: 0, sets: entry.sets.slice(0, 2) }],
  }
  const split: TrainingSplit = {
    ...metadata,
    id: 'rolling-split',
    name: 'Steady rolling cycle',
    description: '',
    mode: 'rolling',
    slots: [
      { id: 'first-slot', label: 'First strength', routineId: routine.id, isRestDay: false },
      { id: 'second-slot', label: 'Second strength', routineId: routine.id, isRestDay: false },
      { id: 'rest-slot', label: 'Recover', routineId: null, isRestDay: true },
    ],
  }
  const seed = db.batch()
  seed.set(db.doc(`approvedUsers/${uid}`), { active: true })
  seed.set(db.doc(`users/${uid}`), {
    uid,
    displayName: 'Rolling Tester',
    onboardingCompleted: true,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  })
  seed.set(db.doc(`users/${uid}/preferences/main`), {
    ...defaultPreferences(),
    timeZone: 'Asia/Manila',
  })
  seed.set(db.doc(`users/${uid}/routines/${routine.id}`), routine)
  seed.set(db.doc(`users/${uid}/splits/${split.id}`), split)
  seed.set(db.doc(`users/${uid}/trainingSettings/current`), {
    ...metadata,
    id: 'current',
    activeSplitId: split.id,
  })
  await seed.commit()

  const errors: string[] = []
  const networkDiagnostics: string[] = []
  let networkTransition = false
  page.on('pageerror', (error) => {
    const cancelledStream =
      /^\/127\.0\.0\.1:8080\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel\?.* due to access control checks\.$/.test(
        error.message,
      )
    const cancelledAuthLookup =
      /^\/127\.0\.0\.1:9099\/identitytoolkit\.googleapis\.com\/v1\/accounts:lookup\?key=demo-api-key due to access control checks\.$/.test(
        error.message,
      )
    if (
      testInfo.project.name === 'iphone-webkit' &&
      networkTransition &&
      (cancelledStream || cancelledAuthLookup)
    )
      networkDiagnostics.push(error.message)
    else errors.push(error.message)
  })
  const headerSync = page.locator('.topbar .sync-status')
  const nextWorkout = page.getByRole('region', { name: 'Your next workout', exact: true })
  const stateRef = db.doc(`users/${uid}/workoutState/current`)
  const cloudSession = async (id: string) =>
    (await db.doc(`users/${uid}/workoutSessions/${id}`).get()).data() as WorkoutSession | undefined
  const cloudCursor = async () => (await stateRef.get()).data()?.rollingProgress?.[split.id]
  async function visit(path: string) {
    networkTransition = true
    try {
      await page.goto(path)
    } finally {
      networkTransition = false
    }
  }
  async function completeSet(index: number) {
    await page.getByLabel('Weight (kg)', { exact: true }).nth(index).fill('25')
    await page.getByLabel('Reps', { exact: true }).nth(index).fill('8')
    await page
      .getByRole('checkbox', {
        name: `Complete set ${index + 1} of ${exercise.name}`,
        exact: true,
      })
      .check()
  }
  async function expectTodayLayout() {
    await expect(nextWorkout).toHaveCount(1)
    const recommendationBounds = await nextWorkout.boundingBox()
    const heroBounds = await page.locator('.welcome-hero').boundingBox()
    expect(recommendationBounds).not.toBeNull()
    expect(heroBounds).not.toBeNull()
    expect(recommendationBounds!.y).toBeLessThan(heroBounds!.y)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
  }
  async function startRecommended() {
    await nextWorkout
      .getByRole('button', { name: 'Start recommended workout', exact: true })
      .click()
    await expect(page).toHaveURL(/\/train\/[A-Za-z0-9_-]+$/)
    return page.url().split('/').at(-1)!
  }
  async function finishPartial(count: boolean) {
    await page.getByRole('button', { name: 'Finish workout', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Finish this workout?', exact: true })
    await expect(dialog).toContainText('1 of 2 sets completed')
    const inclusion = dialog.getByRole('checkbox', {
      name: 'Count this workout toward my split',
      exact: true,
    })
    await expect(inclusion).not.toBeChecked()
    if (count) await inclusion.check()
    await dialog.getByRole('button', { name: 'Finish and save', exact: true }).click()
    await expect(page).toHaveURL(/\/history\/[A-Za-z0-9_-]+$/)
    await expect(headerSync).toHaveText('Changes synced', { timeout: 45_000 })
  }

  await visit('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/today$/)
  await expect(nextWorkout.getByRole('heading', { name: routine.name, exact: true })).toBeVisible()
  await expect(headerSync).toHaveText('Changes synced')
  await expectTodayLayout()
  await page.screenshot({ path: `test-results/${testInfo.project.name}-rolling-overview.png` })
  const originalViewport = page.viewportSize()!
  await page.setViewportSize({ width: 320, height: 740 })
  await expectTodayLayout()
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-rolling-start.png`,
    fullPage: true,
  })
  await page.setViewportSize(originalViewport)

  const firstId = await startRecommended()
  await completeSet(0)
  await completeSet(1)
  await expect(headerSync).toHaveText('Changes synced')
  await expect
    .poll(async () => (await cloudSession(firstId))?.exercises[0].sets[1].completedAt)
    .not.toBeNull()
  expect((await cloudSession(firstId))?.splitContext).toEqual({
    splitId: split.id,
    splitRevision: 1,
    slotId: 'first-slot',
    sequence: 0,
  })

  networkTransition = true
  await page.context().setOffline(true)
  await page.getByRole('button', { name: 'Finish workout', exact: true }).first().click()
  const finish = page.getByRole('dialog', { name: 'Finish this workout?', exact: true })
  await expect(finish).toContainText('2 of 2 sets completed')
  await expect(
    finish.getByRole('checkbox', { name: 'Count this workout toward my split' }),
  ).toHaveCount(0)
  await finish.getByRole('button', { name: 'Finish and save', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/history/${firstId}$`))
  await expect(
    page.getByText('Saved on this device · waiting for cloud confirmation', { exact: true }),
  ).toBeVisible()
  expect((await cloudSession(firstId))?.status).toBe('active')
  expect(await cloudCursor()).toBeUndefined()
  await page.context().setOffline(false)
  await expect(headerSync).toHaveText('Changes synced', { timeout: 45_000 })
  networkTransition = false
  await expect.poll(async () => (await cloudSession(firstId))?.countsForSplit).toBe(true)
  await expect.poll(cloudCursor).toMatchObject({
    splitRevision: 1,
    sequence: 1,
    lastSlotId: 'first-slot',
    lastSessionId: firstId,
  })
  const firstCursor = await cloudCursor()
  expect(firstCursor.completedAt).toBe((await cloudSession(firstId))?.endedAt)

  await visit('/train')
  networkTransition = true
  try {
    await page.reload()
  } finally {
    networkTransition = false
  }
  await expect(nextWorkout.getByRole('heading', { name: routine.name, exact: true })).toBeVisible()
  const partialId = await startRecommended()
  await completeSet(0)
  await finishPartial(false)
  expect((await cloudSession(partialId))?.splitContext).toMatchObject({
    slotId: 'second-slot',
    sequence: 1,
  })
  expect((await cloudSession(partialId))?.countsForSplit).toBe(false)
  expect(await cloudCursor()).toEqual(firstCursor)

  await visit('/train')
  const optedInId = await startRecommended()
  await completeSet(0)
  await finishPartial(true)
  expect((await cloudSession(optedInId))?.splitContext).toMatchObject({
    slotId: 'second-slot',
    sequence: 1,
  })
  expect((await cloudSession(optedInId))?.countsForSplit).toBe(true)
  await expect.poll(cloudCursor).toMatchObject({
    splitRevision: 1,
    sequence: 2,
    lastSlotId: 'second-slot',
    lastSessionId: optedInId,
  })
  const secondCursor = await cloudCursor()
  await visit('/today')
  await expect(
    nextWorkout.getByRole('heading', { name: 'A little room to recover.', exact: true }),
  ).toBeVisible()
  await expect(nextWorkout).toContainText('1 planned rest day')
  await expect(nextWorkout.locator('time')).toHaveCount(1)
  await expectTodayLayout()
  await page.setViewportSize({ width: 320, height: 740 })
  await expectTodayLayout()
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-rolling-rest.png`,
    fullPage: true,
  })
  await page.setViewportSize(originalViewport)

  await nextWorkout.getByRole('button', { name: 'Train early', exact: true }).click()
  const early = page.getByRole('dialog', {
    name: 'Train before your planned rest ends?',
    exact: true,
  })
  await expect(early).toContainText('Starting early skips the remaining rest days')
  await early.getByRole('button', { name: 'Start early workout', exact: true }).click()
  await expect(page).toHaveURL(/\/train\/[A-Za-z0-9_-]+$/)
  const earlyId = page.url().split('/').at(-1)!
  await page.getByRole('button', { name: 'End early', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'End this workout early?', exact: true })
    .getByRole('button', { name: 'End early and keep work', exact: true })
    .click()
  await expect(page).toHaveURL(new RegExp(`/history/${earlyId}$`))
  await expect(headerSync).toHaveText('Changes synced', { timeout: 45_000 })
  expect((await cloudSession(earlyId))?.splitContext).toMatchObject({
    slotId: 'first-slot',
    sequence: 2,
  })
  expect((await cloudSession(earlyId))?.status).toBe('abandoned')
  expect((await cloudSession(earlyId))?.countsForSplit).toBe(false)
  expect(await cloudCursor()).toEqual(secondCursor)
  expect((await db.collection(`users/${uid}/workoutSessions`).get()).size).toBe(4)
  if (networkDiagnostics.length) {
    await testInfo.attach('webkit-firestore-interruption-diagnostics', {
      body: JSON.stringify(networkDiagnostics, null, 2),
      contentType: 'application/json',
    })
  }
  expect(errors).toEqual([])
})
