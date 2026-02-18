function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function trimGeneratedText(value, maxLen = 600) {
  const text = String(value || '').trim()
  if (!text) return ''
  const cleaned = text.replace(/```[\s\S]*?```/g, '').trim()
  if (!cleaned) return ''
  return cleaned.slice(0, Math.max(16, maxLen))
}

function styleHint(roomAgent) {
  const bits = []
  const tradingStyle = String(roomAgent?.tradingStyle || '').trim()
  const personality = String(roomAgent?.personality || '').trim()
  const stylePromptCn = String(roomAgent?.stylePromptCn || '').trim()
  if (tradingStyle) bits.push(`trading_style=${tradingStyle}`)
  if (personality) bits.push(`personality=${personality}`)
  if (stylePromptCn) bits.push(`style_prompt_cn=${stylePromptCn}`)
  return bits.join(' | ')
}

function buildSystemPrompt({ roomAgent, kind }) {
  const agentName = String(roomAgent?.agentName || roomAgent?.agentHandle || 'Agent').trim() || 'Agent'
  const kindRule = kind === 'proactive'
    ? 'You are writing a proactive public room message to keep engagement healthy.'
    : (kind === 'narration'
      ? 'You are narrating your latest trading decision to the room like a livestream host.'
      : 'You are writing a direct reply to a user message in the room.')
  const contextRule = (kind === 'proactive' || kind === 'narration')
    ? 'If room_context contains market_overview_brief or news_digest_titles, explicitly reference them in your message.'
    : ''
  const positionRule = (kind === 'proactive' || kind === 'narration')
    ? 'If room_context.symbol_brief.position_shares_on_symbol is 0, do not claim you are currently holding that symbol; describe it as no-position/watchlist instead.'
    : ''
  const style = styleHint(roomAgent)

  return [
    `You are ${agentName}, a Chinese A-share trading room agent.`,
    kindRule,
    'Respond in concise Chinese, 1-2 short sentences, no markdown, no bullet list, no JSON.',
    'Do not claim you executed real broker orders.',
    contextRule,
    positionRule,
    style ? `Agent profile: ${style}.` : '',
  ].filter(Boolean).join(' ')
}

function toSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function buildUserPrompt({ kind, roomAgent, inboundMessage, latestDecision, historyContext, roomContext }) {
  const latest = latestDecision?.decisions?.[0] || null
  const ctx = toSafeObject(roomContext)
  const payload = {
    kind,
    room_id: roomAgent?.roomId || inboundMessage?.room_id || '',
    incoming_message: inboundMessage
      ? {
        message_type: inboundMessage?.message_type,
        visibility: inboundMessage?.visibility,
        text: inboundMessage?.text,
      }
      : null,
    latest_decision: latest
      ? {
        symbol: latest?.symbol || null,
        action: latest?.action || null,
        confidence: latest?.confidence ?? null,
        quantity: latest?.quantity ?? null,
        price: latest?.price ?? null,
        reasoning: typeof latest?.reasoning === 'string' ? latest.reasoning.slice(0, 120) : null,
        success: latest?.success ?? null,
      }
      : null,
    room_context: ctx
      ? {
        data_readiness: ctx.data_readiness || null,
        market_overview_brief: typeof ctx.market_overview_brief === 'string'
          ? ctx.market_overview_brief.slice(0, 240)
          : null,
        news_digest_titles: Array.isArray(ctx.news_digest_titles)
          ? ctx.news_digest_titles.map((t) => String(t || '').slice(0, 80)).filter(Boolean).slice(0, 6)
          : [],
        symbol_brief: toSafeObject(ctx.symbol_brief)
          ? {
            symbol: ctx.symbol_brief.symbol || null,
            action: ctx.symbol_brief.action || null,
            confidence: ctx.symbol_brief.confidence ?? null,
            order_executed: ctx.symbol_brief.order_executed === true,
            position_shares_on_symbol: Math.max(0, Math.floor(toNumber(ctx.symbol_brief.position_shares_on_symbol, 0))),
            reasoning: typeof ctx.symbol_brief.reasoning === 'string'
              ? ctx.symbol_brief.reasoning.slice(0, 120)
              : null,
          }
          : null,
      }
      : null,
    history_tail: Array.isArray(historyContext)
      ? historyContext.slice(-8).map((item) => ({
        sender_type: item?.sender_type,
        text: String(item?.text || '').slice(0, 80),
      }))
      : [],
  }
  return JSON.stringify(payload)
}

export function createOpenAIChatResponder({
  apiKey,
  model = 'gpt-4o-mini',
  baseUrl = 'https://api.openai.com/v1',
  timeoutMs = 7000,
  maxOutputTokens = 140,
  maxTextLen = 600,
} = {}) {
  if (!apiKey) return null

  const endpoint = `${String(baseUrl).replace(/\/$/, '')}/chat/completions`

  return async function generateAgentMessageText({
    kind = 'reply',
    roomAgent,
    inboundMessage,
    latestDecision,
    historyContext,
    roomContext,
  } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 7000))

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_completion_tokens: Math.max(80, Math.floor(toNumber(maxOutputTokens, 140))),
          messages: [
            { role: 'system', content: buildSystemPrompt({ roomAgent, kind }) },
            {
              role: 'user',
              content: buildUserPrompt({
                kind,
                roomAgent,
                inboundMessage,
                latestDecision,
                historyContext,
                roomContext,
              }),
            },
          ],
        }),
        signal: controller.signal,
      })

      const text = await response.text()
      if (!response.ok) {
        throw new Error(`openai_http_${response.status}:${text.slice(0, 160)}`)
      }

      const parsed = parseJson(text)
      const content = parsed?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('openai_empty_message')
      }

      return trimGeneratedText(content, maxTextLen)
    } finally {
      clearTimeout(timer)
    }
  }
}
