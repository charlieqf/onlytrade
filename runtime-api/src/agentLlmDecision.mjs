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
  const tradingStyle = String(trader?.trading_style || '').trim().toLowerCase()
  const riskProfile = String(trader?.risk_profile || 'balanced').trim().toLowerCase() || 'balanced'
  const personality = String(trader?.personality || '').trim()
  const stylePromptCn = String(trader?.style_prompt_cn || '').trim()
  const strategyName = String(trader?.strategy_name || '').trim()

  const styleBriefByKey = {
    momentum_trend: 'Style: momentum trend-following; avoid counter-trend entries and cut quickly on momentum loss.',
    mean_reversion: 'Style: mean-reversion/value rebound; buy weakness selectively and avoid breakout chasing.',
    event_driven: 'Style: event/regime-shift; respond to volatility spikes and de-risk fast under uncertainty.',
    macro_swing: 'Style: macro swing; prefer slower directional entries with disciplined risk and lower churn.',
  }

  const fallbackBrief = 'Style: balanced systematic discretionary; trade only when signals align.'
  const styleBrief = styleBriefByKey[tradingStyle] || fallbackBrief

  if (tokenSaver) {
    const compact = [
      styleBrief,
      `risk=${riskProfile}`,
      strategyName ? `strategy=${strategyName}` : '',
      personality ? `personality=${personality}` : '',
      stylePromptCn ? `style_prompt_cn=${stylePromptCn}` : '',
    ].filter(Boolean).join(' | ')

    return compact
  }

  return [
    styleBrief,
    strategyName ? `Strategy name: ${strategyName}.` : '',
    `Risk profile: ${riskProfile}.`,
    personality ? `Personality: ${personality}.` : '',
    stylePromptCn ? `CN style instruction: ${stylePromptCn}.` : '',
  ].filter(Boolean).join(' ')
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
    const userPayload = devTokenSaver
      ? {
        c: cycleNumber,
        t: {
          id: trader?.trader_id,
          p: trader?.ai_model,
        },
        x: payload,
      }
      : {
        cycle_number: cycleNumber,
        trader: {
          trader_id: trader?.trader_id,
          trader_name: trader?.trader_name,
          profile: trader?.ai_model,
        },
        context: payload,
      }
    const userPrompt = JSON.stringify(userPayload)

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
              content: userPrompt,
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
        system_prompt: systemPrompt,
        input_prompt: userPrompt,
        cot_trace: String(extracted?.reasoning || ''),
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
