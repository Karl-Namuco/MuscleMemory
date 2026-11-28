import { test, expect } from '@playwright/test'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { defaultPreferences } from '../../src/types/profile'
import type { Routine } from '../../src/types/training'
import type { WorkoutSession } from '../../src/types/workout'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const admin = initializeApp({ projectId: 'demo-muscle-memory' }, 'inline-exercise-e2e')

test('create an exercise from a routine, recover the routine, and log pounds as kilograms', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000)
  const email = `custom-${testInfo.project.name}-${Date.now()}@example.com`
  const password = 'a memorable custom exercise passphrase'
  const created = await request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',
    { data: { email, password, returnSecureToken: true } },
  )
  expect(created.ok()).toBeTruthy()
  const { localId: uid } = (await created.json()) as { localId: string }
  const db = getFirestore(admin)
  const now = Date.now()
  const seed = db.batch()
  seed.set(db.doc(`approvedUsers/${uid}`), { active: true })
  seed.set(db.doc(`users/${uid}`), {
    uid,
    displayName: 'Custom Exercise Tester',
    onboardingCompleted: true,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  })
  seed.set(db.doc(`users/${uid}/preferences/main`), defaultPreferences())
  await seed.commit()

  const errors: string[] = []
  const diagnostics: string[] = []
  let navigating = false
  page.on('pageerror', (error) => {
    const cancelledStream =
      /^\/127\.0\.0\.1:8080\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel\?.* due to access control checks\.$/.test(
        error.message,
      )
    if (testInfo.project.name === 'iphone-webkit' && navigating && cancelledStream)
      diagnostics.push(error.message)
    else errors.push(error.message)
  })
  async function visit(path: string) {
    navigating = true
    try {
      await page.goto(path)
    } finally {
      navigating = false
    }
  }
  async function reload() {
    navigating = true
    try {
      // The routine editor warns before leaving unsaved work; accept the deliberate reload.
      page.once('dialog', (dialog) => void dialog.accept())
      await page.reload()
    } finally {
      navigating = false
    }
  }
  const headerSync = page.locator('.topbar .sync-status')
  await visit('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/today$/)
  await expect(headerSync).toHaveText('Changes synced')

  await visit('/plan/routines/new')
  await page.getByLabel('Routine name', { exact: true }).fill('My personal cable session')
  await page.getByLabel('Description', { exact: false }).fill('Keep these unsaved routine notes.')
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Add an exercise', exact: true })
  await dialog.getByLabel('Search exercises').fill('My cross-body cable press')
  await dialog.getByRole('button', { name: 'Create your own exercise', exact: true }).click()
  await expect(dialog.getByLabel('Exercise name')).toHaveValue('My cross-body cable press')
  await dialog.getByLabel('Equipment', { exact: true }).selectOption('Cable')
  await dialog.getByLabel('Primary muscle', { exact: true }).selectOption('Chest')
  await page.setViewportSize({ width: 320, height: 740 })
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-inline-custom-exercise-320.png`,
    fullPage: true,
  })
  await dialog.getByRole('button', { name: 'Create and add exercise', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'My cross-body cable press' })).toBeVisible()
  await expect(page.getByLabel('Routine name', { exact: true })).toHaveValue(
    'My personal cable session',
  )
  await expect(page.getByLabel('Description', { exact: false })).toHaveValue(
    'Keep these unsaved routine notes.',
  )
  await expect
    .poll(async () => (await db.collection(`users/${uid}/customExercises`).get()).size)
    .toBe(1)
  const custom = (await db.collection(`users/${uid}/customExercises`).get()).docs[0]
  expect(custom.data()).toMatchObject({
    name: 'My cross-body cable press',
    equipment: 'Cable',
    trackingType: 'weight-reps',
    primaryMuscles: ['Chest'],
  })

  // The routine has not been saved yet. Its inserted custom exercise must survive reload.
  await reload()
  await expect(
    page.getByText('Your routine draft was restored from this device.', { exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('Routine name', { exact: true })).toHaveValue(
    'My personal cable session',
  )
  await expect(page.getByRole('heading', { name: 'My cross-body cable press' })).toBeVisible()
  await page.getByRole('button', { name: 'Save routine', exact: true }).click()
  await expect(
    page.getByText('Saved to your account. Your routine is ready to use in a split.', {
      exact: true,
    }),
  ).toBeVisible()
  const routines = await db.collection(`users/${uid}/routines`).get()
  expect(routines.size).toBe(1)
  const routine = routines.docs[0].data() as Routine
  expect(routine.exercises[0].exerciseId).toBe(custom.id)

  await visit('/train')
  await page
    .getByRole('button', { name: 'Start workout: My personal cable session', exact: true })
    .click()
  await expect(page).toHaveURL(/\/train\/[A-Za-z0-9_-]+$/)
  const sessionId = page.url().split('/').at(-1)!
  const cloudSession = async () =>
    (await db.doc(`users/${uid}/workoutSessions/${sessionId}`).get()).data() as
      WorkoutSession | undefined
  const weightUnit = page.getByRole('combobox', {
    name: 'Weight unit for set 1 of My cross-body cable press',
    exact: true,
  })
  await weightUnit.selectOption('lb')
  await page.getByLabel('Weight (lb)', { exact: true }).fill('100.125')
  await expect(page.getByText('≈ 45.4159 kg', { exact: true })).toBeVisible()
  await page.getByLabel('Reps', { exact: true }).first().fill('8')
  await expect.poll(async () => (await cloudSession())?.exercises[0].sets[0].weightKg).toBe(45.4159)
  await weightUnit.selectOption('kg')
  await expect(page.getByLabel('Weight (kg)', { exact: true }).first()).toHaveValue('45.4159')
  await weightUnit.selectOption('lb')
  await expect
    .poll(async () => (await cloudSession())?.exercises[0].sets[0].inputWeightUnit)
    .toBe('lb')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-custom-exercise-weight-320.png`,
    fullPage: true,
  })
  await expect(headerSync).toHaveText('Changes synced')
  await reload()
  await expect(weightUnit).toHaveValue('lb')
  await expect(page.getByLabel('Weight (lb)', { exact: true })).toHaveValue('100.12')
  await expect(page.getByText('≈ 45.4159 kg', { exact: true })).toBeVisible()
  await page
    .getByRole('checkbox', { name: 'Complete set 1 of My cross-body cable press', exact: true })
    .check()
  await page.getByRole('button', { name: 'Finish workout', exact: true }).first().click()
  dialog = page.getByRole('dialog', { name: 'Finish this workout?', exact: true })
  await dialog.getByRole('button', { name: 'Finish and save', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/history/${sessionId}$`))
  await expect(page.getByText('45.4159 kg × 8 reps', { exact: true })).toBeVisible()
  await expect.poll(async () => (await cloudSession())?.status).toBe('completed')
  expect((await cloudSession())?.exercises[0].sets[0]).toMatchObject({
    weightKg: 45.4159,
    inputWeightUnit: 'lb',
    reps: 8,
    completedAt: expect.any(Number),
  })
  if (diagnostics.length)
    await testInfo.attach('webkit-firestore-interruption-diagnostics', {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: 'application/json',
    })
  expect(errors).toEqual([])
})
