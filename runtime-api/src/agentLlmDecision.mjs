function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function supportsTemperature(model) {
  const name = String(model || '').trim().toLowerCase()
  return !name.startsWith('gpt-5')
}

function supportsJsonSchemaResponseFormat(model) {
  const name = String(model || '').trim().toLowerCase()
  return !name.startsWith('gpt-5')
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

function recentHoldStreak(context, maxLookback = 8) {
  const actions = Array.isArray(context?.memory_state?.recent_actions)
    ? context.memory_state.recent_actions
    : []
  let streak = 0
  for (const row of actions.slice(0, Math.max(1, maxLookback))) {
    const action = String(row?.action || '').trim().toLowerCase()
    if (action !== 'hold') break
    streak += 1
  }
  return streak
}

function summarizeCandidateSet(context, { tokenSaver = false } = {}) {
  const raw = context?.candidate_set
  const rawItems = Array.isArray(raw?.items) ? raw.items : []
  const symbols = Array.isArray(raw?.symbols)
    ? raw.symbols.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  const normalizedItems = rawItems
    .map((item) => ({
      symbol: String(item?.symbol || '').trim(),
      symbol_name: String(item?.symbol_name || '').trim(),
      latest_price: toNumber(item?.latest_price, 0),
      ret_5: toNumber(item?.ret_5, 0),
      ret_20: toNumber(item?.ret_20, 0),
      vol_ratio_20: toNumber(item?.vol_ratio_20, 0),
      rsi_14: toNumber(item?.rsi_14, 50),
      rank_score: toNumber(item?.rank_score, 0),
      position_shares: toNumber(item?.position_shares, 0),
      pv_6m: String(item?.price_volume_descriptions?.past_6m || '').trim(),
      pv_1m: String(item?.price_volume_descriptions?.past_1m || '').trim(),
      pv_1w: String(item?.price_volume_descriptions?.past_1w || '').trim(),
      pv_1d: String(item?.price_volume_descriptions?.past_1d || '').trim(),
    }))
    .filter((item) => item.symbol)

  const fallbackSymbol = String(context?.symbol || '').trim() || '600519.SH'
  const mergedSymbols = symbols.length
    ? symbols
    : (normalizedItems.length
      ? normalizedItems.map((item) => item.symbol)
      : [fallbackSymbol])

  const selected = String(raw?.selected_symbol || mergedSymbols[0] || fallbackSymbol).trim() || fallbackSymbol
  const selectedIndex = mergedSymbols.indexOf(selected)
  if (selectedIndex > 0) {
    mergedSymbols.splice(selectedIndex, 1)
    mergedSymbols.unshift(selected)
  } else if (selectedIndex < 0) {
    mergedSymbols.unshift(selected)
  }

  if (tokenSaver) {
    return {
      symbols: mergedSymbols.slice(0, 8),
      selected_symbol: selected,
      top: normalizedItems
        .sort((a, b) => a.rank_score - b.rank_score)
        .slice(0, 5)
        .map((row) => ({
          s: row.symbol,
          n: row.symbol_name || undefined,
          p: row.latest_price,
          r5: row.ret_5,
          r20: row.ret_20,
          v: row.vol_ratio_20,
          rsi: row.rsi_14,
          rk: row.rank_score,
          sh: row.position_shares,
          p6: row.pv_6m ? row.pv_6m.slice(0, 120) : undefined,
          p1m: row.pv_1m ? row.pv_1m.slice(0, 120) : undefined,
          p1w: row.pv_1w ? row.pv_1w.slice(0, 120) : undefined,
          p1d: row.pv_1d ? row.pv_1d.slice(0, 120) : undefined,
        })),
    }
  }

  return {
    symbols: mergedSymbols.slice(0, 12),
    selected_symbol: selected,
    items: normalizedItems
      .sort((a, b) => a.rank_score - b.rank_score)
      .slice(0, 12),
  }
}

function summarizeContext(context) {
  const intraday = context?.intraday?.feature_snapshot || {}
  const daily = context?.daily?.feature_snapshot || {}
  const position = context?.position_state || {}
  const dataReadiness = context?.data_readiness || {}
  const marketOverview = context?.market_overview || {}
  const newsDigest = context?.news_digest || {}
  const memoryStats = context?.memory_state?.stats || {}
  const memoryReplay = context?.memory_state?.replay || {}
  const lastAction = context?.memory_state?.recent_actions?.[0] || null
  const holdStreak = recentHoldStreak(context)
  const candidateSet = summarizeCandidateSet(context)
  const selectedHorizonLines = Array.isArray(context?.daily?.price_volume_reference_lines)
    ? context.daily.price_volume_reference_lines.map((item) => String(item || '').slice(0, 180)).filter(Boolean).slice(0, 4)
    : []

  return {
    symbol: candidateSet?.selected_symbol || context?.symbol || '600519.SH',
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
      historical_summaries: {
        past_6m: String(context?.daily?.price_volume_descriptions?.past_6m || '').slice(0, 180),
        past_1m: String(context?.daily?.price_volume_descriptions?.past_1m || '').slice(0, 180),
        past_1w: String(context?.daily?.price_volume_descriptions?.past_1w || '').slice(0, 180),
        past_1d: String(context?.daily?.price_volume_descriptions?.past_1d || '').slice(0, 180),
      },
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
        hold_streak: holdStreak,
      },
      last_action: lastAction
        ? {
          action: String(lastAction.action || 'hold').toLowerCase(),
          symbol: lastAction.symbol || null,
          price: toNumber(lastAction.price, 0),
        }
        : null,
    },
    contextual: {
      data_readiness_level: String(dataReadiness.level || '').trim().toUpperCase(),
      data_readiness_reasons: Array.isArray(dataReadiness.reasons)
        ? dataReadiness.reasons.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
        : [],
      market_overview_brief: String(marketOverview.brief || '').slice(0, 240),
      news_digest_titles: Array.isArray(newsDigest.titles)
        ? newsDigest.titles.map((item) => String(item || '').slice(0, 96)).filter(Boolean).slice(0, 3)
        : [],
      selected_price_volume_reference: selectedHorizonLines,
    },
    candidate_set: candidateSet,
  }
}

