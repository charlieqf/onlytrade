import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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

async function writeManifest(agentsDir, agentId, payload = {}) {
  const folder = path.join(agentsDir, agentId)
  await mkdir(folder, { recursive: true })
  await writeFile(
    path.join(folder, 'agent.json'),
    JSON.stringify({
      agent_id: agentId,
      agent_name: `Agent ${agentId}`,
      ai_model: 'qwen',
      exchange_id: 'sim-cn',
      ...payload,
    }, null, 2),
    'utf8'
  )
}

test('agent management routes drive registry-backed trader and competition payloads', { timeout: 60000 }, async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'onlytrade-agent-routes-'))
  const agentsDir = path.join(rootDir, 'agents')
  const registryPath = path.join(rootDir, 'data', 'agents', 'registry.json')
  await mkdir(agentsDir, { recursive: true })
  await mkdir(path.dirname(registryPath), { recursive: true })
  await writeFile(registryPath, JSON.stringify({ schema_version: 'agent.registry.v1', agents: {} }, null, 2), 'utf8')
  await writeManifest(agentsDir, 't_001', {
    agent_name: 'HS300 Momentum',
    avatar_file: 'avatar.jpg',
    avatar_hd_file: 'avatar-hd.jpg',
    trading_style: 'momentum_trend',
    risk_profile: 'balanced',
    personality: '冷静直接，偏顺势执行。',
    style_prompt_cn: '优先顺势，不做逆势抄底。',
    stock_pool: ['600519.SH', '601318.SH', '300750.SZ', '000001.SZ', '688981.SH'],
  })
  await writeManifest(agentsDir, 't_002', { agent_name: 'Value Rebound' })
  await writeFile(path.join(agentsDir, 't_001', 'avatar.jpg'), 'avatar-thumb', 'utf8')
  await writeFile(path.join(agentsDir, 't_001', 'avatar-hd.jpg'), 'avatar-hd', 'utf8')

  const port = 18082
  const baseUrl = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: MOCK_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
      AGENTS_DIR: agentsDir,
      AGENT_REGISTRY_PATH: registryPath,
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    child.kill('SIGTERM')
    await rm(rootDir, { recursive: true, force: true })
  })

  await waitForServer(baseUrl)

  const availableRes = await fetch(`${baseUrl}/api/agents/available`)
  const availableBody = await availableRes.json()
  assert.equal(availableRes.ok, true)
  assert.equal(Array.isArray(availableBody.data), true)
  assert.equal(availableBody.data.length, 2)

  const registeredBeforeRes = await fetch(`${baseUrl}/api/agents/registered`)
  const registeredBeforeBody = await registeredBeforeRes.json()
  assert.equal(registeredBeforeRes.ok, true)
  assert.equal(Array.isArray(registeredBeforeBody.data), true)
  assert.equal(registeredBeforeBody.data.length, 0)

  const registerRes = await fetch(`${baseUrl}/api/agents/t_001/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const registerBody = await registerRes.json()
  assert.equal(registerRes.ok, true)
  assert.equal(registerBody.data.agent_id, 't_001')
  assert.equal(registerBody.data.status, 'stopped')

  const tradersAfterRegisterRes = await fetch(`${baseUrl}/api/traders`)
  const tradersAfterRegisterBody = await tradersAfterRegisterRes.json()
  assert.equal(tradersAfterRegisterRes.ok, true)
  assert.equal(tradersAfterRegisterBody.data.length, 1)
  assert.equal(tradersAfterRegisterBody.data[0].trader_id, 't_001')
  assert.match(tradersAfterRegisterBody.data[0].avatar_url, /^\/api\/agents\/t_001\/assets\/avatar\.jpg\?v=\d+$/)
  assert.match(tradersAfterRegisterBody.data[0].avatar_hd_url, /^\/api\/agents\/t_001\/assets\/avatar-hd\.jpg\?v=\d+$/)
  assert.equal(tradersAfterRegisterBody.data[0].trading_style, 'momentum_trend')
  assert.equal(tradersAfterRegisterBody.data[0].risk_profile, 'balanced')
  assert.equal(tradersAfterRegisterBody.data[0].personality, '冷静直接，偏顺势执行。')
  assert.deepEqual(tradersAfterRegisterBody.data[0].stock_pool, ['600519.SH', '601318.SH', '300750.SZ', '000001.SZ', '688981.SH'])

  const symbolsByTraderRes = await fetch(`${baseUrl}/api/symbols?trader_id=t_001`)
  const symbolsByTraderBody = await symbolsByTraderRes.json()
  assert.equal(symbolsByTraderRes.ok, true)
  assert.deepEqual(
    symbolsByTraderBody.symbols.map((item) => item.symbol),
    ['600519.SH', '601318.SH', '300750.SZ', '000001.SZ', '688981.SH']
  )

  const decisionsAfterRegisterRes = await fetch(`${baseUrl}/api/decisions/latest?trader_id=t_001&limit=5`)
  const decisionsAfterRegisterBody = await decisionsAfterRegisterRes.json()
  assert.equal(decisionsAfterRegisterRes.ok, true)
  assert.deepEqual(decisionsAfterRegisterBody.data, [])

  const avatarRes = await fetch(`${baseUrl}${tradersAfterRegisterBody.data[0].avatar_url}`)
  const avatarText = await avatarRes.text()
  assert.equal(avatarRes.ok, true)
  assert.equal(avatarText, 'avatar-thumb')

  const competitionAfterRegisterRes = await fetch(`${baseUrl}/api/competition`)
  const competitionAfterRegisterBody = await competitionAfterRegisterRes.json()
  assert.equal(competitionAfterRegisterRes.ok, true)
  assert.equal(competitionAfterRegisterBody.data.traders.length, 1)
  assert.equal(competitionAfterRegisterBody.data.traders[0].trader_id, 't_001')
  assert.equal(competitionAfterRegisterBody.data.traders[0].is_running, false)
  assert.match(competitionAfterRegisterBody.data.traders[0].avatar_url, /^\/api\/agents\/t_001\/assets\/avatar\.jpg\?v=\d+$/)

  const startRes = await fetch(`${baseUrl}/api/agents/t_001/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const startBody = await startRes.json()
  assert.equal(startRes.ok, true)
  assert.equal(startBody.data.status, 'running')

  const competitionAfterStartRes = await fetch(`${baseUrl}/api/competition`)
  const competitionAfterStartBody = await competitionAfterStartRes.json()
  assert.equal(competitionAfterStartRes.ok, true)
  assert.equal(competitionAfterStartBody.data.traders[0].is_running, true)

  const stopRes = await fetch(`${baseUrl}/api/agents/t_001/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const stopBody = await stopRes.json()
  assert.equal(stopRes.ok, true)
  assert.equal(stopBody.data.status, 'stopped')

  const unregisterRes = await fetch(`${baseUrl}/api/agents/t_001/unregister`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const unregisterBody = await unregisterRes.json()
  assert.equal(unregisterRes.ok, true)
  assert.equal(unregisterBody.data.removed, true)

  const tradersAfterUnregisterRes = await fetch(`${baseUrl}/api/traders`)
  const tradersAfterUnregisterBody = await tradersAfterUnregisterRes.json()
  assert.equal(tradersAfterUnregisterRes.ok, true)
  assert.equal(Array.isArray(tradersAfterUnregisterBody.data), true)
  assert.equal(tradersAfterUnregisterBody.data.length, 0)
})
