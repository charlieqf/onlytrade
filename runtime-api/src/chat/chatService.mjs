import {
  buildAgentReply,
  buildProactiveAgentMessage,
  shouldAgentReply as defaultShouldAgentReply,
} from './chatAgentResponder.mjs'
import { validateMessageType } from './chatContract.mjs'
import { resolveProactiveCadence } from './newsBurst.mjs'

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

function isPolymarketRoomId(roomId) {
  return String(roomId || '').trim().toLowerCase() === 't_015'
}

function firstNonEmptyText(items, maxLen = 120) {
  const rows = Array.isArray(items) ? items : []
  for (const item of rows) {
    const text = String(item || '').trim()
    if (text) return text.slice(0, maxLen)
  }
  return ''
}

function resolvePolymarketTopicKey(roomContext, nowMs = Date.now()) {
  const signalTitle = String(roomContext?.news_burst_signal?.title || '').trim()
  const digestTitle = firstNonEmptyText(roomContext?.news_digest_titles, 140)
  const fallbackTitle = firstNonEmptyText(roomContext?.news_digest_headline_briefs, 140)
  const raw = signalTitle || digestTitle || fallbackTitle
  const normalized = normalizeForDedupe(raw).slice(0, 96)
  if (normalized) return `topic:${normalized}`
  const bucket = Math.floor((Number(nowMs) || Date.now()) / 120_000)
  return `time:${bucket}`
}

const POLYMARKET_TEXT_REPLACEMENTS = [
  [/\b\d{6}\.(?:SZ|SH)\b/g, '该事件'],
  [/\b(?:HSI|HSCEI|KOSPI|KOSDAQ|DJIA|SPX|NDX)\b/gi, '市场情绪'],
  [/量能/g, '讨论热度'],
  [/资金/g, '关注度'],
  [/利好/g, '正向信号'],
  [/利空/g, '负向信号'],
  [/涨停|跌停|涨幅|跌幅/g, '热度变化'],
  [/进场|出货|承接|拉升|追高|抄底|仓位|止损|建仓|加仓|减仓|交易|下单|买入|卖出/g, '判断'],
]

function sanitizePolymarketAgentText(value) {
  let text = String(value || '').trim()
  if (!text) return ''
  for (const [pattern, replacement] of POLYMARKET_TEXT_REPLACEMENTS) {
    text = text.replace(pattern, replacement)
  }
  text = text
    .replace(/\s{2,}/g, ' ')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[。.!！?？]{2,}/g, '。')
    .trim()
  return text
}

function looksLikeQuestionText(value) {
  const text = String(value || '').trim()
  if (!text) return false
  if (/[?？]$/.test(text)) return true
  return /(怎么看|怎么判断|为什么|咋看|可不可以|是否|要不要|行不行|有必要吗)/.test(text)
}

