import { test, expect } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL

test.beforeAll(() => {
  if (!baseURL) {
    throw new Error(
      [
        'E2E_BASE_URL is required.',
        '',
        'Example:',
        '  E2E_BASE_URL="http://<public-ip-or-domain>" npm run test:e2e',
      ].join('\n')
    )
  }
})

test('lobby loads via direct URL', async ({ page }) => {
  await page.goto('/lobby', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('page-lobby')).toBeVisible()
})

test('root loads and renders lobby', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('page-lobby')).toBeVisible()
})

test('leaderboard loads via direct URL', async ({ page }) => {
  await page.goto('/leaderboard', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('page-leaderboard')).toBeVisible()
})

test('api endpoints respond (config + competition)', async ({ request }) => {
  const configRes = await request.get('/api/config')
  expect(configRes.ok()).toBeTruthy()
  const config = await configRes.json()
  expect(typeof config.beta_mode).toBe('boolean')

  const competitionRes = await request.get('/api/competition')
  expect(competitionRes.ok()).toBeTruthy()
  const competition = await competitionRes.json()
  expect(typeof competition.count).toBe('number')
  expect(Array.isArray(competition.traders)).toBe(true)
})

test('leaderboard never shows NaN/Infinity text', async ({ page }) => {
  await page.goto('/leaderboard', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('page-leaderboard')).toBeVisible()
  const text = await page.locator('body').innerText()
  expect(text).not.toMatch(/\bNaN%\b/i)
  expect(text).not.toMatch(/\bInfinity%\b/i)
})

test('navigate lobby -> room', async ({ page }) => {
  await page.goto('/lobby', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('page-lobby')).toBeVisible()
  await page.getByTestId('lobby-enter-room').click()
  await expect(page.getByTestId('page-room')).toBeVisible()
})

test('navigate lobby -> leaderboard', async ({ page }) => {
  await page.goto('/lobby', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('page-lobby')).toBeVisible()
  await page.getByTestId('lobby-go-leaderboard').click()
  await expect(page.getByTestId('page-leaderboard')).toBeVisible()
})
