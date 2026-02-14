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
