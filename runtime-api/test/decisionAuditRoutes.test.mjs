import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, writeFile } from 'node:fs/promises'

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

test('decision audit routes return latest and day records', { timeout: 45000 }, async (t) => {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const baseDir = path.join(RUNTIME_API_DIR, 'test', 'tmp-audit-routes')
  await mkdir(path.join(baseDir, 't_001'), { recursive: true })
  const dayKey = '2026-02-14'
  const fp = path.join(baseDir, 't_001', `${dayKey}.jsonl`)
  const record = {
    schema_version: 'agent.decision_audit.v1',
    trader_id: 't_001',
    day_key: dayKey,
    saved_ts_ms: 1700000000000,
    timestamp: '2026-02-14T00:00:00.000Z',
    cycle_number: 1,
    symbol: '600519.SH',
    action: 'buy',
  }
  await writeFile(fp, `${JSON.stringify(record)}\n`, 'utf8')

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: RUNTIME_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      CHAT_LLM_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
      DECISION_AUDIT_BASE_DIR: path.relative(path.resolve(RUNTIME_API_DIR, '..'), baseDir),
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

  const latestRes = await fetch(`${baseUrl}/api/agents/t_001/decision-audit/latest?limit=10`)
  const latestBody = await latestRes.json()
  assert.equal(latestRes.ok, true)
  assert.equal(latestBody.success, true)
  assert.equal(latestBody.data.trader_id, 't_001')
  assert.equal(Array.isArray(latestBody.data.records), true)
  assert.equal(latestBody.data.records.length, 1)

  const dayRes = await fetch(`${baseUrl}/api/agents/t_001/decision-audit/day?day_key=${encodeURIComponent(dayKey)}&limit=10`)
  const dayBody = await dayRes.json()
  assert.equal(dayRes.ok, true)
  assert.equal(dayBody.success, true)
  assert.equal(dayBody.data.day_key, dayKey)
  assert.equal(dayBody.data.records.length, 1)
})
