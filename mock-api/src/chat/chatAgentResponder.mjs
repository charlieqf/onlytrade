function clampThreshold(value, fallback = 0.05) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(parsed, 1))
}

function sanitizeGeneratedText(value, fallback = '') {
  const text = String(value || '').trim()
  if (!text) return fallback
  return text.slice(0, 1200)
}

export function shouldAgentReply({
  messageType,
  random = Math.random(),
  threshold = 0.05,
} = {}) {
  if (messageType === 'public_mention_agent' || messageType === 'private_agent_dm') {
    return true
  }
  if (messageType === 'public_plain') {
    const safeThreshold = clampThreshold(threshold)
    return Number(random) < safeThreshold
  }
  return false
}

export function buildAgentReply({
  roomAgent,
  inboundMessage,
  text,
  nowMs = Date.now(),
} = {}) {
  const safeNowMs = Number(nowMs)
  const messageTs = Number.isFinite(safeNowMs) ? safeNowMs : Date.now()
  const agentName = String(roomAgent?.agentName || roomAgent?.agentHandle || 'Agent').trim() || 'Agent'

  return {
    id: `msg_agent_${messageTs}_${Math.random().toString(36).slice(2, 8)}`,
    room_id: String(inboundMessage?.room_id || ''),
    user_session_id: String(inboundMessage?.user_session_id || ''),
    sender_type: 'agent',
    sender_name: agentName,
    visibility: inboundMessage?.visibility === 'private' ? 'private' : 'public',
    message_type: String(inboundMessage?.message_type || 'public_plain'),
    text: sanitizeGeneratedText(text, `${agentName}：收到。`),
    created_ts_ms: messageTs,
  }
}

export function buildProactiveAgentMessage({
  roomAgent,
  roomId,
  text,
  nowMs = Date.now(),
} = {}) {
  const safeNowMs = Number(nowMs)
  const messageTs = Number.isFinite(safeNowMs) ? safeNowMs : Date.now()
  const agentName = String(roomAgent?.agentName || roomAgent?.agentHandle || 'Agent').trim() || 'Agent'

  return {
    id: `msg_agent_${messageTs}_${Math.random().toString(36).slice(2, 8)}`,
    room_id: String(roomId || ''),
    user_session_id: 'room_broadcast',
    sender_type: 'agent',
    sender_name: agentName,
    visibility: 'public',
    message_type: 'public_plain',
    text: sanitizeGeneratedText(text, `${agentName}：收到。`),
    created_ts_ms: messageTs,
  }
}
