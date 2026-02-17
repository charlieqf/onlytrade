import type { ChatMessage } from '../../types'

function hasChatMessageId(value: unknown): value is ChatMessage {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string'
  )
}

export function mergeChatMessages(
  previous: ChatMessage[] | undefined,
  incoming: ChatMessage[]
) {
  const prev = Array.isArray(previous) ? previous : []
  const nextItems = Array.isArray(incoming) ? incoming : []

  const byId = new Map<string, ChatMessage>()
  for (const msg of prev) {
    if (hasChatMessageId(msg)) {
      byId.set(msg.id, msg)
    }
  }
  for (const msg of nextItems) {
    if (hasChatMessageId(msg)) {
      byId.set(msg.id, msg)
    }
  }

  const out = Array.from(byId.values())
  out.sort(
    (a, b) => Number(a?.created_ts_ms || 0) - Number(b?.created_ts_ms || 0)
  )
  return out.slice(-200)
}
