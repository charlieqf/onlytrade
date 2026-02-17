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

async function readUntil(res, predicate, timeoutMs = 3000) {
  const reader = res.body?.getReader?.()
  if (!reader) return ''

  const started = Date.now()
  let buffer = ''

  while (Date.now() - started < timeoutMs) {
    const { value, done } = await Promise.race([
      reader.read(),
      delay(250).then(() => ({ value: null, done: false })),
    ])

    if (done) break
    if (value) {
      buffer += new TextDecoder().decode(value)
      if (predicate(buffer)) break
    }
  }

  try {
    await reader.cancel()
  } catch {
    // ignore
  }

  return buffer
}

function countEventBlocks(text, eventName) {
  const safe = String(text || '')
  const name = String(eventName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!name) return 0
  const matches = safe.match(new RegExp(`event:\\s*${name}`, 'g'))
  return Array.isArray(matches) ? matches.length : 0
}

function extractEventIds(text, eventName) {
  const target = String(eventName || '').trim()
  if (!target) return []
  const blocks = String(text || '').split(/\r?\n\r?\n/)
  const out = []

  for (const block of blocks) {
    if (!block) continue
    const lines = block.split(/\r?\n/).map((line) => String(line || '').trim())
    const hasEvent = lines.some((line) => line === `event: ${target}`)
    if (!hasEvent) continue
    const idLine = lines.find((line) => line.startsWith('id:'))
    if (!idLine) continue
    const match = idLine.match(/^id:\s*(\d+)$/)
    if (!match) continue
    out.push(Number(match[1]))
  }

  return out.filter((id) => Number.isFinite(id) && id > 0)
}

test('room events SSE streams initial packet', { timeout: 45000 }, async (t) => {
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
      ROOM_EVENTS_KEEPALIVE_MS: '5000',
      ROOM_EVENTS_STREAM_PACKET_INTERVAL_MS: '5000',
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

  const res = await fetch(`${baseUrl}/api/rooms/t_001/events?decision_limit=1&interval_ms=5000`)
  assert.equal(res.ok, true)
  assert.ok(String(res.headers.get('content-type') || '').includes('text/event-stream'))

  const text = await readUntil(res, (buf) => buf.includes('event: stream_packet'))
  assert.ok(text.includes('event: stream_packet'))
})

