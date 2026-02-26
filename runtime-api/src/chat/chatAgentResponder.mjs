function clampThreshold(value, fallback = 0.05) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(parsed, 1))
}

function stripMarkdown(value) {
  const text = String(value || '')
  if (!text) return ''

  // Remove fenced code blocks and inline code first.
  let cleaned = text.replace(/```[\s\S]*?```/g, ' ')
  cleaned = cleaned.replace(/`[^`]*`/g, ' ')

  // Drop common markdown tokens. Keep content, remove decoration.
  cleaned = cleaned
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')

  return cleaned
}

function capSentences(value, maxSentences = 2) {
  const text = String(value || '').trim()
  if (!text) return ''
  const cap = Math.max(1, Math.floor(Number(maxSentences) || 2))

  const out = []
  let buffer = ''
  for (const ch of text) {
    buffer += ch
    if (/[。！？!?]/.test(ch)) {
      const sentence = buffer.trim()
      if (sentence) out.push(sentence)
      buffer = ''
      if (out.length >= cap) break
    }
  }
  if (out.length < cap && buffer.trim()) {
    out.push(buffer.trim())
  }

  return out.join('')
}

function trimToMaxChars(value, maxChars = 120) {
  const text = String(value || '').trim()
  if (!text) return ''
  const cap = Math.max(24, Math.floor(Number(maxChars) || 120))
  if (text.length <= cap) return text

  const hard = text.slice(0, cap).trim()
  if (!hard) return ''

  let boundary = -1
  for (let i = hard.length - 1; i >= 0; i -= 1) {
    if (/[。！？!?，,；;：:\s]/.test(hard[i])) {
      boundary = i
      break
    }
  }

  let clipped = hard
  if (boundary >= Math.floor(cap * 0.6)) {
    clipped = hard.slice(0, boundary + 1).trim()
  }

  if (!/[。！？!?…]$/.test(clipped)) {
    const body = clipped.length >= cap
      ? clipped.slice(0, Math.max(0, cap - 1)).trimEnd()
      : clipped
    clipped = `${body}…`
  }

  return clipped
}

function sanitizeGeneratedText(value, fallback = '', { maxChars = 120, maxSentences = 2 } = {}) {
  const raw = String(value || '').trim()
  if (!raw) return fallback

  const flattened = stripMarkdown(raw).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  const sentenceCapped = capSentences(flattened, maxSentences)
  const trimmed = trimToMaxChars(sentenceCapped, maxChars)
  return trimmed || fallback
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collapseRepeatedMentions(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.replace(/(@[^\s@]{1,32})(?:\s+\1)+/g, '$1')
}

function ensureSingleSenderMentionPrefix(text, senderName) {
  const body = String(text || '').trim()
  const safeSenderName = String(senderName || '').trim()
  if (!safeSenderName) {
    return collapseRepeatedMentions(body)
  }

  const mention = `@${safeSenderName}`
  const escapedMention = escapeRegExp(mention)

  let normalized = body
  normalized = normalized.replace(new RegExp(`^(?:${escapedMention}[\\s，,。.!！?？:：-]*){2,}`), `${mention} `)
  normalized = collapseRepeatedMentions(normalized)

  if (new RegExp(`^${escapedMention}(?:\\s|$|[，,。.!！?？:：])`).test(normalized)) {
    return normalized
  }

  return `${mention} ${normalized}`.trim()
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
  maxChars = 120,
  maxSentences = 2,
} = {}) {
  const safeNowMs = Number(nowMs)
  const messageTs = Number.isFinite(safeNowMs) ? safeNowMs : Date.now()
  const agentName = String(roomAgent?.agentName || roomAgent?.agentHandle || 'Agent').trim() || 'Agent'

  const inboundSenderName = String(inboundMessage?.sender_name || '').trim()
  const fallbackText = `${agentName}：收到。`
  const generatedText = sanitizeGeneratedText(text, fallbackText, { maxChars, maxSentences })
  const normalizedReply = ensureSingleSenderMentionPrefix(generatedText, inboundSenderName)

  return {
    id: `msg_agent_${messageTs}_${Math.random().toString(36).slice(2, 8)}`,
    room_id: String(inboundMessage?.room_id || ''),
    user_session_id: String(inboundMessage?.user_session_id || ''),
    sender_type: 'agent',
    sender_name: agentName,
    visibility: inboundMessage?.visibility === 'private' ? 'private' : 'public',
    message_type: String(inboundMessage?.message_type || 'public_plain'),
    agent_message_kind: 'reply',
    text: sanitizeGeneratedText(
      normalizedReply,
      fallbackText,
      { maxChars, maxSentences }
    ),
    created_ts_ms: messageTs,
  }
}

export function buildProactiveAgentMessage({
  roomAgent,
  roomId,
  text,
  nowMs = Date.now(),
  maxChars = 120,
  maxSentences = 2,
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
    agent_message_kind: 'proactive',
    text: sanitizeGeneratedText(text, `${agentName}：收到。`, { maxChars, maxSentences }),
    created_ts_ms: messageTs,
  }
}

export function buildNarrationAgentMessage({
  roomAgent,
  roomId,
  text,
  nowMs = Date.now(),
  maxChars = 120,
  maxSentences = 2,
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
    agent_message_kind: 'narration',
    text: sanitizeGeneratedText(text, `${agentName}：收到。`, { maxChars, maxSentences }),
    created_ts_ms: messageTs,
  }
}
