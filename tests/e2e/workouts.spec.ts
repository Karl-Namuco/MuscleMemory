import { test, expect } from '@playwright/test'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { EXERCISES } from '../../src/data/exercises'
import { createRoutineExercise } from '../../src/domain/training/helpers'
import { defaultPreferences } from '../../src/types/profile'
import type { Routine } from '../../src/types/training'
import type { WorkoutSession } from '../../src/types/workout'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const admin = initializeApp({ projectId: 'demo-muscle-memory' }, 'workouts-e2e')

test('workouts retain actuals and timers across reload, finish offline, and preserve snapshot history', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000)
  const db = getFirestore(admin)
  const email = `workout-${testInfo.project.name}-${Date.now()}@example.com`
  const password = 'a memorable training passphrase'
  const registered = await request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',
    { data: { email, password, returnSecureToken: true } },
  )
  expect(registered.ok()).toBeTruthy()
  const { localId: uid } = (await registered.json()) as { localId: string }
  const now = Date.now()
  const weightExercise = EXERCISES.find((exercise) => exercise.trackingType === 'weight-reps')!
  const durationExercise = EXERCISES.find((exercise) => exercise.trackingType === 'duration')!
  const routine: Routine = {
    id: 'workout-acceptance-routine',
    ownerId: uid,
    schemaVersion: 1,
    revision: 1,
    mutationId: 'routine-original',
    previousMutationId: null,
    createdAt: now,
    updatedAt: now,
    archived: false,
    name: 'Steady acceptance session',
    description: 'A little consistent work.',
    targetMuscles: [],
    exercises: [weightExercise, durationExercise].map((exercise) => {
      const entry = createRoutineExercise(exercise)
      return {
        ...entry,
        restSeconds: 180,
        sets: [
          {
            ...entry.sets[0],
            targetWeightKg: exercise.trackingType === 'weight-reps' ? 25 : null,
            durationSeconds: exercise.trackingType === 'duration' ? 60 : null,
          },
        ],
      }
    }),
  }
  const seed = db.batch()
  seed.set(db.doc(`approvedUsers/${uid}`), { active: true })
  seed.set(db.doc(`users/${uid}`), {
    uid,
    displayName: 'Workout Tester',
    onboardingCompleted: true,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  })
  seed.set(db.doc(`users/${uid}/preferences/main`), defaultPreferences())
  seed.set(db.doc(`users/${uid}/routines/${routine.id}`), routine)
  await seed.commit()

  const errors: string[] = []
  const diagnostics: string[] = []
  let networkTransition = false
  page.on('pageerror', (error) => {
    const cancelledStream =
      /^\/127\.0\.0\.1:8080\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel\?.* due to access control checks\.$/.test(
        error.message,
      )
    if (testInfo.project.name === 'iphone-webkit' && networkTransition && cancelledStream)
      diagnostics.push(error.message)
    else errors.push(error.message)
  })
  const headerSync = page.locator('.topbar .sync-status')
  async function visit(path: string) {
    networkTransition = true
    try {
      await page.goto(path)
    } finally {
      networkTransition = false
    }
  }
  async function cloudSession(id: string) {
    return (await db.doc(`users/${uid}/workoutSessions/${id}`).get()).data() as
      WorkoutSession | undefined
  }
  async function screenshot(path: string) {
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path, fullPage: true })
  }

  await visit('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/today$/)
  await expect(headerSync).toHaveText('Changes synced')
  await visit('/train')
  await expect(page.getByRole('heading', { name: 'Show up. Start somewhere.' })).toBeVisible()
  await page.getByRole('button', { name: `Start workout: ${routine.name}`, exact: true }).click()
  await expect(page).toHaveURL(/\/train\/[A-Za-z0-9_-]+$/)
  const sessionId = page.url().split('/').at(-1)!
  await expect(
    page.getByRole('heading', { name: routine.name, exact: true, level: 1 }),
  ).toBeVisible()
  await expect(page.getByLabel('Weight (kg)', { exact: true })).toBeEmpty()
  await expect(page.getByLabel('Reps', { exact: true })).toBeEmpty()
  await expect(page.getByLabel('Duration (sec)', { exact: true })).toBeEmpty()
  const weightCheck = page.getByRole('checkbox', {
    name: `Complete set 1 of ${weightExercise.name}`,
    exact: true,
  })
  await weightCheck.click()
  await expect(weightCheck).not.toBeChecked()
  await expect(page.getByText(/Enter valid actual values for this set/)).toBeVisible()
  await page.getByLabel('Weight (kg)', { exact: true }).fill('42.5')
  await page.getByLabel('Reps', { exact: true }).fill('8')
  await page.getByLabel('RPE (optional)', { exact: true }).first().fill('7.5')
  await weightCheck.check()
  await expect(weightCheck).toBeChecked()
  await expect(page.getByRole('region', { name: 'Rest timer', exact: true })).toBeVisible()
  await expect(headerSync).toHaveText('Changes synced')
  await expect
    .poll(async () => (await cloudSession(sessionId))?.exercises[0].sets[0].weightKg)
    .toBe(42.5)
  const checkpoint = (await cloudSession(sessionId))!
  expect(checkpoint.exercises[0].sets[0]).toMatchObject({
    weightKg: 42.5,
    reps: 8,
    rpe: 7.5,
    completedAt: expect.any(Number),
  })
  expect(checkpoint.exercises[1].sets[0].completedAt).toBeNull()
  expect(checkpoint.timerEndAt).toBeGreaterThan(Date.now())
  expect((await db.collection(`users/${uid}/workoutSessions`).get()).size).toBe(1)

  const originalViewport = page.viewportSize()!
  await screenshot(`test-results/${testInfo.project.name}-workout-logger.png`)
  if (testInfo.project.name === 'desktop-chromium') {
    await page.setViewportSize({ width: 834, height: 1112 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    await screenshot('test-results/tablet-workout-logger.png')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    await screenshot('test-results/mobile-workout-logger.png')
  }
  await page.setViewportSize({ width: 320, height: 740 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await screenshot(`test-results/${testInfo.project.name}-workout-narrow.png`)
  await page.setViewportSize(originalViewport)

  // Changing the source routine cannot change the workout already in progress.
  await db.doc(`users/${uid}/routines/${routine.id}`).set({
    ...routine,
    name: 'Revised acceptance routine',
    revision: 2,
    mutationId: 'routine-revised',
    previousMutationId: routine.mutationId,
    updatedAt: Date.now(),
    exercises: routine.exercises.map((entry) => ({
      ...entry,
      exerciseSnapshot: {
        ...entry.exerciseSnapshot,
        name: `Revised ${entry.exerciseSnapshot.name}`,
      },
    })),
  })
  networkTransition = true
  try {
    await page.reload()
  } finally {
    networkTransition = false
  }
  await expect(page).toHaveURL(new RegExp(`/train/${sessionId}$`))
  await expect(
    page.getByRole('heading', { name: routine.name, exact: true, level: 1 }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: weightExercise.name, exact: true })).toBeVisible()
  await expect(page.getByLabel('Weight (kg)', { exact: true })).toHaveValue('42.5')
  await expect(page.getByLabel('Reps', { exact: true })).toHaveValue('8')
  await expect(weightCheck).toBeChecked()
  await expect(page.getByRole('region', { name: 'Rest timer', exact: true })).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Rest timer', exact: true })
      .getByText('0:00', { exact: true }),
  ).not.toBeVisible()
  await expect(headerSync).toHaveText('Changes synced')
  expect((await cloudSession(sessionId))!.timerEndAt).toBe(checkpoint.timerEndAt)

  networkTransition = true
  await page.context().setOffline(true)
  await page.getByLabel('Duration (sec)', { exact: true }).fill('75')
  await page
    .getByRole('checkbox', { name: `Complete set 1 of ${durationExercise.name}`, exact: true })
    .check()
  await page
    .getByLabel('Workout notes (optional)', { exact: true })
    .fill('Finished while offline; actual values preserved.')
  await page.getByRole('button', { name: 'Finish workout', exact: true }).first().click()
  const finishDialog = page.getByRole('dialog', { name: 'Finish this workout?', exact: true })
  await expect(finishDialog).toContainText('2 of 2 sets completed')
  await finishDialog.getByRole('button', { name: 'Finish and save', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/history/${sessionId}$`))
  await expect(page.getByText('42.5 kg × 8 reps · RPE 7.5', { exact: true })).toBeVisible()
  await expect(page.getByText('75 sec', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Saved on this device · waiting for cloud confirmation', { exact: true }),
  ).toBeVisible()
  await expect(headerSync).not.toHaveText('Changes synced')
  await screenshot(`test-results/${testInfo.project.name}-workout-offline-history.png`)
  expect((await cloudSession(sessionId))!.status).toBe('active')
  await page.context().setOffline(false)
  await expect(headerSync).toHaveText('Changes synced', { timeout: 45_000 })
  networkTransition = false
  await expect.poll(async () => (await cloudSession(sessionId))?.status).toBe('completed')
  const completed = (await cloudSession(sessionId))!
  expect(completed.routineName).toBe(routine.name)
  expect(completed.exercises[0].snapshot.name).toBe(weightExercise.name)
  expect(completed.exercises[1].snapshot.name).toBe(durationExercise.name)
  expect(completed.exercises[0].sets[0]).toMatchObject({
    weightKg: 42.5,
    reps: 8,
    rpe: 7.5,
    completedAt: expect.any(Number),
  })
  expect(completed.exercises[1].sets[0]).toMatchObject({
    durationSeconds: 75,
    completedAt: expect.any(Number),
  })
  expect(completed.notes).toBe('Finished while offline; actual values preserved.')
  expect(completed.timerEndAt).toBeNull()
  expect(completed.completionKey).toBe(sessionId)
  expect(
    (await db.doc(`users/${uid}/workoutState/current`).get()).data()?.activeSessionId,
  ).toBeNull()
  expect((await db.collection(`users/${uid}/workoutSessions`).get()).size).toBe(1)
  await screenshot(`test-results/${testInfo.project.name}-workout-history.png`)

  await page.getByRole('link', { name: /Back to training/, exact: false }).click()
  await page
    .getByRole('button', { name: 'Start workout: Revised acceptance routine', exact: true })
    .click()
  await expect(page).toHaveURL(/\/train\/[A-Za-z0-9_-]+$/)
  const secondId = page.url().split('/').at(-1)!
  expect(secondId).not.toBe(sessionId)
  await expect(page.locator('.workout-previous').filter({ hasText: '42.5 kg × 8 reps' })).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'View previous workout', exact: true }).first(),
  ).toHaveAttribute('href', `/history/${sessionId}`)
  await page.getByLabel('Weight (kg)', { exact: true }).fill('40')
  await page.getByLabel('Reps', { exact: true }).fill('6')
  await page
    .getByRole('checkbox', {
      name: `Complete set 1 of Revised ${weightExercise.name}`,
      exact: true,
    })
    .check()
  await page.getByRole('button', { name: 'End early', exact: true }).click()
  const earlyDialog = page.getByRole('dialog', { name: 'End this workout early?', exact: true })
  await expect(earlyDialog).toContainText('1 of 2 sets completed')
  await earlyDialog.getByRole('button', { name: 'End early and keep work', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/history/${secondId}$`))
  await expect(page.getByText('Ended early', { exact: true })).toBeVisible()
  await expect(page.getByText('Incomplete · excluded from totals', { exact: true })).toBeVisible()
  await expect(headerSync).toHaveText('Changes synced', { timeout: 45_000 })
  const abandoned = (await cloudSession(secondId))!
  expect(abandoned.status).toBe('abandoned')
  expect(abandoned.exercises[0].sets[0]).toMatchObject({
    weightKg: 40,
    reps: 6,
    completedAt: expect.any(Number),
  })
  expect(abandoned.exercises[1].sets[0].completedAt).toBeNull()
  expect(abandoned.completionKey).toBeNull()
  expect(
    (await db.doc(`users/${uid}/workoutState/current`).get()).data()?.activeSessionId,
  ).toBeNull()
  expect((await db.collection(`users/${uid}/workoutSessions`).get()).size).toBe(2)
  if (diagnostics.length)
    await testInfo.attach('webkit-firestore-interruption-diagnostics', {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: 'application/json',
    })
  expect(errors).toEqual([])
})
