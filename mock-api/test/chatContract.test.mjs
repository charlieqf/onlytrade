import test from 'node:test'
import assert from 'node:assert/strict'

import { chatStoragePaths, validateMessageType } from '../src/chat/chatContract.mjs'

test('chat contract supports only three message types', () => {
  assert.equal(validateMessageType('public_plain'), true)
  assert.equal(validateMessageType('public_mention_agent'), true)
  assert.equal(validateMessageType('private_agent_dm'), true)
  assert.equal(validateMessageType('public_mention_user'), false)
})

test('chat contract returns public and private storage paths', () => {
  const paths = chatStoragePaths('t_001', 'usr_sess_1')
  assert.equal(paths.publicPath, 'data/chat/rooms/t_001/public.jsonl')
  assert.equal(paths.privatePath, 'data/chat/rooms/t_001/dm/usr_sess_1.jsonl')
})
