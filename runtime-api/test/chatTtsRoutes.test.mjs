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
const MOCK_API_DIR = path.resolve(__dirname, '..')

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

test('chat tts config + validation routes', { timeout: 45000 }, async (t) => {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: MOCK_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
      CHAT_TTS_ENABLED: 'true',
      OPENAI_API_KEY: 'test_dummy_key',
      OPENAI_BASE_URL: 'http://127.0.0.1:1',
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    await stopChild(child)
  })

  await waitForServer(baseUrl)

  const registerRes = await fetch(`${baseUrl}/api/agents/t_003/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const registerBody = await registerRes.json()
  assert.equal(registerRes.ok, true)
  assert.equal(registerBody.success, true)

  const cfgRes = await fetch(`${baseUrl}/api/chat/tts/config`)
  const cfgBody = await cfgRes.json()
  assert.equal(cfgRes.ok, true)
  assert.equal(cfgBody.success, true)
  assert.equal(cfgBody.data.enabled, true)
  assert.equal(typeof cfgBody.data.voice_map?.t_003, 'string')

  const missingTextRes = await fetch(`${baseUrl}/api/chat/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: 't_003', text: '   ' }),
  })
  const missingTextBody = await missingTextRes.json()
  assert.equal(missingTextRes.status, 400)
  assert.equal(missingTextBody.success, false)
  assert.equal(missingTextBody.error, 'text_required')

  const badRoomRes = await fetch(`${baseUrl}/api/chat/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: 't_missing', text: 'test' }),
  })
  const badRoomBody = await badRoomRes.json()
  assert.equal(badRoomRes.status, 404)
  assert.equal(badRoomBody.success, false)
  assert.equal(badRoomBody.error, 'room_not_found')
})

test('chat tts disabled returns 503', { timeout: 45000 }, async (t) => {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: MOCK_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
      CHAT_TTS_ENABLED: 'false',
      OPENAI_API_KEY: '',
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    await stopChild(child)
  })

  await waitForServer(baseUrl)

  const res = await fetch(`${baseUrl}/api/chat/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: 't_003', text: 'hello' }),
  })
  const body = await res.json()
  assert.equal(res.status, 503)
  assert.equal(body.success, false)
  assert.equal(body.error, 'chat_tts_disabled')
})