function summarizeContextLite(context) {
  const intraday = context?.intraday?.feature_snapshot || {}
  const daily = context?.daily?.feature_snapshot || {}
  const position = context?.position_state || {}
  const dataReadiness = context?.data_readiness || {}
  const marketOverview = context?.market_overview || {}
  const newsDigest = context?.news_digest || {}
  const memoryStats = context?.memory_state?.stats || {}
  const lastAction = context?.memory_state?.recent_actions?.[0] || null
  const holdStreak = recentHoldStreak(context)
  const candidateSet = summarizeCandidateSet(context, { tokenSaver: true })
  const selectedHorizonLines = Array.isArray(context?.daily?.price_volume_reference_lines)
    ? context.daily.price_volume_reference_lines.map((item) => String(item || '').slice(0, 120)).filter(Boolean).slice(0, 4)
    : []

  return {
    symbol: candidateSet?.selected_symbol || context?.symbol || '600519.SH',
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
      hx: {
        m6: String(context?.daily?.price_volume_descriptions?.past_6m || '').slice(0, 120),
        m1: String(context?.daily?.price_volume_descriptions?.past_1m || '').slice(0, 120),
        w1: String(context?.daily?.price_volume_descriptions?.past_1w || '').slice(0, 120),
        d1: String(context?.daily?.price_volume_descriptions?.past_1d || '').slice(0, 120),
      },
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
      hold_streak: holdStreak,
      last_action: lastAction
        ? {
          action: String(lastAction.action || 'hold').toLowerCase(),
          symbol: lastAction.symbol || null,
          fee_paid: toNumber(lastAction.fee_paid, 0),
        }
        : null,
    },
    cx: {
      dr: String(dataReadiness.level || '').trim().toUpperCase(),
      mo: String(marketOverview.brief || '').slice(0, 120),
      nw: Array.isArray(newsDigest.titles)
        ? newsDigest.titles.map((item) => String(item || '').slice(0, 64)).filter(Boolean).slice(0, 2)
        : [],
      pv: selectedHorizonLines,
    },
    cands: candidateSet,
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

  const source = (() => {
    if (Array.isArray(value.decisions) && value.decisions[0] && typeof value.decisions[0] === 'object') {
      return value.decisions[0]
    }
    if (value.decision && typeof value.decision === 'object') {
      return value.decision
    }
    return value
  })()

  const action = toAction(
    source.action
    ?? source.decision
    ?? source.signal
    ?? source.side
    ?? source.trade_action
  )
  const symbol = String(
    source.symbol
    ?? source.ticker
    ?? source.code
    ?? source.instrument
    ?? fallbackSymbol
    ?? ''
  ).trim() || fallbackSymbol
  const confidence = Number(
    source.confidence
    ?? source.confidence_score
    ?? source.score
    ?? source.probability
    ?? 0.6
  )
  const quantityShares = Number(
    source.quantity_shares
    ?? source.quantity
    ?? source.shares
    ?? source.qty
    ?? source.size
  )
  const reasoning = String(
    source.reasoning
    ?? source.rationale
    ?? source.thesis
    ?? source.explanation
    ?? source.notes
    ?? ''
  ).trim()

  const coerced = {
    action,
    symbol,
    confidence: Number.isFinite(confidence) ? confidence : 0.6,
    quantity_shares: Number.isFinite(quantityShares) ? quantityShares : (action === 'hold' ? 0 : 100),
    reasoning: reasoning || 'Model output normalized by fallback parser.',
  }
  if (isValidRawDecisionShape(coerced)) {
    return coerced
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
      'Goal: maximize competition score: return first, then drawdown control, then Sharpe, with turnover/cost discipline.',
      'Do not overreact to one bar.',
      'HOLD is valid when edge is weak or signals conflict.',
      'Use market overview + news digest only as tie-break context, not as direct trade trigger without confirming signals.',
      'Respect lot size and constraints.',
      'Return only JSON in required schema.',
    ].join(' ')
  }

  return [
    'You are an A-share virtual trading agent in a replay simulation.',
    'Primary objective: maximize multi-day competition score: return first, then max-drawdown control, then Sharpe, while avoiding unnecessary turnover and fee drag.',
    'Respect constraints: 100-share lot size, no leverage, no hidden assumptions.',
    'Avoid overreaction to single bars; prioritize regime + context + memory consistency.',
    'HOLD is a valid outcome whenever edge is weak, uncertainty is high, or signals are mixed.',
    'Use market overview and news digest as tie-break context when technical signals are mixed; do not force trades for engagement.',
    'Return JSON only with keys: action, confidence, quantity_shares, reasoning.',
    'action must be buy|sell|hold.',
    'quantity_shares must be 0 for hold and multiples of 100 otherwise.',
    'reasoning should be concise and non-sensitive, max 2 sentences.',
  ].join(' ')
}

