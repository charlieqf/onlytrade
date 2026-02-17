import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const RUNTIME_API_DIR = path.resolve(__dirname, '..')

async function waitForServer(baseUrl, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`)
      if (res.ok) return
    } catch {
      // Keep polling until timeout.
    }
    await delay(250)
  }
  throw new Error('server_start_timeout')
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(() => {
        if (typeof port === 'number') resolve(port)
        else reject(new Error('port_unavailable'))
      })
    })
  })
}

async function stopChild(child, timeoutMs = 2000) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    once(child, 'exit'),
    delay(timeoutMs),
  ])
  if (child.exitCode === null) {
    child.kill('SIGKILL')
  }
}

test('room stream packet returns atomic snapshot', { timeout: 45000 }, async (t) => {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: RUNTIME_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      CHAT_LLM_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    await stopChild(child)
  })

  await waitForServer(baseUrl)

  const registerRes = await fetch(`${baseUrl}/api/agents/t_001/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const registerBody = await registerRes.json()
  assert.equal(registerRes.ok, true)
  assert.equal(registerBody.success, true)

  const res = await fetch(`${baseUrl}/api/rooms/t_001/stream-packet?decision_limit=3`)
  const body = await res.json()
  assert.equal(res.ok, true)
  assert.equal(body.success, true)
  assert.equal(body.data.schema_version, 'room.stream_packet.v1')
  assert.equal(body.data.room_id, 't_001')
  assert.equal(typeof body.data.ts_ms, 'number')
  assert.equal(body.data.trader.trader_id, 't_001')
  assert.ok(body.data.status)
  assert.ok(body.data.account)
  assert.ok(Array.isArray(body.data.positions), true)
  assert.ok(Array.isArray(body.data.decisions_latest), true)
  assert.ok(body.data.room_context)
  assert.ok(body.data.files)
})

test('room stream packet reuses pre-fetched overview and digest in room context', { timeout: 45000 }, async (t) => {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: RUNTIME_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      CHAT_LLM_ENABLED: 'false',
      CHAT_PROACTIVE_VIEWER_TICK_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
      ROOM_EVENTS_TEST_MODE: 'true',
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    await stopChild(child)
  })

  await waitForServer(baseUrl)

  const registerRes = await fetch(`${baseUrl}/api/agents/t_001/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(registerRes.ok, true)

  const packetRes = await fetch(`${baseUrl}/api/rooms/t_001/stream-packet?decision_limit=3`)
  assert.equal(packetRes.ok, true)

  const statsRes = await fetch(`${baseUrl}/api/_test/rooms/t_001/packet-build-stats`)
  assert.equal(statsRes.ok, true)
  const statsBody = await statsRes.json()
  assert.equal(statsBody.success, true)

  const stats = statsBody.data || {}
  assert.ok(Number(stats.packet_overview_fetch_count) >= 1)
  assert.ok(Number(stats.packet_digest_fetch_count) >= 1)
  assert.equal(Number(stats.context_overview_fetch_count), 0)
  assert.equal(Number(stats.context_digest_fetch_count), 0)
})

test('invalid room probe does not retain packet build state', { timeout: 45000 }, async (t) => {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: RUNTIME_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      CHAT_LLM_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
      ROOM_EVENTS_TEST_MODE: 'true',
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    await stopChild(child)
  })

  await waitForServer(baseUrl)

  const invalidRes = await fetch(`${baseUrl}/api/rooms/not_exists/stream-packet?decision_limit=3`)
  assert.equal(invalidRes.ok, false)

  const statsRes = await fetch(`${baseUrl}/api/_test/rooms/not_exists/packet-build-stats`)
  assert.equal(statsRes.ok, false)
  const body = await statsRes.json()
  assert.equal(body.success, false)
  assert.equal(body.error, 'room_not_found')
})

test('higher decision_limit request does not reuse lower-limit in-flight packet', { timeout: 60000 }, async (t) => {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: RUNTIME_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      CHAT_LLM_ENABLED: 'false',
      CHAT_PROACTIVE_VIEWER_TICK_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
      ROOM_EVENTS_TEST_MODE: 'true',
      ROOM_EVENTS_PACKET_BUILD_DELAY_MS: '1500',
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    await stopChild(child)
  })

  await waitForServer(baseUrl)

  const registerRes = await fetch(`${baseUrl}/api/agents/t_001/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(registerRes.ok, true)

  const lowPromise = fetch(`${baseUrl}/api/rooms/t_001/stream-packet?decision_limit=1`)
  await delay(120)
  const highPromise = fetch(`${baseUrl}/api/rooms/t_001/stream-packet?decision_limit=20`)

  const [lowRes, highRes] = await Promise.all([lowPromise, highPromise])
  assert.equal(lowRes.ok, true)
  assert.equal(highRes.ok, true)

  const lowBody = await lowRes.json()
  const highBody = await highRes.json()
  assert.equal(lowBody.success, true)
  assert.equal(highBody.success, true)

  const lowDecisions = Array.isArray(lowBody?.data?.decisions_latest) ? lowBody.data.decisions_latest : []
  const highDecisions = Array.isArray(highBody?.data?.decisions_latest) ? highBody.data.decisions_latest : []
  assert.ok(lowDecisions.length <= 1)
  assert.ok(highDecisions.length >= lowDecisions.length)

  const statsRes = await fetch(`${baseUrl}/api/_test/rooms/t_001/packet-build-stats`)
  assert.equal(statsRes.ok, true)
  const statsBody = await statsRes.json()
  assert.equal(statsBody.success, true)

  const stats = statsBody.data || {}
  assert.ok(Number(stats.build_started_count) >= 2)
  assert.equal(Number(stats.joined_call_count), 0)
})

