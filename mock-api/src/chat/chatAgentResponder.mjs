function clampThreshold(value, fallback = 0.05) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(parsed, 1))
}

function normalizeHistory(historyContext) {
  if (!Array.isArray(historyContext)) return []
  return historyContext
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      sender_type: String(item.sender_type || '').trim().toLowerCase(),
      text: String(item.text || '').trim(),
      created_ts_ms: Number(item.created_ts_ms),
    }))
    .filter((item) => item.text)
    .sort((a, b) => Number(a.created_ts_ms) - Number(b.created_ts_ms))
}

function truncate(text, maxLen = 48) {
  const value = String(text || '').trim()
  if (value.length <= maxLen) return value
  return `${value.slice(0, maxLen - 3)}...`
}

function buildContextHint(historyContext, currentInputText = '') {
  const history = normalizeHistory(historyContext)
  if (!history.length) return ''

  const current = String(currentInputText || '').trim()
  const candidate = [...history]
    .reverse()
    .find((item) => item.sender_type === 'user' && item.text && item.text !== current)

  if (!candidate) return ''
  return ` Recent room context: "${truncate(candidate.text)}".`
}

const PROACTIVE_PERSONALITY_TEMPLATES = [
  '{agent}: quick vibe check - how is everyone feeling right now?',
  '{agent}: quick vibe check - what are you watching today, market or life?',
  '{agent}: small reset reminder - relax shoulders and take one deep breath.',
  '{agent}: community prompt - share one small win from today.',
  '{agent}: question of the moment - what would make this room more useful?',
]

function stableHash(input) {
  const text = String(input || '')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function pickProactiveTemplate(roomId, nowMs) {
  const minuteBucket = Math.floor(Number(nowMs || 0) / 60_000)
  const seed = stableHash(`${roomId}:${minuteBucket}`)
  const idx = seed % PROACTIVE_PERSONALITY_TEMPLATES.length
  return PROACTIVE_PERSONALITY_TEMPLATES[idx]
}

function shouldAttachSymbolHint(roomId, nowMs) {
  const minuteBucket = Math.floor(Number(nowMs || 0) / 60_000)
  const seed = stableHash(`${roomId}:symbol:${minuteBucket}`)
  return seed % 3 === 0
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
  historyContext,
  nowMs = Date.now(),
} = {}) {
  const agentName = String(roomAgent?.agentName || roomAgent?.agentHandle || 'Agent').trim() || 'Agent'
  const symbol = String(latestDecision?.decisions?.[0]?.symbol || '').trim()
  const symbolHint = symbol ? ` Current focus: ${symbol}.` : ''
  const contextHint = buildContextHint(historyContext, inboundMessage?.text)

  let text = ''
  if (inboundMessage?.message_type === 'private_agent_dm') {
    text = `${agentName}: private thread received. I will keep responses in this channel.${symbolHint}${contextHint}`
  } else if (inboundMessage?.message_type === 'public_mention_agent') {
    text = `${agentName}: acknowledged in public room.${symbolHint}${contextHint}`
  } else {
    text = `${agentName}: noted.${symbolHint}${contextHint}`
  }

  return {
    id: `msg_agent_${nowMs}_${Math.random().toString(36).slice(2, 8)}`,
    room_id: String(inboundMessage?.room_id || ''),
    user_session_id: String(inboundMessage?.user_session_id || ''),
    sender_type: 'agent',
    sender_name: agentName,
    visibility: inboundMessage?.visibility === 'private' ? 'private' : 'public',
    message_type: String(inboundMessage?.message_type || 'public_plain'),
    text,
    created_ts_ms: nowMs,
  }
}

export function buildProactiveAgentMessage({
  roomAgent,
  roomId,
  latestDecision,
  historyContext,
  nowMs = Date.now(),
} = {}) {
  const safeNowMs = Number(nowMs)
  const messageTs = Number.isFinite(safeNowMs) ? safeNowMs : Date.now()
  const agentName = String(roomAgent?.agentName || roomAgent?.agentHandle || 'Agent').trim() || 'Agent'
  const symbol = String(latestDecision?.decisions?.[0]?.symbol || '').trim()
  const includeSymbol = shouldAttachSymbolHint(roomId, messageTs)
  const symbolHint = symbol && includeSymbol ? ` Current focus: ${symbol}.` : ''
  const contextHint = buildContextHint(historyContext)
  const template = pickProactiveTemplate(roomId, messageTs)
  const text = template.replace('{agent}', agentName)

  return {
    id: `msg_agent_${messageTs}_${Math.random().toString(36).slice(2, 8)}`,
    room_id: String(roomId || ''),
    user_session_id: 'room_broadcast',
    sender_type: 'agent',
    sender_name: agentName,
    visibility: 'public',
    message_type: 'public_plain',
    text: `${text}${symbolHint}${contextHint}`,
    created_ts_ms: messageTs,
  }
}
