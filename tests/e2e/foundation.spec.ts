import { test, expect } from '@playwright/test'

test('private account onboarding, durable preferences, navigation, and safe sign-out', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000)
  const email = `foundation-${testInfo.project.name}-${Date.now()}@example.com`
  const password = 'a memorable training passphrase'
  const pageErrors: string[] = []
  const navigationDiagnostics: string[] = []
  let leavingDocument = false
  page.on('pageerror', (error) => {
    // WebKit reports cancelled Firestore fetches as errors when leaving a document.
    // Firebase maintainer explanation: https://github.com/firebase/firebase-js-sdk/issues/3708
    // The same diagnostic outside an explicit reload/sign-out still fails this test.
    const cancelledStream =
      /^\/127\.0\.0\.1:8080\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel\?.* due to access control checks\.$/.test(
        error.message,
      )
    if (testInfo.project.name === 'iphone-webkit' && leavingDocument && cancelledStream) {
      navigationDiagnostics.push(error.message)
    } else pageErrors.push(error.message)
  })
  async function reloadPage() {
    leavingDocument = true
    try {
      await page.reload()
    } finally {
      leavingDocument = false
    }
  }
  await page.goto('/today')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole('link', { name: 'Create an account' }).click()
  await expect(page).toHaveURL(/\/register$/)
  await expect(page.getByRole('heading', { name: 'Make it a habit.' })).toBeVisible()
  await page.getByLabel('Email address').fill(email)
  await expect(page.getByLabel('Email address')).toHaveValue(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password', { exact: true }).fill(password)
  const registered = page.waitForResponse(
    (response) => response.url().includes('accounts:signUp') && response.status() === 200,
  )
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  const { localId } = (await (await registered).json()) as { localId: string }
  await expect(page.getByText('Your account is created.', { exact: false })).toBeVisible()
  const approval = await request.patch(
    `http://127.0.0.1:8080/v1/projects/demo-muscle-memory/databases/(default)/documents/approvedUsers/${localId}`,
    {
      headers: { Authorization: 'Bearer owner' },
      data: { fields: { active: { booleanValue: true } } },
    },
  )
  expect(approval.ok()).toBeTruthy()
  await expect(page).toHaveURL(/\/onboarding$/)
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-onboarding.png`,
    fullPage: true,
  })
  await page.getByLabel('What should we call you?').fill('Alex Rivera')
  await page.getByLabel('Time zone').selectOption('Asia/Manila')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'What are you working toward?' })).toBeVisible()
  await reloadPage()
  await expect(page.getByRole('heading', { name: 'What are you working toward?' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Usual workout length').fill('45')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Set up your way to train.' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Let’s get started' }).click()
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: /Alex/ })).toBeVisible()
  await expect(page.getByText('45 minutes', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await page.screenshot({ path: `test-results/${testInfo.project.name}-today.png`, fullPage: true })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
  await reloadPage()
  await expect(page.getByRole('heading', { name: /Alex/ })).toBeVisible()
  const navigation = page.getByRole('navigation', {
    name: testInfo.project.name === 'iphone-webkit' ? 'Mobile navigation' : 'Main navigation',
    exact: true,
  })
  await navigation.getByRole('link', { name: 'Plan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Built around your life.' })).toBeVisible()
  await navigation.getByRole('link', { name: 'Train', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Show up. Start somewhere.' })).toBeVisible()
  await navigation.getByRole('link', { name: 'Progress', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your story, in progress.' })).toBeVisible()
  await navigation.getByRole('link', { name: 'Profile', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Alex Rivera', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Edit preferences' }).click()
  await expect(page.getByLabel('What should we call you?')).toHaveValue('Alex Rivera')
  await page.getByLabel('What should we call you?').fill('Alex R')
  for (const heading of [
    'What are you working toward?',
    'Find your training rhythm.',
    'Set up your way to train.',
    'Your starting point.',
  ]) {
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByRole('heading', { name: 'Alex R', exact: true })).toBeVisible()
  await expect(
    page.getByText('Your preferences are saved to your account.', { exact: true }),
  ).toBeVisible()
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-profile.png`,
    fullPage: true,
  })
  leavingDocument = true
  try {
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  } finally {
    leavingDocument = false
  }
  await expect(page.getByText('Alex R', { exact: true })).not.toBeVisible()
  if (navigationDiagnostics.length)
    await testInfo.attach('webkit-firestore-navigation-diagnostics', {
      body: JSON.stringify(navigationDiagnostics, null, 2),
      contentType: 'application/json',
    })
  expect(pageErrors).toEqual([])
})

test('registration controls fit a narrow screen and remain labeled', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/register')
  await expect(page.getByRole('heading', { name: 'Make it a habit.' })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByText('Enter your email address.', { exact: true })).toBeVisible()
})
