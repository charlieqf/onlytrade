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

test('agent reply deduplicates repeated sender mention', () => {
  const message = buildAgentReply({
    roomAgent: {
      agentName: 'HS300 Momentum',
    },
    inboundMessage: {
      room_id: 't_001',
      user_session_id: 'usr_sess_1',
      visibility: 'public',
      message_type: 'public_mention_agent',
      sender_name: '观众02',
      text: '@agent 600986怎么看',
    },
    text: '@观众02 @观众02 当前偏震荡，先控仓。',
    nowMs: 456,
  })

  assert.equal(message.text.includes('@观众02 @观众02'), false)
  assert.match(message.text, /^@观众02\s/)
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

test('agent reply truncation keeps a clean ending', () => {
  const message = buildAgentReply({
    roomAgent: {
      agentName: 'HS300 Momentum',
    },
    inboundMessage: {
      room_id: 't_001',
      user_session_id: 'usr_sess_1',
      visibility: 'public',
      message_type: 'public_mention_agent',
      sender_name: '观众09',
      text: '@agent 给个简短更新',
    },
    text: '当前AI链条情绪回暖但成交分化明显，我先盯量价确认再执行，若信号失败就继续观望并把回撤风险控制在计划线内。',
    nowMs: 99_000,
    maxChars: 45,
    maxSentences: 2,
  })

  assert.equal(message.text.startsWith('@观众09 '), true)
  assert.equal(message.text.length <= 45, true)
  assert.match(message.text, /[。！？!?…]$/)
})
