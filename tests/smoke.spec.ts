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
  await expect(page.getByText('ProfitBuilder')).toBeVisible()
  await page.getByLabel('Email').fill(demoEmail)
  await page.getByLabel('Password').fill(demoPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('dashboard, tracking fallback, and two-page bid builder render cleanly', async ({ page }) => {
  mkdirSync('artifacts/iteration-11-builder-layout', { recursive: true })

  await signInDemoUser(page)

  await expect(page.getByRole('heading', { name: 'ProfitBuilder' })).toBeVisible()
  await expect(page.locator('.app-brand-mark')).toBeVisible()
  await expect(page.getByText('ProfitBuilder')).toBeVisible()
  await expect(page.getByRole('link', { name: /Pine Court Storm Repair/i })).toBeVisible()
  await page.screenshot({
    path: 'artifacts/iteration-11-builder-layout/dashboard.png',
    fullPage: true,
  })

  await page.getByRole('link', { name: /Pine Court Storm Repair/i }).click()
  await expect(page.getByRole('heading', { name: 'Pine Court Storm Repair' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Terminal items' })).toBeVisible()
  await expect(page.locator('.tracking-table')).toBeVisible()
  await page.screenshot({
    path: 'artifacts/iteration-11-builder-layout/project-tracking-list.png',
    fullPage: true,
  })

  await page.getByRole('button', { name: /Labor/i }).first().click()
  const laborActualsDialog = page.getByRole('dialog')
  await expect(laborActualsDialog.getByRole('heading', { name: 'Labor actuals' })).toBeVisible()
  await laborActualsDialog.screenshot({
    path: 'artifacts/iteration-11-builder-layout/tracking-labor-actuals.png',
  })
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('link', { name: 'Advanced' }).first().click()
  await expect(page).toHaveURL(/\/projects\/.+\/items\//)
  await expect(page.getByRole('heading', { name: 'Quantity + material' })).toBeVisible()
  await expect(page.getByLabel('Actual quantity')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Billing + overhead' })).toBeVisible()
  await page.screenshot({
    path: 'artifacts/iteration-11-builder-layout/item-tracking-detail.png',
    fullPage: true,
  })

  await page.getByRole('link', { name: /Project items/i }).click()
  await expect(page.getByRole('heading', { name: 'Terminal items' })).toBeVisible()
  await page.getByRole('link', { name: /Back/i }).click()

  await expect(page.getByRole('link', { name: /Maple Street Roof Replacement/i })).toBeVisible()
  await page.getByRole('link', { name: /Maple Street Roof Replacement/i }).click()
  await expect(page.getByRole('heading', { name: 'Maple Street Roof Replacement' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Bid builder' })).toBeVisible()
  await expect(page.locator('.project-builder-table')).toBeVisible()
  await expect(page.getByRole('button', { name: /Materials/i }).first()).toBeVisible()
  await page.screenshot({
    path: 'artifacts/iteration-11-builder-layout/project-bid-builder.png',
    fullPage: true,
  })

  await page.getByRole('button', { name: /Materials/i }).first().click()
  const materialsDialog = page.getByRole('dialog')
  await expect(materialsDialog.getByRole('heading', { name: 'Materials editor' })).toBeVisible()
  await expect(materialsDialog.getByRole('searchbox')).toBeVisible()
  await materialsDialog.screenshot({
    path: 'artifacts/iteration-11-builder-layout/materials-picker.png',
  })
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: 'Company library' }).click()
  const libraryDialog = page.getByRole('dialog')
  await expect(libraryDialog.getByRole('heading', { name: 'Company library' })).toBeVisible()
  await libraryDialog.screenshot({
    path: 'artifacts/iteration-11-builder-layout/company-library.png',
  })
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('link', { name: 'Advanced editor' }).first().click()
  await expect(page).toHaveURL(/\/projects\/.+\/items\//)
  await expect(page.getByRole('link', { name: /Bid builder/i })).toBeVisible()
  await expect(page.getByLabel('Unit of measure')).toBeVisible()
  await expect(page.getByLabel('Cost / unit')).toBeVisible()
  await page.screenshot({
    path: 'artifacts/iteration-11-builder-layout/item-estimate-advanced.png',
    fullPage: true,
  })

  await page.getByRole('link', { name: /Bid builder/i }).click()
  await expect(page.getByRole('heading', { name: 'Bid builder' })).toBeVisible()

  await page.getByRole('link', { name: /Back/i }).click()
  await expect(page.getByRole('heading', { name: 'ProfitBuilder' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByText('ProfitBuilder')).toBeVisible()
})

test.describe('iphone layout', () => {
  test.use({
    viewport: iPhone13.viewport,
    userAgent: iPhone13.userAgent,
    deviceScaleFactor: iPhone13.deviceScaleFactor,
    isMobile: iPhone13.isMobile,
    hasTouch: iPhone13.hasTouch,
  })

  test('mobile bid builder sheets and advanced fallback render cleanly', async ({ page }) => {
    mkdirSync('artifacts/iteration-11-builder-layout-mobile', { recursive: true })

    await signInDemoUser(page)

    await expect(page.getByRole('heading', { name: 'ProfitBuilder' })).toBeVisible()
    await expect(page.locator('.app-brand-mark')).toBeVisible()
    await expect(page.locator('.dashboard-mobile-list').first()).toBeVisible()
    await page.screenshot({
      path: 'artifacts/iteration-11-builder-layout-mobile/dashboard-iphone13.png',
      fullPage: true,
    })

    await page.getByRole('link', { name: /Maple Street Roof Replacement/i }).click()
    await expect(page.getByRole('heading', { name: 'Maple Street Roof Replacement' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Bid builder' })).toBeVisible()
    await expect(page.locator('.project-builder-mobile-list')).toBeVisible()
    await page.screenshot({
      path: 'artifacts/iteration-11-builder-layout-mobile/project-bid-builder-iphone13.png',
      fullPage: true,
    })

    const firstMobileCard = page.locator('.project-builder-mobile-list details').first()
    await firstMobileCard.locator('summary').click()
    await page.screenshot({
      path: 'artifacts/iteration-11-builder-layout-mobile/project-bid-builder-expanded-iphone13.png',
      fullPage: true,
    })
    await firstMobileCard.getByRole('button', { name: /Materials/i }).click()
    const materialsDialog = page.getByRole('dialog')
    await expect(materialsDialog.getByRole('heading', { name: 'Materials editor' })).toBeVisible()
    await materialsDialog.screenshot({
      path: 'artifacts/iteration-11-builder-layout-mobile/materials-picker-iphone13.png',
    })
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('button', { name: 'Company library' }).click()
    const libraryDialog = page.getByRole('dialog')
    await expect(libraryDialog.getByRole('heading', { name: 'Company library' })).toBeVisible()
    await libraryDialog.screenshot({
      path: 'artifacts/iteration-11-builder-layout-mobile/company-library-iphone13.png',
    })
    await page.getByRole('button', { name: 'Close' }).click()

    await firstMobileCard.getByRole('link', { name: 'Advanced editor' }).click()
    await expect(page.getByRole('link', { name: /Bid builder/i })).toBeVisible()
    await expect(page.getByLabel('Unit of measure')).toBeVisible()
    await expect(page.getByLabel('Cost / unit')).toBeVisible()
    await page.screenshot({
      path: 'artifacts/iteration-11-builder-layout-mobile/item-estimate-advanced-iphone13.png',
      fullPage: true,
    })
  })
})
