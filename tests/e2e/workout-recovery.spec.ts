import { readFile } from 'node:fs/promises'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { EXERCISES } from '../../src/data/exercises'
import { createRoutineExercise } from '../../src/domain/training/helpers'
import { defaultPreferences } from '../../src/types/profile'
import type { WorkoutCheckpoint } from '../../src/services/workouts/storage'
import type { Routine } from '../../src/types/training'
import type { WorkoutSession } from '../../src/types/workout'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const admin = initializeApp({ projectId: 'demo-muscle-memory' }, 'workout-recovery-e2e')
const db = getFirestore(admin)
const password = 'a memorable recovery passphrase'
const weightExercise = EXERCISES.find((exercise) => exercise.trackingType === 'weight-reps')!
const headerSync = (page: Page) => page.locator('.topbar .sync-status')
const recovery = (page: Page) => page.getByRole('region', { name: 'Workout recovery', exact: true })
const checkbox = (page: Page) =>
  page.getByRole('checkbox', { name: `Complete set 1 of ${weightExercise.name}`, exact: true })

async function seed(request: APIRequestContext, label: string) {
  const email = `workout-recovery-${label}-${Date.now()}@example.com`
  const registered = await request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',
    {
      data: { email, password, returnSecureToken: true },
    },
  )
  expect(registered.ok()).toBeTruthy()
  const { localId: uid } = (await registered.json()) as { localId: string }
  const now = Date.now()
  const entry = createRoutineExercise(weightExercise)
  const routine: Routine = {
    id: 'recovery-routine',
    ownerId: uid,
    createdAt: now,
    updatedAt: now,
    archived: false,
    schemaVersion: 1,
    revision: 1,
    mutationId: 'recovery-routine-original',
    previousMutationId: null,
    name: 'Recovery acceptance session',
    description: '',
    targetMuscles: [],
    exercises: [{ ...entry, restSeconds: 90, sets: [entry.sets[0]] }],
  }
  const batch = db.batch()
  batch.set(db.doc(`approvedUsers/${uid}`), { active: true })
  batch.set(db.doc(`users/${uid}`), {
    uid,
    displayName: 'Recovery Tester',
    onboardingCompleted: true,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  })
  batch.set(db.doc(`users/${uid}/preferences/main`), defaultPreferences())
  batch.set(db.doc(`users/${uid}/routines/${routine.id}`), routine)
  await batch.commit()
  return { email, uid, routine }
}

async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/today$/)
  await expect(headerSync(page)).toHaveText('Changes synced')
}

async function openTrain(page: Page) {
  await page.goto('/train')
  await expect(
    page.getByRole('heading', { name: 'Show up. Start somewhere.', exact: true, level: 1 }),
  ).toBeVisible()
  await expect(headerSync(page)).toHaveText('Changes synced')
}

async function start(page: Page, routine: Routine) {
  await page.getByRole('button', { name: `Start workout: ${routine.name}`, exact: true }).click()
  await expect(page).toHaveURL(/\/train\/[A-Za-z0-9_-]+$/)
  await expect(
    page.getByRole('heading', { name: routine.name, exact: true, level: 1 }),
  ).toBeVisible()
  return page.url().split('/').at(-1)!
}

async function log(page: Page, weight: number, reps = 8) {
  await page.getByLabel('Weight (kg)', { exact: true }).fill(String(weight))
  await page.getByLabel('Reps', { exact: true }).fill(String(reps))
  await checkbox(page).check()
  await expect(checkbox(page)).toBeChecked()
}

async function cloudSession(uid: string, id: string) {
  return (await db.doc(`users/${uid}/workoutSessions/${id}`).get()).data() as
    WorkoutSession | undefined
}

test('a second tab stays read only until the workout writer closes, then resumes its exact saved actuals', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'Desktop adverse concurrency coverage; mobile logging is covered by the main workout flow.',
  )
  test.setTimeout(120_000)
  const { email, uid, routine } = await seed(request, 'tabs')
  await signIn(page, email)
  await openTrain(page)
  const id = await start(page, routine)
  await log(page, 25)
  await expect(headerSync(page)).toHaveText('Changes synced')
  await expect
    .poll(async () => (await cloudSession(uid, id))?.exercises[0].sets[0].weightKg)
    .toBe(25)
  const second = await page.context().newPage()
  try {
    await second.goto(`/train/${id}`)
    await expect(
      second.getByRole('heading', { name: routine.name, exact: true, level: 1 }),
    ).toBeVisible()
    await expect(recovery(second)).toContainText('Another tab is editing your workouts')
    await expect(second.getByLabel('Weight (kg)', { exact: true })).toHaveValue('25')
    await expect(second.getByLabel('Reps', { exact: true })).toHaveValue('8')
    await expect(second.getByLabel('Weight (kg)', { exact: true })).toBeDisabled()
    await expect(second.getByLabel('Reps', { exact: true })).toBeDisabled()
    await expect(checkbox(second)).toBeDisabled()
    await second.screenshot({
      path: 'test-results/desktop-workout-second-tab-readonly.png',
      fullPage: true,
    })
    await page.close()
    await recovery(second)
      .getByRole('button', { name: 'Retry synchronization', exact: true })
      .click()
    await expect(recovery(second)).not.toBeVisible()
    await expect(checkbox(second)).toBeEnabled()
    await expect(checkbox(second)).toBeChecked()
    await checkbox(second).uncheck()
    await expect(second.getByLabel('Weight (kg)', { exact: true })).toBeEnabled()
    await expect(second.getByLabel('Reps', { exact: true })).toBeEnabled()
    await expect(second.getByLabel('Weight (kg)', { exact: true })).toHaveValue('25')
    await expect(second.getByLabel('Reps', { exact: true })).toHaveValue('8')
    await second.getByLabel('Reps', { exact: true }).fill('9')
    await checkbox(second).check()
    await expect(headerSync(second)).toHaveText('Changes synced')
    await expect.poll(async () => (await cloudSession(uid, id))?.exercises[0].sets[0].reps).toBe(9)
    expect((await cloudSession(uid, id))!.exercises[0].sets[0].weightKg).toBe(25)
    expect((await db.collection(`users/${uid}/workoutSessions`).get()).size).toBe(1)
  } finally {
    await second.close()
  }
})

