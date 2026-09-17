import { test, expect } from '@playwright/test'

const PASSWORD = 'e2e-smoke-test-password-only'
const ORG_ADMIN_EMAIL = 'e2e-org-admin@example.test'
const RECEPTIONIST_EMAIL = 'e2e-receptionist@example.test'

async function login(page: import('@playwright/test').Page, email: string) {
  await page.goto('/')
  await page.getByLabel('Email o identificativo').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Accedi' }).click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
}

// Always runnable: only needs the dev server up (see playwright.config.ts's
// webServer) and *some* value in apps/web/.env.local for
// VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY -- client construction doesn't
// make a network call, so a placeholder is enough (same assumption the
// existing packages/core-sdk/src/client.test.ts unit test makes).
test('shows the login form when signed out', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Bentornato' })).toBeVisible()
  await expect(page.getByLabel('Email o identificativo')).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accedi' })).toBeVisible()
})

// The authenticated tests require a local Supabase stack (`supabase start`),
// fixtures from scripts/e2e/provision-fixtures.mjs and local URL/anon-key
// values exposed to Vite. CI creates all of those in a disposable stack.
test('organization admin logs in, switches property, and logs out', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await login(page, ORG_ADMIN_EMAIL)
  await expect(page.locator('.page-heading .eyebrow')).toHaveText('Property A1')

  await page.getByRole('button', { name: /Property A1/ }).first().click()
  await page.getByRole('option', { name: /Property A2/ }).click()
  await expect(page.locator('.page-heading .eyebrow')).toHaveText('Property A2')

  await page.getByRole('button', { name: 'Menu account di E2E Org Admin' }).click()
  await page.getByRole('menu').getByRole('button', { name: 'Esci' }).click()
  await expect(page.getByRole('heading', { name: 'Bentornato' })).toBeVisible()

  expect(consoleErrors).toEqual([])
})

test('organization admin sees Team management actions but cannot change own access', async ({ page }) => {
  await login(page, ORG_ADMIN_EMAIL)
  await page.goto('/team')

  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Crea profilo' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Team' })).toContainText('E2E Org Admin')
  await expect(page.getByRole('table', { name: 'Team' })).toContainText('E2E Receptionist')
  await expect(page.getByRole('switch', { name: 'Stato accesso di E2E Org Admin' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Rimuovi E2E Org Admin' })).toBeDisabled()
})

test('receptionist sees the complete property roster in read-only mode', async ({ page }) => {
  await login(page, RECEPTIONIST_EMAIL)
  await page.goto('/team')

  const team = page.getByRole('table', { name: 'Team' })
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible()
  await expect(team).toContainText('E2E Org Admin')
  await expect(team).toContainText('E2E Receptionist')
  await expect(page.getByRole('button', { name: 'Crea profilo' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Modifica E2E/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Rimuovi E2E/ })).toHaveCount(0)
})

test('organization admin can navigate the mapped Housekeeping stay', async ({ page }) => {
  await login(page, ORG_ADMIN_EMAIL)
  await page.goto('/housekeeping')
  await expect(page.getByRole('link', { name: 'Richieste' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Soggiorni' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Gestione' })).toBeVisible()
  await page.getByRole('link', { name: 'Soggiorni' }).click()
  await expect(page.getByRole('heading', { name: 'Soggiorni' })).toBeVisible()
  await expect(page.getByText(/Camera 101 · Rossi/)).toBeVisible()
})

test('organization admin can manage a Housekeeping request category and its item', async ({ page }) => {
  await login(page, ORG_ADMIN_EMAIL)
  await page.goto('/housekeeping/admin/menu')

  await expect(page.getByRole('heading', { name: 'Menu richieste' })).toBeVisible()
  await page.getByLabel('Nome categoria').fill('E2E Comfort')
  await page.locator('label').filter({ hasText: 'E2E Reception' }).click()
  await expect(page.getByLabel('E2E Reception')).toBeChecked()
  await page.getByRole('button', { name: 'Aggiungi categoria', exact: true }).click()

  const categories = page.getByRole('table', { name: 'Menu richieste' })
  const categoryRow = categories.getByRole('row').filter({ hasText: 'E2E Comfort' })
  await expect(categoryRow).toContainText('E2E Reception')

  await page.getByRole('button', { name: 'Categoria *', exact: true }).click()
  await page.getByRole('option', { name: 'E2E Comfort' }).click()
  await page.getByLabel('Nome', { exact: true }).fill('E2E Cuscino')
  await page.getByRole('button', { name: 'Aggiungi elemento' }).click()
  await expect(page.getByText('E2E Cuscino', { exact: true })).toBeVisible()

  await categoryRow.getByRole('button', { name: 'Rimuovi' }).click()
  await expect(page.getByText('Rimuovere questa categoria?')).toBeVisible()
  await page.getByRole('button', { name: 'Rimuovi', exact: true }).click()
  await expect(categories.getByText('E2E Comfort', { exact: true })).toHaveCount(0)
  await expect(page.getByText('E2E Cuscino', { exact: true })).toHaveCount(0)
})

test('receptionist can read Housekeeping without its management tab', async ({ page }) => {
  await login(page, RECEPTIONIST_EMAIL)
  await page.goto('/housekeeping')
  await expect(page.getByRole('link', { name: 'Richieste' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Soggiorni' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Gestione' })).toHaveCount(0)
})

test('unknown deep link still resolves through the authenticated shell', async ({ page }) => {
  await login(page, ORG_ADMIN_EMAIL)
  await page.goto('/not-a-real-route')

  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  await expect(page).toHaveURL('http://127.0.0.1:5173/')
})
