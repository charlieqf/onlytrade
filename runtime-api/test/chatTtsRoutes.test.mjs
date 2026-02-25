import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, rm } from 'node:fs/promises'
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

async function deleteWithToken(baseUrl, pathName, { token = '' } = {}) {
  const headers = {}
  if (token) headers['x-control-token'] = token
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: 'DELETE',
    headers,
  })
  const body = await response.json()
  return { response, body }
}

async function startMockServer(handler) {
  const server = createServer(handler)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : null
  if (!port) throw new Error('mock_server_port_unavailable')
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  }
}

async function stopMockServer(server) {
  if (!server || !server.listening) return
  await new Promise((resolve) => {
    server.close(() => resolve())
  })
}

async function readRequestJson(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

test('chat tts config + validation routes', { timeout: 45000 }, async (t) => {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: RUNTIME_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
      CHAT_TTS_ENABLED: 'true',
      OPENAI_API_KEY: 'test_dummy_key',
      OPENAI_BASE_URL: 'http://127.0.0.1:1',
      CHAT_TTS_PROFILE_PATH: path.resolve(__dirname, '.tmp', `tts-profiles-${port}.json`),
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
    cwd: RUNTIME_API_DIR,
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

test('chat tts profile endpoints enforce token and persist room overrides', { timeout: 60000 }, async (t) => {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const token = 'tts-control-token'
  const tmpDir = path.resolve(__dirname, '.tmp', `tts-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const profilePath = path.join(tmpDir, 'tts_profiles.json')
  const registryPath = path.join(tmpDir, 'registry.json')
  await mkdir(tmpDir, { recursive: true })

  const commonEnv = {
    ...process.env,
    PORT: String(port),
    AGENT_LLM_ENABLED: 'false',
    CHAT_LLM_ENABLED: 'false',
    RUNTIME_DATA_MODE: 'replay',
    STRICT_LIVE_MODE: 'false',
    CHAT_TTS_ENABLED: 'true',
    OPENAI_API_KEY: 'test_dummy_key',
    OPENAI_BASE_URL: 'http://127.0.0.1:1',
    CONTROL_API_TOKEN: token,
    CHAT_TTS_PROFILE_PATH: profilePath,
    AGENT_REGISTRY_PATH: registryPath,
  }

  let child = spawn(process.execPath, ['server.mjs'], {
    cwd: RUNTIME_API_DIR,
    env: commonEnv,
    stdio: 'ignore',
  })

  t.after(async () => {
    await stopChild(child)
    await rm(tmpDir, { recursive: true, force: true })
  })

  await waitForServer(baseUrl)

  const register = await postJson(baseUrl, '/api/agents/t_003/register', {}, { token })
  assert.equal(register.response.ok, true)

  const beforeSetRes = await fetch(`${baseUrl}/api/chat/tts/profile?room_id=t_003`)
  const beforeSetBody = await beforeSetRes.json()
  assert.equal(beforeSetRes.ok, true)
  assert.equal(beforeSetBody.data.profile.provider, 'openai')
  assert.equal(beforeSetBody.data.profile.has_override, false)

  const unauthorizedSet = await postJson(
    baseUrl,
    '/api/chat/tts/profile',
    { room_id: 't_003', provider: 'selfhosted', voice: 'xuanyijiangjie', fallback_provider: 'openai' }
  )
  assert.equal(unauthorizedSet.response.status, 401)
  assert.equal(unauthorizedSet.body.error, 'unauthorized_control_token')

  const authorizedSet = await postJson(
    baseUrl,
    '/api/chat/tts/profile',
    { room_id: 't_003', provider: 'selfhosted', voice: 'xuanyijiangjie', speed: 1.1, fallback_provider: 'openai' },
    { token }
  )
  assert.equal(authorizedSet.response.ok, true)
  assert.equal(authorizedSet.body.data.profile.provider, 'selfhosted')
  assert.equal(authorizedSet.body.data.profile.has_override, true)

  const afterSetRes = await fetch(`${baseUrl}/api/chat/tts/profile?room_id=t_003`)
  const afterSetBody = await afterSetRes.json()
  assert.equal(afterSetRes.ok, true)
  assert.equal(afterSetBody.data.profile.provider, 'selfhosted')
  assert.equal(afterSetBody.data.profile.voice, 'xuanyijiangjie')
  assert.equal(afterSetBody.data.profile.has_override, true)

  await stopChild(child)
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: RUNTIME_API_DIR,
    env: commonEnv,
    stdio: 'ignore',
  })
  await waitForServer(baseUrl)

  const registerAfterRestart = await postJson(baseUrl, '/api/agents/t_003/register', {}, { token })
  assert.equal(registerAfterRestart.response.ok, true)

  const afterRestartRes = await fetch(`${baseUrl}/api/chat/tts/profile?room_id=t_003`)
  const afterRestartBody = await afterRestartRes.json()
  assert.equal(afterRestartRes.ok, true)
  assert.equal(afterRestartBody.data.profile.provider, 'selfhosted')
  assert.equal(afterRestartBody.data.profile.voice, 'xuanyijiangjie')
  assert.equal(afterRestartBody.data.profile.has_override, true)

  const unauthorizedClear = await deleteWithToken(baseUrl, '/api/chat/tts/profile?room_id=t_003')
  assert.equal(unauthorizedClear.response.status, 401)
  assert.equal(unauthorizedClear.body.error, 'unauthorized_control_token')

  const authorizedClear = await deleteWithToken(baseUrl, '/api/chat/tts/profile?room_id=t_003', { token })
  assert.equal(authorizedClear.response.ok, true)
  assert.equal(authorizedClear.body.data.profile.has_override, false)

  const afterClearRes = await fetch(`${baseUrl}/api/chat/tts/profile?room_id=t_003`)
  const afterClearBody = await afterClearRes.json()
  assert.equal(afterClearRes.ok, true)
  assert.equal(afterClearBody.data.profile.provider, 'openai')
  assert.equal(afterClearBody.data.profile.has_override, false)
})

test('chat tts dispatches across openai and selfhosted providers', { timeout: 60000 }, async (t) => {
  const openAiCalls = []
  const selfHostedCalls = []

  const openAiMock = await startMockServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/audio/speech') {
      const body = await readRequestJson(req)
      openAiCalls.push(body)
      const payload = Buffer.from('MOCK_OPENAI_MP3')
      res.statusCode = 200
      res.setHeader('Content-Type', 'audio/mpeg')
      res.setHeader('Content-Length', String(payload.length))
      res.end(payload)
      return
    }

    res.statusCode = 404
    res.end('not_found')
  })

  const selfHostedMock = await startMockServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/tts') {
      const body = await readRequestJson(req)
      selfHostedCalls.push(body)

      if (String(body.voice_id || '').trim() === 'trigger_fail') {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'mock_selfhosted_failure' }))
        return
      }

      const payload = Buffer.from('RIFFMOCKWAVDATA')
      res.statusCode = 200
      res.setHeader('Content-Type', 'audio/wav')
      res.setHeader('Content-Length', String(payload.length))
      res.end(payload)
      return
    }

    res.statusCode = 404
    res.end('not_found')
  })

  t.after(async () => {
    await stopMockServer(openAiMock.server)
    await stopMockServer(selfHostedMock.server)
  })

  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const token = 'dispatch-control-token'
  const tmpDir = path.resolve(__dirname, '.tmp', `tts-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await mkdir(tmpDir, { recursive: true })

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: RUNTIME_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      CHAT_LLM_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
      CHAT_TTS_ENABLED: 'true',
      CONTROL_API_TOKEN: token,
      OPENAI_API_KEY: 'test_dummy_key',
      OPENAI_BASE_URL: openAiMock.baseUrl,
      CHAT_TTS_SELFHOSTED_URL: `${selfHostedMock.baseUrl}/tts`,
      CHAT_TTS_SELFHOSTED_MEDIA_TYPE: 'wav',
      CHAT_TTS_PROFILE_PATH: path.join(tmpDir, 'tts_profiles.json'),
      AGENT_REGISTRY_PATH: path.join(tmpDir, 'registry.json'),
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    await stopChild(child)
    await rm(tmpDir, { recursive: true, force: true })
  })

  await waitForServer(baseUrl)

  const register = await postJson(baseUrl, '/api/agents/t_003/register', {}, { token })
  assert.equal(register.response.ok, true)

  const defaultSpeechRes = await fetch(`${baseUrl}/api/chat/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: 't_003', text: 'openai-default' }),
  })
  assert.equal(defaultSpeechRes.ok, true)
  assert.equal(defaultSpeechRes.headers.get('x-tts-provider'), 'openai')
  assert.equal(defaultSpeechRes.headers.get('x-tts-provider-requested'), 'openai')
  assert.equal(defaultSpeechRes.headers.get('x-tts-fallback-used'), 'false')
  assert.equal(defaultSpeechRes.headers.get('x-tts-model'), 'tts-1-hd')

  const setSelfHosted = await postJson(
    baseUrl,
    '/api/chat/tts/profile',
    { room_id: 't_003', provider: 'selfhosted', voice: 'xuanyijiangjie', fallback_provider: 'openai' },
    { token }
  )
  assert.equal(setSelfHosted.response.ok, true)

  const selfHostedSpeechRes = await fetch(`${baseUrl}/api/chat/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: 't_003', text: 'selfhosted-route' }),
  })
  assert.equal(selfHostedSpeechRes.ok, true)
  assert.equal(selfHostedSpeechRes.headers.get('x-tts-provider'), 'selfhosted')
  assert.equal(selfHostedSpeechRes.headers.get('x-tts-provider-requested'), 'selfhosted')
  assert.equal(selfHostedSpeechRes.headers.get('x-tts-fallback-used'), 'false')
  assert.equal(selfHostedSpeechRes.headers.get('x-tts-model'), 'selfhosted')
  assert.equal(selfHostedSpeechRes.headers.get('content-type'), 'audio/wav')

  const setFailingVoice = await postJson(
    baseUrl,
    '/api/chat/tts/profile',
    { room_id: 't_003', provider: 'selfhosted', voice: 'trigger_fail', fallback_provider: 'openai' },
    { token }
  )
  assert.equal(setFailingVoice.response.ok, true)

  const fallbackSpeechRes = await fetch(`${baseUrl}/api/chat/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: 't_003', text: 'selfhosted-fallback-openai' }),
  })
  assert.equal(fallbackSpeechRes.ok, true)
  assert.equal(fallbackSpeechRes.headers.get('x-tts-provider'), 'openai')
  assert.equal(fallbackSpeechRes.headers.get('x-tts-provider-requested'), 'selfhosted')
  assert.equal(fallbackSpeechRes.headers.get('x-tts-fallback-used'), 'true')

  assert.equal(openAiCalls.length >= 2, true)
  assert.equal(selfHostedCalls.length >= 2, true)
  assert.equal(selfHostedCalls.some((row) => row.media_type === 'wav'), true)
})
