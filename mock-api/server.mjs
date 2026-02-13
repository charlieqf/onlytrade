import express from 'express'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMarketDataService } from './src/marketProxy.mjs'
import { buildAgentMarketContext, buildPositionState } from './src/agentMarketContext.mjs'
import { createInMemoryAgentRuntime } from './src/agentDecisionRuntime.mjs'
import { createReplayEngine } from './src/replayEngine.mjs'
import { createAgentMemoryStore } from './src/agentMemoryStore.mjs'
import { createOpenAIAgentDecider } from './src/agentLlmDecision.mjs'
import { createAgentRegistryStore } from './src/agentRegistryStore.mjs'
import { resolveRuntimeDataMode } from './src/runtimeDataMode.mjs'
import { createLiveFileFrameProvider } from './src/liveFileFrameProvider.mjs'
import { getCnAMarketSessionStatus } from './src/cnMarketSession.mjs'
import { createDecisionLogStore, dayKeyInTimeZone } from './src/decisionLogStore.mjs'
import { createChatFileStore } from './src/chat/chatFileStore.mjs'
import { createChatService } from './src/chat/chatService.mjs'
import { createOpenAIChatResponder } from './src/chat/chatLlmResponder.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return

  const content = readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue

    const key = match[1]
    if (process.env[key] !== undefined) continue

    let value = match[2].trim()
    const isQuoted = (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
    if (isQuoted) {
      value = value.slice(1, -1)
    }

    process.env[key] = value.replace(/\\n/g, '\n')
  }
}

function loadDotEnv() {
  const localPath = path.join(__dirname, '.env.local')
  const defaultPath = path.join(__dirname, '.env')
  loadEnvFile(localPath)
  loadEnvFile(defaultPath)
}

loadDotEnv()

const PORT = Number(process.env.PORT || 8080)
const BOOT_TS = Date.now()
const STEP_MS = 8000
const MARKET_PROVIDER = (process.env.MARKET_PROVIDER || 'real').toLowerCase() === 'real' ? 'real' : 'mock'
const MARKET_UPSTREAM_URL = process.env.MARKET_UPSTREAM_URL || ''
const MARKET_UPSTREAM_API_KEY = process.env.MARKET_UPSTREAM_API_KEY || ''
const MARKET_STREAM_POLL_MS = Math.max(300, Number(process.env.MARKET_STREAM_POLL_MS || 500))
const AGENT_RUNTIME_CYCLE_MS = Math.max(3000, Number(process.env.AGENT_RUNTIME_CYCLE_MS || 15000))
const AGENT_DECISION_EVERY_BARS = Math.max(1, Number(process.env.AGENT_DECISION_EVERY_BARS || 10))
const REPLAY_SPEED = Math.max(0.1, Number(process.env.REPLAY_SPEED || 60))
const REPLAY_WARMUP_BARS = Math.max(1, Number(process.env.REPLAY_WARMUP_BARS || 120))
const REPLAY_TICK_MS = Math.max(100, Number(process.env.REPLAY_TICK_MS || 250))
const REPLAY_LOOP = String(process.env.REPLAY_LOOP || 'true').toLowerCase() !== 'false'
const RUNTIME_DATA_MODE = resolveRuntimeDataMode(process.env.RUNTIME_DATA_MODE || 'live_file')
const STRICT_LIVE_MODE = String(process.env.STRICT_LIVE_MODE || 'true').toLowerCase() !== 'false'
const LIVE_FILE_REFRESH_MS = Math.max(250, Number(process.env.LIVE_FILE_REFRESH_MS || 10000))
const LIVE_FILE_STALE_MS = Math.max(10_000, Number(process.env.LIVE_FILE_STALE_MS || 180_000))
const AGENT_SESSION_GUARD_ENABLED = String(
  process.env.AGENT_SESSION_GUARD_ENABLED || (RUNTIME_DATA_MODE === 'live_file' ? 'true' : 'false')
).toLowerCase() !== 'false'
const AGENT_SESSION_GUARD_AUTO_RESUME = String(process.env.AGENT_SESSION_GUARD_AUTO_RESUME || 'true').toLowerCase() !== 'false'
const AGENT_SESSION_GUARD_CHECK_MS = Math.max(5_000, Number(process.env.AGENT_SESSION_GUARD_CHECK_MS || 30_000))
const AGENT_SESSION_GUARD_REQUIRE_FRESH_LIVE_DATA = String(process.env.AGENT_SESSION_GUARD_REQUIRE_FRESH_LIVE_DATA || 'true').toLowerCase() !== 'false'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
const AGENT_LLM_TIMEOUT_MS = Math.max(1000, Number(process.env.AGENT_LLM_TIMEOUT_MS || 7000))
const AGENT_LLM_ENABLED = String(process.env.AGENT_LLM_ENABLED || 'true').toLowerCase() !== 'false'
const AGENT_LLM_DEV_TOKEN_SAVER = String(process.env.AGENT_LLM_DEV_TOKEN_SAVER || 'true').toLowerCase() !== 'false'
const AGENT_LLM_MAX_OUTPUT_TOKENS = Math.max(80, Number(process.env.AGENT_LLM_MAX_OUTPUT_TOKENS || 180))
const AGENT_COMMISSION_RATE = Math.max(0, Number(process.env.AGENT_COMMISSION_RATE || 0.0003))
const CONTROL_API_TOKEN = process.env.CONTROL_API_TOKEN || ''
const RESET_AGENT_MEMORY_ON_BOOT = String(process.env.RESET_AGENT_MEMORY_ON_BOOT || 'false').toLowerCase() === 'true'
const MARKET_DAILY_HISTORY_DAYS = (() => {
  const parsed = Number(process.env.MARKET_DAILY_HISTORY_DAYS || 90)
  if (!Number.isFinite(parsed)) return 90
  return Math.max(20, Math.min(Math.floor(parsed), 365))
})()
const CHAT_MAX_TEXT_LEN = Math.max(10, Number(process.env.CHAT_MAX_TEXT_LEN || 600))
const CHAT_RATE_LIMIT_PER_MIN = Math.max(1, Number(process.env.CHAT_RATE_LIMIT_PER_MIN || 20))
const CHAT_PUBLIC_PLAIN_REPLY_RATE = (() => {
  const parsed = Number(process.env.CHAT_PUBLIC_PLAIN_REPLY_RATE || 0.05)
  if (!Number.isFinite(parsed)) return 0.05
  return Math.max(0, Math.min(parsed, 1))
})()
const CHAT_LLM_ENABLED = String(process.env.CHAT_LLM_ENABLED || String(AGENT_LLM_ENABLED)).toLowerCase() !== 'false'
const CHAT_LLM_TIMEOUT_MS = Math.max(1000, Number(process.env.CHAT_LLM_TIMEOUT_MS || AGENT_LLM_TIMEOUT_MS))
const CHAT_LLM_MAX_OUTPUT_TOKENS = Math.max(80, Number(process.env.CHAT_LLM_MAX_OUTPUT_TOKENS || 140))

const REPLAY_PATH = path.join(
  ROOT_DIR,
  'onlytrade-web',
  'public',
  'replay',
  'cn-a',
  'latest',
  'frames.1m.json'
)

const LIVE_FRAMES_PATH = path.resolve(
  ROOT_DIR,
  process.env.LIVE_FRAMES_PATH || path.join('data', 'live', 'onlytrade', 'frames.1m.json')
)

const DAILY_HISTORY_PATH = path.join(
  ROOT_DIR,
  'onlytrade-web',
  'public',
  'replay',
  'cn-a',
  'history',
  `frames.1d.${MARKET_DAILY_HISTORY_DAYS}.json`
)

const KILL_SWITCH_PATH = path.join(ROOT_DIR, 'data', 'runtime', 'kill-switch.json')

const AGENTS_DIR = path.resolve(
  ROOT_DIR,
  process.env.AGENTS_DIR || 'agents'
)

const AGENT_REGISTRY_PATH = path.resolve(
  ROOT_DIR,
  process.env.AGENT_REGISTRY_PATH || path.join('data', 'agents', 'registry.json')
)

if (STRICT_LIVE_MODE && RUNTIME_DATA_MODE !== 'live_file') {
  throw new Error('strict_live_mode_requires_runtime_data_mode_live_file')
}

if (STRICT_LIVE_MODE && MARKET_PROVIDER !== 'real') {
  throw new Error('strict_live_mode_requires_market_provider_real')
}

const DEFAULT_TRADERS = [
  {
    trader_id: 't_001',
    trader_name: 'HS300 Momentum',
    ai_model: 'qwen',
    exchange_id: 'sim-cn',
    strategy_name: 'Momentum + trend confirmation',
  },
  {
    trader_id: 't_002',
    trader_name: 'Value Rebound',
    ai_model: 'deepseek',
    exchange_id: 'sim-cn',
    strategy_name: 'Mean reversion + support zones',
  },
  {
    trader_id: 't_003',
    trader_name: 'Mei Lin Alpha',
    ai_model: 'gpt-4o-mini',
    exchange_id: 'sim-cn',
    strategy_name: 'Event-driven + risk controls',
  },
  {
    trader_id: 't_004',
    trader_name: 'Blonde Macro',
    ai_model: 'gpt-4o-mini',
    exchange_id: 'sim-cn',
    strategy_name: 'Macro swing + volatility filters',
  },
]

const CN_STOCK_NAME_BY_SYMBOL = {
  '600519.SH': '贵州茅台',
  '601318.SH': '中国平安',
  '600036.SH': '招商银行',
  '300750.SZ': '宁德时代',
  '000858.SZ': '五粮液',
  '000001.SZ': '平安银行',
  '688981.SH': '中芯国际',
}

function tick() {
  return Math.floor((Date.now() - BOOT_TS) / STEP_MS)
}

function getReplaySimulationState() {
  const replayState = replayEngine?.getStatus?.()
  if (replayState && Number.isFinite(replayState.cursor_index) && replayState.cursor_index >= 0) {
    const timelineLength = Math.max(1, Number(replayState.timeline_length) || 1)
    const cursorIndex = Number(replayState.cursor_index) || 0
    const normalized = timelineLength > 1 ? cursorIndex / (timelineLength - 1) : 0
    return {
      step: cursorIndex,
      normalized,
      trading_day: replayState.trading_day || null,
      day_index: Number(replayState.day_index) || 0,
      day_count: Number(replayState.day_count) || 0,
      day_bar_index: Number(replayState.day_bar_index) || 0,
      day_bar_count: Number(replayState.day_bar_count) || 0,
    }
  }

  return {
    step: STRICT_LIVE_MODE ? 0 : tick(),
    normalized: 0,
    trading_day: null,
    day_index: 0,
    day_count: 0,
    day_bar_index: 0,
    day_bar_count: 0,
  }
}

function ok(data) {
  return { success: true, data }
}

function fail(error, status = 500) {
  return { success: false, error, status }
}

function isSafeAssetFileName(value) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(String(value || '').trim())
}

function buildAgentAssetUrl(agentId, fileName) {
  const safeAgentId = String(agentId || '').trim()
  const safeFileName = String(fileName || '').trim()
  if (!safeAgentId || !safeFileName) return null
  if (!isSafeAssetFileName(safeFileName)) return null
  return `/api/agents/${encodeURIComponent(safeAgentId)}/assets/${encodeURIComponent(safeFileName)}`
}

function normalizeStockPool(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const output = []

  for (const item of value) {
    const symbol = String(item || '').trim().toUpperCase()
    if (!/^\d{6}\.(SH|SZ)$/.test(symbol)) continue
    if (seen.has(symbol)) continue
    seen.add(symbol)
    output.push(symbol)
    if (output.length >= 100) break
  }

  return output
}

function symbolsToEntries(symbols) {
  return symbols.map((symbol) => ({
    symbol,
    name: CN_STOCK_NAME_BY_SYMBOL[symbol] || symbol,
    category: 'stock',
  }))
}

