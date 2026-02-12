import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldAgentReply } from '../src/chat/chatAgentResponder.mjs'

test('agent reply policy by message type', () => {
  assert.equal(shouldAgentReply({ messageType: 'public_mention_agent' }), true)
  assert.equal(shouldAgentReply({ messageType: 'private_agent_dm' }), true)
  assert.equal(shouldAgentReply({ messageType: 'public_plain', random: 0.99, threshold: 0.1 }), false)
})
