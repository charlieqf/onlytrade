import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'

import { createAgentRegistryStore } from '../src/agentRegistryStore.mjs'

async function setupFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'onlytrade-agent-registry-'))
  const agentsDir = path.join(rootDir, 'agents')
  const registryPath = path.join(rootDir, 'data', 'agents', 'registry.json')
  await mkdir(agentsDir, { recursive: true })

  const store = createAgentRegistryStore({ agentsDir, registryPath })

  return { rootDir, agentsDir, registryPath, store }
}

async function writeManifest(agentsDir, agentId, override = {}) {
  const agentDir = path.join(agentsDir, agentId)
  await mkdir(agentDir, { recursive: true })
  const payload = {
    agent_id: agentId,
    agent_name: `Agent ${agentId}`,
    ai_model: 'qwen',
    exchange_id: 'sim-cn',
    ...override,
  }
  await writeFile(path.join(agentDir, 'agent.json'), JSON.stringify(payload, null, 2), 'utf8')
}

test('listAvailableAgents discovers manifests from agents/*/agent.json', async (t) => {
  const { rootDir, agentsDir, store } = await setupFixture()
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  await writeManifest(agentsDir, 't_001', { agent_name: 'HS300 Momentum' })
  await writeManifest(agentsDir, 't_002', {
    agent_name: 'Value Rebound',
    avatar_file: 'avatar.jpg',
    avatar_hd_file: 'avatar-hd.jpg',
    trading_style: ' mean_reversion ',
    risk_profile: ' balanced ',
    personality: ' 冷静耐心，偏逆向思考。 ',
    style_prompt_cn: ' 弱势分批吸纳，强势分批止盈。 ',
    stock_pool: ['600519.SH', '601318.sh', 'invalid', '300750.SZ', '600519.SH'],
  })

  const available = await store.listAvailableAgents()
  assert.equal(available.length, 2)
  assert.equal(available[0].agent_id, 't_001')
  assert.equal(available[1].agent_id, 't_002')
  assert.equal(available[1].avatar_file, 'avatar.jpg')
  assert.equal(available[1].avatar_hd_file, 'avatar-hd.jpg')
  assert.equal(available[1].trading_style, 'mean_reversion')
  assert.equal(available[1].risk_profile, 'balanced')
  assert.equal(available[1].personality, '冷静耐心，偏逆向思考。')
  assert.equal(available[1].style_prompt_cn, '弱势分批吸纳，强势分批止盈。')
  assert.deepEqual(available[1].stock_pool, ['600519.SH', '601318.SH', '300750.SZ'])
})

test('register/unregister persists registry.json state', async (t) => {
  const { rootDir, agentsDir, registryPath, store } = await setupFixture()
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  await writeManifest(agentsDir, 't_001')
  const registered = await store.registerAgent('t_001')
  assert.equal(registered.agent_id, 't_001')
  assert.equal(registered.status, 'stopped')
  assert.equal(registered.show_in_lobby, true)

  const afterRegisterRaw = JSON.parse(await readFile(registryPath, 'utf8'))
  assert.equal(typeof afterRegisterRaw.agents.t_001.registered_at, 'string')

  const unregisterResult = await store.unregisterAgent('t_001')
  assert.equal(unregisterResult.removed, true)

  const afterUnregisterRaw = JSON.parse(await readFile(registryPath, 'utf8'))
  assert.equal(afterUnregisterRaw.agents.t_001, undefined)
})

test('start/stop transitions are idempotent', async (t) => {
  const { rootDir, agentsDir, store } = await setupFixture()
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  await writeManifest(agentsDir, 't_001')
  await store.registerAgent('t_001')

  const started = await store.startAgent('t_001')
  assert.equal(started.status, 'running')
  assert.equal(typeof started.last_started_at, 'string')

  const startedAgain = await store.startAgent('t_001')
  assert.equal(startedAgain.status, 'running')
  assert.equal(startedAgain.last_started_at, started.last_started_at)

  const stopped = await store.stopAgent('t_001')
  assert.equal(stopped.status, 'stopped')
  assert.equal(typeof stopped.last_stopped_at, 'string')

  const stoppedAgain = await store.stopAgent('t_001')
  assert.equal(stoppedAgain.status, 'stopped')
  assert.equal(stoppedAgain.last_stopped_at, stopped.last_stopped_at)
})

test('registerAgent fails when manifest is missing', async (t) => {
  const { rootDir, store } = await setupFixture()
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  await assert.rejects(
    () => store.registerAgent('t_missing'),
    (error) => error?.code === 'agent_manifest_not_found'
  )
})

test('reconcile removes stale registrations when folders are deleted', async (t) => {
  const { rootDir, agentsDir, store } = await setupFixture()
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  await writeManifest(agentsDir, 't_001')
  await writeManifest(agentsDir, 't_002')
  await store.registerAgent('t_001')
  await store.registerAgent('t_002')

  await rm(path.join(agentsDir, 't_002'), { recursive: true, force: true })
  const reconcileResult = await store.reconcile()

  assert.deepEqual(reconcileResult.removed, ['t_002'])

  const registered = await store.listRegisteredAgents()
  assert.equal(registered.some((agent) => agent.agent_id === 't_002'), false)
  assert.equal(registered.some((agent) => agent.agent_id === 't_001'), true)
})