function toTraderRecord(agent) {
  const agentId = String(agent?.agent_id || '').trim()
  const explicitAvatarUrl = String(agent?.avatar_url || '').trim()
  const explicitAvatarHdUrl = String(agent?.avatar_hd_url || '').trim()
  const avatarFile = String(agent?.avatar_file || '').trim()
  const avatarHdFile = String(agent?.avatar_hd_file || '').trim()
  const tradingStyle = String(agent?.trading_style || '').trim().toLowerCase()
  const riskProfile = String(agent?.risk_profile || '').trim().toLowerCase()
  const personality = String(agent?.personality || '').trim()
  const stylePromptCn = String(agent?.style_prompt_cn || '').trim()
  const stockPool = normalizeStockPool(agent?.stock_pool)

  const avatarUrl = explicitAvatarUrl || buildAgentAssetUrl(agentId, avatarFile)
  const avatarHdUrl = explicitAvatarHdUrl || buildAgentAssetUrl(agentId, avatarHdFile)

  return {
    trader_id: agentId,
    trader_name: String(agent?.agent_name || agent?.agent_id || '').trim(),
    ai_model: String(agent?.ai_model || 'unknown').trim(),
    exchange_id: String(agent?.exchange_id || 'sim-cn').trim(),
    is_running: String(agent?.status || 'stopped') === 'running',
    show_in_competition: agent?.show_in_lobby !== false,
    strategy_name: String(agent?.strategy_name || '').trim(),
    trading_style: tradingStyle || undefined,
    risk_profile: riskProfile || undefined,
    personality: personality || undefined,
    style_prompt_cn: stylePromptCn || undefined,
    stock_pool: stockPool.length ? stockPool : undefined,
    avatar_url: avatarUrl || undefined,
    avatar_hd_url: avatarHdUrl || undefined,
  }
}

function getRegisteredTraders() {
  return registeredAgents.map(toTraderRecord)
}

function getLobbyTraders() {
  return getRegisteredTraders().filter((trader) => trader.show_in_competition)
}

function getRunningRuntimeTraders() {
  return getRegisteredTraders().filter((trader) => trader.is_running)
}

function fallbackCompetitionRow(trader) {
  return {
    trader_id: trader.trader_id,
    trader_name: trader.trader_name,
    ai_model: trader.ai_model,
    exchange: 'sim',
    total_equity: 100000,
    total_pnl: 0,
    total_pnl_pct: 0,
    position_count: 0,
    margin_used_pct: 0,
    is_running: trader.is_running,
    avatar_url: trader.avatar_url,
    avatar_hd_url: trader.avatar_hd_url,
  }
}

function getCompetitionData() {
  const simulation = getReplaySimulationState()
  const initial = 100000
  const lobbyTraders = getLobbyTraders()

  const traders = lobbyTraders.map((trader) => {
    const fallback = fallbackCompetitionRow(trader)
    const snapshot = memoryStore?.getSnapshot?.(trader.trader_id)
    const stats = snapshot?.stats || {}
    const latestTotalBalance = Number(stats?.latest_total_balance)

    if (!Number.isFinite(latestTotalBalance) || latestTotalBalance <= 0) {
      return fallback
    }

    const equity = Number(latestTotalBalance.toFixed(2))
    const pnl = Number((equity - initial).toFixed(2))
    const pct = Number((((equity - initial) / initial) * 100).toFixed(2))
    const positionCount = Array.isArray(snapshot?.holdings)
      ? snapshot.holdings.filter((holding) => Number(holding?.shares) > 0).length
      : fallback.position_count

    return {
      ...fallback,
      total_pnl_pct: pct,
      total_pnl: pnl,
      total_equity: equity,
      position_count: positionCount,
      is_running: trader.is_running,
    }
  })

  return {
    count: traders.length,
    traders,
    replay: {
      trading_day: simulation.trading_day,
      day_index: simulation.day_index,
      day_count: simulation.day_count,
      day_bar_index: simulation.day_bar_index,
      day_bar_count: simulation.day_bar_count,
    },
  }
}

function getTraderById(traderId) {
  const wanted = String(traderId || '').trim()
  const registered = getRegisteredTraders()
  const available = availableAgents.map((agent) => ({
    trader_id: agent.agent_id,
    trader_name: agent.agent_name,
    ai_model: agent.ai_model,
    exchange_id: agent.exchange_id,
    is_running: false,
    show_in_competition: false,
    strategy_name: agent.strategy_name || '',
    trading_style: agent.trading_style || '',
    risk_profile: agent.risk_profile || '',
    personality: agent.personality || '',
    style_prompt_cn: agent.style_prompt_cn || '',
    stock_pool: normalizeStockPool(agent.stock_pool),
    avatar_url: agent.avatar_url || buildAgentAssetUrl(agent.agent_id, agent.avatar_file),
    avatar_hd_url: agent.avatar_hd_url || buildAgentAssetUrl(agent.agent_id, agent.avatar_hd_file),
  }))

  return (
    registered.find((trader) => trader.trader_id === wanted) ||
    available.find((trader) => trader.trader_id === wanted) ||
    registered[0] ||
    available[0] ||
    DEFAULT_TRADERS[0]
  )
}

function normalizeAgentHandle(traderName) {
  const normalized = String(traderName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'agent'
}

function resolveRoomAgentForChat(roomId) {
  const trader = getRegisteredTraders().find((item) => item.trader_id === roomId)
  if (!trader) return null

  return {
    roomId: trader.trader_id,
    agentId: trader.trader_id,
    agentHandle: normalizeAgentHandle(trader.trader_name),
    agentName: trader.trader_name,
    isRunning: trader.is_running === true,
    personality: trader.personality || '',
    tradingStyle: trader.trading_style || '',
    stylePromptCn: trader.style_prompt_cn || '',
  }
}

function createUserSessionId() {
  const token = randomUUID().replace(/-/g, '').slice(0, 16)
  return `usr_sess_${token}`
}

function sanitizeUserNickname(value) {
  const nickname = String(value || '').trim().replace(/\s+/g, ' ')
  if (!nickname) return ''
  return nickname.slice(0, 24)
}

function createDefaultUserNickname(userSessionId) {
  const suffix = String(userSessionId || '').replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase()
  if (!suffix) return 'User'
  return `User-${suffix}`
}

function parseChatLimit(limitRaw, fallback = 20) {
  const parsed = Number(limitRaw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(Math.floor(parsed), 200))
}

function parseBeforeTs(beforeRaw) {
  if (beforeRaw == null || beforeRaw === '') return null
  const parsed = Number(beforeRaw)
  return Number.isFinite(parsed) ? parsed : null
}

function chatErrorStatus(error) {
  if (Number.isFinite(Number(error?.status))) {
    return Number(error.status)
  }
  if (error?.code === 'room_not_found') return 404
  if (error?.code === 'rate_limited') return 429
  return 400
}

function agentErrorStatus(error) {
  if (Number.isFinite(Number(error?.status))) {
    return Number(error.status)
  }
  if (error?.code === 'invalid_agent_id') return 400
  if (error?.code === 'agent_manifest_not_found') return 404
  if (error?.code === 'agent_not_registered') return 409
  return 500
}

function resolveNicknameForSession(userSessionId, preferredNickname = '') {
  const safeSessionId = String(userSessionId || '').trim()
  const requestedNickname = sanitizeUserNickname(preferredNickname)
  if (!safeSessionId) {
    return requestedNickname || 'User'
  }
  const existing = chatSessionRegistry.get(safeSessionId)

  if (requestedNickname) {
    const record = {
      user_nickname: requestedNickname,
      updated_ts_ms: Date.now(),
    }
    chatSessionRegistry.set(safeSessionId, record)
    return requestedNickname
  }

  if (existing?.user_nickname) {
    return existing.user_nickname
  }

  const fallback = createDefaultUserNickname(safeSessionId)
  chatSessionRegistry.set(safeSessionId, {
    user_nickname: fallback,
    updated_ts_ms: Date.now(),
  })
  return fallback
}

function derivedDecisionCycleMs() {
  if (RUNTIME_DATA_MODE === 'live_file') {
    return agentRuntime?.getState?.().cycle_ms || AGENT_RUNTIME_CYCLE_MS
  }
  const replaySpeed = replayEngine?.getStatus?.().speed || REPLAY_SPEED
  return Math.max(1000, Math.round((60_000 * agentDecisionEveryBars) / Math.max(0.1, replaySpeed)))
}

function getAgentSessionGuardSnapshot(nowMs = Date.now(), { liveStatusOverride = undefined } = {}) {
  const enabled = AGENT_SESSION_GUARD_ENABLED && RUNTIME_DATA_MODE === 'live_file'
  const session = enabled ? getCnAMarketSessionStatus(nowMs) : null
  const liveStatus = enabled
    ? (liveStatusOverride !== undefined
      ? liveStatusOverride
      : (liveFileFrameProvider ? liveFileFrameProvider.getStatus() : null))
    : null
  const liveFreshOk = !AGENT_SESSION_GUARD_REQUIRE_FRESH_LIVE_DATA || (!liveStatus?.stale && !liveStatus?.last_error && (liveStatus?.frame_count || 0) > 0)

  return {
    enabled,
    auto_resume: !!AGENT_SESSION_GUARD_AUTO_RESUME,
    now_ms: nowMs,
    session,
    live_file: liveStatus,
    live_fresh_ok: liveFreshOk,
    auto_paused: !!agentSessionGuardState.auto_paused,
    auto_paused_at_ms: agentSessionGuardState.auto_paused_at_ms,
    last_check_ms: agentSessionGuardState.last_check_ms,
  }
}

async function enforceAgentSessionGuard({ reason = 'timer' } = {}) {
  let refreshedLiveStatus = undefined
  if (AGENT_SESSION_GUARD_ENABLED && RUNTIME_DATA_MODE === 'live_file' && liveFileFrameProvider) {
    try {
      await liveFileFrameProvider.refresh(false)
    } catch {
      // keep guard robust; stale status will block auto-resume
    }
    refreshedLiveStatus = liveFileFrameProvider.getStatus()
  }

  const snapshot = getAgentSessionGuardSnapshot(Date.now(), { liveStatusOverride: refreshedLiveStatus })
  if (!snapshot.enabled || !agentRuntime) {
    return { changed: false, snapshot }
  }

  agentSessionGuardState.last_check_ms = snapshot.now_ms
  agentSessionGuardState.last_session = snapshot.session
  agentSessionGuardState.last_live_status = snapshot.live_file

  if (killSwitchState.active) {
    return { changed: false, snapshot }
  }

  const isOpen = !!snapshot.session?.is_open
  const runtimeState = agentRuntime.getState()
  const runningTraders = getRunningRuntimeTraders()
  const hasRunningTraders = runningTraders.length > 0

  // Outside session: pause if the runtime is running.
  if (!isOpen) {
    if (runtimeState.running) {
      agentRuntime.pause()
      agentSessionGuardState.auto_paused = true
      agentSessionGuardState.auto_paused_at_ms = snapshot.now_ms
      return { changed: true, snapshot: { ...snapshot, reason } }
    }
    return { changed: false, snapshot: { ...snapshot, reason } }
  }

  // In session: optionally resume, but only if we paused it.
  if (!snapshot.auto_resume) {
    return { changed: false, snapshot: { ...snapshot, reason } }
  }

  if (!runtimeState.running && agentSessionGuardState.auto_paused && hasRunningTraders && snapshot.live_fresh_ok) {
    agentRuntime.resume()
    agentSessionGuardState.auto_paused = false
    agentSessionGuardState.auto_paused_at_ms = null
    return { changed: true, snapshot: { ...snapshot, reason } }
  }

  return { changed: false, snapshot: { ...snapshot, reason } }
}

function getAgentSessionGuardPublicSnapshot(nowMs = Date.now()) {
  const snapshot = getAgentSessionGuardSnapshot(nowMs)
  if (!snapshot.enabled) {
    return {
      enabled: false,
    }
  }

  const live = snapshot.live_file
  const livePublic = live ? {
    stale: !!live.stale,
    last_load_ts_ms: live.last_load_ts_ms,
    last_mtime_ms: live.last_mtime_ms,
    last_error: live.last_error,
    frame_count: live.frame_count,
  } : null

  return {
    enabled: true,
    auto_resume: snapshot.auto_resume,
    require_fresh_live_data: !!AGENT_SESSION_GUARD_REQUIRE_FRESH_LIVE_DATA,
    auto_paused: snapshot.auto_paused,
    auto_paused_at_ms: snapshot.auto_paused_at_ms,
    session: snapshot.session,
    live_file: livePublic,
  }
}

function secureTokenEquals(expected, provided) {
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8')
  const providedBuffer = Buffer.from(String(provided || ''), 'utf8')
  if (!expectedBuffer.length || expectedBuffer.length !== providedBuffer.length) {
    return false
  }
  return timingSafeEqual(expectedBuffer, providedBuffer)
}

function resolveControlToken(req) {
  const headerToken = String(req.headers['x-control-token'] || '').trim()
  if (headerToken) return headerToken

  const authHeader = String(req.headers.authorization || '').trim()
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim()
  }

  const bodyToken = String(req.body?.control_token || '').trim()
  return bodyToken
}