test('conflicting offline devices retain the rejected actuals through reload and recovery download', async ({
  browser,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'Desktop adverse concurrency coverage; mobile logging is covered by the main workout flow.',
  )
  test.setTimeout(180_000)
  const { email, uid, routine } = await seed(request, 'devices')
  const firstContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
  const secondContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
  try {
    const first = await firstContext.newPage()
    const second = await secondContext.newPage()
    await signIn(first, email)
    await signIn(second, email)
    await openTrain(first)
    await openTrain(second)
    await firstContext.setOffline(true)
    await secondContext.setOffline(true)
    const firstId = await start(first, routine)
    const secondId = await start(second, routine)
    expect(secondId).not.toBe(firstId)
    await log(first, 10)
    await log(second, 30)
    await expect(headerSync(first)).toHaveText('Offline · cached data')
    await expect(headerSync(second)).toHaveText('Offline · cached data')
    expect((await db.collection(`users/${uid}/workoutSessions`).get()).size).toBe(0)
    await firstContext.setOffline(false)
    await expect(headerSync(first)).toHaveText('Changes synced', { timeout: 45_000 })
    await expect
      .poll(async () => (await cloudSession(uid, firstId))?.exercises[0].sets[0].weightKg)
      .toBe(10)
    await secondContext.setOffline(false)
    await expect(recovery(second)).toContainText(/rejected|changed|newer cloud/i, {
      timeout: 45_000,
    })
    await expect(second.getByLabel('Weight (kg)', { exact: true })).toHaveValue('30')
    await expect(second.getByLabel('Reps', { exact: true })).toHaveValue('8')
    await expect(checkbox(second)).toBeChecked()
    const winners = await db.collection(`users/${uid}/workoutSessions`).get()
    expect(winners.docs.map((snapshot) => snapshot.id)).toEqual([firstId])
    await second.reload()
    await expect(
      second.getByRole('heading', { name: routine.name, exact: true, level: 1 }),
    ).toBeVisible()
    await expect(recovery(second)).toContainText(/rejected|changed|not confirmed|newer cloud/i)
    await expect(second.getByLabel('Weight (kg)', { exact: true })).toHaveValue('30')
    await expect(second.getByLabel('Reps', { exact: true })).toHaveValue('8')
    await expect(checkbox(second)).toBeChecked()
    const downloaded = second.waitForEvent('download')
    await recovery(second)
      .getByRole('button', { name: 'Download workout recovery', exact: true })
      .click()
    const path = await (await downloaded).path()
    expect(path).not.toBeNull()
    const exported = JSON.parse(await readFile(path!, 'utf8')) as {
      ownerId: string
      checkpoints: WorkoutCheckpoint[]
    }
    expect(exported.ownerId).toBe(uid)
    const recovered = exported.checkpoints.find((checkpoint) => checkpoint.session.id === secondId)
    expect(recovered?.session.exercises[0].sets[0]).toMatchObject({
      weightKg: 30,
      reps: 8,
      completedAt: expect.any(Number),
    })
    await second.screenshot({
      path: 'test-results/desktop-workout-conflict-recovery.png',
      fullPage: true,
    })
    second.once('dialog', (dialog) => {
      void dialog.accept()
    })
    await recovery(second).getByRole('button', { name: 'Use cloud version', exact: true }).click()
    await expect(second).toHaveURL(/\/train$/)
    await expect(recovery(second)).not.toBeVisible()
    const resume = second.locator('.workout-resume').getByRole('link', { name: /Resume workout/ })
    await expect(resume).toHaveAttribute('href', `/train/${firstId}`)
    await resume.click()
    await expect(
      second.getByRole('heading', { name: routine.name, exact: true, level: 1 }),
    ).toBeVisible()
    await expect(second.getByLabel('Weight (kg)', { exact: true })).toHaveValue('10')
    await expect(second.getByLabel('Reps', { exact: true })).toHaveValue('8')
    expect(
      (await db.collection(`users/${uid}/workoutSessions`).get()).docs.map(
        (snapshot) => snapshot.id,
      ),
    ).toEqual([firstId])
    expect((await cloudSession(uid, firstId))!.exercises[0].sets[0].weightKg).toBe(10)
    expect(await cloudSession(uid, secondId)).toBeUndefined()
  } finally {
    await firstContext.close()
    await secondContext.close()
  }
})