function normalizeForDedupe(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，,。.!！?？:：;；~`'"“”‘’\-_=+()\[\]{}<>\/\\]/g, '')
    .trim()
}

function isRoomAgentRunning(roomAgent) {
  return roomAgent?.isRunning === true || roomAgent?.is_running === true
}

function pickStable(items, keySeed = '', fallback = '') {
  const rows = Array.isArray(items)
    ? items.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  if (!rows.length) return fallback
  const key = String(keySeed || '')
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
  }
  const idx = Math.abs(hash) % rows.length
  return rows[idx] || fallback
}

function buildFallbackReplyText({ roomAgent, inboundMessage, roomContext, latestDecision, nowMs }) {
  const roomId = String(inboundMessage?.room_id || roomAgent?.roomId || '').trim().toLowerCase()
  if (isPolymarketRoomId(roomId)) {
    const sender = String(inboundMessage?.sender_name || '').trim() || '朋友'
    const newsTitle = pickStable(roomContext?.news_digest_titles, `${sender}|poly-news|${nowMs}`, '')
    const background = pickStable(roomContext?.news_background_notes, `${sender}|poly-bg|${nowMs}`, '')
    const fallbackCore = background || newsTitle || '这条事件先看公开来源是否出现新增确认'
    return `@${sender} 我先回应你这个判断：${String(fallbackCore).slice(0, 42)}。我们只做事件解读和概率讨论，不给操作指令。`
  }

  const sender = String(inboundMessage?.sender_name || '').trim() || '朋友'
  const symbol = String(
    latestDecision?.decisions?.[0]?.symbol
    || roomContext?.symbol_brief?.symbol
    || ''
  ).trim()
  const action = String(
    latestDecision?.decisions?.[0]?.action
    || roomContext?.symbol_brief?.action
    || 'hold'
  ).trim().toUpperCase()
  const newsTitle = pickStable(roomContext?.news_digest_titles, `${sender}|news|${nowMs}`, '')
  const casual = pickStable(roomContext?.casual_topics, `${sender}|casual|${nowMs}`, '')

  const tradeLine = symbol
    ? (action === 'BUY'
      ? `我会继续跟踪${symbol}的量价配合，确认后再进攻。`
      : action === 'SELL'
        ? `我先把${symbol}风险放在第一位，反弹不强就不恋战。`
        : `我对${symbol}先保持观察，等更清晰信号再动。`)
    : '我先把风险和节奏放前面，不着急抢动作。'

  const newsLine = newsTitle ? `另外这条消息也要盯：${newsTitle.slice(0, 24)}。` : ''
  const casualLineRaw = casual ? `${casual.slice(0, 22)}。` : '我们先稳住节奏，机会会有。'
  const casualLine = isTimeAwareChatTextAllowed(casualLineRaw, nowMs)
    ? casualLineRaw
    : timeAwareFallbackLine(nowMs)

  return `@${sender} ${tradeLine}${newsLine || casualLine}`
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

function shanghaiDayPart(tsMs) {
  const date = new Date(Number.isFinite(Number(tsMs)) ? Number(tsMs) : Date.now())
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  const [hh, mm] = hm.split(':').map((item) => Number(item || 0))
  const mins = hh * 60 + mm
  if (mins >= 330 && mins < 540) return 'early_morning'
  if (mins >= 540 && mins < 690) return 'morning_session'
  if (mins >= 690 && mins < 780) return 'lunch_break'
  if (mins >= 780 && mins < 900) return 'afternoon_session'
  if (mins >= 900 && mins < 1140) return 'evening'
  return 'night'
}

function isTimeAwareChatTextAllowed(text, tsMs) {
  const value = String(text || '').trim()
  if (!value) return false
  const dayPart = shanghaiDayPart(tsMs)
  const nightLife = /(下班|晚饭|晚餐|今晚|夜宵|熬夜|晚安|睡觉|收工)/i
  const morningOnly = /(早安|早餐|刚起床|上班路上|早盘刚开|刚到公司)/i

  if (
    (dayPart === 'early_morning' || dayPart === 'morning_session' || dayPart === 'lunch_break' || dayPart === 'afternoon_session')
    && nightLife.test(value)
  ) {
    return false
  }
  if ((dayPart === 'evening' || dayPart === 'night') && morningOnly.test(value)) {
    return false
  }
  return true
}

function timeAwareFallbackLine(tsMs) {
  const dayPart = shanghaiDayPart(tsMs)
  if (dayPart === 'early_morning' || dayPart === 'morning_session') {
    return '我先把早盘节奏稳住，等信号更清晰再同步。'
  }
  if (dayPart === 'lunch_break') {
    return '午间先复盘关键信号，下午再看确认位。'
  }
  if (dayPart === 'afternoon_session') {
    return '下午盘先守风险边界，再择机跟进。'
  }
  return '当前先以风控和节奏为主，不做情绪化动作。'
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
    // UX: the client can explicitly mark a message as an agent mention
    // even if the user didn't type "@agent". Treat that as an implicit
    // mention rather than rejecting the request.
    if (messageType === 'public_mention_agent') return
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
  resolveRoomContext = () => null,
  nowMs = () => Date.now(),
  random = () => Math.random(),
  maxTextLen = Number(process.env.CHAT_MAX_TEXT_LEN || 600),
  agentMaxChars = Number(process.env.CHAT_AGENT_MAX_CHARS || 120),
  agentMaxSentences = Number(process.env.CHAT_AGENT_MAX_SENTENCES || 2),
  rateLimitPerMin = Number(process.env.CHAT_RATE_LIMIT_PER_MIN || 20),
  publicPlainReplyRate = Number(process.env.CHAT_PUBLIC_PLAIN_REPLY_RATE || 0.05),
  proactivePublicIntervalMs = Number(process.env.CHAT_PUBLIC_PROACTIVE_INTERVAL_MS || 18_000),
  proactiveNewsBurstEnabled = String(process.env.CHAT_PROACTIVE_NEWS_BURST_ENABLED || 'true').toLowerCase() !== 'false',
  proactiveNewsBurstIntervalMs = Number(process.env.CHAT_PROACTIVE_NEWS_BURST_INTERVAL_MS || 9_000),
  proactiveNewsBurstDurationMs = Number(process.env.CHAT_PROACTIVE_NEWS_BURST_DURATION_MS || 120_000),
  proactiveNewsBurstCooldownMs = Number(process.env.CHAT_PROACTIVE_NEWS_BURST_COOLDOWN_MS || 480_000),
  chatContextTimeZone = process.env.CHAT_CONTEXT_TIMEZONE || 'Asia/Shanghai',
  shouldAgentReply = defaultShouldAgentReply,
  generateAgentMessageText = null,
  onPublicAppend = null,
  enableProactiveOnRead = true,
} = {}) {
  if (!store) {
    throw new Error('chat_store_required')
  }
  if (typeof resolveRoomAgent !== 'function') {
    throw new Error('resolve_room_agent_required')
  }

  const limiter = buildRateLimiter(rateLimitPerMin)
  const safeMaxTextLen = Math.max(1, Number(maxTextLen) || 600)
  const safeAgentMaxChars = Math.max(24, Math.min(800, Math.floor(Number(agentMaxChars) || 120)))
  const safeAgentMaxSentences = Math.max(1, Math.min(4, Math.floor(Number(agentMaxSentences) || 2)))
  const safePublicReplyRate = Number.isFinite(Number(publicPlainReplyRate))
    ? Math.max(0, Math.min(Number(publicPlainReplyRate), 1))
    : 0.05
  const safeProactivePublicIntervalMs = Math.max(10_000, Number(proactivePublicIntervalMs) || 90_000)
  const safeProactiveNewsBurstIntervalMs = Math.max(3_000, Number(proactiveNewsBurstIntervalMs) || 9_000)
  const safeProactiveNewsBurstDurationMs = Math.max(0, Number(proactiveNewsBurstDurationMs) || 120_000)
  const safeProactiveNewsBurstCooldownMs = Math.max(0, Number(proactiveNewsBurstCooldownMs) || 480_000)
  const safeProactiveNewsBurstEnabled = Boolean(proactiveNewsBurstEnabled)
  const proactiveStateByRoom = new Map()
  const proactiveInFlightByRoom = new Map()
  const proactiveBurstStateByRoom = new Map()
  const polymarketReplyBudgetByRoom = new Map()

  function consumePolymarketReplyBudget(roomId, roomContext, now) {
    const safeRoomId = String(roomId || '').trim().toLowerCase()
    if (!isPolymarketRoomId(safeRoomId)) return true
    const topicKey = resolvePolymarketTopicKey(roomContext, now)
    const prev = polymarketReplyBudgetByRoom.get(safeRoomId) || {
      topic_key: '',
      replied_count: 0,
      updated_ms: 0,
    }
    const next = String(prev.topic_key || '') === topicKey
      ? { ...prev }
      : { topic_key: topicKey, replied_count: 0, updated_ms: Number(now) || Date.now() }

    if (Number(next.replied_count || 0) >= 1) {
      polymarketReplyBudgetByRoom.set(safeRoomId, {
        ...next,
        updated_ms: Number(now) || Date.now(),
      })
      return false
    }

    polymarketReplyBudgetByRoom.set(safeRoomId, {
      ...next,
      replied_count: Number(next.replied_count || 0) + 1,
      updated_ms: Number(now) || Date.now(),
    })
    return true
  }

  function emitPublicAppendBestEffort(roomId, payload) {
    if (typeof onPublicAppend !== 'function') return
    try {
      Promise.resolve(onPublicAppend(roomId, payload)).catch(() => {})
    } catch {
      // ignore
    }
  }

  async function resolveRoomContextSafe(roomId) {
    try {
      if (typeof resolveRoomContext !== 'function') return null
      return await Promise.resolve(resolveRoomContext(roomId))
    } catch {
      return null
    }
  }

  async function generateAgentText(payload) {
    if (typeof generateAgentMessageText !== 'function') return ''
    try {
      const raw = await generateAgentMessageText(payload)
      const text = sanitizeText(raw)
      if (!text) return ''
      // Bound by both global chat limits and streamer-style constraints.
      const capped = text.slice(0, safeMaxTextLen)
      if (!isTimeAwareChatTextAllowed(capped, payload?.nowMs)) {
        return timeAwareFallbackLine(payload?.nowMs)
      }
      return capped
    } catch {
      return ''
    }
  }

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
    if (!isRoomAgentRunning(roomAgent)) {
      return
    }

    if (proactiveInFlightByRoom.get(roomId) === true) {
      return
    }

    const now = nowMs()
    let roomContext = null
    let cadence = resolveProactiveCadence({
      nowMs: now,
      defaultIntervalMs: safeProactivePublicIntervalMs,
      burstIntervalMs: safeProactiveNewsBurstIntervalMs,
      burstDurationMs: safeProactiveNewsBurstDurationMs,
      cooldownMs: safeProactiveNewsBurstCooldownMs,
      previousState: proactiveBurstStateByRoom.get(roomId) || null,
      burstSignal: null,
    })
    let cadenceIntervalMs = cadence.intervalMs

    const lastProactiveTs = Number(proactiveStateByRoom.get(roomId) || 0)
    const elapsedSinceProactive = now - lastProactiveTs
    if (elapsedSinceProactive < cadenceIntervalMs) {
      const baseWindowCheck = elapsedSinceProactive < safeProactivePublicIntervalMs
      if (!safeProactiveNewsBurstEnabled || !baseWindowCheck) {
        proactiveBurstStateByRoom.set(roomId, cadence.state)
        return
      }

      roomContext = await resolveRoomContextSafe(roomId)
      cadence = resolveProactiveCadence({
        nowMs: now,
        defaultIntervalMs: safeProactivePublicIntervalMs,
        burstIntervalMs: safeProactiveNewsBurstIntervalMs,
        burstDurationMs: safeProactiveNewsBurstDurationMs,
        cooldownMs: safeProactiveNewsBurstCooldownMs,
        previousState: cadence.state,
        burstSignal: roomContext?.news_burst_signal || null,
      })
      cadenceIntervalMs = cadence.intervalMs
      proactiveBurstStateByRoom.set(roomId, cadence.state)

      if (elapsedSinceProactive < cadenceIntervalMs) {
        return
      }
    } else {
      proactiveBurstStateByRoom.set(roomId, cadence.state)
    }

    proactiveInFlightByRoom.set(roomId, true)
    try {
      const publicMessages = await store.readPublic(roomId, 500, null)
      const todayMessages = filterTodayMessages(publicMessages, now, chatContextTimeZone)
      const lastMessage = todayMessages[todayMessages.length - 1]
      const lastMessageTs = Number(lastMessage?.created_ts_ms)

      if (Number.isFinite(lastMessageTs)) {
        const elapsedSinceLastMessage = now - lastMessageTs
        if (elapsedSinceLastMessage < cadenceIntervalMs) {
          const baseWindowCheck = elapsedSinceLastMessage < safeProactivePublicIntervalMs
          if (!safeProactiveNewsBurstEnabled || !baseWindowCheck) {
            return
          }

          if (!roomContext) {
            roomContext = await resolveRoomContextSafe(roomId)
          }

          cadence = resolveProactiveCadence({
            nowMs: now,
            defaultIntervalMs: safeProactivePublicIntervalMs,
            burstIntervalMs: safeProactiveNewsBurstIntervalMs,
            burstDurationMs: safeProactiveNewsBurstDurationMs,
            cooldownMs: safeProactiveNewsBurstCooldownMs,
            previousState: proactiveBurstStateByRoom.get(roomId) || cadence.state,
            burstSignal: roomContext?.news_burst_signal || null,
          })
          cadenceIntervalMs = cadence.intervalMs
          proactiveBurstStateByRoom.set(roomId, cadence.state)

          if (elapsedSinceLastMessage < cadenceIntervalMs) {
            return
          }
        }
      }

      if (!roomContext) {
        roomContext = await resolveRoomContextSafe(roomId)
      }

      let generatedText = await generateAgentText({
        kind: 'proactive',
        roomAgent,
        roomId,
        roomContext,
        latestDecision: resolveLatestDecision(roomId),
        historyContext: todayMessages,
        nowMs: now,
      })
      if (!generatedText) {
        return
      }

      if (isPolymarketRoomId(roomId)) {
        generatedText = sanitizePolymarketAgentText(generatedText)
      }

      // Basic dedupe: avoid repeating similar proactive lines.
      let candidateKey = normalizeForDedupe(generatedText)
      const recentProactives = todayMessages
        .filter((item) => item?.sender_type === 'agent' && item?.agent_message_kind === 'proactive')
        .slice(-8)
      for (const msg of recentProactives) {
        if (normalizeForDedupe(msg?.text) === candidateKey) {
          const casual = Array.isArray(roomContext?.casual_topics)
            ? roomContext.casual_topics.map((item) => String(item || '').trim()).filter(Boolean)
            : []
          const pick = casual.length ? casual[now % casual.length] : ''
          const alt = pick
            ? `${String(generatedText).replace(/[。！？!?]+$/g, '')}。${pick}`
            : ''
          const altKey = normalizeForDedupe(alt)
          if (alt && altKey && altKey !== candidateKey) {
            generatedText = alt
            candidateKey = altKey
            break
          }
          return
        }
      }

      const proactiveMessage = buildProactiveAgentMessage({
        roomAgent,
        roomId,
        text: generatedText,
        nowMs: now,
        maxChars: safeAgentMaxChars,
        maxSentences: safeAgentMaxSentences,
      })

      await store.appendPublic(roomId, proactiveMessage)
      emitPublicAppendBestEffort(roomId, { message: proactiveMessage })
      proactiveStateByRoom.set(roomId, now)
    } finally {
      proactiveInFlightByRoom.set(roomId, false)
    }
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
      emitPublicAppendBestEffort(safeRoomId, { message: userMessage })
    }

    let agentReply = null
    let shouldReplyNow = false
    if (isRoomAgentRunning(roomAgent)) {
      shouldReplyNow = shouldAgentReply({
        messageType: safeMessageType,
        random: random(),
        threshold: safePublicReplyRate,
      })

      if (!shouldReplyNow && safeMessageType === 'public_plain' && safeVisibility === 'public') {
        const questionBoost = looksLikeQuestionText(safeText) ? 0.35 : 0.12
        if (Number(random()) < questionBoost) {
          shouldReplyNow = true
        }
      }
    }

    if (shouldReplyNow) {
      const historyContext = await readTodayContext(safeRoomId, safeUserSessionId, safeVisibility)
      const roomContextForReply = await resolveRoomContextSafe(safeRoomId)

      if (!consumePolymarketReplyBudget(safeRoomId, roomContextForReply, now)) {
        return {
          message: userMessage,
          agent_reply: null,
        }
      }

      let generatedText = await generateAgentText({
        kind: 'reply',
        roomAgent,
        roomId: safeRoomId,
        roomContext: roomContextForReply,
        inboundMessage: userMessage,
        latestDecision: resolveLatestDecision(safeRoomId),
        historyContext,
        nowMs: now,
      })

      // Mentions/DMs are expected to get an agent response. If the LLM
      // returns empty/errored, still emit a short fallback reply.
      const forceReply = safeMessageType === 'public_mention_agent' || safeMessageType === 'private_agent_dm'
      if (!generatedText && forceReply) {
        generatedText = buildFallbackReplyText({
          roomAgent,
          inboundMessage: userMessage,
          roomContext: roomContextForReply,
          latestDecision: resolveLatestDecision(safeRoomId),
          nowMs: now,
        })
      }
      if (isPolymarketRoomId(safeRoomId)) {
        generatedText = sanitizePolymarketAgentText(generatedText)
      }
      if (generatedText || forceReply) {
        const nowReply = nowMs()
        agentReply = buildAgentReply({
          roomAgent,
          inboundMessage: userMessage,
          text: generatedText,
          nowMs: nowReply,
          maxChars: safeAgentMaxChars,
          maxSentences: safeAgentMaxSentences,
        })

        if (safeVisibility === 'private') {
          await store.appendPrivate(safeRoomId, safeUserSessionId, agentReply)
        } else {
          await store.appendPublic(safeRoomId, agentReply)
          emitPublicAppendBestEffort(safeRoomId, { message: agentReply })
        }
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
    if (enableProactiveOnRead && beforeTsMs == null) {
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