function requireControlAuthorization(req, res) {
  if (!CONTROL_API_TOKEN) return true

  const provided = resolveControlToken(req)
  if (!secureTokenEquals(CONTROL_API_TOKEN, provided)) {
    res.status(401).json({ success: false, error: 'unauthorized_control_token' })
    return false
  }
  return true
}

function killSwitchPublicState() {
  return {
    ...killSwitchState,
    control_token_required: !!CONTROL_API_TOKEN,
  }
}

async function persistKillSwitchState() {
  const dir = path.dirname(KILL_SWITCH_PATH)
  await mkdir(dir, { recursive: true })
  const tmpPath = `${KILL_SWITCH_PATH}.tmp`
  await writeFile(tmpPath, JSON.stringify(killSwitchState, null, 2), 'utf8')
  await rename(tmpPath, KILL_SWITCH_PATH)
}

async function loadKillSwitchState() {
  try {
    const raw = await readFile(KILL_SWITCH_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.active === 'boolean') {
      killSwitchState = {
        ...killSwitchState,
        ...parsed,
        active: !!parsed.active,
      }
    }
  } catch {
    // Default to inactive when no persisted state exists.
  }
}

async function setKillSwitch({ active, reason = null, actor = 'unknown' }) {
  if (active) {
    killSwitchState = {
      ...killSwitchState,
      active: true,
      reason: reason || 'manual_terminate_all_agents',
      activated_at: new Date().toISOString(),
      activated_by: actor,
      deactivated_at: null,
      deactivated_by: null,
    }
    replayEngine?.pause?.()
    agentRuntime?.pause?.()
    replayBarsSinceAgentDecision = 0
    queuedAgentDecisionSteps = 0
    agentDispatchInFlight = false
  } else {
    killSwitchState = {
      ...killSwitchState,
      active: false,
      deactivated_at: new Date().toISOString(),
      deactivated_by: actor,
    }
  }

  await persistKillSwitchState()
}

function getStatus(traderId) {
  const trader = getTraderById(traderId)
  const runtimeCallCount = agentRuntime?.getCallCount(trader.trader_id) || 0
  const runtimeState = agentRuntime?.getState?.() || { cycle_ms: AGENT_RUNTIME_CYCLE_MS }
  const replaySpeed = replayEngine?.getStatus?.().speed || REPLAY_SPEED
  const scanIntervalSec = RUNTIME_DATA_MODE === 'live_file'
    ? Math.max(1, Math.round((Number(runtimeState.cycle_ms || AGENT_RUNTIME_CYCLE_MS) || AGENT_RUNTIME_CYCLE_MS) / 1000))
    : Math.max(1, Math.round((60 / Math.max(0.1, replaySpeed)) * agentDecisionEveryBars))
  return {
    trader_id: trader.trader_id,
    trader_name: trader.trader_name,
    ai_model: trader.ai_model,
    is_running: !!trader.is_running,
    start_time: new Date(BOOT_TS).toISOString(),
    runtime_minutes: Math.max(0, Math.floor((Date.now() - BOOT_TS) / 60_000)),
    call_count: runtimeCallCount,
    initial_balance: 100000,
    scan_interval: RUNTIME_DATA_MODE === 'live_file'
      ? `${scanIntervalSec}s`
      : `${scanIntervalSec}s (~${agentDecisionEveryBars} bars)`,
    stop_until: '',
    last_reset_time: '',
    ai_provider: llmDecider ? 'openai-runtime' : 'rule-runtime',
    strategy_type: 'ai_trading',
  }
}

function getAccount(traderId) {
  const snapshot = memoryStore?.getSnapshot?.(traderId)
  const stats = snapshot?.stats || {}
  const initialBalance = Number(stats?.initial_balance || 100000)
  const latestTotalBalance = Number(stats?.latest_total_balance)
  const latestAvailableBalance = Number(stats?.latest_available_balance)
  const latestUnrealizedProfit = Number(stats?.latest_unrealized_profit)

  if (Number.isFinite(latestTotalBalance) && latestTotalBalance > 0) {
    const totalEquity = Number(latestTotalBalance.toFixed(2))
    const availableBalance = Number((Number.isFinite(latestAvailableBalance) ? latestAvailableBalance : totalEquity).toFixed(2))
    const unrealizedProfit = Number((Number.isFinite(latestUnrealizedProfit) ? latestUnrealizedProfit : 0).toFixed(2))
    const totalPnl = Number((totalEquity - initialBalance).toFixed(2))
    const totalPnlPct = Number((((totalEquity - initialBalance) / Math.max(1, initialBalance)) * 100).toFixed(2))
    const latestDaily = Array.isArray(snapshot?.daily_journal) ? snapshot.daily_journal[0] : null
    const dailyPnl = latestDaily
      ? Number((Number(latestDaily.end_balance || totalEquity) - Number(latestDaily.start_balance || totalEquity)).toFixed(2))
      : 0
    const positionCount = Array.isArray(snapshot?.holdings)
      ? snapshot.holdings.filter((holding) => Number(holding?.shares) > 0).length
      : 0

    return {
      total_equity: totalEquity,
      wallet_balance: availableBalance,
      unrealized_profit: unrealizedProfit,
      available_balance: availableBalance,
      total_pnl: totalPnl,
      total_pnl_pct: totalPnlPct,
      initial_balance: initialBalance,
      daily_pnl: dailyPnl,
      position_count: positionCount,
      margin_used: 0,
      margin_used_pct: 0,
    }
  }

  return {
    total_equity: initialBalance,
    wallet_balance: initialBalance,
    unrealized_profit: 0,
    available_balance: initialBalance,
    total_pnl: 0,
    total_pnl_pct: 0,
    initial_balance: initialBalance,
    daily_pnl: 0,
    position_count: 0,
    margin_used: 0,
    margin_used_pct: 0,
  }
}

function getPositions(traderId) {
  const snapshot = memoryStore?.getSnapshot?.(traderId)
  if (snapshot && Array.isArray(snapshot.holdings)) {
    const holdings = snapshot.holdings
      .filter((holding) => Number(holding?.shares) > 0)
      .map((holding) => {
        const quantity = Math.max(0, Math.floor(Number(holding.shares) || 0))
        const entryPrice = Number(holding.avg_cost || 0)
        const markPrice = Number(holding.mark_price || entryPrice || 0)
        const unrealizedPnl = Number(((markPrice - entryPrice) * quantity).toFixed(2))
        const unrealizedPnlPct = entryPrice > 0
          ? Number((((markPrice - entryPrice) / entryPrice) * 100).toFixed(4))
          : 0

        return {
          symbol: String(holding.symbol || ''),
          side: 'LONG',
          entry_price: Number(entryPrice.toFixed(4)),
          mark_price: Number(markPrice.toFixed(4)),
          quantity,
          leverage: 1,
          unrealized_pnl: unrealizedPnl,
          unrealized_pnl_pct: unrealizedPnlPct,
          liquidation_price: 0,
          margin_used: 0,
        }
      })
      .filter((position) => position.symbol)

    return holdings
  }

  return []
}

function getStatistics() {
  const runtimeMetrics = agentRuntime?.getMetrics() || { totalCycles: 0, successfulCycles: 0, failedCycles: 0 }
  const snapshots = memoryStore?.getAllSnapshots?.() || []
  const totalOpenPositions = snapshots.reduce((sum, snapshot) => {
    const holdings = Array.isArray(snapshot?.holdings) ? snapshot.holdings : []
    return sum + holdings.filter((holding) => Number(holding?.shares) > 0).length
  }, 0)
  const totalClosePositions = snapshots.reduce((sum, snapshot) => {
    const sellTrades = Number(snapshot?.stats?.sell_trades || 0)
    return sum + (Number.isFinite(sellTrades) ? Math.max(0, sellTrades) : 0)
  }, 0)

  const totalCycles = Number.isFinite(runtimeMetrics.totalCycles) ? Math.max(0, runtimeMetrics.totalCycles) : 0
  const failedCycles = Number.isFinite(runtimeMetrics.failedCycles) ? Math.max(0, runtimeMetrics.failedCycles) : 0
  const successfulCycles = Number.isFinite(runtimeMetrics.successfulCycles)
    ? Math.max(0, runtimeMetrics.successfulCycles)
    : Math.max(totalCycles - failedCycles, 0)

  return {
    total_cycles: totalCycles,
    successful_cycles: successfulCycles,
    failed_cycles: failedCycles,
    total_open_positions: totalOpenPositions,
    total_close_positions: totalClosePositions,
  }
}

