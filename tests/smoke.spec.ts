import { devices, expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const readLocalEnv = () => {
  const content = readFileSync('.env.local', 'utf8')
  const values = new Map<string, string>()

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) {
      continue
    }

    const equalsIndex = line.indexOf('=')

    if (equalsIndex === -1) {
      continue
    }

    const key = line.slice(0, equalsIndex).trim()
    const value = line.slice(equalsIndex + 1).trim()
    values.set(key, value)
  }

  return {
    demoEmail: values.get('VITE_DEMO_EMAIL') ?? '',
    demoPassword: values.get('VITE_DEMO_PASSWORD') ?? '',
  }
}

const { demoEmail, demoPassword } = readLocalEnv()
const iPhone13 = devices['iPhone 13']

const signInDemoUser = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(demoEmail)
  await page.getByLabel('Password').fill(demoPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('login, dashboard, and project detail render cleanly', async ({ page }) => {
  mkdirSync('artifacts/iteration-7', { recursive: true })

  await signInDemoUser(page)

  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Pine Court Storm Repair/i })).toBeVisible()
  await page.screenshot({
    path: 'artifacts/iteration-7/dashboard.png',
    fullPage: true,
  })

  await page.getByRole('link', { name: /Pine Court Storm Repair/i }).click()
  await expect(page).toHaveURL(/\/projects\//)
  await expect(page.getByRole('heading', { name: 'Pine Court Storm Repair' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tracking' })).toBeVisible()
  await expect(
    page.locator('.worksheet-desktop-shell').getByLabel('1.1.1 actual material cost'),
  ).toBeVisible()
  await page.screenshot({
    path: 'artifacts/iteration-7/project-active.png',
    fullPage: true,
  })

  await page.getByRole('link', { name: /Back/i }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: /Maple Street Roof Replacement/i })).toBeVisible()
  await page.getByRole('link', { name: /Maple Street Roof Replacement/i }).click()
  await expect(page).toHaveURL(/\/projects\//)
  await expect(page.getByRole('heading', { name: 'Maple Street Roof Replacement' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Estimate' })).toBeVisible()
  await expect(
    page.locator('.worksheet-desktop-shell').getByLabel('1.2.3 scope name'),
  ).toHaveValue('Architectural shingles')
  await expect(
    page.locator('.worksheet-desktop-shell').getByLabel('1.2.3 material cost'),
  ).toBeVisible()
  await page.screenshot({
    path: 'artifacts/iteration-7/project-bidding.png',
    fullPage: true,
  })

  await page.getByRole('link', { name: /Back/i }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  await signInDemoUser(page)
  await expect(page.getByRole('link', { name: /Pine Court Storm Repair/i })).toBeVisible()
})

test.describe('iphone layout', () => {
  test.use({
    viewport: iPhone13.viewport,
    userAgent: iPhone13.userAgent,
    deviceScaleFactor: iPhone13.deviceScaleFactor,
    isMobile: iPhone13.isMobile,
    hasTouch: iPhone13.hasTouch,
  })

  test('dashboard and worksheet mobile layouts render cleanly', async ({ page }) => {
    mkdirSync('artifacts/iteration-8-mobile', { recursive: true })

    await signInDemoUser(page)

    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
    await expect(page.locator('.dashboard-mobile-list').first()).toBeVisible()
    await page.screenshot({
      path: 'artifacts/iteration-8-mobile/dashboard-iphone13.png',
      fullPage: true,
    })

    await page.getByRole('link', { name: /Pine Court Storm Repair/i }).click()
    await expect(page.getByRole('heading', { name: 'Pine Court Storm Repair' })).toBeVisible()
    await expect(page.locator('.worksheet-mobile-shell')).toBeVisible()
    await page.locator('.worksheet-mobile-card-summary').first().click()
    await expect(
      page.locator('.worksheet-mobile-shell').getByLabel('1.1.1 actual material cost'),
    ).toBeVisible()
    await page.screenshot({
      path: 'artifacts/iteration-8-mobile/project-tracking-iphone13.png',
      fullPage: true,
    })

    await page.getByRole('link', { name: /Back/i }).click()
    await expect(page.getByRole('link', { name: /Maple Street Roof Replacement/i })).toBeVisible()
    await page.getByRole('link', { name: /Maple Street Roof Replacement/i }).click()
    await expect(page.getByRole('heading', { name: 'Maple Street Roof Replacement' })).toBeVisible()
    await expect(page.locator('.worksheet-mobile-shell')).toBeVisible()
    await page
      .locator('.worksheet-mobile-card-summary')
      .filter({ hasText: 'Architectural shingles' })
      .click()
    await expect(
      page.locator('.worksheet-mobile-shell').getByLabel('1.2.3 material cost'),
    ).toBeVisible()
    await page.screenshot({
      path: 'artifacts/iteration-8-mobile/project-estimate-iphone13.png',
      fullPage: true,
    })
  })
})