test('room events SSE emits chat_public_append on public chat post', { timeout: 45000 }, async (t) => {
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
      ROOM_EVENTS_KEEPALIVE_MS: '5000',
      ROOM_EVENTS_STREAM_PACKET_INTERVAL_MS: '5000',
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

  const eventsRes = await fetch(`${baseUrl}/api/rooms/t_001/events?decision_limit=1&interval_ms=5000`)
  assert.equal(eventsRes.ok, true)
  assert.ok(String(eventsRes.headers.get('content-type') || '').includes('text/event-stream'))

  await delay(100)

  const postPromise = fetch(`${baseUrl}/api/chat/rooms/t_001/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_session_id: 'usr_sess_test',
      user_nickname: 'TestUser',
      visibility: 'public',
      message_type: 'public_plain',
      text: 'hello sse',
    }),
  })

  const text = await readUntil(eventsRes, (buf) => buf.includes('event: chat_public_append'), 6000)
  const postRes = await postPromise
  assert.equal(postRes.ok, true)
  assert.ok(text.includes('event: chat_public_append'))
})

test('room events SSE replays buffered events using Last-Event-ID', { timeout: 45000 }, async (t) => {
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
      ROOM_EVENTS_KEEPALIVE_MS: '5000',
      ROOM_EVENTS_STREAM_PACKET_INTERVAL_MS: '5000',
      ROOM_EVENTS_BUFFER_TTL_MS: '60000',
      CHAT_PROACTIVE_VIEWER_TICK_ENABLED: 'false',
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

  const eventsRes1 = await fetch(`${baseUrl}/api/rooms/t_001/events?decision_limit=1&interval_ms=5000`)
  assert.equal(eventsRes1.ok, true)

  await fetch(`${baseUrl}/api/chat/rooms/t_001/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_session_id: 'usr_sess_test',
      user_nickname: 'TestUser',
      visibility: 'public',
      message_type: 'public_plain',
      text: 'first',
    }),
  })

  const firstBlock = await readUntil(eventsRes1, (buf) => buf.includes('event: chat_public_append'), 6000)
  const idMatch = firstBlock.match(/id:\s*(\d+)\n[\s\S]*?event: chat_public_append/)
  assert.ok(idMatch && idMatch[1], 'expected id field before chat_public_append')
  const firstId = Number(idMatch[1])
  assert.ok(Number.isFinite(firstId) && firstId > 0)

  await delay(150)

  // Post while no SSE subscribers are connected; should be buffered for replay.
  const postRes2 = await fetch(`${baseUrl}/api/chat/rooms/t_001/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_session_id: 'usr_sess_test',
      user_nickname: 'TestUser',
      visibility: 'public',
      message_type: 'public_plain',
      text: 'second',
    }),
  })
  assert.equal(postRes2.ok, true)

  const eventsRes2 = await fetch(`${baseUrl}/api/rooms/t_001/events?decision_limit=1&interval_ms=5000`, {
    headers: {
      'Last-Event-ID': String(firstId),
    },
  })
  assert.equal(eventsRes2.ok, true)

  const replayText = await readUntil(eventsRes2, (buf) => buf.includes('event: chat_public_append') && buf.includes('second'), 6000)
  assert.ok(replayText.includes('event: chat_public_append'))
  assert.ok(replayText.includes('second'))
})

test('room events SSE replays buffered stream_packet events', { timeout: 60000 }, async (t) => {
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
      ROOM_EVENTS_KEEPALIVE_MS: '5000',
      ROOM_EVENTS_STREAM_PACKET_INTERVAL_MS: '2000',
      ROOM_EVENTS_BUFFER_TTL_MS: '60000',
      CHAT_PROACTIVE_VIEWER_TICK_ENABLED: 'false',
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

  // Keep one subscriber connected so timer packets continue while we reconnect.
  const keeperRes = await fetch(`${baseUrl}/api/rooms/t_001/events?decision_limit=1&interval_ms=2000`)
  assert.equal(keeperRes.ok, true)

  const probeRes = await fetch(`${baseUrl}/api/rooms/t_001/events?decision_limit=1&interval_ms=2000`)
  assert.equal(probeRes.ok, true)
  const firstText = await readUntil(probeRes, (buf) => buf.includes('event: stream_packet'), 6000)
  const packetIds = extractEventIds(firstText, 'stream_packet')
  assert.ok(packetIds.length >= 1)
  const firstId = Number(packetIds[0])

  // Let at least one timer packet be emitted after firstId while keeper is connected.
  await delay(2600)

  const replayRes = await fetch(`${baseUrl}/api/rooms/t_001/events?decision_limit=1&interval_ms=2000`, {
    headers: {
      'Last-Event-ID': String(firstId),
    },
  })
  assert.equal(replayRes.ok, true)

  // Replay + initial push should both arrive quickly; without replay we'd usually only see one.
  const replayText = await readUntil(replayRes, (buf) => countEventBlocks(buf, 'stream_packet') >= 2, 1200)
  assert.ok(countEventBlocks(replayText, 'stream_packet') >= 2)
  assert.ok(replayText.includes('event: stream_packet'))

  // Cleanup keeper connection.
  await readUntil(keeperRes, () => false, 50)
})

test('room stream_packet singleflight keeps max concurrency at 1', { timeout: 60000 }, async (t) => {
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
      ROOM_EVENTS_KEEPALIVE_MS: '5000',
      ROOM_EVENTS_STREAM_PACKET_INTERVAL_MS: '2000',
      ROOM_EVENTS_PACKET_BUILD_DELAY_MS: '3500',
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

  const eventsRes = await fetch(`${baseUrl}/api/rooms/t_001/events?decision_limit=1&interval_ms=2000`)
  assert.equal(eventsRes.ok, true)
  assert.ok(String(eventsRes.headers.get('content-type') || '').includes('text/event-stream'))

  const streamText = await readUntil(eventsRes, () => false, 8500)

  const statsRes = await fetch(`${baseUrl}/api/_test/rooms/t_001/packet-build-stats`)
  assert.equal(statsRes.ok, true)
  const statsBody = await statsRes.json()
  assert.equal(statsBody.success, true)
  const stats = statsBody.data || {}

  assert.equal(Number(stats.max_concurrency), 1)
  assert.ok(Number(stats.timer_skip_count) >= 1)

  const packetCount = countEventBlocks(streamText, 'stream_packet')
  assert.ok(packetCount <= 3)
})
