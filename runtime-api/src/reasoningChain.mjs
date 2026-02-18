function toSafeNumber(value, fallback = NaN) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function safeText(value, maxLen = 240) {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (!text) return ''
  return text.slice(0, Math.max(16, Math.floor(Number(maxLen) || 240)))
}

function pct(value, digits = 2) {
  const n = toSafeNumber(value, NaN)
  if (!Number.isFinite(n)) return null
  return Number((n * 100).toFixed(digits))
}

function joinReasons(reasons) {
  const rows = Array.isArray(reasons) ? reasons : []
  return rows
    .map((r) => safeText(r, 40))
    .filter(Boolean)
    .slice(0, 4)
    .join('、')
}

function buildDataStep({ dataReadiness, sessionGate } = {}) {
  const readiness = dataReadiness && typeof dataReadiness === 'object' ? dataReadiness : null
  const gate = sessionGate && typeof sessionGate === 'object' ? sessionGate : null

  const level = safeText(readiness?.level || 'OK', 10) || 'OK'
  const reasons = joinReasons(readiness?.reasons)

  let text = `数据状态：${level}`
  if (reasons) text += `（${reasons}）`

  const marketClosed = gate?.reasons && Array.isArray(gate.reasons) && gate.reasons.includes('market_closed')
  if (marketClosed) {
    text += '；当前休市，策略以保守为主。'
  }

  return safeText(text, 140)
}

function buildOverviewStep({ marketOverviewBrief, newsTitles } = {}) {
  const brief = safeText(marketOverviewBrief, 200)
  const titles = Array.isArray(newsTitles) ? newsTitles.map((t) => safeText(t, 60)).filter(Boolean) : []

  const bits = []
  if (brief) {
    bits.push(`市场概览：${brief}`)
  }
  if (titles.length) {
    bits.push(`消息面：${titles.slice(0, 2).join('；')}`)
  }

  if (!bits.length) return ''
  return safeText(bits.join('；'), 160)
}

function buildSignalStep(context) {
  const ret5 = pct(context?.intraday?.feature_snapshot?.ret_5, 2)
  const ret20 = pct(context?.intraday?.feature_snapshot?.ret_20, 2)
  const rsi14 = toSafeNumber(context?.daily?.feature_snapshot?.rsi_14, NaN)
  const sma20 = toSafeNumber(context?.daily?.feature_snapshot?.sma_20, NaN)
  const sma60 = toSafeNumber(context?.daily?.feature_snapshot?.sma_60, NaN)

  const bits = []
  if (ret5 != null) bits.push(`5m${ret5 >= 0 ? '+' : ''}${ret5}%`)
  if (ret20 != null) bits.push(`20m${ret20 >= 0 ? '+' : ''}${ret20}%`)
  if (Number.isFinite(rsi14)) bits.push(`RSI${Number(rsi14.toFixed(0))}`)
  if (Number.isFinite(sma20) && Number.isFinite(sma60) && sma20 > 0 && sma60 > 0) {
    bits.push(sma20 >= sma60 ? '趋势偏强' : '趋势偏弱')
  }

  if (!bits.length) return ''
  return safeText(`信号快照：${bits.join('，')}。`, 140)
}

function buildActionStep({ decision, context } = {}) {
  const head = decision?.decisions?.[0] || null
  const symbol = safeText(head?.symbol || context?.symbol || '', 20)
  const action = safeText(head?.action || '', 10).toUpperCase() || 'HOLD'
  const qty = toSafeNumber(head?.quantity, NaN)
  const shares = toSafeNumber(context?.position_state?.shares, NaN)
  const confidence = toSafeNumber(head?.confidence, NaN)
  const stopLoss = toSafeNumber(head?.stop_loss, NaN)
  const takeProfit = toSafeNumber(head?.take_profit, NaN)

  const forcedHold = context?.llm_decision?.source === 'readiness_gate'
  if (forcedHold) {
    const reasons = joinReasons(context?.data_readiness?.reasons)
    const extra = reasons ? `（${reasons}）` : ''
    return safeText(`动作：HOLD（数据未就绪${extra}，跳过模型）。`, 160)
  }

  const bits = []
  bits.push(`动作：${symbol ? symbol + ' ' : ''}${action}`)
  if (action === 'HOLD' && Number.isFinite(shares) && shares <= 0) {
    bits.push('当前无仓位，继续观察')
  }
  if (Number.isFinite(qty) && qty > 0) bits.push(`数量${Math.floor(qty)}`)
  if (Number.isFinite(confidence)) bits.push(`置信度${Number(confidence).toFixed(2)}`)
  if (Number.isFinite(stopLoss) && stopLoss > 0) bits.push(`止损${stopLoss.toFixed(2)}`)
  if (Number.isFinite(takeProfit) && takeProfit > 0) bits.push(`止盈${takeProfit.toFixed(2)}`)

  return safeText(`${bits.join('，')}。`, 160)
}

export function buildViewerReasoningStepsCn({ trader, context, decision } = {}) {
  const steps = []

  const dataStep = buildDataStep({
    dataReadiness: context?.data_readiness,
    sessionGate: context?.session_gate,
  })
  if (dataStep) steps.push(`1 ${dataStep}`)

  const overviewStep = buildOverviewStep({
    marketOverviewBrief: context?.market_overview?.brief,
    newsTitles: context?.news_digest?.titles,
  })
  if (overviewStep) steps.push(`2 ${overviewStep}`)

  const signalStep = buildSignalStep(context)
  if (signalStep) steps.push(`${steps.length + 1} ${signalStep}`)

  const actionStep = buildActionStep({ decision, context })
  if (actionStep) steps.push(`${steps.length + 1} ${actionStep}`)

  // Ensure 2-4 items for consistent UX.
  const trimmed = steps.filter(Boolean).slice(0, 4)
  if (trimmed.length >= 2) return trimmed

  // Fallback: if we only have one line, create a second minimal line.
  const name = safeText(trader?.trader_name || trader?.trader_id || 'Agent', 24)
  return [
    trimmed[0] || '1 数据状态：OK。',
    `2 ${name}：继续观察，等待更明确的信号。`,
  ]
}
