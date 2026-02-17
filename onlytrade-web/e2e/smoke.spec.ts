import { test, expect } from '@playwright/test'
import crypto from 'node:crypto'

const baseURL = process.env.E2E_BASE_URL

function unwrapApiPayload<T>(json: any): T {
  if (
    json &&
    typeof json === 'object' &&
    typeof json.success === 'boolean' &&
    'data' in json
  ) {
    return json.data as T
  }
  return json as T
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = String(input || '')
    .toUpperCase()
    .replace(/=+$/g, '')
    .replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []

  for (const ch of clean) {
    const idx = alphabet.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

function totpCode(
  secretBase32: string,
  nowMs = Date.now(),
  stepSec = 30,
  digits = 6
): string {
  const key = base32Decode(secretBase32)
  const counter = Math.floor(nowMs / 1000 / stepSec)
  const msg = Buffer.alloc(8)
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  msg.writeUInt32BE(counter & 0xffffffff, 4)

  const hmac = crypto.createHmac('sha1', key).update(msg).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const bin = (hmac.readUInt32BE(offset) & 0x7fffffff) >>> 0
  const mod = 10 ** digits
  const code = String(bin % mod).padStart(digits, '0')
  return code
}

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
  const config = unwrapApiPayload<any>(await configRes.json())
  expect(typeof config.beta_mode).toBe('boolean')

  const competitionRes = await request.get('/api/competition')
  expect(competitionRes.ok()).toBeTruthy()
  const competition = unwrapApiPayload<any>(await competitionRes.json())
  expect(typeof competition.count).toBe('number')
  expect(Array.isArray(competition.traders)).toBe(true)
})

test('public traders endpoint responds with array', async ({ request }) => {
  const res = await request.get('/api/traders')
  expect(res.ok()).toBeTruthy()
  const data = unwrapApiPayload<any>(await res.json())
  expect(Array.isArray(data)).toBe(true)

  if (
    (process.env.E2E_EXPECT_TRADERS_NONEMPTY || '').toLowerCase() === 'true'
  ) {
    expect(data.length).toBeGreaterThan(0)
  }
})

test('static icon assets are reachable', async ({ request }) => {
  const nofx = await request.get('/icons/nofx.svg')
  expect(nofx.ok()).toBeTruthy()
  const onlytrade = await request.get('/icons/onlytrade.svg')
  expect(onlytrade.ok()).toBeTruthy()
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
  await expect(page).toHaveURL(/\/room(\?|$)/)
})

test('room loads without trader and shows empty state', async ({ page }) => {
  await page.goto('/room', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('room-empty-state')).toBeVisible()
})

test('room loads with a known trader', async ({ page }) => {
  const slug = String(process.env.E2E_TRADER_SLUG || '').trim()
  test.skip(!slug, 'Set E2E_TRADER_SLUG to a stable trader slug')

  await page.goto(`/room?trader=${encodeURIComponent(slug)}`, {
    waitUntil: 'domcontentloaded',
  })
  await expect(page.getByTestId('trader-dashboard')).toBeVisible()
  await expect(page.getByTestId('room-empty-state')).toHaveCount(0)
})

test('login via email/password + TOTP sets auth_token', async ({ page }) => {
  const email = String(process.env.E2E_EMAIL || '').trim()
  const password = String(process.env.E2E_PASSWORD || '').trim()
  const totpSecret = String(process.env.E2E_TOTP_SECRET || '').trim()

  test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD')
  test.skip(!totpSecret, 'Set E2E_TOTP_SECRET (base32) to automate OTP')

  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('login-email')).toBeVisible()

  await page.getByTestId('login-email').fill(email)
  await page.getByTestId('login-password').fill(password)
  await page.getByTestId('login-submit').click()

  // If OTP is required, complete it; otherwise, still verify we ended up authenticated.
  const otpInput = page.getByTestId('otp-code')
  if (await otpInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    const code = totpCode(totpSecret)
    await otpInput.fill(code)
    await page.getByTestId('otp-submit').click()
  }

  await page.waitForFunction(() => !!localStorage.getItem('auth_token'), null, {
    timeout: 20_000,
  })
  const token = await page.evaluate(() => localStorage.getItem('auth_token'))
  expect(token).toBeTruthy()
  expect(String(token).length).toBeGreaterThan(10)
})

test('navigate lobby -> leaderboard', async ({ page }) => {
  await page.goto('/lobby', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('page-lobby')).toBeVisible()
  await page.getByTestId('lobby-go-leaderboard').click()
  await expect(page.getByTestId('page-leaderboard')).toBeVisible()
})
