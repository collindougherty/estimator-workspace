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

test('login, dashboard, project list, and item detail render cleanly', async ({ page }) => {
  mkdirSync('artifacts/iteration-9-alex-flow', { recursive: true })

  await signInDemoUser(page)

  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Pine Court Storm Repair/i })).toBeVisible()
  await page.screenshot({
    path: 'artifacts/iteration-9-alex-flow/dashboard.png',
    fullPage: true,
  })

  await page.getByRole('link', { name: /Pine Court Storm Repair/i }).click()
  await expect(page).toHaveURL(/\/projects\//)
  await expect(page.getByRole('heading', { name: 'Pine Court Storm Repair' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Terminal items' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Tear off and disposal/i })).toBeVisible()
  await page.screenshot({
    path: 'artifacts/iteration-9-alex-flow/project-tracking-list.png',
    fullPage: true,
  })

  await page.getByRole('link', { name: /Tear off and disposal/i }).click()
  await expect(page).toHaveURL(/\/projects\/.+\/items\//)
  await expect(page.getByRole('heading', { name: 'Tear off and disposal' })).toBeVisible()
  await expect(page.getByLabel('Actual quantity')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Billing + overhead' })).toBeVisible()
  await page.screenshot({
    path: 'artifacts/iteration-9-alex-flow/item-tracking-detail.png',
    fullPage: true,
  })

  await page.getByRole('link', { name: /Project items/i }).click()
  await expect(page.getByRole('heading', { name: 'Terminal items' })).toBeVisible()
  await page.getByRole('link', { name: /Back/i }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: /Maple Street Roof Replacement/i })).toBeVisible()
  await page.getByRole('link', { name: /Maple Street Roof Replacement/i }).click()
  await expect(page).toHaveURL(/\/projects\//)
  await expect(page.getByRole('heading', { name: 'Maple Street Roof Replacement' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Terminal items' })).toBeVisible()
  await page.getByRole('link', { name: /Architectural shingles/i }).click()
  await expect(page).toHaveURL(/\/projects\/.+\/items\//)
  await expect(page.getByRole('heading', { name: 'Architectural shingles' })).toBeVisible()
  await expect(page.getByLabel('Unit of measure')).toBeVisible()
  await expect(page.getByLabel('Cost / unit')).toBeVisible()
  await page.screenshot({
    path: 'artifacts/iteration-9-alex-flow/item-estimate-detail.png',
    fullPage: true,
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
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

  test('dashboard, terminal items, and item detail mobile layouts render cleanly', async ({
    page,
  }) => {
    mkdirSync('artifacts/iteration-9-alex-flow-mobile', { recursive: true })

    await signInDemoUser(page)

    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
    await expect(page.locator('.dashboard-mobile-list').first()).toBeVisible()
    await page.screenshot({
      path: 'artifacts/iteration-9-alex-flow-mobile/dashboard-iphone13.png',
      fullPage: true,
    })

    await page.getByRole('link', { name: /Pine Court Storm Repair/i }).click()
    await expect(page.getByRole('heading', { name: 'Pine Court Storm Repair' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Terminal items' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Tear off and disposal/i })).toBeVisible()
    await page.screenshot({
      path: 'artifacts/iteration-9-alex-flow-mobile/project-tracking-list-iphone13.png',
      fullPage: true,
    })

    await page.getByRole('link', { name: /Tear off and disposal/i }).click()
    await expect(page.getByLabel('Actual quantity')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Billing + overhead' })).toBeVisible()
    await page.screenshot({
      path: 'artifacts/iteration-9-alex-flow-mobile/item-tracking-detail-iphone13.png',
      fullPage: true,
    })

    await page.getByRole('link', { name: /Project items/i }).click()
    await page.getByRole('link', { name: /Back/i }).click()
    await expect(page.getByRole('link', { name: /Maple Street Roof Replacement/i })).toBeVisible()
    await page.getByRole('link', { name: /Maple Street Roof Replacement/i }).click()
    await expect(page.getByRole('heading', { name: 'Maple Street Roof Replacement' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Terminal items' })).toBeVisible()
    await page.getByRole('link', { name: /Architectural shingles/i }).click()
    await expect(page.getByLabel('Unit of measure')).toBeVisible()
    await expect(page.getByLabel('Cost / unit')).toBeVisible()
    await page.screenshot({
      path: 'artifacts/iteration-9-alex-flow-mobile/item-estimate-detail-iphone13.png',
      fullPage: true,
    })
  })
})
