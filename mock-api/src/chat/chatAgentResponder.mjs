function clampThreshold(value, fallback = 0.05) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(parsed, 1))
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
  latestDecision,
  nowMs = Date.now(),
} = {}) {
  const agentName = String(roomAgent?.agentName || roomAgent?.agentHandle || 'Agent').trim() || 'Agent'
  const symbol = String(latestDecision?.decisions?.[0]?.symbol || '').trim()
  const symbolHint = symbol ? ` Current focus: ${symbol}.` : ''

  let text = ''
  if (inboundMessage?.message_type === 'private_agent_dm') {
    text = `${agentName}: private thread received. I will keep responses in this channel.${symbolHint}`
  } else if (inboundMessage?.message_type === 'public_mention_agent') {
    text = `${agentName}: acknowledged in public room.${symbolHint}`
  } else {
    text = `${agentName}: noted.${symbolHint}`
  }

  return {
    id: `msg_agent_${nowMs}_${Math.random().toString(36).slice(2, 8)}`,
    room_id: String(inboundMessage?.room_id || ''),
    user_session_id: String(inboundMessage?.user_session_id || ''),
    sender_type: 'agent',
    visibility: inboundMessage?.visibility === 'private' ? 'private' : 'public',
    message_type: String(inboundMessage?.message_type || 'public_plain'),
    text,
    created_ts_ms: nowMs,
  }
}
