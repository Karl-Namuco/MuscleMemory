import { test, expect } from '@playwright/test'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { defaultPreferences } from '../../src/types/profile'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const admin = initializeApp({ projectId: 'demo-muscle-memory' }, 'training-e2e')

test('configure exercises, routines, and durable splits with safe archive and offline recovery', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000)
  const email = `training-${testInfo.project.name}-${Date.now()}@example.com`
  const password = 'a memorable training passphrase'
  const created = await request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',
    {
      data: { email, password, returnSecureToken: true },
    },
  )
  expect(created.ok()).toBeTruthy()
  const { localId: uid } = (await created.json()) as { localId: string }
  const db = getFirestore(admin)
  const seed = db.batch()
  const now = Date.now()
  seed.set(db.doc(`approvedUsers/${uid}`), { active: true })
  seed.set(db.doc(`users/${uid}`), {
    uid,
    displayName: 'Training Tester',
    onboardingCompleted: true,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  })
  seed.set(db.doc(`users/${uid}/preferences/main`), defaultPreferences())
  await seed.commit()
  const errors: string[] = []
  const networkDiagnostics: string[] = []
  let networkTransition = false
  page.on('pageerror', (error) => {
    const cancelledStream =
      /^\/127\.0\.0\.1:8080\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel\?.* due to access control checks\.$/.test(
        error.message,
      )
    if (testInfo.project.name === 'iphone-webkit' && networkTransition && cancelledStream)
      networkDiagnostics.push(error.message)
    else errors.push(error.message)
  })
  async function visit(url: string) {
    networkTransition = true
    try {
      await page.goto(url)
    } finally {
      networkTransition = false
    }
  }
  await visit('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Training/ })).toBeVisible()
  await expect(page.getByText('Changes synced', { exact: true })).toBeVisible()

  await visit('/exercises')
  await page.getByRole('link', { name: 'Create exercise', exact: true }).click()
  await page.getByLabel('Exercise name').fill('Tempo dumbbell press')
  await page
    .getByRole('group', { name: /Primary muscles/ })
    .getByRole('button', { name: 'Chest', exact: true })
    .click()
  await page
    .getByLabel('Instructions', { exact: true })
    .fill('Lower with control.\nPress smoothly.')
  await page.getByRole('button', { name: 'Save exercise', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Tempo dumbbell press', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Changes synced', { exact: true })).toBeVisible()
  const exercises = await db.collection(`users/${uid}/customExercises`).get()
  expect(exercises.size).toBe(1)
  const exerciseId = exercises.docs[0].id

  await visit(`/plan/routines/new?exercise=${exerciseId}`)
  await page.getByLabel('Routine name', { exact: true }).fill('Upper strength')
  await page.getByLabel('Weight (kg)', { exact: false }).first().fill('20')
  await page.getByRole('button', { name: 'Save routine', exact: true }).click()
  await expect(
    page.getByText('Saved to your account. Your routine is ready to use in a split.', {
      exact: true,
    }),
  ).toBeVisible()
  const routines = await db.collection(`users/${uid}/routines`).get()
  expect(routines.size).toBe(1)
  expect(routines.docs[0].data().exercises[0].sets[0].targetWeightKg).toBe(20)
  const routineId = routines.docs[0].id

  await visit('/plan/splits')
  await page.getByRole('button', { name: 'New split', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Create a split' })
  await dialog.getByLabel('Split name').fill('My training rhythm')
  await dialog.getByLabel('Slot 1 label').fill('Upper day')
  await dialog.getByLabel('Routine for slot 1').selectOption(routineId)
  await dialog.getByRole('button', { name: 'Add slot', exact: true }).click()
  await dialog.getByLabel('Slot 2 label').fill('Recovery day')
  await dialog.getByRole('region', { name: 'Slot 2', exact: true }).getByLabel('Rest day').check()
  await dialog.getByRole('button', { name: 'Move slot 2 up' }).click()
  await expect(dialog.getByLabel('Slot 1 label')).toHaveValue('Recovery day')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'New split', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Create a split' })
  await expect(dialog.getByLabel('Split name')).toHaveValue('My training rhythm')
  await expect(
    dialog.getByText('Your unfinished split was restored from this device.', { exact: true }),
  ).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await dialog.getByRole('button', { name: 'Save split', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  let card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'My training rhythm', exact: true }) })
  await card.getByRole('button', { name: 'Make active', exact: true }).click()
  await expect(card.getByText('Active split', { exact: true })).toBeVisible()
  await expect(page.getByText('Changes synced', { exact: true })).toBeVisible()
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-splits.png`,
    fullPage: true,
  })

  await page
    .getByRole('navigation', { name: 'Training setup', exact: true })
    .getByRole('link', { name: 'Overview', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'My training rhythm', exact: true })).toBeVisible()
  await expect(page.getByText('Recovery day', { exact: true })).toBeVisible()
  await page.screenshot({ path: `test-results/${testInfo.project.name}-plan.png`, fullPage: true })
  if (testInfo.project.name === 'desktop-chromium') {
    await page.setViewportSize({ width: 834, height: 1112 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    await page.screenshot({ path: 'test-results/tablet-plan.png', fullPage: true })
  }

  await page.getByRole('link', { name: 'Manage your split', exact: true }).click()
  card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'My training rhythm', exact: true }) })
  networkTransition = true
  await page.context().setOffline(true)
  await card.getByRole('button', { name: 'Edit split', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Edit your split' })
  await dialog.getByLabel('Split name').fill('Offline training rhythm')
  await dialog.getByRole('button', { name: 'Save split', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Offline training rhythm', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Training save recovery', exact: true }),
  ).toBeVisible()
  await page.context().setOffline(false)
  await expect(page.getByText('Changes synced', { exact: true })).toBeVisible()
  networkTransition = false
  await expect(
    page.getByRole('region', { name: 'Training save recovery', exact: true }),
  ).not.toBeVisible()
  await expect
    .poll(async () => (await db.collection(`users/${uid}/splits`).get()).docs[0].data().name)
    .toBe('Offline training rhythm')

  card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Offline training rhythm', exact: true }) })
  await card.getByRole('button', { name: 'Archive Offline training rhythm', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Archive this split?' })
    .getByRole('button', { name: 'Archive split', exact: true })
    .click()
  await expect(card).not.toBeVisible()
  await expect(page.getByText('Changes synced', { exact: true })).toBeVisible()
  expect(
    (await db.doc(`users/${uid}/trainingSettings/current`).get()).data()?.activeSplitId,
  ).toBeNull()
  expect((await db.doc(`users/${uid}/routines/${routineId}`).get()).data()?.archived).toBe(false)
  await page.getByLabel('Show archived').check()
  await page.getByRole('button', { name: 'Restore Offline training rhythm', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Restore this split?' })
    .getByRole('button', { name: 'Restore split', exact: true })
    .click()
  await page.getByLabel('Show archived').uncheck()
  await expect(
    page.getByRole('heading', { name: 'Offline training rhythm', exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: /^Push \/ Pull \/ Legs/ }).click()
  await page
    .getByRole('dialog', { name: 'Push / Pull / Legs', exact: true })
    .getByRole('button', { name: 'Add template', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Push / Pull / Legs', exact: true })).toBeVisible()
  await expect(page.getByText('Changes synced', { exact: true })).toBeVisible()
  expect((await db.collection(`users/${uid}/routines`).get()).size).toBe(4)
  await page.setViewportSize({ width: 320, height: 740 })
  await page.getByRole('button', { name: 'New split', exact: true }).click()
  const narrowEditor = page.getByRole('dialog', { name: 'Create a split' })
  await expect(narrowEditor.getByLabel('Split name')).toHaveValue('')
  await narrowEditor.getByLabel('Split name').fill('A'.repeat(120))
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await expect
    .poll(() => narrowEditor.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true)
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-split-editor-narrow.png`,
    fullPage: true,
  })
  await narrowEditor.getByRole('button', { name: 'Close', exact: true }).click()
  if (networkDiagnostics.length)
    await testInfo.attach('webkit-firestore-interruption-diagnostics', {
      body: JSON.stringify(networkDiagnostics, null, 2),
      contentType: 'application/json',
    })
  expect(errors).toEqual([])
})
