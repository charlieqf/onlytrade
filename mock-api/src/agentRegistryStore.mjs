import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

function nowIso() {
  return new Date().toISOString()
}

function toSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalizeAgentId(agentIdRaw) {
  const agentId = String(agentIdRaw || '').trim()
  return agentId
}

function normalizeOptionalText(value, maxLen = 512) {
  const text = String(value || '').trim()
  if (!text) return null
  return text.slice(0, maxLen)
}

function normalizeAssetFileName(value) {
  const text = String(value || '').trim()
  if (!text) return null
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(text)) return null
  return text
}

function assertValidAgentId(agentId) {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(agentId)) {
    const error = new Error('invalid_agent_id')
    error.code = 'invalid_agent_id'
    throw error
  }
}

function normalizeStatus(statusRaw) {
  return statusRaw === 'running' ? 'running' : 'stopped'
}

function normalizeRegistryRecord(recordRaw) {
  const record = toSafeObject(recordRaw)
  return {
    registered_at: typeof record.registered_at === 'string' ? record.registered_at : null,
    status: normalizeStatus(record.status),
    show_in_lobby: record.show_in_lobby !== false,
    last_started_at: typeof record.last_started_at === 'string' ? record.last_started_at : null,
    last_stopped_at: typeof record.last_stopped_at === 'string' ? record.last_stopped_at : null,
  }
}

function registrySeed() {
  return {
    schema_version: 'agent.registry.v1',
    agents: {},
  }
}

function parseManifest(raw, expectedAgentId = '') {
  const payload = toSafeObject(raw)
  const agentId = normalizeAgentId(payload.agent_id)
  if (!agentId) return null
  assertValidAgentId(agentId)
  if (expectedAgentId && agentId !== expectedAgentId) return null

  const agentName = String(payload.agent_name || '').trim()
  const aiModel = String(payload.ai_model || '').trim()
  const exchangeId = String(payload.exchange_id || '').trim()

  if (!agentName || !aiModel || !exchangeId) {
    return null
  }

  const avatarFile = normalizeAssetFileName(payload.avatar_file)
  const avatarHdFile = normalizeAssetFileName(payload.avatar_hd_file)
  const avatarUrl = normalizeOptionalText(payload.avatar_url)
  const avatarHdUrl = normalizeOptionalText(payload.avatar_hd_url)

  return {
    ...payload,
    agent_id: agentId,
    agent_name: agentName,
    ai_model: aiModel,
    exchange_id: exchangeId,
    avatar_file: avatarFile,
    avatar_hd_file: avatarHdFile,
    avatar_url: avatarUrl,
    avatar_hd_url: avatarHdUrl,
  }
}

