import test from 'node:test'
import assert from 'node:assert/strict'

import { createChatService } from '../src/chat/chatService.mjs'

function createFakeStore() {
  const calls = {
    publicWrites: [],
    privateWrites: [],
  }

  return {
    calls,
    store: {
      async appendPublic(_roomId, message) {
        calls.publicWrites.push(message)
      },
      async appendPrivate(_roomId, _userSessionId, message) {
        calls.privateWrites.push(message)
      },
      async readPublic() {
        return []
      },
      async readPrivate() {
        return []
      },
    },
  }
}

test('rejects mention targets other than room agent', async () => {
  const fake = createFakeStore()
  const svc = createChatService({
    store: fake.store,
    resolveRoomAgent: () => ({
      roomId: 't_001',
      agentId: 't_001',
      agentHandle: 'hs300_momentum',
    }),
  })

  await assert.rejects(
    () => svc.postMessage({
      roomId: 't_001',
      userSessionId: 'usr_sess_1',
      visibility: 'public',
      text: '@john hi',
      messageType: 'public_mention_agent',
    }),
    /invalid_mention_target/
  )
})

test('routes private_agent_dm into private writer', async () => {
  const fake = createFakeStore()
  const svc = createChatService({
    store: fake.store,
    resolveRoomAgent: () => ({
      roomId: 't_001',
      agentId: 't_001',
      agentHandle: 'hs300_momentum',
    }),
  })

  await svc.postMessage({
    roomId: 't_001',
    userSessionId: 'usr_sess_1',
    visibility: 'private',
    text: 'hi agent',
    messageType: 'private_agent_dm',
  })

  assert.equal(fake.calls.privateWrites.length >= 1, true)
  assert.equal(fake.calls.privateWrites[0].sender_type, 'user')
  assert.equal(fake.calls.privateWrites[0].visibility, 'private')
})
