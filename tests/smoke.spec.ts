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

const openTrackingBucket = async (page: Page, bucket: 'Equipment' | 'Labor') => {
  await page.getByRole('button', { name: new RegExp(`Tear off and disposal ${bucket}`, 'i') }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: `${bucket} actuals` })).toBeVisible()
  return dialog
}

const tearOffTrackingRow = (page: Page) =>
  page.locator('.tracking-table tbody tr').filter({ hasText: 'Tear off and disposal' }).first()

test('dashboard, tracking table, and two-page bid builder render cleanly', async ({ page }) => {
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

  const trackingRow = tearOffTrackingRow(page)
  const equipmentActualsDialog = await openTrackingBucket(page, 'Equipment')
  const equipmentDaysField = equipmentActualsDialog.getByLabel('Days')
  const originalEquipmentDays = await equipmentDaysField.inputValue()
  const updatedEquipmentDays = String(Number(originalEquipmentDays || '0') + 0.5)

  await equipmentDaysField.fill(updatedEquipmentDays)
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(trackingRow.locator('.row-save-state')).toHaveText('Synced')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pine Court Storm Repair' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Terminal items' })).toBeVisible()

  const reloadedEquipmentDialog = await openTrackingBucket(page, 'Equipment')
  await expect(reloadedEquipmentDialog.getByLabel('Days')).toHaveValue(updatedEquipmentDays)
  await reloadedEquipmentDialog.getByLabel('Days').fill(originalEquipmentDays)
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(tearOffTrackingRow(page).locator('.row-save-state')).toHaveText('Synced')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pine Court Storm Repair' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Terminal items' })).toBeVisible()

  await page.getByRole('button', { name: /Labor/i }).first().click()
  const laborActualsDialog = page.getByRole('dialog')
  await expect(laborActualsDialog.getByRole('heading', { name: 'Labor actuals' })).toBeVisible()
  await laborActualsDialog.screenshot({
    path: 'artifacts/iteration-11-builder-layout/tracking-labor-actuals.png',
  })
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: /O\/H \+ profit/i }).first().click()
  const markupActualsDialog = page.getByRole('dialog')
  await expect(markupActualsDialog.getByRole('heading', { name: 'Overhead actuals' })).toBeVisible()
  await expect(markupActualsDialog.getByText('Tracked on the project summary, not typed here')).toBeVisible()
  await markupActualsDialog.screenshot({
    path: 'artifacts/iteration-11-builder-layout/tracking-markup-actuals.png',
  })
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('link', { name: /Back/i }).click()
  await expect(page.getByRole('link', { name: /Maple Street Roof Replacement/i })).toBeVisible()
  await page.getByRole('link', { name: /Maple Street Roof Replacement/i }).click()
  await expect(page.getByRole('heading', { name: 'Maple Street Roof Replacement' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Bid builder' })).toBeVisible()
  await expect(page.locator('.project-builder-table')).toBeVisible()
  await expect(page.getByRole('button', { name: 'New section' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Materials/i }).first()).toBeVisible()
  await page.screenshot({
    path: 'artifacts/iteration-11-builder-layout/project-bid-builder.png',
    fullPage: true,
  })

  await page.getByRole('button', { name: 'New section' }).click()
  const scopeCreator = page.locator('.scope-picker-popover').first()
  await expect(scopeCreator.getByRole('heading', { name: 'New section' })).toBeVisible()
  await scopeCreator.screenshot({
    path: 'artifacts/iteration-11-builder-layout/scope-creator.png',
  })
  await scopeCreator.getByRole('button', { name: 'Cancel' }).click()
  const firstScopeInput = page.locator('.project-builder-table').getByLabel('1.1.1 scope name')
  await firstScopeInput.scrollIntoViewIfNeeded()
  const firstScopeRow = firstScopeInput.locator('xpath=ancestor::tr[1]')
  await firstScopeRow.getByRole('button', { name: /^Delete$/ }).click()
  const deleteScopeDialog = page.getByRole('dialog')
  await expect(deleteScopeDialog.getByRole('heading', { name: 'Delete scope?' })).toBeVisible()
  await deleteScopeDialog.getByRole('button', { name: 'Keep scope' }).click()
  await expect(deleteScopeDialog).toHaveCount(0)

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
  await expect(libraryDialog.getByRole('tab', { name: /Labor/i })).toBeVisible()
  await expect(libraryDialog.getByRole('tab', { name: /Equipment/i })).toBeVisible()
  await expect(libraryDialog.getByRole('tab', { name: /Materials/i })).toBeVisible()
  await libraryDialog.screenshot({
    path: 'artifacts/iteration-11-builder-layout/company-library.png',
  })
  await page.getByRole('button', { name: 'Close' }).click()

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

  test('mobile bid builder sheets render cleanly', async ({ page }) => {
    mkdirSync('artifacts/iteration-11-builder-layout-mobile', { recursive: true })

    await signInDemoUser(page)

    await expect(page.getByRole('heading', { name: 'ProfitBuilder' })).toBeVisible()
    await expect(page.locator('.app-brand-mark')).toBeVisible()
    await expect(page.locator('.dashboard-mobile-list').first()).toBeVisible()
    await expect(page.locator('.dashboard-mobile-card .status-badge')).toHaveCount(0)
    await page.screenshot({
      path: 'artifacts/iteration-11-builder-layout-mobile/dashboard-iphone13.png',
      fullPage: true,
    })

    await page.getByRole('link', { name: /Maple Street Roof Replacement/i }).click()
    await expect(page.getByRole('heading', { name: 'Maple Street Roof Replacement' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Bid builder' })).toBeVisible()
    await expect(page.locator('.project-builder-mobile-list')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New section' })).toBeVisible()
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
    await expect(libraryDialog.getByRole('tab', { name: /Labor/i })).toBeVisible()
    await libraryDialog.screenshot({
      path: 'artifacts/iteration-11-builder-layout-mobile/company-library-iphone13.png',
    })
    await page.getByRole('button', { name: 'Close' }).click()
  })
})
