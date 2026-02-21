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

async function postJson(baseUrl, pathName, payload, { token = '' } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['x-control-token'] = token
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload || {}),
  })
  const body = await response.json()
  return { response, body }
}

test('control token is required on mutating control endpoints when configured', { timeout: 45000 }, async (t) => {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const controlToken = 'test-control-token'

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: RUNTIME_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      CHAT_LLM_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
      CONTROL_API_TOKEN: controlToken,
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    await stopChild(child)
  })

  await waitForServer(baseUrl)

  const unauthorizedRuntime = await postJson(baseUrl, '/api/agent/runtime/control', { action: 'pause' })
  assert.equal(unauthorizedRuntime.response.status, 401)
  assert.equal(unauthorizedRuntime.body.error, 'unauthorized_control_token')

  const authorizedRuntime = await postJson(baseUrl, '/api/agent/runtime/control', { action: 'pause' }, { token: controlToken })
  assert.equal(authorizedRuntime.response.ok, true)
  assert.equal(authorizedRuntime.body.success, true)

  const unauthorizedReplay = await postJson(baseUrl, '/api/replay/runtime/control', { action: 'pause' })
  assert.equal(unauthorizedReplay.response.status, 401)
  assert.equal(unauthorizedReplay.body.error, 'unauthorized_control_token')

  const unauthorizedRegister = await postJson(baseUrl, '/api/agents/t_001/register', {})
  assert.equal(unauthorizedRegister.response.status, 401)
  assert.equal(unauthorizedRegister.body.error, 'unauthorized_control_token')

  const authorizedRegister = await postJson(baseUrl, '/api/agents/t_001/register', {}, { token: controlToken })
  assert.equal(authorizedRegister.response.ok, true)
  assert.equal(authorizedRegister.body.success, true)
})

test('factory-reset and reset-agent require explicit confirmation and support dry-run', { timeout: 45000 }, async (t) => {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const controlToken = 'test-control-token-2'

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: RUNTIME_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      CHAT_LLM_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
      CONTROL_API_TOKEN: controlToken,
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    await stopChild(child)
  })

  await waitForServer(baseUrl)

  const noConfirmReset = await postJson(baseUrl, '/api/dev/factory-reset', { cursor_index: 0 }, { token: controlToken })
  assert.equal(noConfirmReset.response.status, 400)
  assert.equal(noConfirmReset.body.error, 'reset_confirmation_required')

  const dryRunReset = await postJson(
    baseUrl,
    '/api/dev/factory-reset',
    { cursor_index: 0, confirm: 'RESET', dry_run: true },
    { token: controlToken }
  )
  assert.equal(dryRunReset.response.ok, true)
  assert.equal(dryRunReset.body.data.dry_run, true)

  const register = await postJson(baseUrl, '/api/agents/t_001/register', {}, { token: controlToken })
  assert.equal(register.response.ok, true)

  const noScopeReset = await postJson(
    baseUrl,
    '/api/dev/reset-agent',
    { trader_id: 't_001', confirm: 't_001' },
    { token: controlToken }
  )
  assert.equal(noScopeReset.response.status, 400)
  assert.equal(noScopeReset.body.error, 'no_reset_scope_selected')

  const badConfirmReset = await postJson(
    baseUrl,
    '/api/dev/reset-agent',
    { trader_id: 't_001', reset_memory: true, confirm: 'RESET' },
    { token: controlToken }
  )
  assert.equal(badConfirmReset.response.status, 400)
  assert.equal(badConfirmReset.body.error, 'reset_confirmation_required')

  const dryRunAgentReset = await postJson(
    baseUrl,
    '/api/dev/reset-agent',
    {
      trader_id: 't_001',
      reset_memory: true,
      reset_positions: true,
      reset_stats: true,
      confirm: 't_001',
      dry_run: true,
    },
    { token: controlToken }
  )
  assert.equal(dryRunAgentReset.response.ok, true)
  assert.equal(dryRunAgentReset.body.data.dry_run, true)

  const liveAgentReset = await postJson(
    baseUrl,
    '/api/dev/reset-agent',
    {
      trader_id: 't_001',
      reset_positions: true,
      reset_stats: true,
      confirm: 't_001',
    },
    { token: controlToken }
  )
  assert.equal(liveAgentReset.response.ok, true)
  assert.equal(liveAgentReset.body.data.action, 'reset_agent')
  assert.equal(liveAgentReset.body.data.trader_id, 't_001')
})

test('live preflight endpoint returns mode checks', { timeout: 45000 }, async (t) => {
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

  const response = await fetch(`${baseUrl}/api/ops/live-preflight`)
  const body = await response.json()
  assert.equal(response.ok, true)
  assert.equal(body.success, true)
  assert.equal(body.data.checks.data_mode.actual, 'replay')
  assert.equal(body.data.checks.data_mode.ok, false)
})
