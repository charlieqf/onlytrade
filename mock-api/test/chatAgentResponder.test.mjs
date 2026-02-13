import test from 'node:test'
import assert from 'node:assert/strict'

import { buildProactiveAgentMessage, shouldAgentReply } from '../src/chat/chatAgentResponder.mjs'

test('agent reply policy by message type', () => {
  assert.equal(shouldAgentReply({ messageType: 'public_mention_agent' }), true)
  assert.equal(shouldAgentReply({ messageType: 'private_agent_dm' }), true)
  assert.equal(shouldAgentReply({ messageType: 'public_plain', random: 0.99, threshold: 0.1 }), false)
})

test('proactive message can be personality-first and non-stock', () => {
  const message = buildProactiveAgentMessage({
    roomAgent: {
      agentName: 'HS300 Momentum',
    },
    roomId: 't_001',
    latestDecision: {
      decisions: [{ symbol: '600519.SH' }],
    },
    nowMs: 61_000,
  })

  const personalityHints = [
    'vibe check',
    'small reset reminder',
    'community prompt',
    'question of the moment',
  ]
  assert.equal(personalityHints.some((hint) => message.text.includes(hint)), true)
  assert.equal(message.text.includes('Current focus:'), false)
})
