import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAgentReply,
  buildNarrationAgentMessage,
  buildProactiveAgentMessage,
  shouldAgentReply,
} from '../src/chat/chatAgentResponder.mjs'

test('agent reply policy by message type', () => {
  assert.equal(shouldAgentReply({ messageType: 'public_mention_agent' }), true)
  assert.equal(shouldAgentReply({ messageType: 'private_agent_dm' }), true)
  assert.equal(shouldAgentReply({ messageType: 'public_plain', random: 0.99, threshold: 0.1 }), false)
})

test('proactive message uses provided llm text', () => {
  const message = buildProactiveAgentMessage({
    roomAgent: {
      agentName: 'HS300 Momentum',
    },
    roomId: 't_001',
    text: 'LLM proactive text',
    nowMs: 61_000,
  })

  assert.equal(message.text, 'LLM proactive text')
  assert.equal(message.agent_message_kind, 'proactive')
})

test('agent reply uses provided llm text', () => {
  const message = buildAgentReply({
    roomAgent: {
      agentName: 'HS300 Momentum',
      personality: '冷静直接，偏顺势执行。',
    },
    inboundMessage: {
      room_id: 't_001',
      user_session_id: 'usr_sess_1',
      visibility: 'public',
      message_type: 'public_mention_agent',
      text: '@agent 汇报一下',
    },
    text: 'LLM reply text',
    nowMs: 123,
  })

  assert.equal(message.text, 'LLM reply text')
  assert.equal(message.agent_message_kind, 'reply')
})

test('narration message caps to two sentences and strips markdown', () => {
  const message = buildNarrationAgentMessage({
    roomAgent: {
      agentName: 'HS300 Momentum',
    },
    roomId: 't_001',
    text: '**第一句**。第二句！第三句？',
    nowMs: 9_000,
    maxChars: 200,
    maxSentences: 2,
  })

  assert.equal(message.agent_message_kind, 'narration')
  assert.equal(message.text, '第一句。第二句！')
})