function riskInstructionForProfile(riskProfile, { tokenSaver = false } = {}) {
  const risk = String(riskProfile || 'balanced').trim().toLowerCase() || 'balanced'

  const compactByRisk = {
    conservative: 'Risk mode conservative: prefer fewer trades, higher confirmation, usually 1 lot.',
    balanced: 'Risk mode balanced: require aligned signals before trading, avoid churn.',
    aggressive: 'Risk mode aggressive: act faster on strong edge, but keep losses controlled and avoid random overtrading.',
  }

  const detailedByRisk = {
    conservative: [
      'Risk mode: conservative.',
      'Prefer capital preservation, tighter selectivity, and lower turnover.',
      'Use smaller sizing unless edge is very strong and conditions are clean.',
    ].join(' '),
    balanced: [
      'Risk mode: balanced.',
      'Trade when multiple signals align; avoid noise and overtrading.',
      'Maintain consistent sizing and discipline.',
    ].join(' '),
    aggressive: [
      'Risk mode: aggressive.',
      'React faster when signal quality is high, but cut exposure quickly when edge degrades.',
      'Higher activity is allowed only with clear evidence, not impulse.',
    ].join(' '),
  }

  if (tokenSaver) {
    return compactByRisk[risk] || compactByRisk.balanced
  }
  return detailedByRisk[risk] || detailedByRisk.balanced
}