test('singleflight remains serialized when cleanup is enabled in test mode', { timeout: 70000 }, async (t) => {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: RUNTIME_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      CHAT_LLM_ENABLED: 'false',
      CHAT_PROACTIVE_VIEWER_TICK_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
      ROOM_EVENTS_TEST_MODE: 'true',
      ROOM_EVENTS_CLEANUP_IN_TEST: 'true',
      ROOM_EVENTS_PACKET_BUILD_DELAY_MS: '1600',
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    await stopChild(child)
  })

  await waitForServer(baseUrl)

  const registerRes = await fetch(`${baseUrl}/api/agents/t_001/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(registerRes.ok, true)

  const lowPromise = fetch(`${baseUrl}/api/rooms/t_001/stream-packet?decision_limit=1`)
  await delay(100)
  const highPromise = fetch(`${baseUrl}/api/rooms/t_001/stream-packet?decision_limit=20`)
  await delay(2200)
  const midPromise = fetch(`${baseUrl}/api/rooms/t_001/stream-packet?decision_limit=10`)

  const [lowRes, highRes, midRes] = await Promise.all([lowPromise, highPromise, midPromise])
  assert.equal(lowRes.ok, true)
  assert.equal(highRes.ok, true)
  assert.equal(midRes.ok, true)

  const lowBody = await lowRes.json()
  const highBody = await highRes.json()
  const midBody = await midRes.json()
  assert.equal(lowBody.success, true)
  assert.equal(highBody.success, true)
  assert.equal(midBody.success, true)

  const lowDecisions = Array.isArray(lowBody?.data?.decisions_latest) ? lowBody.data.decisions_latest : []
  const highDecisions = Array.isArray(highBody?.data?.decisions_latest) ? highBody.data.decisions_latest : []
  const midDecisions = Array.isArray(midBody?.data?.decisions_latest) ? midBody.data.decisions_latest : []

  assert.ok(lowDecisions.length <= 1)
  assert.ok(midDecisions.length <= 10)
  assert.ok(highDecisions.length >= midDecisions.length)

  const statsRes = await fetch(`${baseUrl}/api/_test/rooms/t_001/packet-build-stats`)
  assert.equal(statsRes.ok, true)
  const statsBody = await statsRes.json()
  assert.equal(statsBody.success, true)

  const stats = statsBody.data || {}
  assert.equal(Number(stats.global_max_concurrency), 1)
  assert.equal(Number(stats.global_build_started_count), 2)
})
