import {
  buildAgentReply,
  buildProactiveAgentMessage,
  shouldAgentReply as defaultShouldAgentReply,
} from './chatAgentResponder.mjs'
import { validateMessageType } from './chatContract.mjs'

const MENTION_TOKEN_RE = /@([a-zA-Z0-9_]+)/g

function chatError(code, status = 400) {
  const error = new Error(code)
  error.code = code
  error.status = status
  return error
}

function normalizeVisibility(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'private' ? 'private' : 'public'
}

function parseMentions(text) {
  const tokens = []
  const matches = String(text || '').matchAll(MENTION_TOKEN_RE)
  for (const match of matches) {
    tokens.push(String(match[1] || '').toLowerCase())
  }
  return tokens
}

function sanitizeText(value) {
  return String(value || '').trim()
}

function sanitizeNickname(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ')
  if (!text) return ''
  return text.slice(0, 24)
}

function dayKeyInTimeZone(tsMs, timeZone = 'Asia/Shanghai') {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return dtf.format(new Date(tsMs))
}

function filterTodayMessages(messages, nowMs, timeZone = 'Asia/Shanghai') {
  const today = dayKeyInTimeZone(nowMs, timeZone)
  return messages.filter((item) => {
    const ts = Number(item?.created_ts_ms)
    if (!Number.isFinite(ts)) return false
    return dayKeyInTimeZone(ts, timeZone) === today
  })
}

function fallbackNicknameFromSessionId(userSessionId) {
  const token = String(userSessionId || '').replace(/[^a-zA-Z0-9]/g, '')
  const tail = token.slice(-4).toUpperCase()
  if (!tail) return 'User'
  return `User-${tail}`
}

function buildMessageId(nowMs) {
  return `msg_${nowMs}_${Math.random().toString(36).slice(2, 8)}`
}

function buildRateLimiter(limitPerMin) {
  const buckets = new Map()
  const safeLimit = Math.max(1, Number(limitPerMin) || 20)

  return {
    assert(roomId, userSessionId, nowMs) {
      const key = `${roomId}::${userSessionId}`
      const windowStart = nowMs - 60_000
      const previous = buckets.get(key) || []
      const active = previous.filter((ts) => ts >= windowStart)

      if (active.length >= safeLimit) {
        throw chatError('rate_limited', 429)
      }

      active.push(nowMs)
      buckets.set(key, active)
    },
  }
}

function assertMessageVisibility(messageType, visibility) {
  if (messageType === 'private_agent_dm' && visibility !== 'private') {
    throw chatError('invalid_visibility', 400)
  }
  if (messageType !== 'private_agent_dm' && visibility !== 'public') {
    throw chatError('invalid_visibility', 400)
  }
}

function assertMentionTargets({ text, messageType, roomAgent }) {
  const mentions = parseMentions(text)
  if (!mentions.length) {
    if (messageType === 'public_mention_agent') {
      throw chatError('invalid_mention_target', 400)
    }
    return
  }

  const allowed = new Set(['agent'])
  const roomAgentHandle = String(roomAgent?.agentHandle || '').trim().toLowerCase()
  if (roomAgentHandle) {
    allowed.add(roomAgentHandle)
  }

  for (const token of mentions) {
    if (!allowed.has(token)) {
      throw chatError('invalid_mention_target', 400)
    }
  }
}

