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
