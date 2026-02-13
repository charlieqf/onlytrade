import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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

test('chat routes bootstrap and room message flow', { timeout: 45000 }, async (t) => {
  const port = 18081
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: MOCK_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
    },
    stdio: 'ignore',
  })

  t.after(() => {
    child.kill('SIGTERM')
  })

  await waitForServer(baseUrl)

  const res = await fetch(`${baseUrl}/api/chat/session/bootstrap`, { method: 'POST' })
  const body = await res.json()

  assert.equal(res.ok, true)
  assert.equal(body.success, true)
  assert.ok(body.data.user_session_id)
  assert.equal(String(body.data.user_session_id).startsWith('usr_sess_'), true)
  assert.ok(body.data.user_nickname)

  const userSessionId = String(body.data.user_session_id)

  const registerRes = await fetch(`${baseUrl}/api/agents/t_001/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const registerBody = await registerRes.json()
  assert.equal(registerRes.ok, true)
  assert.equal(registerBody.success, true)

  const publicReadBefore = await fetch(`${baseUrl}/api/chat/rooms/t_001/public?limit=20`)
  const publicReadBeforeBody = await publicReadBefore.json()
  assert.equal(publicReadBefore.ok, true)
  assert.equal(Array.isArray(publicReadBeforeBody.data.messages), true)
  assert.equal(publicReadBeforeBody.data.messages.some((item) => item.sender_type === 'agent'), true)

  const invalidMentionRes = await fetch(`${baseUrl}/api/chat/rooms/t_001/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_session_id: userSessionId,
      visibility: 'public',
      message_type: 'public_mention_agent',
      text: '@john hi',
    }),
  })
  const invalidMentionBody = await invalidMentionRes.json()
  assert.equal(invalidMentionRes.status, 400)
  assert.equal(invalidMentionBody.success, false)
  assert.equal(invalidMentionBody.error, 'invalid_mention_target')

  const validPublicPost = await fetch(`${baseUrl}/api/chat/rooms/t_001/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_session_id: userSessionId,
      visibility: 'public',
      message_type: 'public_mention_agent',
      text: '@agent status?',
    }),
  })
  const publicPostBody = await validPublicPost.json()
  assert.equal(validPublicPost.ok, true)
  assert.equal(publicPostBody.success, true)
  assert.equal(typeof publicPostBody.data.message.sender_name, 'string')
  assert.equal(typeof publicPostBody.data.agent_reply.sender_name, 'string')

  const publicReadAfter = await fetch(`${baseUrl}/api/chat/rooms/t_001/public?limit=20`)
  const publicReadBody = await publicReadAfter.json()
  assert.equal(publicReadAfter.ok, true)
  assert.equal(publicReadBody.success, true)
  assert.equal(Array.isArray(publicReadBody.data.messages), true)
  assert.equal(publicReadBody.data.messages.length >= 2, true)

  const privatePost = await fetch(`${baseUrl}/api/chat/rooms/t_001/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_session_id: userSessionId,
      visibility: 'private',
      message_type: 'private_agent_dm',
      text: 'private hello',
    }),
  })
  assert.equal(privatePost.ok, true)

  const privateRead = await fetch(`${baseUrl}/api/chat/rooms/t_001/private?user_session_id=${encodeURIComponent(userSessionId)}&limit=20`)
  const privateReadBody = await privateRead.json()
  assert.equal(privateRead.ok, true)
  assert.equal(privateReadBody.success, true)
  assert.equal(Array.isArray(privateReadBody.data.messages), true)
  assert.equal(privateReadBody.data.messages.length >= 2, true)
})
