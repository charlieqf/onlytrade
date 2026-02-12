import { describe, it, expect } from 'vitest'
import { api } from './api'

describe('chat api', () => {
  it('exposes room chat methods', () => {
    expect(typeof api.bootstrapChatSession).toBe('function')
    expect(typeof api.getRoomPublicMessages).toBe('function')
    expect(typeof api.getRoomPrivateMessages).toBe('function')
    expect(typeof api.postRoomMessage).toBe('function')
  })
})
