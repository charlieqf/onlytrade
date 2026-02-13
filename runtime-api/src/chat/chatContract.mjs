const MESSAGE_TYPES = new Set(['public_plain', 'public_mention_agent', 'private_agent_dm'])

function sanitizeId(value) {
  const safe = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_')
  return safe || 'unknown'
}

export function validateMessageType(messageType) {
  return MESSAGE_TYPES.has(String(messageType || '').trim())
}

export function chatStoragePaths(roomId, userSessionId) {
  const safeRoomId = sanitizeId(roomId)
  const safeUserSessionId = sanitizeId(userSessionId)

  return {
    publicPath: `data/chat/rooms/${safeRoomId}/public.jsonl`,
    privatePath: `data/chat/rooms/${safeRoomId}/dm/${safeUserSessionId}.jsonl`,
  }
}

export function getAllowedMessageTypes() {
  return Array.from(MESSAGE_TYPES)
}