function hashSymbol(symbol) {
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function intervalMs(interval) {
  switch (interval) {
    case '1m': return 60_000
    case '5m': return 5 * 60_000
    case '15m': return 15 * 60_000
    case '30m': return 30 * 60_000
    case '60m':
    case '1h': return 60 * 60_000
    case '4h': return 4 * 60 * 60_000
    case '1d': return 24 * 60 * 60_000
    default: return 5 * 60_000
  }
}

function tradingDayString(tsMs) {
  return new Date(tsMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

function sessionPhase(tsMs) {
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(tsMs))
  const [hh, mm] = hm.split(':').map(Number)
  const mins = hh * 60 + mm

  if (mins >= 555 && mins < 570) return 'pre_open'
  if (mins >= 570 && mins < 690) return 'continuous_am'
  if (mins >= 690 && mins < 780) return 'lunch_break'
  if (mins >= 780 && mins < 900) return 'continuous_pm'
  if (mins >= 900 && mins < 915) return 'close_auction'
  return 'closed'
}

function exchangeFromSymbol(symbol) {
  if (symbol.endsWith('.SH')) return 'SSE'
  if (symbol.endsWith('.SZ')) return 'SZSE'
  return 'OTHER'
}

function generateFrames({ symbol, interval, limit, mode = 'mock', provider = 'mock-api-generated' }) {
  const seed = hashSymbol(symbol)
  const base = 80 + (seed % 1500)
  const step = intervalMs(interval)
  const safeLimit = Math.max(1, Math.min(limit, 2000))
  const frames = []
  let prev = base
  const now = Date.now()
  const startSeq = Math.floor(now / step) - safeLimit

  for (let i = safeLimit - 1; i >= 0; i--) {
    const start = now - i * step
    const end = start + step

    const drift = Math.sin((safeLimit - i) / 12) * (base * 0.001)
    const noise = ((seed + i * 17) % 11 - 5) * (base * 0.0006)

    const open = prev
    const close = Math.max(0.1, open + drift + noise)
    const high = Math.max(open, close) * 1.004
    const low = Math.min(open, close) * 0.996
    const volumeShares = 5000 + ((seed + i * 29) % 9000)
    const turnoverCny = Number((volumeShares * close).toFixed(2))

    frames.push({
      schema_version: 'market.bar.v1',
      market: 'CN-A',
      mode,
      provider,
      feed: 'bars',
      seq: startSeq + (safeLimit - i),
      event_ts_ms: end,
      ingest_ts_ms: end + 120,
      instrument: {
        symbol,
        exchange: exchangeFromSymbol(symbol),
        timezone: 'Asia/Shanghai',
        currency: 'CNY',
      },
      interval,
      window: {
        start_ts_ms: start,
        end_ts_ms: end,
        trading_day: tradingDayString(start),
      },
      session: {
        phase: sessionPhase(start),
        is_halt: false,
        is_partial: i === 0,
      },
      bar: {
        open: Number(open.toFixed(4)),
        high: Number(high.toFixed(4)),
        low: Number(low.toFixed(4)),
        close: Number(close.toFixed(4)),
        volume_shares: volumeShares,
        turnover_cny: turnoverCny,
        vwap: Number((turnoverCny / volumeShares).toFixed(4)),
      },
    })

    prev = close
  }

  return frames
}

function framesToKlines(frames) {
  return frames.map((frame) => ({
    openTime: frame.window.start_ts_ms,
    open: frame.bar.open,
    high: frame.bar.high,
    low: frame.bar.low,
    close: frame.bar.close,
    volume: frame.bar.volume_shares,
    quoteVolume: frame.bar.turnover_cny,
  }))
}

function toFixedNumber(value, digits = 2) {
  return Number((Number(value) || 0).toFixed(digits))
}

function toTimeMs(value) {
  const ts = new Date(value || '').getTime()
  return Number.isFinite(ts) ? ts : 0
}

function generateEquityHistory(traderId, hours = 0) {
  const snapshot = memoryStore?.getSnapshot?.(traderId)
  const initialBalance = Math.max(1, Number(snapshot?.stats?.initial_balance || 100000))
  const curve = Array.isArray(snapshot?.equity_curve) ? snapshot.equity_curve : []

  const normalized = curve
    .map((point, idx) => {
      const equity = toFixedNumber(point?.total_equity, 2)
      const pnl = toFixedNumber(point?.pnl, 2)
      const pct = toFixedNumber(point?.pnl_pct, 4)
      return {
        timestamp: String(point?.timestamp || new Date().toISOString()),
        total_equity: equity,
        pnl,
        pnl_pct: pct,
        total_pnl_pct: toFixedNumber(point?.total_pnl_pct, 4),
        cycle_number: Math.max(0, Math.floor(Number(point?.cycle_number) || idx + 1)),
      }
    })
    .sort((a, b) => toTimeMs(a.timestamp) - toTimeMs(b.timestamp))

  const nowMs = Date.now()
  const filteredByHours = Number(hours) > 0
    ? normalized.filter((point) => toTimeMs(point.timestamp) >= nowMs - Number(hours) * 60 * 60 * 1000)
    : normalized

  const output = filteredByHours.length ? filteredByHours : normalized
  if (output.length) {
    return output
  }

  const latest = toFixedNumber(snapshot?.stats?.latest_total_balance || initialBalance, 2)
  return [{
    timestamp: new Date().toISOString(),
    total_equity: latest,
    pnl: toFixedNumber(latest - initialBalance, 2),
    pnl_pct: toFixedNumber(((latest - initialBalance) / initialBalance) * 100, 4),
    total_pnl_pct: toFixedNumber(((latest - initialBalance) / initialBalance) * 100, 4),
    cycle_number: Math.max(0, Number(snapshot?.stats?.decisions || 0)),
  }]
}

function buildPositionHistoryStats(closedPositions, initialBalance = 100000) {
  const trades = Array.isArray(closedPositions) ? closedPositions : []
  const totalTrades = trades.length
  const wins = trades.filter((trade) => Number(trade?.realized_pnl || 0) > 0)
  const losses = trades.filter((trade) => Number(trade?.realized_pnl || 0) < 0)
  const grossProfit = wins.reduce((sum, trade) => sum + Number(trade.realized_pnl || 0), 0)
  const grossLossAbs = Math.abs(losses.reduce((sum, trade) => sum + Number(trade.realized_pnl || 0), 0))
  const totalPnl = trades.reduce((sum, trade) => sum + Number(trade?.realized_pnl || 0), 0)
  const totalFee = trades.reduce((sum, trade) => sum + Number(trade?.fee || 0), 0)
  const tradeReturns = trades.map((trade) => Number(trade?.realized_pnl || 0) / Math.max(1, initialBalance))
  const mean = tradeReturns.length
    ? tradeReturns.reduce((sum, value) => sum + value, 0) / tradeReturns.length
    : 0
  const variance = tradeReturns.length > 1
    ? tradeReturns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (tradeReturns.length - 1)
    : 0
  const stdDev = Math.sqrt(Math.max(0, variance))
  const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(tradeReturns.length) : 0

  const sortedByExit = [...trades].sort((a, b) => toTimeMs(a?.exit_time) - toTimeMs(b?.exit_time))
  let equity = Number(initialBalance || 100000)
  let peak = equity
  let maxDrawdownPct = 0
  for (const trade of sortedByExit) {
    equity += Number(trade?.realized_pnl || 0)
    peak = Math.max(peak, equity)
    const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdown)
  }

  return {
    total_trades: totalTrades,
    win_trades: wins.length,
    loss_trades: losses.length,
    win_rate: totalTrades > 0 ? toFixedNumber((wins.length / totalTrades) * 100, 2) : 0,
    profit_factor: grossLossAbs > 0 ? toFixedNumber(grossProfit / grossLossAbs, 2) : toFixedNumber(grossProfit > 0 ? 999 : 0, 2),
    sharpe_ratio: toFixedNumber(sharpe, 2),
    total_pnl: toFixedNumber(totalPnl, 2),
    total_fee: toFixedNumber(totalFee, 2),
    avg_win: wins.length ? toFixedNumber(grossProfit / wins.length, 2) : 0,
    avg_loss: losses.length ? toFixedNumber(losses.reduce((sum, trade) => sum + Number(trade.realized_pnl || 0), 0) / losses.length, 2) : 0,
    max_drawdown_pct: toFixedNumber(maxDrawdownPct, 2),
  }
}

function buildSymbolStats(closedPositions) {
  const map = new Map()
  for (const trade of closedPositions || []) {
    const symbol = String(trade?.symbol || '').trim()
    if (!symbol) continue
    if (!map.has(symbol)) {
      map.set(symbol, {
        symbol,
        total_trades: 0,
        win_trades: 0,
        total_pnl: 0,
        total_hold_mins: 0,
      })
    }
    const bucket = map.get(symbol)
    const pnl = Number(trade?.realized_pnl || 0)
    bucket.total_trades += 1
    if (pnl > 0) bucket.win_trades += 1
    bucket.total_pnl += pnl
    const holdMins = Math.max(0, (toTimeMs(trade?.exit_time) - toTimeMs(trade?.entry_time)) / 60000)
    bucket.total_hold_mins += holdMins
  }

  return Array.from(map.values())
    .map((row) => ({
      symbol: row.symbol,
      total_trades: row.total_trades,
      win_trades: row.win_trades,
      win_rate: row.total_trades > 0 ? toFixedNumber((row.win_trades / row.total_trades) * 100, 2) : 0,
      total_pnl: toFixedNumber(row.total_pnl, 2),
      avg_pnl: row.total_trades > 0 ? toFixedNumber(row.total_pnl / row.total_trades, 2) : 0,
      avg_hold_mins: row.total_trades > 0 ? toFixedNumber(row.total_hold_mins / row.total_trades, 2) : 0,
    }))
    .sort((a, b) => b.total_pnl - a.total_pnl)
}

function buildDirectionStats(closedPositions) {
  const map = new Map()
  for (const trade of closedPositions || []) {
    const side = String(trade?.side || 'LONG').toUpperCase()
    if (!map.has(side)) {
      map.set(side, {
        side,
        trade_count: 0,
        win_trades: 0,
        total_pnl: 0,
      })
    }
    const bucket = map.get(side)
    const pnl = Number(trade?.realized_pnl || 0)
    bucket.trade_count += 1
    if (pnl > 0) bucket.win_trades += 1
    bucket.total_pnl += pnl
  }

  return Array.from(map.values()).map((row) => ({
    side: row.side,
    trade_count: row.trade_count,
    win_rate: row.trade_count > 0 ? toFixedNumber((row.win_trades / row.trade_count) * 100, 2) : 0,
    total_pnl: toFixedNumber(row.total_pnl, 2),
    avg_pnl: row.trade_count > 0 ? toFixedNumber(row.total_pnl / row.trade_count, 2) : 0,
  }))
}

function getPositionHistory(traderId, limit = 100) {
  const snapshot = memoryStore?.getSnapshot?.(traderId)
  const initialBalance = Number(snapshot?.stats?.initial_balance || 100000)
  const closed = Array.isArray(snapshot?.closed_positions) ? snapshot.closed_positions : []
  let tradeEvents = Array.isArray(snapshot?.trade_events) ? snapshot.trade_events : []

  const commissionRate = Number(snapshot?.config?.commission_rate ?? AGENT_COMMISSION_RATE)
  const safeCommissionRate = Number.isFinite(commissionRate) ? Math.max(0, commissionRate) : 0
  const defaultCashAfter = toFixedNumber(Number(snapshot?.stats?.latest_available_balance ?? initialBalance), 2)
  const defaultEquityAfter = toFixedNumber(Number(snapshot?.stats?.latest_total_balance ?? initialBalance), 2)
  const holdings = Array.isArray(snapshot?.holdings) ? snapshot.holdings : []
  const holdingBySymbol = new Map(
    holdings
      .map((row) => ({
        symbol: String(row?.symbol || '').trim(),
        shares: Number(row?.shares ?? 0),
        avg_cost: Number(row?.avg_cost ?? 0),
        mark_price: Number(row?.mark_price ?? 0),
      }))
      .filter((row) => row.symbol)
      .map((row) => [row.symbol, row])
  )

  // Backfill trade events for older snapshots (before trade_events existed).
  // We prefer showing *something* in realtime (buys/sells) even when there are
  // no closed positions yet.
  if (tradeEvents.length === 0 && snapshot) {
    const seeded = []
    const openLots = Array.isArray(snapshot?.open_lots) ? snapshot.open_lots : []
    for (const lot of openLots) {
      const symbol = String(lot?.symbol || '').trim()
      const qty = Math.max(0, Math.floor(Number(lot?.entry_qty || 0)))
      const price = Number(lot?.entry_price || 0)
      const ts = String(lot?.entry_time || snapshot?.updated_at || '')
      if (!symbol || !qty || !Number.isFinite(price) || !ts) continue

      const notional = toFixedNumber(qty * price, 2)
      const holding = holdingBySymbol.get(symbol)
      const feeFromLot = Number(lot?.entry_fee_remaining ?? 0)
      const computedFee = safeCommissionRate > 0 ? toFixedNumber(Number(notional) * safeCommissionRate, 2) : 0
      const fee = Number.isFinite(feeFromLot) && feeFromLot > 0 ? toFixedNumber(feeFromLot, 2) : computedFee

      seeded.push({
        id: String(lot?.entry_order_id || `seed-buy-${symbol}-${ts}`),
        trader_id: traderId,
        cycle_number: 0,
        ts,
        symbol,
        side: 'BUY',
        quantity: qty,
        price,
        notional,
        fee,
        realized_pnl: 0,
        cash_after: defaultCashAfter,
        total_equity_after: defaultEquityAfter,
        position_after_qty: Number.isFinite(Number(holding?.shares)) && Number(holding?.shares) > 0
          ? Math.floor(Number(holding.shares))
          : qty,
        position_after_avg_cost: Number.isFinite(Number(holding?.avg_cost)) && Number(holding?.avg_cost) > 0
          ? toFixedNumber(Number(holding.avg_cost), 4)
          : toFixedNumber(price, 4),
        position_after_mark: Number.isFinite(Number(holding?.mark_price)) && Number(holding?.mark_price) > 0
          ? toFixedNumber(Number(holding.mark_price), 4)
          : toFixedNumber(price, 4),
        source: 'seed',
      })
    }

    for (const pos of closed) {
      const symbol = String(pos?.symbol || '').trim()
      const qty = Math.max(0, Math.floor(Number(pos?.quantity || 0)))
      const price = Number(pos?.exit_price || 0)
      const ts = String(pos?.exit_time || '')
      if (!symbol || !qty || !Number.isFinite(price) || !ts) continue

      const notional = toFixedNumber(qty * price, 2)
      const holding = holdingBySymbol.get(symbol)
      const explicitFee = Number(pos?.fee ?? 0)
      const computedFee = safeCommissionRate > 0 ? toFixedNumber(Number(notional) * safeCommissionRate, 2) : 0
      const fee = Number.isFinite(explicitFee) && explicitFee > 0 ? toFixedNumber(explicitFee, 2) : computedFee

      seeded.push({
        id: String(pos?.exit_order_id || `seed-sell-${symbol}-${ts}`),
        trader_id: traderId,
        cycle_number: 0,
        ts,
        symbol,
        side: 'SELL',
        quantity: qty,
        price,
        notional,
        fee,
        realized_pnl: toFixedNumber(Number(pos?.realized_pnl || 0), 2),
        cash_after: defaultCashAfter,
        total_equity_after: defaultEquityAfter,
        position_after_qty: Number.isFinite(Number(holding?.shares))
          ? Math.max(0, Math.floor(Number(holding.shares)))
          : 0,
        position_after_avg_cost: Number.isFinite(Number(holding?.avg_cost)) && Number(holding?.avg_cost) > 0
          ? toFixedNumber(Number(holding.avg_cost), 4)
          : 0,
        position_after_mark: Number.isFinite(Number(holding?.mark_price)) && Number(holding?.mark_price) > 0
          ? toFixedNumber(Number(holding.mark_price), 4)
          : toFixedNumber(price, 4),
        source: 'seed',
      })
    }

    tradeEvents = seeded
  }

  // Ensure older events still show post-trade snapshot columns.
  if (snapshot && tradeEvents.length) {
    tradeEvents = tradeEvents.map((evt) => {
      if (!evt || typeof evt !== 'object') return evt
      const symbol = String(evt?.symbol || '').trim()
      const holding = symbol ? holdingBySymbol.get(symbol) : null
      const next = { ...evt }

      if (next.cash_after == null) next.cash_after = defaultCashAfter
      if (next.total_equity_after == null) next.total_equity_after = defaultEquityAfter

      if (next.position_after_qty == null) {
        if (Number.isFinite(Number(holding?.shares))) {
          next.position_after_qty = Math.max(0, Math.floor(Number(holding.shares)))
        }
      }
      if (next.position_after_avg_cost == null) {
        if (Number.isFinite(Number(holding?.avg_cost)) && Number(holding.avg_cost) > 0) {
          next.position_after_avg_cost = toFixedNumber(Number(holding.avg_cost), 4)
        }
      }
      if (next.position_after_mark == null) {
        if (Number.isFinite(Number(holding?.mark_price)) && Number(holding.mark_price) > 0) {
          next.position_after_mark = toFixedNumber(Number(holding.mark_price), 4)
        }
      }

      // Normalize fee display to avoid -0.00.
      const fee = Number(next.fee ?? 0)
      if (Number.isFinite(fee)) {
        next.fee = toFixedNumber(Math.abs(fee), 2)
      }

      return next
    })
  }
  const sorted = [...closed].sort((a, b) => toTimeMs(b?.exit_time) - toTimeMs(a?.exit_time))
  const sortedTrades = [...tradeEvents].sort((a, b) => toTimeMs(b?.ts) - toTimeMs(a?.ts))
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 100, 1000))
  const limited = sorted.slice(0, safeLimit)
  const limitedTrades = sortedTrades.slice(0, safeLimit)

  return {
    positions: limited,
    trade_events: limitedTrades,
    stats: buildPositionHistoryStats(sorted, initialBalance),
    symbol_stats: buildSymbolStats(sorted),
    direction_stats: buildDirectionStats(sorted),
  }
}