export function createChatService({
  store,
  resolveRoomAgent,
  resolveLatestDecision = () => null,
  nowMs = () => Date.now(),
  random = () => Math.random(),
  maxTextLen = Number(process.env.CHAT_MAX_TEXT_LEN || 600),
  rateLimitPerMin = Number(process.env.CHAT_RATE_LIMIT_PER_MIN || 20),
  publicPlainReplyRate = Number(process.env.CHAT_PUBLIC_PLAIN_REPLY_RATE || 0.05),
  proactivePublicIntervalMs = Number(process.env.CHAT_PUBLIC_PROACTIVE_INTERVAL_MS || 90_000),
  chatContextTimeZone = process.env.CHAT_CONTEXT_TIMEZONE || 'Asia/Shanghai',
  shouldAgentReply = defaultShouldAgentReply,
} = {}) {
  if (!store) {
    throw new Error('chat_store_required')
  }
  if (typeof resolveRoomAgent !== 'function') {
    throw new Error('resolve_room_agent_required')
  }

  const limiter = buildRateLimiter(rateLimitPerMin)
  const safeMaxTextLen = Math.max(1, Number(maxTextLen) || 600)
  const safePublicReplyRate = Number.isFinite(Number(publicPlainReplyRate))
    ? Math.max(0, Math.min(Number(publicPlainReplyRate), 1))
    : 0.05
  const safeProactivePublicIntervalMs = Math.max(10_000, Number(proactivePublicIntervalMs) || 90_000)
  const proactiveStateByRoom = new Map()

  function ensureRoomAgent(roomId) {
    const roomAgent = resolveRoomAgent(roomId)
    if (!roomAgent) {
      throw chatError('room_not_found', 404)
    }

    if (roomAgent.roomId && String(roomAgent.roomId) !== String(roomId)) {
      throw chatError('invalid_room_agent_mapping', 400)
    }

    if (roomAgent.agentId && String(roomAgent.agentId) !== String(roomId)) {
      throw chatError('invalid_room_agent_mapping', 400)
    }

    return roomAgent
  }

  async function readTodayContext(roomId, userSessionId, visibility) {
    if (visibility === 'private') {
      const privateMessages = await store.readPrivate(roomId, userSessionId, 500, null)
      return filterTodayMessages(privateMessages, nowMs(), chatContextTimeZone)
    }

    const publicMessages = await store.readPublic(roomId, 500, null)
    return filterTodayMessages(publicMessages, nowMs(), chatContextTimeZone)
  }

  async function maybeEmitProactivePublicMessage(roomId, roomAgent) {
    const now = nowMs()
    const lastProactiveTs = Number(proactiveStateByRoom.get(roomId) || 0)
    if (now - lastProactiveTs < safeProactivePublicIntervalMs) {
      return
    }

    const publicMessages = await store.readPublic(roomId, 500, null)
    const todayMessages = filterTodayMessages(publicMessages, now, chatContextTimeZone)
    const lastMessage = todayMessages[todayMessages.length - 1]
    const lastMessageTs = Number(lastMessage?.created_ts_ms)

    if (Number.isFinite(lastMessageTs) && now - lastMessageTs < safeProactivePublicIntervalMs) {
      return
    }

    const proactiveMessage = buildProactiveAgentMessage({
      roomAgent,
      roomId,
      latestDecision: resolveLatestDecision(roomId),
      historyContext: todayMessages,
      nowMs: now,
    })

    await store.appendPublic(roomId, proactiveMessage)
    proactiveStateByRoom.set(roomId, now)
  }

  async function postMessage({
    roomId,
    userSessionId,
    userNickname,
    visibility,
    text,
    messageType,
  }) {
    const safeRoomId = String(roomId || '').trim()
    const safeUserSessionId = String(userSessionId || '').trim()
    const safeVisibility = normalizeVisibility(visibility)
    const safeText = sanitizeText(text)
    const safeUserNickname = sanitizeNickname(userNickname) || fallbackNicknameFromSessionId(safeUserSessionId)
    const safeMessageType = String(messageType || '').trim()

    if (!safeRoomId) {
      throw chatError('invalid_room_id', 400)
    }
    if (!safeUserSessionId) {
      throw chatError('invalid_user_session_id', 400)
    }
    if (!validateMessageType(safeMessageType)) {
      throw chatError('invalid_message_type', 400)
    }
    if (!safeText) {
      throw chatError('invalid_text', 400)
    }
    if (safeText.length > safeMaxTextLen) {
      throw chatError('text_too_long', 400)
    }

    const roomAgent = ensureRoomAgent(safeRoomId)
    assertMessageVisibility(safeMessageType, safeVisibility)
    assertMentionTargets({ text: safeText, messageType: safeMessageType, roomAgent })

    const now = nowMs()
    limiter.assert(safeRoomId, safeUserSessionId, now)

    const userMessage = {
      id: buildMessageId(now),
      room_id: safeRoomId,
      user_session_id: safeUserSessionId,
      sender_type: 'user',
      sender_name: safeUserNickname,
      visibility: safeVisibility,
      message_type: safeMessageType,
      text: safeText,
      created_ts_ms: now,
    }

    if (safeVisibility === 'private') {
      await store.appendPrivate(safeRoomId, safeUserSessionId, userMessage)
    } else {
      await store.appendPublic(safeRoomId, userMessage)
    }

    let agentReply = null
    if (shouldAgentReply({ messageType: safeMessageType, random: random(), threshold: safePublicReplyRate })) {
      const nowReply = nowMs()
      agentReply = buildAgentReply({
        roomAgent,
        inboundMessage: userMessage,
        latestDecision: resolveLatestDecision(safeRoomId),
        historyContext: await readTodayContext(safeRoomId, safeUserSessionId, safeVisibility),
        nowMs: nowReply,
      })

      if (safeVisibility === 'private') {
        await store.appendPrivate(safeRoomId, safeUserSessionId, agentReply)
      } else {
        await store.appendPublic(safeRoomId, agentReply)
      }
    }

    return {
      message: userMessage,
      agent_reply: agentReply,
    }
  }

  async function getPublicMessages(roomId, { limit = 20, beforeTsMs = null } = {}) {
    const safeRoomId = String(roomId || '').trim()
    if (!safeRoomId) {
      throw chatError('invalid_room_id', 400)
    }

    const roomAgent = ensureRoomAgent(safeRoomId)
    if (beforeTsMs == null) {
      await maybeEmitProactivePublicMessage(safeRoomId, roomAgent)
    }
    return store.readPublic(safeRoomId, limit, beforeTsMs)
  }

  async function getPrivateMessages(roomId, userSessionId, { limit = 20, beforeTsMs = null } = {}) {
    const safeRoomId = String(roomId || '').trim()
    const safeUserSessionId = String(userSessionId || '').trim()

    if (!safeRoomId) {
      throw chatError('invalid_room_id', 400)
    }
    if (!safeUserSessionId) {
      throw chatError('invalid_user_session_id', 400)
    }

    ensureRoomAgent(safeRoomId)
    return store.readPrivate(safeRoomId, safeUserSessionId, limit, beforeTsMs)
  }

  return {
    postMessage,
    getPublicMessages,
    getPrivateMessages,
  }
}
