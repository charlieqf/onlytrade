import { describe, expect, test } from 'vitest'

import type { ChatMessage } from '../../types'
import { mergeChatMessages } from './mergeChatMessages'

function msg(id: string, createdTsMs: number, text: string): ChatMessage {
  return {
    id,
    room_id: 'room_1',
    user_session_id: 'sess_1',
    sender_type: 'user',
    sender_name: 'User',
    visibility: 'public',
    message_type: 'public_plain',
    text,
    created_ts_ms: createdTsMs,
  }
}

describe('mergeChatMessages', () => {
  test('deduplicates by id and keeps incoming update', () => {
    const previous = [msg('a', 10, 'old-a'), msg('b', 20, 'old-b')]
    const incoming = [msg('b', 20, 'new-b'), msg('c', 30, 'new-c')]

    const merged = mergeChatMessages(previous, incoming)

    expect(merged.map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(merged.find((row) => row.id === 'b')?.text).toBe('new-b')
  })

  test('sorts by created_ts_ms ascending and caps at 200', () => {
    const previous = []
    const incoming = Array.from({ length: 220 }, (_, idx) =>
      msg(`m-${idx + 1}`, idx + 1, `t-${idx + 1}`)
    )

    const merged = mergeChatMessages(previous, incoming)

    expect(merged.length).toBe(200)
    expect(merged[0]?.id).toBe('m-21')
    expect(merged[199]?.id).toBe('m-220')
  })
})