let replayBatch = null
let dailyHistoryBatch = null
let agentRuntime = null
let replayEngine = null
let replayEngineTimer = null
let liveFileFrameProvider = null
let agentSessionGuardTimer = null
let agentSessionGuardState = {
  auto_paused: false,
  auto_paused_at_ms: null,
  last_check_ms: null,
  last_session: null,
  last_live_status: null,
}
let availableAgents = []
let registeredAgents = []
const agentRegistryStore = createAgentRegistryStore({
  agentsDir: AGENTS_DIR,
  registryPath: AGENT_REGISTRY_PATH,
})
const memoryStore = createAgentMemoryStore({
  rootDir: ROOT_DIR,
  traders: DEFAULT_TRADERS,
  commissionRate: AGENT_COMMISSION_RATE,
})
const chatSessionRegistry = new Map()
const chatStore = createChatFileStore({
  baseDir: path.join(ROOT_DIR, 'data', 'chat'),
})
const decisionLogStore = createDecisionLogStore({
  baseDir: path.join(ROOT_DIR, 'data', 'decisions'),
  timeZone: 'Asia/Shanghai',
})
let chatService = null
let agentDecisionEveryBars = AGENT_DECISION_EVERY_BARS
let replayBarsSinceAgentDecision = 0
let queuedAgentDecisionSteps = 0
let agentDispatchInFlight = false
let killSwitchState = {
  active: false,
  reason: null,
  activated_at: null,
  activated_by: null,
  deactivated_at: null,
  deactivated_by: null,
}
const llmDecider = AGENT_LLM_ENABLED
  ? createOpenAIAgentDecider({
    apiKey: OPENAI_API_KEY,
    model: OPENAI_MODEL,
    baseUrl: OPENAI_BASE_URL,
    timeoutMs: AGENT_LLM_TIMEOUT_MS,
    devTokenSaver: AGENT_LLM_DEV_TOKEN_SAVER,
    maxOutputTokens: AGENT_LLM_MAX_OUTPUT_TOKENS,
  })
  : null
const chatLlmResponder = CHAT_LLM_ENABLED
  ? createOpenAIChatResponder({
    apiKey: OPENAI_API_KEY,
    model: OPENAI_MODEL,
    baseUrl: OPENAI_BASE_URL,
    timeoutMs: CHAT_LLM_TIMEOUT_MS,
    maxOutputTokens: CHAT_LLM_MAX_OUTPUT_TOKENS,
    maxTextLen: CHAT_MAX_TEXT_LEN,
  })
  : null
chatService = createChatService({
  store: chatStore,
  resolveRoomAgent: resolveRoomAgentForChat,
  resolveLatestDecision: (roomId) => {
    const latest = agentRuntime?.getLatestDecisions?.(roomId, 1) || []
    return latest[0] || null
  },
  maxTextLen: CHAT_MAX_TEXT_LEN,
  rateLimitPerMin: CHAT_RATE_LIMIT_PER_MIN,
  publicPlainReplyRate: CHAT_PUBLIC_PLAIN_REPLY_RATE,
  generateAgentMessageText: chatLlmResponder,
})
let marketDataService = createMarketDataService({
  provider: MARKET_PROVIDER,
  upstreamBaseUrl: MARKET_UPSTREAM_URL,
  upstreamApiKey: MARKET_UPSTREAM_API_KEY,
  strictLive: STRICT_LIVE_MODE && RUNTIME_DATA_MODE === 'live_file',
  replayBatch,
  dailyHistoryBatch,
  replayFrameProvider: async ({ symbol, interval, limit }) => {
    if (interval !== '1m') return []

    if (RUNTIME_DATA_MODE === 'live_file' && liveFileFrameProvider) {
      return liveFileFrameProvider.getFrames({ symbol, interval, limit })
    }

    if (!replayEngine) return []
    return replayEngine.getVisibleFrames(symbol, limit)
  },
})

function syncMarketDataService() {
  if (RUNTIME_DATA_MODE === 'live_file' && !liveFileFrameProvider) {
    liveFileFrameProvider = createLiveFileFrameProvider({
      filePath: LIVE_FRAMES_PATH,
      refreshMs: LIVE_FILE_REFRESH_MS,
      staleAfterMs: LIVE_FILE_STALE_MS,
    })
  }

  marketDataService = createMarketDataService({
    provider: MARKET_PROVIDER,
    upstreamBaseUrl: MARKET_UPSTREAM_URL,
    upstreamApiKey: MARKET_UPSTREAM_API_KEY,
    strictLive: STRICT_LIVE_MODE && RUNTIME_DATA_MODE === 'live_file',
    replayBatch,
    dailyHistoryBatch,
    replayFrameProvider: async ({ symbol, interval, limit }) => {
      if (interval !== '1m') return []

      if (RUNTIME_DATA_MODE === 'live_file' && liveFileFrameProvider) {
        return liveFileFrameProvider.getFrames({ symbol, interval, limit })
      }

      if (!replayEngine) return []
      return replayEngine.getVisibleFrames(symbol, limit)
    },
  })
}

async function refreshAgentState({ reconcile = true } = {}) {
  if (reconcile) {
    await agentRegistryStore.reconcile()
  }

  const [nextAvailable, nextRegistered] = await Promise.all([
    agentRegistryStore.listAvailableAgents(),
    agentRegistryStore.listRegisteredAgents(),
  ])

  availableAgents = nextAvailable
  registeredAgents = nextRegistered.filter((agent) => agent.available !== false)

  const runtimeTraders = getRunningRuntimeTraders()
  agentRuntime?.setTraders?.(runtimeTraders)

  if (agentRuntime) {
    if (runtimeTraders.length === 0) {
      agentRuntime.pause?.()
      agentSessionGuardState.auto_paused = false
      agentSessionGuardState.auto_paused_at_ms = null
    } else if (AGENT_SESSION_GUARD_ENABLED && RUNTIME_DATA_MODE === 'live_file') {
      const session = getCnAMarketSessionStatus(Date.now())
      let liveStatus = liveFileFrameProvider?.getStatus?.() || null
      if (liveFileFrameProvider?.refresh) {
        try {
          await liveFileFrameProvider.refresh(false)
          liveStatus = liveFileFrameProvider.getStatus()
        } catch {
          // If refresh fails, keep the existing status and avoid auto-resume.
        }
      }
      const liveOk = !AGENT_SESSION_GUARD_REQUIRE_FRESH_LIVE_DATA || (!!liveStatus && !liveStatus.stale && !liveStatus.last_error && (liveStatus.frame_count || 0) > 0)
      if (!session.is_open) {
        if (agentRuntime.getState?.().running) {
          agentRuntime.pause?.()
          agentSessionGuardState.auto_paused = true
          agentSessionGuardState.auto_paused_at_ms = Date.now()
          agentSessionGuardState.last_session = session
          agentSessionGuardState.last_live_status = liveStatus
        }
      } else if (!agentRuntime.getState?.().running && liveOk) {
        agentRuntime.resume?.()
        agentSessionGuardState.auto_paused = false
        agentSessionGuardState.auto_paused_at_ms = null
        agentSessionGuardState.last_session = session
        agentSessionGuardState.last_live_status = liveStatus
      }
    } else if (!agentRuntime.getState?.().running) {
      agentRuntime.resume?.()
    }
  }

  return {
    available_agents: availableAgents,
    registered_agents: registeredAgents,
    running_agent_ids: runtimeTraders.map((trader) => trader.trader_id),
  }
}

function resetReplayEngine() {
  if (replayEngineTimer) {
    clearInterval(replayEngineTimer)
    replayEngineTimer = null
  }
  replayEngine = null

  if (RUNTIME_DATA_MODE !== 'replay') {
    syncMarketDataService()
    return
  }

  if (!replayBatch?.frames?.length) {
    syncMarketDataService()
    return
  }

  replayEngine = createReplayEngine({
    replayBatch,
    initialSpeed: REPLAY_SPEED,
    initialRunning: true,
    warmupBars: REPLAY_WARMUP_BARS,
    loop: REPLAY_LOOP,
  })

  let lastTickMs = Date.now()
  replayEngineTimer = setInterval(() => {
    const now = Date.now()
    const elapsed = now - lastTickMs
    lastTickMs = now
    const advanced = replayEngine?.tick(elapsed) || []
    if (advanced.length) {
      scheduleAgentDecisionsForReplayBars(advanced.length).catch(() => {})
    }
  }, REPLAY_TICK_MS)

  syncMarketDataService()
}

async function factoryResetRuntime({ cursorIndex = 0 } = {}) {
  agentRuntime?.pause?.()
  replayEngine?.pause?.()
  replayEngine?.setCursor?.(cursorIndex)

  replayBarsSinceAgentDecision = 0
  queuedAgentDecisionSteps = 0
  agentDispatchInFlight = false

  const runtimeReset = agentRuntime?.reset?.() || null
  await memoryStore.resetAll()

  return {
    runtime: {
      ...(runtimeReset?.state || agentRuntime?.getState?.() || {}),
      metrics: runtimeReset?.metrics || agentRuntime?.getMetrics?.() || null,
    },
    replay: replayEngine?.getStatus?.() || null,
    memory: memoryStore.getAllSnapshots(),
  }
}

async function flushQueuedAgentDecisions() {
  if (!agentRuntime || agentDispatchInFlight) return

  agentDispatchInFlight = true
  try {
    while (queuedAgentDecisionSteps > 0) {
      if (killSwitchState.active) {
        queuedAgentDecisionSteps = 0
        break
      }
      queuedAgentDecisionSteps -= 1
      await agentRuntime.stepOnce()
    }
  } finally {
    agentDispatchInFlight = false
  }
}

