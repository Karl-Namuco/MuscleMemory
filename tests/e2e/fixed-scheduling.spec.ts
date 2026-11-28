import { test, expect } from '@playwright/test'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { EXERCISES } from '../../src/data/exercises'
import { addDays, localDate } from '../../src/domain/scheduling/fixed'
import { createRoutineExercise } from '../../src/domain/training/helpers'
import { defaultPreferences } from '../../src/types/profile'
import type { FixedSchedule } from '../../src/types/fixedScheduling'
import type { Routine, TrainingSplit } from '../../src/types/training'
import type { WorkoutSession } from '../../src/types/workout'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
const admin = initializeApp({ projectId: 'demo-muscle-memory' }, 'fixed-scheduling-e2e')

test('Fixed calendar edits and offline full/partial completions retain dated identities and convert pounds to kilograms', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(300_000)
  const db = getFirestore(admin)
  const email = `fixed-${testInfo.project.name}-${Date.now()}@example.com`
  const password = 'a memorable training passphrase'
  const registered = await request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',
    { data: { email, password, returnSecureToken: true } },
  )
  expect(registered.ok()).toBeTruthy()
  const { localId: uid } = (await registered.json()) as { localId: string }
  const now = Date.now()
  const today = localDate(now, 'Asia/Manila')
  const startDate = addDays(today, -3)
  const metadata = {
    ownerId: uid,
    schemaVersion: 1 as const,
    revision: 1,
    mutationId: 'fixed-seed',
    previousMutationId: null,
    createdAt: now,
    updatedAt: now,
    archived: false,
  }
  const exercise = EXERCISES.find((candidate) => candidate.trackingType === 'weight-reps')!
  const entry = createRoutineExercise(exercise)
  const routine: Routine = {
    ...metadata,
    id: 'fixed-routine',
    name: 'Dated strength session',
    description: '',
    targetMuscles: [],
    exercises: [{ ...entry, restSeconds: 0, sets: entry.sets.slice(0, 2) }],
  }
  const split: TrainingSplit = {
    ...metadata,
    id: 'fixed-split',
    name: 'Steady fixed cycle',
    description: '',
    mode: 'fixed',
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
    displayName: 'Fixed Tester',
    onboardingCompleted: true,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  })
  seed.set(db.doc(`users/${uid}/preferences/main`), {
    ...defaultPreferences(),
    weightUnit: 'kg',
    timeZone: 'Asia/Manila',
    preferredDays: [],
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
    const cancelledRequest =
      /^\/127\.0\.0\.1:(8080\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel\?.*|9099\/identitytoolkit\.googleapis\.com\/v1\/accounts:lookup\?key=demo-api-key) due to access control checks\.$/.test(
        error.message,
      )
    if (testInfo.project.name === 'iphone-webkit' && networkTransition && cancelledRequest)
      networkDiagnostics.push(error.message)
    else errors.push(error.message)
  })
  const headerSync = page.locator('.topbar .sync-status')
  const nextWorkout = page.getByRole('region', { name: 'Your next workout', exact: true })
  const calendarRef = db.doc(`users/${uid}/fixedSchedules/${split.id}`)
  const cloudCalendar = async () => (await calendarRef.get()).data() as FixedSchedule | undefined
  const cloudSession = async (id: string) =>
    (await db.doc(`users/${uid}/workoutSessions/${id}`).get()).data() as WorkoutSession | undefined
  async function visit(path: string) {
    networkTransition = true
    try {
      await page.goto(path)
    } finally {
      networkTransition = false
    }
  }
  async function synced() {
    await expect(headerSync).toHaveText('Changes synced', { timeout: 45_000 })
  }
  async function selectWeekOf(date: string) {
    const target = new Date(`${date}T00:00:00Z`)
    const targetStart = addDays(date, -((target.getUTCDay() + 6) % 7))
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const heading = page.getByRole('heading', { name: /^Week of / })
      const current = (await heading.innerText()).replace('Week of ', '')
      if (current === targetStart) return
      await page
        .getByRole('button', {
          name: current < targetStart ? 'Next week' : 'Previous week',
          exact: true,
        })
        .click()
    }
    throw new Error(`Could not display the week of ${date}`)
  }
  function datedRow(label: string, date: string) {
    return page.getByRole('article', { name: `${label} on ${date}`, exact: true }).first()
  }
  async function completeSet(index: number, pounds = '100') {
    await page
      .getByLabel(`Weight unit for set ${index + 1} of ${exercise.name}`, { exact: true })
      .selectOption('lb')
    await page.getByLabel('Weight (lb)', { exact: true }).nth(index).fill(pounds)
    await page.getByLabel('Reps', { exact: true }).nth(index).fill('8')
    await expect(
      page.getByText(`≈ ${pounds === '100' ? '45.3592' : '49.8952'} kg`, {
        exact: true,
      }),
    ).toBeVisible()
    await page
      .getByRole('checkbox', {
        name: `Complete set ${index + 1} of ${exercise.name}`,
        exact: true,
      })
      .check()
  }
  async function startRecommended() {
    await nextWorkout.getByRole('button', { name: 'Start scheduled workout', exact: true }).click()
    await expect(page).toHaveURL(/\/train\/[A-Za-z0-9_-]+$/)
    await synced()
    return page.url().split('/').at(-1)!
  }
  async function finishOffline(id: string, expectedSets: number, count?: boolean) {
    const before = (await cloudCalendar())!
    await page.getByRole('button', { name: 'Finish workout', exact: true }).first().click()
    const finish = page.getByRole('dialog', { name: 'Finish this workout?', exact: true })
    await expect(finish).toContainText(`${expectedSets} of 2 sets completed`)
    const inclusion = finish.getByRole('checkbox', {
      name: 'Count this workout toward my split',
      exact: true,
    })
    if (count === undefined) await expect(inclusion).toHaveCount(0)
    else {
      await expect(inclusion).not.toBeChecked()
      if (count) await inclusion.check()
    }
    await finish.getByRole('button', { name: 'Finish and save', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/history/${id}$`))
    await expect(
      page.getByText(/Saved on this device.*waiting for cloud confirmation/),
    ).toBeVisible()
    expect((await cloudSession(id))?.status).toBe('active')
    expect((await cloudCalendar())?.revision).toBe(before.revision)
    await page.context().setOffline(false)
    await synced()
    networkTransition = false
    await expect.poll(async () => (await cloudSession(id))?.status).toBe('completed')
    const session = (await cloudSession(id))!
    const calendar = (await cloudCalendar())!
    const occurrence = calendar.occurrences.find(
      (item) => item.id === session.fixedContext?.occurrenceId,
    )!
    expect(session.exercises[0].sets[0].weightKg).toBe(45.3592)
    expect(session.exercises[0].sets[0].inputWeightUnit).toBe('lb')
    expect(session.countsForSplit).toBe(count ?? true)
    if (count === false) {
      expect(occurrence.status).toBe('planned')
      expect(calendar.revision).toBe(before.revision)
    } else {
      expect(occurrence.status).toBe('completed')
      expect(occurrence.completionSessionId).toBe(id)
      expect(occurrence.resolvedAt).toBe(session.endedAt)
      expect(calendar.revision).toBe(before.revision + 1)
      expect(calendar.action).toMatchObject({
        kind: 'complete',
        sessionId: id,
        occurrenceId: occurrence.id,
      })
    }
    return session
  }

  await visit('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/today$/)
  await synced()
  await expect(nextWorkout).toContainText('Create a 28-day calendar')
  await nextWorkout.getByRole('link', { name: 'View or adjust calendar' }).click()
  await page.getByLabel('Calendar start date', { exact: true }).fill(startDate)
  for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
    await page.getByRole('checkbox', { name: day, exact: true }).check()
  await page.getByRole('button', { name: 'Create calendar', exact: true }).click()
  await expect.poll(async () => (await cloudCalendar())?.occurrences.length).toBe(28)
  await synced()
  let calendar = (await cloudCalendar())!
  expect(calendar.timeZone).toBe('Asia/Manila')
  expect(calendar.preferredDays).toEqual([0, 1, 2, 3, 4, 5, 6])
  const generationId = calendar.generationId
  await expect(page.getByRole('region', { name: `Today, ${today}` })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Missed workouts', exact: true })).toContainText(
    'First strength',
  )
  await selectWeekOf(addDays(startDate, 6))
  const skipped = calendar.occurrences[6]
  await datedRow(skipped.label, skipped.scheduledDate)
    .getByRole('button', { name: 'Skip', exact: true })
    .click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm skip', exact: true }).click()
  await expect.poll(async () => (await cloudCalendar())?.occurrences[6].status).toBe('skipped')
  await synced()
  const moved = calendar.occurrences[4]
  await selectWeekOf(moved.scheduledDate)
  await datedRow(moved.label, moved.scheduledDate)
    .getByRole('button', { name: 'Move', exact: true })
    .click()
  await page.getByLabel('New date', { exact: true }).fill(skipped.scheduledDate)
  await page.getByRole('dialog').getByRole('button', { name: 'Save change', exact: true }).click()
  await expect
    .poll(async () => (await cloudCalendar())?.occurrences[4].scheduledDate)
    .toBe(skipped.scheduledDate)
  await synced()
  const swapped = calendar.occurrences[7]
  const other = calendar.occurrences[8]
  await selectWeekOf(swapped.scheduledDate)
  await datedRow(swapped.label, swapped.scheduledDate)
    .getByRole('button', { name: 'Swap', exact: true })
    .click()
  await page.getByLabel('Swap with', { exact: true }).selectOption(other.id)
  await page.getByRole('dialog').getByRole('button', { name: 'Save change', exact: true }).click()
  await expect
    .poll(async () => (await cloudCalendar())?.occurrences[7].scheduledDate)
    .toBe(other.scheduledDate)
  await synced()
  calendar = (await cloudCalendar())!
  expect(calendar.occurrences[8].scheduledDate).toBe(swapped.scheduledDate)
  expect(calendar.occurrences[4].originalDate).toBe(moved.originalDate)
  expect(calendar.generationId).toBe(generationId)

  await visit('/today')
  await expect(nextWorkout).toContainText(`overdue from ${startDate}`)
  const fullId = await startRecommended()
  networkTransition = true
  await page.context().setOffline(true)
  await completeSet(0)
  await completeSet(1, '110')
  const full = await finishOffline(fullId, 2)
  expect(full.exercises[0].sets[1].weightKg).toBe(49.8952)
  expect(full.fixedContext?.occurrenceId).toBe(calendar.occurrences[0].id)
  expect(full.splitContext).toMatchObject({ slotId: 'first-slot', sequence: 0 })

  await visit('/train')
  const partialId = await startRecommended()
  networkTransition = true
  await page.context().setOffline(true)
  await completeSet(0)
  const partial = await finishOffline(partialId, 1, false)
  expect(partial.fixedContext?.occurrenceId).toBe(calendar.occurrences[1].id)
  await visit('/train')
  const countedId = await startRecommended()
  networkTransition = true
  await page.context().setOffline(true)
  await completeSet(0)
  const counted = await finishOffline(countedId, 1, true)
  expect(counted.fixedContext?.occurrenceId).toBe(partial.fixedContext?.occurrenceId)

  await visit('/plan/calendar')
  networkTransition = true
  try {
    await page.reload()
  } finally {
    networkTransition = false
  }
  await synced()
  await page.getByRole('button', { name: 'This week', exact: true }).click()
  await selectWeekOf(startDate)
  await expect(datedRow('First strength', startDate)).toContainText('completed')
  expect((await cloudCalendar())?.generationId).toBe(generationId)
  expect((await db.collection(`users/${uid}/workoutSessions`).get()).size).toBe(3)
  await page.setViewportSize({ width: 320, height: 740 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-fixed-calendar.png`,
    fullPage: true,
  })
  if (networkDiagnostics.length)
    await testInfo.attach('webkit-firestore-interruption-diagnostics', {
      body: JSON.stringify(networkDiagnostics, null, 2),
      contentType: 'application/json',
    })
  expect(errors).toEqual([])
})
