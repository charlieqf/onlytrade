import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveRuntimeDataMode } from '../src/runtimeDataMode.mjs'

test('resolveRuntimeDataMode supports replay and live_file', () => {
  assert.equal(resolveRuntimeDataMode('replay'), 'replay')
  assert.equal(resolveRuntimeDataMode('live_file'), 'live_file')
  assert.equal(resolveRuntimeDataMode('LIVE_FILE'), 'live_file')
  assert.equal(resolveRuntimeDataMode('unknown'), 'replay')
  assert.equal(resolveRuntimeDataMode(''), 'replay')
})