async function scheduleAgentDecisionsForReplayBars(advancedBars, forceSingleStep = false) {
  if (!agentRuntime) return
  if (killSwitchState.active) return

  const bars = Math.max(0, Number(advancedBars) || 0)
  if (bars === 0 && !forceSingleStep) return

  const runtimeRunning = !!agentRuntime.getState?.().running
  if (!runtimeRunning && !forceSingleStep) return

  replayBarsSinceAgentDecision += bars
  let steps = 0

  while (replayBarsSinceAgentDecision >= agentDecisionEveryBars) {
    replayBarsSinceAgentDecision -= agentDecisionEveryBars
    steps += 1
  }

  if (forceSingleStep && steps === 0) {
    steps = 1
  }

  if (steps <= 0) return
  queuedAgentDecisionSteps += steps
  await flushQueuedAgentDecisions()
}

async function loadReplayBatch() {
  try {
    const content = await readFile(REPLAY_PATH, 'utf8')
    const parsed = JSON.parse(content)
    if (!parsed || !Array.isArray(parsed.frames)) return null
    replayBatch = parsed
    resetReplayEngine()
    return replayBatch
  } catch {
    replayBatch = null
    resetReplayEngine()
    return null
  }
}

async function loadDailyHistoryBatch() {
  try {
    const content = await readFile(DAILY_HISTORY_PATH, 'utf8')
    const parsed = JSON.parse(content)
    if (!parsed || !Array.isArray(parsed.frames)) return null
    dailyHistoryBatch = parsed
    syncMarketDataService()
    return dailyHistoryBatch
  } catch {
    syncMarketDataService()
    return null
  }
}

function aggregateManifestStockPool() {
  const seen = new Set()
  const output = []
  for (const agent of [...registeredAgents, ...availableAgents]) {
    const pool = normalizeStockPool(agent?.stock_pool)
    for (const symbol of pool) {
      if (seen.has(symbol)) continue
      seen.add(symbol)
      output.push(symbol)
    }
  }
  return output
}

function symbolList({ traderId = '' } = {}) {
  const wantedTraderId = String(traderId || '').trim()
  if (wantedTraderId) {
    const traderPool = normalizeStockPool(getTraderById(wantedTraderId)?.stock_pool)
    if (traderPool.length) {
      return symbolsToEntries(traderPool)
    }
  }

  const manifestPool = aggregateManifestStockPool()
  if (manifestPool.length) {
    return symbolsToEntries(manifestPool)
  }

  if (RUNTIME_DATA_MODE === 'live_file' && liveFileFrameProvider) {
    const symbols = liveFileFrameProvider.getSymbols('1m')
    if (symbols.length) {
      return symbolsToEntries(symbols)
    }
    if (STRICT_LIVE_MODE) {
      return []
    }
  }

  if (STRICT_LIVE_MODE) {
    return []
  }

  const sourceFrames = replayBatch?.frames?.length
    ? replayBatch.frames
    : (dailyHistoryBatch?.frames?.length ? dailyHistoryBatch.frames : null)

  if (!sourceFrames) {
    return [
      { symbol: '600519.SH', name: CN_STOCK_NAME_BY_SYMBOL['600519.SH'], category: 'stock' },
      { symbol: '601318.SH', name: CN_STOCK_NAME_BY_SYMBOL['601318.SH'], category: 'stock' },
      { symbol: '300750.SZ', name: CN_STOCK_NAME_BY_SYMBOL['300750.SZ'], category: 'stock' },
    ]
  }

  const set = new Set(sourceFrames.map((f) => f.instrument?.symbol).filter(Boolean))
  return symbolsToEntries(Array.from(set).sort())
}

function pickTraderSymbol(trader, cycleNumber = 1) {
  const traderPool = normalizeStockPool(trader?.stock_pool)
  const symbols = (traderPool.length
    ? traderPool
    : symbolList({ traderId: trader?.trader_id }).map((item) => item.symbol)
  )
  if (!symbols.length) {
    if (STRICT_LIVE_MODE) {
      throw new Error('no_live_symbol_pool')
    }
    return '600519.SH'
  }
  const idx = Math.abs(hashSymbol(trader?.trader_id || '') + cycleNumber) % symbols.length
  return symbols[idx]
}

async function evaluateTraderContext(trader, { cycleNumber }) {
  if (RUNTIME_DATA_MODE === 'live_file' && STRICT_LIVE_MODE && liveFileFrameProvider) {
    const liveStatus = liveFileFrameProvider.getStatus()
    if (liveStatus?.stale) {
      const error = new Error('live_file_stale')
      error.code = 'live_file_stale'
      throw error
    }
    if (liveStatus?.last_error) {
      const error = new Error('live_file_error')
      error.code = 'live_file_error'
      throw error
    }
  }

  const symbol = pickTraderSymbol(trader, cycleNumber)
  const [intradayBatch, dailyBatch] = await Promise.all([
    marketDataService.getFrames({
      symbol,
      interval: '1m',
      limit: 180,
    }),
    marketDataService.getFrames({
      symbol,
      interval: '1d',
      limit: 90,
    }),
  ])

  const account = getAccount(trader.trader_id)
  const positions = getPositions(trader.trader_id)
  const positionState = buildPositionState({ symbol, account, positions })
  const latestEventTs = intradayBatch.frames[intradayBatch.frames.length - 1]?.event_ts_ms
  const context = buildAgentMarketContext({
    symbol,
    asOfTsMs: Number.isFinite(latestEventTs) ? latestEventTs : Date.now(),
    intradayBatch,
    dailyBatch,
    positionState,
  })
  context.runtime_config = {
    commission_rate: AGENT_COMMISSION_RATE,
  }

  const memorySnapshot = memoryStore.getSnapshot(trader.trader_id)
  if (memorySnapshot) {
    context.memory_state = {
      replay: memorySnapshot.replay,
      stats: memorySnapshot.stats,
      holdings: memorySnapshot.holdings,
      recent_actions: memorySnapshot.recent_actions,
    }
  }

  if (llmDecider && !killSwitchState.active) {
    try {
      const llmDecision = await llmDecider({
        trader,
        cycleNumber,
        context,
      })
      if (llmDecision) {
        context.llm_decision = llmDecision
      }
    } catch {
      // Fall back to rule-based decision path when model call fails.
    }
  }

  return {
    context,
    cycleNumber,
  }
}

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'opentrade-mock-api', uptime_s: Math.round((Date.now() - BOOT_TS) / 1000) })
})

app.get('/api/config', (_req, res) => {
  res.json({ beta_mode: true, registration_enabled: false })
})

app.get('/api/agents/:id/assets/:fileName', (req, res) => {
  const agentId = String(req.params.id || '').trim()
  const fileName = String(req.params.fileName || '').trim()

  if (!/^[a-z][a-z0-9_]{1,63}$/.test(agentId)) {
    res.status(400).json({ success: false, error: 'invalid_agent_id' })
    return
  }

  if (!isSafeAssetFileName(fileName)) {
    res.status(400).json({ success: false, error: 'invalid_asset_file' })
    return
  }

  const assetPath = path.join(AGENTS_DIR, agentId, fileName)
  res.set('Cache-Control', 'public, max-age=86400')
  res.sendFile(assetPath, (error) => {
    if (!error) return
    if (!res.headersSent) {
      res.status(404).json({ success: false, error: 'agent_asset_not_found' })
    }
  })
})

app.get('/api/agents/available', async (_req, res) => {
  try {
    const state = await refreshAgentState()
    res.json(ok(state.available_agents))
  } catch (error) {
    res.status(agentErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'agents_available_failed' })
  }
})

app.get('/api/agents/registered', async (_req, res) => {
  try {
    const state = await refreshAgentState()
    res.json(ok(state.registered_agents))
  } catch (error) {
    res.status(agentErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'agents_registered_failed' })
  }
})

app.post('/api/agents/:id/register', async (req, res) => {
  try {
    const agentId = String(req.params.id || '').trim()
    const registered = await agentRegistryStore.registerAgent(agentId)
    await refreshAgentState()
    res.json(ok(registered))
  } catch (error) {
    res.status(agentErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'agent_register_failed' })
  }
})

app.post('/api/agents/:id/unregister', async (req, res) => {
  try {
    const agentId = String(req.params.id || '').trim()
    const removed = await agentRegistryStore.unregisterAgent(agentId)
    const state = await refreshAgentState()
    res.json(ok({
      ...removed,
      running_agent_ids: state.running_agent_ids,
    }))
  } catch (error) {
    res.status(agentErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'agent_unregister_failed' })
  }
})

app.post('/api/agents/:id/start', async (req, res) => {
  try {
    const agentId = String(req.params.id || '').trim()
    const started = await agentRegistryStore.startAgent(agentId)
    await refreshAgentState()
    res.json(ok(started))
  } catch (error) {
    res.status(agentErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'agent_start_failed' })
  }
})

app.post('/api/agents/:id/stop', async (req, res) => {
  try {
    const agentId = String(req.params.id || '').trim()
    const stopped = await agentRegistryStore.stopAgent(agentId)
    await refreshAgentState()
    res.json(ok(stopped))
  } catch (error) {
    res.status(agentErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'agent_stop_failed' })
  }
})

app.get('/api/traders', async (_req, res) => {
  try {
    await refreshAgentState()
    res.json(ok(getLobbyTraders()))
  } catch (error) {
    res.status(agentErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'traders_read_failed' })
  }
})

app.get('/api/competition', async (_req, res) => {
  try {
    await refreshAgentState()
    res.json(ok(getCompetitionData()))
  } catch (error) {
    res.status(agentErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'competition_read_failed' })
  }
})

app.get('/api/top-traders', async (_req, res) => {
  try {
    await refreshAgentState()
    const top = [...getCompetitionData().traders]
      .sort((a, b) => b.total_pnl_pct - a.total_pnl_pct)
      .slice(0, 3)
    res.json(ok(top))
  } catch (error) {
    res.status(agentErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'top_traders_read_failed' })
  }
})

app.post('/api/chat/session/bootstrap', (req, res) => {
  const userSessionId = createUserSessionId()
  const requestedNickname = sanitizeUserNickname(req.body?.user_nickname)
  const userNickname = requestedNickname || createDefaultUserNickname(userSessionId)

  chatSessionRegistry.set(userSessionId, {
    user_nickname: userNickname,
    updated_ts_ms: Date.now(),
  })

  res.json(ok({
    user_session_id: userSessionId,
    user_nickname: userNickname,
  }))
})

app.get('/api/chat/rooms/:roomId/public', async (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim()
    const limit = parseChatLimit(req.query.limit, 20)
    const beforeTsMs = parseBeforeTs(req.query.before_ts_ms)
    const messages = await chatService.getPublicMessages(roomId, { limit, beforeTsMs })
    res.json(ok({
      room_id: roomId,
      visibility: 'public',
      messages,
    }))
  } catch (error) {
    res.status(chatErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'chat_public_read_failed' })
  }
})

app.get('/api/chat/rooms/:roomId/private', async (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim()
    const userSessionId = String(req.query.user_session_id || '').trim()
    const limit = parseChatLimit(req.query.limit, 20)
    const beforeTsMs = parseBeforeTs(req.query.before_ts_ms)
    const messages = await chatService.getPrivateMessages(roomId, userSessionId, { limit, beforeTsMs })
    res.json(ok({
      room_id: roomId,
      user_session_id: userSessionId,
      visibility: 'private',
      messages,
    }))
  } catch (error) {
    res.status(chatErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'chat_private_read_failed' })
  }
})

app.post('/api/chat/rooms/:roomId/messages', async (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim()
    const userSessionId = String(req.body?.user_session_id || '').trim()
    const userNickname = resolveNicknameForSession(userSessionId, req.body?.user_nickname)
    const visibility = String(req.body?.visibility || '').trim()
    const messageType = String(req.body?.message_type || '').trim()
    const text = String(req.body?.text || '')

    const result = await chatService.postMessage({
      roomId,
      userSessionId,
      userNickname,
      visibility,
      messageType,
      text,
    })

    res.json(ok(result))
  } catch (error) {
    res.status(chatErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'chat_post_failed' })
  }
})

app.get('/api/status', (req, res) => {
  const traderId = String(req.query.trader_id || getTraderById('').trader_id)
  res.json(ok(getStatus(traderId)))
})

app.get('/api/account', (req, res) => {
  const traderId = String(req.query.trader_id || getTraderById('').trader_id)
  res.json(ok(getAccount(traderId)))
})

app.get('/api/positions', (req, res) => {
  const traderId = String(req.query.trader_id || getTraderById('').trader_id)
  res.json(ok(getPositions(traderId)))
})