function styleInstructionForTrader(trader, { tokenSaver = false } = {}) {
  const tradingStyle = String(trader?.trading_style || '').trim().toLowerCase()
  const riskProfile = String(trader?.risk_profile || 'balanced').trim().toLowerCase() || 'balanced'
  const personality = String(trader?.personality || '').trim()
  const stylePromptCn = String(trader?.style_prompt_cn || '').trim()
  const strategyName = String(trader?.strategy_name || '').trim()

  const stylePlaybookByKey = {
    momentum_trend: {
      compact: [
        'Style momentum_trend: follow continuation, avoid counter-trend bottom-fishing.',
        'Buy bias on positive ret_5/ret_20 with healthy trend structure; exit fast on momentum failure.',
      ].join(' '),
      detailed: [
        'Style: momentum trend-following.',
        'Entry bias: prefer continuation when ret_5 and ret_20 are positive and trend structure is healthy; avoid late chasing after obvious exhaustion.',
        'Exit bias: de-risk quickly when momentum weakens, ret_5 flips against position, or trend quality deteriorates.',
      ].join(' '),
    },
    mean_reversion: {
      compact: [
        'Style mean_reversion: buy controlled weakness near oversold context; avoid breakout chasing.',
        'Take profits earlier and reduce risk if rebound fails to confirm.',
      ].join(' '),
      detailed: [
        'Style: mean-reversion/value rebound.',
        'Entry bias: look for controlled pullbacks and oversold-rebound setups; avoid entering when downside momentum is still accelerating.',
        'Exit bias: harvest rebounds earlier, and cut quickly if bounce quality is poor or risk-off signals dominate.',
      ].join(' '),
    },
    event_driven: {
      compact: [
        'Style event_driven: react to volatility/volume regime shifts, confirm with price action.',
        'Scale down quickly when uncertainty or whipsaw risk rises.',
      ].join(' '),
      detailed: [
        'Style: event-driven/regime-shift.',
        'Entry bias: prioritize setups where volatility and participation clearly expand in the direction of edge.',
        'Exit bias: de-risk fast under uncertainty, headline whipsaw, or failed follow-through after event impulse.',
      ].join(' '),
    },
    macro_swing: {
      compact: [
        'Style macro_swing: align with broader trend/regime, lower churn and fewer low-quality flips.',
        'Prefer patience and cleaner swing entries over short noisy trades.',
      ].join(' '),
      detailed: [
        'Style: macro swing.',
        'Entry bias: align with broader regime and smoother trend structure; prefer patience over micro-noise reactions.',
        'Exit bias: protect capital when macro/trend backdrop weakens; avoid frequent flip-flop trading.',
      ].join(' '),
    },
  }

  const fallbackPlaybook = {
    compact: 'Style balanced: trade only when multiple signals align.',
    detailed: 'Style: balanced systematic discretionary; trade only when signals align and avoid overtrading.',
  }
  const stylePlaybook = stylePlaybookByKey[tradingStyle] || fallbackPlaybook
  const riskInstruction = riskInstructionForProfile(riskProfile, { tokenSaver })

  if (tokenSaver) {
    const compact = [
      stylePlaybook.compact,
      riskInstruction,
      strategyName ? `strategy=${strategyName}` : '',
      personality ? `personality=${personality}` : '',
      stylePromptCn ? `style_prompt_cn=${stylePromptCn}` : '',
    ].filter(Boolean).join(' | ')

    return compact
  }

  return [
    stylePlaybook.detailed,
    strategyName ? `Strategy name: ${strategyName}.` : '',
    riskInstruction,
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

    const requiresManualJsonMode = !supportsJsonSchemaResponseFormat(model)
    const systemPrompt = [
      universalInstruction({ tokenSaver: devTokenSaver }),
      styleInstructionForTrader(trader, { tokenSaver: devTokenSaver }),
      'Return exactly one decision inside decisions[0].',
      'Do not include markdown fences.',
      requiresManualJsonMode ? 'Output must be valid JSON object only with key "decisions".' : '',
    ].join(' ')

    const candidateSymbols = Array.isArray(payload?.candidate_set?.symbols)
      ? payload.candidate_set.symbols
      : (Array.isArray(payload?.cands?.symbols) ? payload.cands.symbols : [])
    const allowedSymbols = candidateSymbols.length
      ? candidateSymbols
      : [payload?.symbol || context?.symbol || '600519.SH']
    const primarySymbol = allowedSymbols[0] || '600519.SH'
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
                  enum: allowedSymbols,
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
      const requestBody = {
        model,
        max_completion_tokens: Math.max(80, Math.floor(toNumber(maxOutputTokens, 180))),
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      }
      if (supportsJsonSchemaResponseFormat(model)) {
        requestBody.response_format = {
          type: 'json_schema',
          json_schema: decisionSchema,
        }
      }
      if (supportsTemperature(model)) {
        requestBody.temperature = devTokenSaver ? 0 : 0.15
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
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
      const extracted = extractRawDecision(rawDecision, primarySymbol)
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
