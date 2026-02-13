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

function createPersistentFakeStore(initialPublic = [], initialPrivate = []) {
  const publicMessages = [...initialPublic]
  const privateMessages = [...initialPrivate]

  return {
    publicMessages,
    privateMessages,
    store: {
      async appendPublic(_roomId, message) {
        publicMessages.push(message)
      },
      async appendPrivate(_roomId, _userSessionId, message) {
        privateMessages.push(message)
      },
      async readPublic(_roomId, limit = 20, beforeTsMs = null) {
        const filtered = beforeTsMs == null
          ? publicMessages
          : publicMessages.filter((item) => Number(item.created_ts_ms) < Number(beforeTsMs))
        return filtered.slice(-limit)
      },
      async readPrivate(_roomId, _userSessionId, limit = 20, beforeTsMs = null) {
        const filtered = beforeTsMs == null
          ? privateMessages
          : privateMessages.filter((item) => Number(item.created_ts_ms) < Number(beforeTsMs))
        return filtered.slice(-limit)
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
      isRunning: true,
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
      isRunning: true,
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

test('includes sender_name for user and agent messages', async () => {
  const fake = createFakeStore()
  const svc = createChatService({
    store: fake.store,
    resolveRoomAgent: () => ({
      roomId: 't_001',
      agentId: 't_001',
      agentHandle: 'hs300_momentum',
      agentName: 'HS300 Momentum',
      isRunning: true,
    }),
    shouldAgentReply: () => true,
    generateAgentMessageText: async () => 'LLM: noted in public room',
  })

  const result = await svc.postMessage({
    roomId: 't_001',
    userSessionId: 'usr_sess_1',
    userNickname: 'TraderFox',
    visibility: 'public',
    text: '@agent hi',
    messageType: 'public_mention_agent',
  })

  assert.equal(result.message.sender_name, 'TraderFox')
  assert.equal(result.agent_reply?.sender_name, 'HS300 Momentum')
})

test('agent reply uses today chat history context', async () => {
  const fake = createPersistentFakeStore([
    {
      id: 'old1',
      room_id: 't_001',
      user_session_id: 'usr_sess_1',
      sender_type: 'user',
      sender_name: 'TraderFox',
      visibility: 'public',
      message_type: 'public_plain',
      text: 'Can you revisit bank stocks?',
      created_ts_ms: Date.now() - 60_000,
    },
  ])

  const svc = createChatService({
    store: fake.store,
    resolveRoomAgent: () => ({
      roomId: 't_001',
      agentId: 't_001',
      agentHandle: 'hs300_momentum',
      agentName: 'HS300 Momentum',
      isRunning: true,
    }),
    shouldAgentReply: () => true,
    generateAgentMessageText: async ({ historyContext }) => `LLM history size=${historyContext.length}`,
  })

  const result = await svc.postMessage({
    roomId: 't_001',
    userSessionId: 'usr_sess_1',
    userNickname: 'TraderFox',
    visibility: 'public',
    text: '@agent give update',
    messageType: 'public_mention_agent',
  })

  assert.equal(result.agent_reply?.text, 'LLM history size=2')
})

test('injects proactive public message when room is quiet', async () => {
  let nowValue = 180_000
  const fake = createPersistentFakeStore([
    {
      id: 'm1',
      room_id: 't_001',
      user_session_id: 'usr_sess_1',
      sender_type: 'user',
      sender_name: 'TraderFox',
      visibility: 'public',
      message_type: 'public_plain',
      text: 'hello',
      created_ts_ms: 0,
    },
  ])

  const svc = createChatService({
    store: fake.store,
    resolveRoomAgent: () => ({
      roomId: 't_001',
      agentId: 't_001',
      agentHandle: 'hs300_momentum',
      agentName: 'HS300 Momentum',
      isRunning: true,
    }),
    nowMs: () => nowValue,
    proactivePublicIntervalMs: 60_000,
    generateAgentMessageText: async () => 'LLM proactive ping',
  })

  const messages = await svc.getPublicMessages('t_001', { limit: 20 })

  const proactive = messages.find((item) => item.sender_type === 'agent')
  assert.equal(Boolean(proactive), true)
  assert.equal(proactive?.text, 'LLM proactive ping')

  nowValue = 181_000
  const messagesAgain = await svc.getPublicMessages('t_001', { limit: 20 })
  const proactiveCount = messagesAgain.filter((item) => item.sender_type === 'agent').length
  assert.equal(proactiveCount, 1)
})

test('does not send agent messages when room agent is stopped', async () => {
  const fake = createFakeStore()
  const svc = createChatService({
    store: fake.store,
    resolveRoomAgent: () => ({
      roomId: 't_001',
      agentId: 't_001',
      agentHandle: 'hs300_momentum',
      agentName: 'HS300 Momentum',
      isRunning: false,
    }),
    shouldAgentReply: () => true,
    generateAgentMessageText: async () => 'LLM should not be used',
  })

  const result = await svc.postMessage({
    roomId: 't_001',
    userSessionId: 'usr_sess_1',
    visibility: 'public',
    text: '@agent hello',
    messageType: 'public_mention_agent',
  })

  assert.equal(result.agent_reply, null)
  const agentWrites = fake.calls.publicWrites.filter((m) => m.sender_type === 'agent')
  assert.equal(agentWrites.length, 0)
})
