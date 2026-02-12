function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function toAction(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'buy' || normalized === 'sell' || normalized === 'hold') {
    return normalized
  }
  return 'hold'
}

function latestPrice(context) {
  const frames = context?.intraday?.frames || []
  const close = toNumber(frames[frames.length - 1]?.bar?.close, 0)
  return close > 0 ? close : 0
}

function summarizeContext(context) {
  const intraday = context?.intraday?.feature_snapshot || {}
  const daily = context?.daily?.feature_snapshot || {}
  const position = context?.position_state || {}
  const memoryStats = context?.memory_state?.stats || {}
  const memoryReplay = context?.memory_state?.replay || {}
  const lastAction = context?.memory_state?.recent_actions?.[0] || null

  return {
    symbol: context?.symbol || '600519.SH',
    market: context?.market || 'CN-A',
    lot_size: toNumber(context?.constraints?.lot_size, 100) || 100,
    intraday: {
      ret_5: toNumber(intraday.ret_5, 0),
      ret_20: toNumber(intraday.ret_20, 0),
      atr_14: toNumber(intraday.atr_14, 0),
      vol_ratio_20: toNumber(intraday.vol_ratio_20, 0),
    },
    daily: {
      sma_20: toNumber(daily.sma_20, 0),
      sma_60: toNumber(daily.sma_60, 0),
      rsi_14: toNumber(daily.rsi_14, 50),
      range_20d_pct: toNumber(daily.range_20d_pct, 0),
    },
    position_state: {
      shares: toNumber(position.shares, 0),
      avg_cost: toNumber(position.avg_cost, 0),
      unrealized_pnl: toNumber(position.unrealized_pnl, 0),
      cash_cny: toNumber(position.cash_cny, 0),
      mark_price: latestPrice(context),
    },
    memory_state: {
      replay: {
        trading_day: memoryReplay.trading_day || null,
        day_index: toNumber(memoryReplay.day_index, 0),
      },
      stats: {
        return_rate_pct: toNumber(memoryStats.return_rate_pct, 0),
        decisions: toNumber(memoryStats.decisions, 0),
        wins: toNumber(memoryStats.wins, 0),
        losses: toNumber(memoryStats.losses, 0),
      },
      last_action: lastAction
        ? {
          action: String(lastAction.action || 'hold').toLowerCase(),
          symbol: lastAction.symbol || null,
          price: toNumber(lastAction.price, 0),
        }
        : null,
    },
  }
}