app.get('/api/decisions/latest', (req, res) => {
  const traderId = String(req.query.trader_id || '')
  const limit = Number(req.query.limit || 5)
  const safeLimit = Number.isFinite(limit) ? limit : 5
  const runtimeDecisions = agentRuntime?.getLatestDecisions(traderId || undefined, safeLimit) || []

  if (!traderId) {
    res.json(ok(runtimeDecisions))
    return
  }

  Promise.resolve()
    .then(async () => {
      const logged = await decisionLogStore.listLatest({ traderId, limit: safeLimit })
      const items = []

      for (const row of runtimeDecisions) {
        if (row && typeof row === 'object') items.push(row)
      }
      for (const row of logged) {
        if (row && typeof row === 'object') items.push(row)
      }

      // Fallback: synthesize a minimal decision list from persisted recent_actions.
      if (items.length === 0) {
        const snapshot = memoryStore?.getSnapshot?.(traderId) || null
        const recent = Array.isArray(snapshot?.recent_actions) ? snapshot.recent_actions : []
        const todayKey = dayKeyInTimeZone(Date.now(), 'Asia/Shanghai')
        const filtered = recent.filter((action) => {
          const ts = Date.parse(String(action?.ts || ''))
          if (!Number.isFinite(ts)) return false
          return dayKeyInTimeZone(ts, 'Asia/Shanghai') === todayKey
        })

        const accountState = {
          total_balance: Number(snapshot?.stats?.latest_total_balance ?? 100000),
          available_balance: Number(snapshot?.stats?.latest_available_balance ?? 100000),
          total_unrealized_profit: Number(snapshot?.stats?.latest_unrealized_profit ?? 0),
          position_count: Array.isArray(snapshot?.holdings) ? snapshot.holdings.filter((h) => Number(h?.shares) > 0).length : 0,
          margin_used_pct: 0,
        }

        for (const act of filtered.slice(0, safeLimit)) {
          const action = String(act?.action || 'hold').toLowerCase()
          const symbol = act?.symbol ? String(act.symbol) : ''
          const tsIso = String(act?.ts || new Date().toISOString())
          const price = Number(act?.price || 0)
          items.push({
            timestamp: tsIso,
            cycle_number: Number(act?.cycle_number || 0),
            system_prompt: '',
            input_prompt: '',
            cot_trace: '',
            decision_json: JSON.stringify({ action, symbol, price }),
            account_state: accountState,
            positions: [],
            candidate_coins: [],
            decisions: [
              {
                action,
                symbol,
                price,
                order_id: 0,
                timestamp: tsIso,
                success: true,
              },
            ],
            execution_log: [],
            success: true,
          })
        }
      }

      // De-dupe by timestamp+cycle_number+decision_json
      const seen = new Set()
      const deduped = []
      for (const row of items) {
        const key = `${row?.timestamp || ''}|${row?.cycle_number || 0}|${row?.decision_json || ''}`
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push(row)
      }

      deduped.sort((a, b) => (Date.parse(b?.timestamp || '') || 0) - (Date.parse(a?.timestamp || '') || 0))
      res.json(ok(deduped.slice(0, safeLimit)))
    })
    .catch(() => {
      res.json(ok(runtimeDecisions))
    })
})

app.get('/api/agent/runtime/status', (_req, res) => {
  const state = agentRuntime?.getState?.() || {
    running: false,
    cycle_ms: derivedDecisionCycleMs(),
    in_flight: false,
    last_cycle_started_ms: null,
    last_cycle_completed_ms: null,
  }
  const metrics = agentRuntime?.getMetrics?.() || {
    totalCycles: 0,
    successfulCycles: 0,
    failedCycles: 0,
  }

  res.json(ok({
    ...state,
    cycle_ms: derivedDecisionCycleMs(),
    metrics,
    decision_every_bars: agentDecisionEveryBars,
    market_session_guard: getAgentSessionGuardPublicSnapshot(),
    kill_switch: killSwitchPublicState(),
    llm: {
      enabled: !!llmDecider,
      effective_enabled: !!llmDecider && !killSwitchState.active,
      model: llmDecider ? OPENAI_MODEL : null,
      token_saver: llmDecider ? AGENT_LLM_DEV_TOKEN_SAVER : null,
      max_output_tokens: llmDecider ? AGENT_LLM_MAX_OUTPUT_TOKENS : null,
    },
    traders: getRegisteredTraders().map((trader) => ({
      trader_id: trader.trader_id,
      call_count: agentRuntime?.getCallCount?.(trader.trader_id) || 0,
    })),
  }))
})

app.get('/api/agent/memory', (req, res) => {
  const traderId = String(req.query.trader_id || '')
  if (traderId) {
    const snapshot = memoryStore.getSnapshot(traderId)
    if (!snapshot) {
      res.status(404).json({ success: false, error: 'memory_not_found' })
      return
    }
    res.json(ok(snapshot))
    return
  }

  res.json(ok(memoryStore.getAllSnapshots()))
})

app.post('/api/agent/runtime/control', async (req, res) => {
  const action = String(req.body?.action || '').trim().toLowerCase()
  if (!agentRuntime) {
    res.status(503).json({ success: false, error: 'agent_runtime_unavailable' })
    return
  }

  if (killSwitchState.active && (action === 'resume' || action === 'step')) {
    res.status(423).json({ success: false, error: 'kill_switch_active' })
    return
  }

  if (action === 'pause') {
    agentRuntime.pause()
  } else if (action === 'resume') {
    agentRuntime.resume()
  } else if (action === 'step') {
    await agentRuntime.stepOnce()
  } else if (action === 'set_cycle_ms') {
    const cycleMs = Number(req.body?.cycle_ms)
    if (!Number.isFinite(cycleMs)) {
      res.status(400).json({ success: false, error: 'invalid_cycle_ms' })
      return
    }
    if (RUNTIME_DATA_MODE === 'live_file') {
      agentRuntime.setCycleMs(cycleMs)
    } else {
      const replaySpeed = replayEngine?.getStatus?.().speed || REPLAY_SPEED
      const bars = Math.max(1, Math.round((cycleMs * Math.max(0.1, replaySpeed)) / 60_000))
      agentDecisionEveryBars = bars
    }
  } else if (action === 'set_decision_every_bars') {
    const bars = Number(req.body?.decision_every_bars)
    if (!Number.isFinite(bars)) {
      res.status(400).json({ success: false, error: 'invalid_decision_every_bars' })
      return
    }
    agentDecisionEveryBars = Math.max(1, Math.min(Math.floor(bars), 240))
  } else {
    res.status(400).json({ success: false, error: 'invalid_action' })
    return
  }

  res.json(ok({
    action,
    state: {
      ...agentRuntime.getState(),
      cycle_ms: derivedDecisionCycleMs(),
    },
    metrics: agentRuntime.getMetrics(),
    decision_every_bars: agentDecisionEveryBars,
  }))
})

app.post('/api/agent/runtime/kill-switch', async (req, res) => {
  if (!requireControlAuthorization(req, res)) return

  const action = String(req.body?.action || '').trim().toLowerCase()
  const reason = String(req.body?.reason || '').trim()
  const actor = String(req.body?.actor || req.ip || 'api').trim() || 'api'

  if (action !== 'activate' && action !== 'deactivate') {
    res.status(400).json({ success: false, error: 'invalid_action' })
    return
  }

  await setKillSwitch({
    active: action === 'activate',
    reason,
    actor,
  })

  res.json(ok({
    action,
    kill_switch: killSwitchPublicState(),
    runtime: {
      ...(agentRuntime?.getState?.() || {}),
      cycle_ms: derivedDecisionCycleMs(),
      metrics: agentRuntime?.getMetrics?.() || null,
    },
    replay: replayEngine?.getStatus?.() || null,
  }))
})

app.get('/api/replay/runtime/status', async (_req, res) => {
  if (RUNTIME_DATA_MODE === 'live_file' && liveFileFrameProvider) {
    await liveFileFrameProvider.refresh(false)
  }

  const replayState = replayEngine?.getStatus?.() || {
    running: false,
    speed: REPLAY_SPEED,
    loop: REPLAY_LOOP,
    completed: false,
    warmup_bars: REPLAY_WARMUP_BARS,
    cursor_index: -1,
    timeline_length: 0,
    current_ts_ms: null,
  }

  const liveFileStatus = RUNTIME_DATA_MODE === 'live_file' && liveFileFrameProvider
    ? liveFileFrameProvider.getStatus()
    : null

  res.json(ok({
    ...replayState,
    data_mode: RUNTIME_DATA_MODE,
    live_file: liveFileStatus,
    symbols: symbolList().map((item) => item.symbol),
  }))
})

app.post('/api/replay/runtime/control', (req, res) => {
  const action = String(req.body?.action || '').trim().toLowerCase()
  if (!replayEngine) {
    res.status(503).json({ success: false, error: 'replay_unavailable' })
    return
  }

  if (action === 'pause') {
    replayEngine.pause()
  } else if (action === 'resume') {
    replayEngine.resume()
  } else if (action === 'step') {
    const bars = Number(req.body?.bars || 1)
    const advanced = replayEngine.step(Number.isFinite(bars) ? bars : 1)
    scheduleAgentDecisionsForReplayBars(advanced.length, true).catch(() => {})
  } else if (action === 'set_speed') {
    const speed = Number(req.body?.speed)
    if (!Number.isFinite(speed)) {
      res.status(400).json({ success: false, error: 'invalid_speed' })
      return
    }
    replayEngine.setSpeed(speed)
  } else if (action === 'set_cursor') {
    const cursor = Number(req.body?.cursor_index)
    if (!Number.isFinite(cursor)) {
      res.status(400).json({ success: false, error: 'invalid_cursor_index' })
      return
    }
    replayEngine.setCursor(cursor)
  } else if (action === 'set_loop') {
    const loop = req.body?.loop
    if (typeof loop !== 'boolean') {
      res.status(400).json({ success: false, error: 'invalid_loop' })
      return
    }
    replayEngine.setLoop(loop)
  } else {
    res.status(400).json({ success: false, error: 'invalid_action' })
    return
  }

  res.json(ok({
    action,
    state: replayEngine.getStatus(),
  }))
})

app.post('/api/dev/factory-reset', async (req, res) => {
  try {
    const useWarmup = String(req.body?.use_warmup ?? 'false').toLowerCase() === 'true'
    const warmupCursor = Math.max(0, REPLAY_WARMUP_BARS - 1)
    const requestedCursor = Number(req.body?.cursor_index)
    const cursorIndex = Number.isFinite(requestedCursor)
      ? Math.max(0, Math.floor(requestedCursor))
      : (useWarmup ? warmupCursor : 0)

    const state = await factoryResetRuntime({ cursorIndex })
    res.json(ok({
      action: 'factory_reset',
      cursor_index: cursorIndex,
      use_warmup: useWarmup,
      state,
    }))
  } catch (error) {
    res.status(500).json({ success: false, error: error?.message || 'factory_reset_failed' })
  }
})

app.get('/api/statistics', (_req, res) => {
  res.json(ok(getStatistics()))
})

app.get('/api/equity-history', (req, res) => {
  const traderId = String(req.query.trader_id || getTraderById('').trader_id)
  const hours = Number(req.query.hours || 0)
  res.json(ok(generateEquityHistory(traderId, Number.isFinite(hours) ? hours : 0)))
})

app.post('/api/equity-history-batch', (req, res) => {
  const ids = Array.isArray(req.body?.trader_ids)
    ? req.body.trader_ids
    : getLobbyTraders().map((t) => t.trader_id)
  const hours = Number(req.body?.hours || 0)
  const histories = Object.fromEntries(
    ids.map((id) => [id, generateEquityHistory(String(id), Number.isFinite(hours) ? hours : 0)])
  )
  res.json(ok({ histories }))
})

app.get('/api/positions/history', (req, res) => {
  const traderId = String(req.query.trader_id || getTraderById('').trader_id)
  const limit = Number(req.query.limit || 100)
  res.json(ok(getPositionHistory(traderId, Number.isFinite(limit) ? limit : 100)))
})

app.get('/api/symbols', (req, res) => {
  const traderId = String(req.query.trader_id || '').trim()
  // Historical compatibility: this endpoint is intentionally unwrapped.
  res.json({ symbols: symbolList({ traderId }) })
})