export function createAgentRegistryStore({
  agentsDir,
  registryPath,
} = {}) {
  if (!agentsDir) {
    throw new Error('agents_dir_required')
  }
  if (!registryPath) {
    throw new Error('registry_path_required')
  }

  async function writeRegistryAtomic(payload) {
    const dir = path.dirname(registryPath)
    await mkdir(dir, { recursive: true })

    const nonce = Math.random().toString(16).slice(2, 10)
    const tmpPath = `${registryPath}.${process.pid}.${Date.now()}.${nonce}.tmp`
    await writeFile(tmpPath, JSON.stringify(payload, null, 2), 'utf8')

    try {
      await rename(tmpPath, registryPath)
    } catch (error) {
      if (error?.code === 'EEXIST' || error?.code === 'EPERM') {
        await rm(registryPath, { force: true })
        await rename(tmpPath, registryPath)
      } else {
        await rm(tmpPath, { force: true })
        throw error
      }
    }
  }

  async function readRegistry() {
    try {
      const raw = await readFile(registryPath, 'utf8')
      const parsed = toSafeObject(JSON.parse(raw))
      const agentsRaw = toSafeObject(parsed.agents)
      const agents = {}
      for (const [agentIdRaw, recordRaw] of Object.entries(agentsRaw)) {
        const agentId = normalizeAgentId(agentIdRaw)
        if (!agentId) continue
        try {
          assertValidAgentId(agentId)
        } catch {
          continue
        }
        agents[agentId] = normalizeRegistryRecord(recordRaw)
      }

      return {
        schema_version: typeof parsed.schema_version === 'string' ? parsed.schema_version : 'agent.registry.v1',
        agents,
      }
    } catch {
      const seed = registrySeed()
      await writeRegistryAtomic(seed)
      return seed
    }
  }

  async function listAvailableAgents() {
    let entries = []
    try {
      entries = await readdir(agentsDir, { withFileTypes: true })
    } catch {
      return []
    }

    const available = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const expectedAgentId = normalizeAgentId(entry.name)
      if (!expectedAgentId) continue

      const manifestPath = path.join(agentsDir, entry.name, 'agent.json')
      try {
        const raw = await readFile(manifestPath, 'utf8')
        const parsed = JSON.parse(raw)
        const manifest = parseManifest(parsed, expectedAgentId)
        if (!manifest) continue
        available.push(manifest)
      } catch {
        // Ignore malformed/missing manifests and continue scanning.
      }
    }

    return available.sort((a, b) => a.agent_id.localeCompare(b.agent_id))
  }

  async function listRegisteredAgents() {
    const [registry, available] = await Promise.all([
      readRegistry(),
      listAvailableAgents(),
    ])

    const availableById = new Map(available.map((agent) => [agent.agent_id, agent]))

    return Object.entries(registry.agents)
      .map(([agentId, record]) => {
        const manifest = availableById.get(agentId)
        return {
          agent_id: agentId,
          ...(manifest || {}),
          ...record,
          available: !!manifest,
        }
      })
      .sort((a, b) => a.agent_id.localeCompare(b.agent_id))
  }

  async function assertAvailableAgent(agentId) {
    const normalizedAgentId = normalizeAgentId(agentId)
    assertValidAgentId(normalizedAgentId)

    const available = await listAvailableAgents()
    const manifest = available.find((agent) => agent.agent_id === normalizedAgentId)
    if (!manifest) {
      const error = new Error('agent_manifest_not_found')
      error.code = 'agent_manifest_not_found'
      throw error
    }

    return manifest
  }

  async function registerAgent(agentId) {
    const manifest = await assertAvailableAgent(agentId)
    const normalizedAgentId = manifest.agent_id
    const registry = await readRegistry()
    const existing = registry.agents[normalizedAgentId]

    registry.agents[normalizedAgentId] = existing
      ? normalizeRegistryRecord(existing)
      : {
        registered_at: nowIso(),
        status: 'stopped',
        show_in_lobby: true,
        last_started_at: null,
        last_stopped_at: null,
      }

    await writeRegistryAtomic(registry)
    return {
      ...manifest,
      agent_id: normalizedAgentId,
      ...registry.agents[normalizedAgentId],
      available: true,
    }
  }

  async function unregisterAgent(agentId) {
    const normalizedAgentId = normalizeAgentId(agentId)
    assertValidAgentId(normalizedAgentId)

    const registry = await readRegistry()
    if (!registry.agents[normalizedAgentId]) {
      return { agent_id: normalizedAgentId, removed: false }
    }

    delete registry.agents[normalizedAgentId]
    await writeRegistryAtomic(registry)
    return { agent_id: normalizedAgentId, removed: true }
  }

  async function assertRegisteredAgent(agentId) {
    const normalizedAgentId = normalizeAgentId(agentId)
    assertValidAgentId(normalizedAgentId)

    const registry = await readRegistry()
    const record = registry.agents[normalizedAgentId]
    if (!record) {
      const error = new Error('agent_not_registered')
      error.code = 'agent_not_registered'
      throw error
    }

    return { registry, normalizedAgentId, record }
  }

  async function startAgent(agentId) {
    const { registry, normalizedAgentId, record } = await assertRegisteredAgent(agentId)
    if (record.status !== 'running') {
      registry.agents[normalizedAgentId] = {
        ...record,
        status: 'running',
        last_started_at: nowIso(),
      }
      await writeRegistryAtomic(registry)
    }

    return {
      agent_id: normalizedAgentId,
      ...registry.agents[normalizedAgentId],
    }
  }

  async function stopAgent(agentId) {
    const { registry, normalizedAgentId, record } = await assertRegisteredAgent(agentId)
    if (record.status !== 'stopped') {
      registry.agents[normalizedAgentId] = {
        ...record,
        status: 'stopped',
        last_stopped_at: nowIso(),
      }
      await writeRegistryAtomic(registry)
    }

    return {
      agent_id: normalizedAgentId,
      ...registry.agents[normalizedAgentId],
    }
  }

  async function reconcile() {
    const [registry, available] = await Promise.all([
      readRegistry(),
      listAvailableAgents(),
    ])

    const availableIds = new Set(available.map((agent) => agent.agent_id))
    const removed = []

    for (const agentId of Object.keys(registry.agents)) {
      if (!availableIds.has(agentId)) {
        removed.push(agentId)
        delete registry.agents[agentId]
      }
    }

    if (removed.length) {
      await writeRegistryAtomic(registry)
    }

    return {
      removed: removed.sort(),
      remaining_count: Object.keys(registry.agents).length,
    }
  }

  return {
    listAvailableAgents,
    listRegisteredAgents,
    registerAgent,
    unregisterAgent,
    startAgent,
    stopAgent,
    reconcile,
  }
}