function summarizeContextLite(context) {
  const intraday = context?.intraday?.feature_snapshot || {}
  const daily = context?.daily?.feature_snapshot || {}
  const position = context?.position_state || {}
  const memoryStats = context?.memory_state?.stats || {}
  const lastAction = context?.memory_state?.recent_actions?.[0] || null

  return {
    symbol: context?.symbol || '600519.SH',
    lot_size: toNumber(context?.constraints?.lot_size, 100) || 100,
    intraday: {
      ret_5: toNumber(intraday.ret_5, 0),
      ret_20: toNumber(intraday.ret_20, 0),
      atr_14: toNumber(intraday.atr_14, 0),
    },
    daily: {
      sma_20: toNumber(daily.sma_20, 0),
      sma_60: toNumber(daily.sma_60, 0),
      rsi_14: toNumber(daily.rsi_14, 50),
    },
    position_state: {
      shares: toNumber(position.shares, 0),
      cash_cny: toNumber(position.cash_cny, 0),
      mark_price: latestPrice(context),
    },
    memory_state: {
      return_rate_pct: toNumber(memoryStats.return_rate_pct, 0),
      decisions: toNumber(memoryStats.decisions, 0),
      wins: toNumber(memoryStats.wins, 0),
      losses: toNumber(memoryStats.losses, 0),
      last_action: lastAction
        ? {
          action: String(lastAction.action || 'hold').toLowerCase(),
          symbol: lastAction.symbol || null,
          fee_paid: toNumber(lastAction.fee_paid, 0),
        }
        : null,
    },
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function isValidRawDecisionShape(value) {
  if (!value || typeof value !== 'object') return false
  if (typeof value.action !== 'string') return false
  if (!['buy', 'sell', 'hold'].includes(value.action.toLowerCase())) return false
  if (typeof value.symbol !== 'string' || !value.symbol.trim()) return false
  if (!Number.isFinite(Number(value.confidence))) return false
  if (!Number.isFinite(Number(value.quantity_shares))) return false
  if (typeof value.reasoning !== 'string') return false
  return true
}

function isValidRawDecisionEnvelope(value) {
  if (!value || typeof value !== 'object') return false
  if (!Array.isArray(value.decisions)) return false
  if (value.decisions.length !== 1) return false
  return isValidRawDecisionShape(value.decisions[0])
}

function extractRawDecision(value, fallbackSymbol) {
  if (!value || typeof value !== 'object') return null

  if (isValidRawDecisionEnvelope(value)) {
    return value.decisions[0]
  }

  // Backward-compatible fallback for legacy single-object format.
  if (isValidRawDecisionShape(value)) {
    return value
  }

  // Partial fallback: still allow symbol omission by injecting active symbol.
  if (
    typeof value.action === 'string' &&
    Number.isFinite(Number(value.confidence)) &&
    Number.isFinite(Number(value.quantity_shares)) &&
    typeof value.reasoning === 'string'
  ) {
    return {
      ...value,
      symbol: value.symbol || fallbackSymbol,
    }
  }

  return null
}

function normalizeDecision(raw, context) {
  const symbol = String(raw?.symbol || context?.symbol || '600519.SH')
  const lotSize = Math.max(100, toNumber(context?.constraints?.lot_size, 100) || 100)
  const action = toAction(raw?.action)
  const confidence = Number(clamp(toNumber(raw?.confidence, 0.6), 0.51, 0.95).toFixed(2))
  const requestedQuantity = Math.floor(toNumber(raw?.quantity_shares, action === 'hold' ? 0 : lotSize))
  const lots = Math.max(0, Math.floor(requestedQuantity / lotSize))
  const quantity = action === 'hold' ? 0 : Math.max(lotSize, lots * lotSize)
  const reasoningRaw = String(raw?.reasoning || '').trim()
  const reasoning = reasoningRaw
    ? reasoningRaw.slice(0, 320)
    : 'No strong edge from current features; maintain discipline.'

  return {
    action,
    symbol,
    confidence,
    quantity,
    reasoning,
  }
}

function universalInstruction({ tokenSaver = false } = {}) {
  if (tokenSaver) {
    return [
      'You are an A-share replay trading agent.',
      'Goal: stable risk-adjusted returns across days.',
      'Do not overreact to one bar; HOLD when edge is weak.',
      'Respect lot size and constraints.',
      'Return only JSON in required schema.',
    ].join(' ')
  }

  return [
    'You are an A-share virtual trading agent in a replay simulation.',
    'Primary objective: risk-adjusted consistency over multi-day competition, not maximum turnover.',
    'Respect constraints: 100-share lot size, no leverage, no hidden assumptions.',
    'Avoid overreaction to single bars; prioritize regime + context + memory consistency.',
    'If edge is weak or conflicting, prefer hold.',
    'Return JSON only with keys: action, confidence, quantity_shares, reasoning.',
    'action must be buy|sell|hold.',
    'quantity_shares must be 0 for hold and multiples of 100 otherwise.',
    'reasoning should be concise and non-sensitive, max 2 sentences.',
  ].join(' ')
}

function styleInstructionForTrader(trader, { tokenSaver = false } = {}) {
  const traderId = String(trader?.trader_id || '').toLowerCase()
  const strategy = String(trader?.strategy_name || '').toLowerCase()

  if (traderId === 't_001' || strategy.includes('momentum')) {
    if (tokenSaver) {
      return 'Style: momentum trend-following; avoid counter-trend entries and cut quickly on momentum loss.'
    }
    return [
      'Style: Momentum/Trend Follower.',
      'Mindset: participate when trend and short-term return align; cut exposure quickly when momentum fades.',
      'Bias: fewer but cleaner directional decisions; avoid mean-reversion catching.',
    ].join(' ')
  }

  if (traderId === 't_002' || strategy.includes('mean reversion') || strategy.includes('reversion')) {
    if (tokenSaver) {
      return 'Style: mean-reversion/value rebound; buy weakness selectively and avoid breakout chasing.'
    }
    return [
      'Style: Value Rebound / Mean Reversion.',
      'Mindset: accumulate when short-term weakness appears in broader stable structure.',
      'Bias: scale cautiously, avoid chasing strong breakouts, protect downside if weakness persists.',
    ].join(' ')
  }

  if (traderId === 't_003' || strategy.includes('event')) {
    if (tokenSaver) {
      return 'Style: event/regime-shift; respond to volatility spikes and de-risk fast under uncertainty.'
    }
    return [
      'Style: Event Flow / Regime Shift.',
      'Mindset: react to abrupt state changes using volatility and volume context.',
      'Bias: quick de-risking when uncertainty spikes; only commit when conviction is clear.',
    ].join(' ')
  }

  if (traderId === 't_004' || strategy.includes('macro')) {
    if (tokenSaver) {
      return 'Style: macro swing; prefer slower directional entries with disciplined risk and lower churn.'
    }
    return [
      'Style: Macro Swing / Regime Rotation.',
      'Mindset: hold directional positions longer when higher-timeframe context is supportive.',
      'Bias: fewer trades, avoid overtrading, prioritize capital efficiency and clear invalidation.',
    ].join(' ')
  }

  return [
    'Style: Balanced systematic discretionary.',
    'Mindset: trade only when signals align; otherwise hold and preserve capital.',
  ].join(' ')
}

export function createOpenAIAgentDecider({
  apiKey,
  model = 'gpt-4o-mini',
  baseUrl = 'https://api.openai.com/v1',
  timeoutMs = 7_000,
  devTokenSaver = true,
  maxOutputTokens = 180,
} = {}) {
  if (!apiKey) return null

  const endpoint = `${String(baseUrl).replace(/\/$/, '')}/chat/completions`

  return async function decideWithLlm({ trader, cycleNumber, context }) {
    const payload = devTokenSaver ? summarizeContextLite(context) : summarizeContext(context)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs))

    const systemPrompt = [
      universalInstruction({ tokenSaver: devTokenSaver }),
      styleInstructionForTrader(trader, { tokenSaver: devTokenSaver }),
      'Return exactly one decision inside decisions[0].',
      'Do not include markdown fences.',
    ].join(' ')

    const allowedSymbol = payload?.symbol || context?.symbol || '600519.SH'
    const reasoningMaxChars = devTokenSaver ? 160 : 320

    const decisionSchema = {
      name: 'agent_trade_decision_bundle',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          decisions: {
            type: 'array',
            minItems: 1,
            maxItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                action: {
                  type: 'string',
                  enum: ['buy', 'sell', 'hold'],
                },
                symbol: {
                  type: 'string',
                  enum: [allowedSymbol],
                },
                confidence: {
                  type: 'number',
                  minimum: 0.51,
                  maximum: 0.95,
                },
                quantity_shares: {
                  type: 'number',
                  minimum: 0,
                },
                reasoning: {
                  type: 'string',
                  minLength: 1,
                  maxLength: reasoningMaxChars,
                },
              },
              required: ['action', 'symbol', 'confidence', 'quantity_shares', 'reasoning'],
            },
          },
        },
        required: ['decisions'],
      },
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: devTokenSaver ? 0 : 0.15,
          max_completion_tokens: Math.max(80, Math.floor(toNumber(maxOutputTokens, 180))),
          response_format: {
            type: 'json_schema',
            json_schema: decisionSchema,
          },
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: devTokenSaver
                ? JSON.stringify({
                  c: cycleNumber,
                  t: {
                    id: trader?.trader_id,
                    p: trader?.ai_model,
                  },
                  x: payload,
                })
                : JSON.stringify({
                  cycle_number: cycleNumber,
                  trader: {
                    trader_id: trader?.trader_id,
                    trader_name: trader?.trader_name,
                    profile: trader?.ai_model,
                  },
                  context: payload,
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

      const rawDecision = parseJson(content)
      if (!rawDecision) {
        throw new Error('openai_invalid_json_content')
      }
      const extracted = extractRawDecision(rawDecision, allowedSymbol)
      if (!extracted || !isValidRawDecisionShape(extracted)) {
        throw new Error('openai_invalid_decision_shape')
      }

      return {
        ...normalizeDecision(extracted, context),
        source: 'openai',
        model,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