app.get('/api/agent/market-context', async (req, res) => {
  const symbol = String(req.query.symbol || '600519.SH')
  const intradayInterval = String(req.query.intraday_interval || '1m')
  const intradayLimit = Number(req.query.intraday_limit || 180)
  const dailyLimit = Number(req.query.daily_limit || 90)
  const source = String(req.query.source || '')
  const traderId = String(req.query.trader_id || getTraderById('').trader_id)

  try {
    const [intradayBatch, dailyBatch] = await Promise.all([
      marketDataService.getFrames({
        symbol,
        interval: intradayInterval,
        limit: Number.isFinite(intradayLimit) ? intradayLimit : 180,
        source,
      }),
      marketDataService.getFrames({
        symbol,
        interval: '1d',
        limit: Number.isFinite(dailyLimit) ? dailyLimit : 90,
        source,
      }),
    ])

    const account = getAccount(traderId)
    const positions = getPositions(traderId)
    const positionState = buildPositionState({ symbol, account, positions })
    const latestEventTs = intradayBatch.frames[intradayBatch.frames.length - 1]?.event_ts_ms
    const payload = buildAgentMarketContext({
      symbol,
      asOfTsMs: Number.isFinite(latestEventTs) ? latestEventTs : Date.now(),
      intradayBatch,
      dailyBatch,
      positionState,
    })

    const memorySnapshot = memoryStore.getSnapshot(traderId)
    if (memorySnapshot) {
      payload.memory_state = {
        replay: memorySnapshot.replay,
        stats: memorySnapshot.stats,
        holdings: memorySnapshot.holdings,
        recent_actions: memorySnapshot.recent_actions,
      }
    }

    res.json(ok(payload))
  } catch (error) {
    res.status(502).json({ success: false, error: error?.message || 'agent_context_error' })
  }
})

app.get('/api/market/frames', async (req, res) => {
  const symbol = String(req.query.symbol || '600519.SH')
  const interval = String(req.query.interval || '5m')
  const limit = Number(req.query.limit || 800)
  const source = String(req.query.source || '')

  try {
    const payload = await marketDataService.getFrames({
      symbol,
      interval,
      limit: Number.isFinite(limit) ? limit : 800,
      source,
    })

    res.json(ok(payload))
  } catch (error) {
    const code = String(error?.code || error?.message || '')
    const status = code === 'live_frames_unavailable' ? 503 : 502
    res.status(status).json({ success: false, error: error?.message || 'market_proxy_error' })
  }
})

app.get('/api/klines', async (req, res) => {
  const symbol = String(req.query.symbol || '600519.SH')
  const interval = String(req.query.interval || '5m')
  const limit = Number(req.query.limit || 800)
  const source = String(req.query.source || '')

  try {
    const payload = await marketDataService.getKlines({
        symbol,
        interval,
        limit: Number.isFinite(limit) ? limit : 800,
        source,
      })

    res.json(ok(payload))
  } catch (error) {
    const code = String(error?.code || error?.message || '')
    const status = code === 'live_frames_unavailable' ? 503 : 502
    res.status(status).json({ success: false, error: error?.message || 'market_proxy_error' })
  }
})

app.get('/api/market/stream', (req, res) => {
  const symbolsRaw = String(req.query.symbols || '600519.SH')
  const symbols = symbolsRaw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const interval = String(req.query.interval || '1m')
  const limit = Number(req.query.limit || 2)
  const source = String(req.query.source || '')

  const safeSymbols = symbols.length ? symbols : ['600519.SH']
  const lastKeyBySymbol = new Map()

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  res.write(`event: ready\n`)
  res.write(`data: ${JSON.stringify({ ok: true, symbols: safeSymbols, interval })}\n\n`)

  let running = true

  const emitFrames = async () => {
    if (!running) return

    const frameBatch = []

    for (const symbol of safeSymbols) {
      const batch = await marketDataService.getFrames({ symbol, interval, limit, source })
      const latest = batch.frames[batch.frames.length - 1]
      if (!latest) continue

      const key = `${symbol}|${interval}|${latest.window.start_ts_ms}`
      if (lastKeyBySymbol.get(symbol) === key) continue

      lastKeyBySymbol.set(symbol, key)
      frameBatch.push(latest)
    }

    if (!frameBatch.length) return

    const mode = frameBatch.some((frame) => frame.mode === 'real') ? 'real' : 'mock'
    const providerSet = new Set(frameBatch.map((frame) => frame.provider))
    const provider = providerSet.size === 1 ? frameBatch[0].provider : 'mixed'
    const payload = {
      schema_version: 'market.frames.v1',
      market: 'CN-A',
      mode,
      provider,
      frames: frameBatch,
    }

    res.write(`event: frames\n`)
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  emitFrames().catch(() => {
    if (running) {
      res.write(`event: error\n`)
      res.write(`data: ${JSON.stringify({ error: 'stream_emit_failed' })}\n\n`)
    }
  })

  const timer = setInterval(() => {
    emitFrames().catch(() => {
      if (running) {
        res.write(`event: error\n`)
        res.write(`data: ${JSON.stringify({ error: 'stream_emit_failed' })}\n\n`)
      }
    })
  }, MARKET_STREAM_POLL_MS)

  req.on('close', () => {
    running = false
    clearInterval(timer)
    res.end()
  })
})

app.get('/api/orders', (_req, res) => {
  res.json(ok([]))
})

app.get('/api/open-orders', (_req, res) => {
  res.json(ok([]))
})

app.get('/api/traders/:id/config', (req, res) => {
  const trader = getTraderById(req.params.id)
  res.json(ok({
    trader_id: trader.trader_id,
    trader_name: trader.trader_name,
    ai_model: trader.ai_model,
    exchange_id: trader.exchange_id,
    strategy_name: trader.strategy_name,
    trading_style: trader.trading_style,
    risk_profile: trader.risk_profile,
    personality: trader.personality,
    style_prompt_cn: trader.style_prompt_cn,
    is_running: trader.is_running,
    avatar_url: trader.avatar_url,
    avatar_hd_url: trader.avatar_hd_url,
    initial_balance: 100000,
    scan_interval_minutes: 1,
    show_in_competition: trader.show_in_competition !== false,
    is_cross_margin: false,
  }))
})

app.post('/api/traders/:id/close-position', (_req, res) => {
  res.json(ok({ message: 'Virtual position close queued in mock-api mode' }))
})

app.use('/api', (_req, res) => {
  const payload = fail('not_found', 404)
  res.status(404).json({ success: false, error: payload.error })
})

await loadKillSwitchState()
await loadReplayBatch()
await loadDailyHistoryBatch()
if (RESET_AGENT_MEMORY_ON_BOOT) {
  await memoryStore.resetAll()
} else {
  await memoryStore.hydrate()
}

agentRuntime = createInMemoryAgentRuntime({
  traders: [],
  evaluateTrader: evaluateTraderContext,
  cycleMs: AGENT_RUNTIME_CYCLE_MS,
  maxHistory: 120,
  autoTimer: RUNTIME_DATA_MODE === 'live_file',
  onDecision: async ({ trader, decision }) => {
    const fallbackAccount = getAccount(trader.trader_id)
    const account = {
      total_equity: Number(decision?.account_state?.total_balance ?? fallbackAccount.total_equity),
      available_balance: Number(decision?.account_state?.available_balance ?? fallbackAccount.available_balance),
      unrealized_profit: Number(decision?.account_state?.total_unrealized_profit ?? fallbackAccount.unrealized_profit),
    }
    const positions = Array.isArray(decision?.positions)
      ? decision.positions
      : getPositions(trader.trader_id)
    const replayStatus = replayEngine?.getStatus?.() || null
    decision.runtime_meta = {
      decision_every_bars: agentDecisionEveryBars,
      llm_model: llmDecider ? OPENAI_MODEL : null,
    }
    await memoryStore.recordSnapshot({
      trader,
      decision,
      account,
      positions,
      replayStatus,
    })

    try {
      await decisionLogStore.appendDecision({ traderId: trader.trader_id, decision })
    } catch {
      // keep runtime robust: failure to persist decisions must not break trading loop
    }
  },
})

agentRuntime.start()
await refreshAgentState()

if (killSwitchState.active) {
  replayEngine?.pause?.()
  agentRuntime?.pause?.()
  replayBarsSinceAgentDecision = 0
  queuedAgentDecisionSteps = 0
  agentDispatchInFlight = false
}

if (AGENT_SESSION_GUARD_ENABLED && RUNTIME_DATA_MODE === 'live_file') {
  enforceAgentSessionGuard({ reason: 'boot' }).catch(() => {})
  agentSessionGuardTimer = setInterval(() => {
    enforceAgentSessionGuard({ reason: 'interval' }).catch(() => {})
  }, AGENT_SESSION_GUARD_CHECK_MS)
}

function handleShutdown() {
  agentRuntime?.stop()
  if (agentSessionGuardTimer) {
    clearInterval(agentSessionGuardTimer)
    agentSessionGuardTimer = null
  }
  if (replayEngineTimer) {
    clearInterval(replayEngineTimer)
    replayEngineTimer = null
  }
}

process.on('SIGINT', handleShutdown)
process.on('SIGTERM', handleShutdown)

app.listen(PORT, () => {
  const replayInfo = replayBatch?.frames?.length
    ? `replay loaded (${replayBatch.frames.length} frames)`
    : 'no replay file loaded'
  const dailyHistoryInfo = dailyHistoryBatch?.frames?.length
    ? `daily history loaded (${dailyHistoryBatch.frames.length} frames, lookback=${MARKET_DAILY_HISTORY_DAYS}d)`
    : `no daily history found at ${DAILY_HISTORY_PATH}`
  const providerInfo = MARKET_PROVIDER === 'real'
    ? `provider=real upstream=${MARKET_UPSTREAM_URL || 'not-configured'}`
    : 'provider=mock'
  const strictLiveInfo = `strict_live_mode=${STRICT_LIVE_MODE}`
  const runtimeInfo = RUNTIME_DATA_MODE === 'live_file'
    ? `agent_runtime mode=timer cycle_ms=${AGENT_RUNTIME_CYCLE_MS}`
    : `agent_runtime mode=event-driven decision_every_bars=${agentDecisionEveryBars}`
  const controlInfo = `control_api_token=${CONTROL_API_TOKEN ? 'configured' : 'not-configured'}`
  const killSwitchInfo = `kill_switch=${killSwitchState.active ? 'ACTIVE' : 'inactive'}`
  const resetInfo = `memory_reset_on_boot=${RESET_AGENT_MEMORY_ON_BOOT}`
  const llmInfo = llmDecider
    ? `llm=openai model=${OPENAI_MODEL} timeout_ms=${AGENT_LLM_TIMEOUT_MS} token_saver=${AGENT_LLM_DEV_TOKEN_SAVER} max_output_tokens=${AGENT_LLM_MAX_OUTPUT_TOKENS}`
    : 'llm=disabled (set OPENAI_API_KEY to enable gpt-4o-mini)'
  const replayRuntimeInfo = RUNTIME_DATA_MODE === 'live_file'
    ? `data_mode=live_file live_frames_path=${LIVE_FRAMES_PATH} refresh_ms=${LIVE_FILE_REFRESH_MS} stale_ms=${LIVE_FILE_STALE_MS}`
    : (replayEngine?.getStatus?.()
      ? `replay_runtime speed=${replayEngine.getStatus().speed}x tick_ms=${REPLAY_TICK_MS}`
      : 'replay_runtime unavailable')
  const registryInfo = `agent_registry path=${AGENT_REGISTRY_PATH}`
  const agentInfo = `agents_dir=${AGENTS_DIR} available=${availableAgents.length} registered=${registeredAgents.length}`
  console.log(`[mock-api] listening on http://localhost:${PORT}`)
  console.log(`[mock-api] ${replayInfo}`)
  console.log(`[mock-api] ${dailyHistoryInfo}`)
  console.log(`[mock-api] ${providerInfo}`)
  console.log(`[mock-api] ${strictLiveInfo}`)
  console.log(`[mock-api] ${runtimeInfo}`)
  console.log(`[mock-api] ${controlInfo}`)
  console.log(`[mock-api] ${killSwitchInfo}`)
  console.log(`[mock-api] ${resetInfo}`)
  console.log(`[mock-api] ${llmInfo}`)
  console.log(`[mock-api] ${replayRuntimeInfo}`)
  console.log(`[mock-api] ${registryInfo}`)
  console.log(`[mock-api] ${agentInfo}`)
})
