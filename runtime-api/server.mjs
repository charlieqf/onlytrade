import express from 'express'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { accessSync, constants as fsConstants, existsSync, readFileSync } from 'node:fs'
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
import {
  getMarketSpecForExchange,
  getMarketSessionStatusForExchange,
  inferMarketFromSymbol,
  isCnStockSymbol,
  isUsTicker,
} from './src/marketSpec.mjs'
import { createDecisionLogStore, dayKeyInTimeZone } from './src/decisionLogStore.mjs'
import { createDecisionAuditStore } from './src/decisionAuditStore.mjs'
import { createChatFileStore } from './src/chat/chatFileStore.mjs'
import { createChatService } from './src/chat/chatService.mjs'
import { createOpenAIChatResponder } from './src/chat/chatLlmResponder.mjs'
import { buildNarrationAgentMessage, buildProactiveAgentMessage } from './src/chat/chatAgentResponder.mjs'
import { normalizeDigestHeadlines, resolveProactiveCadence, selectNewsBurstSignal } from './src/chat/newsBurst.mjs'
import { createLiveJsonFileProvider } from './src/liveJsonFileProvider.mjs'
import { evaluateDataReadiness } from './src/dataReadiness.mjs'
import { readJsonlRecordsStreaming } from './src/jsonlReader.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const DECISION_AUDIT_BASE_DIR = path.resolve(
  ROOT_DIR,
  process.env.DECISION_AUDIT_BASE_DIR || path.join('data', 'audit', 'decision_audit')
)

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
const LIVE_PREFLIGHT_EXPECTED_REGISTRY_COUNT = Math.max(0, Number(process.env.LIVE_PREFLIGHT_EXPECTED_REGISTRY_COUNT || 0))
const AGENT_SESSION_GUARD_ENABLED = String(
  process.env.AGENT_SESSION_GUARD_ENABLED || (RUNTIME_DATA_MODE === 'live_file' ? 'true' : 'false')
).toLowerCase() !== 'false'
const AGENT_SESSION_GUARD_AUTO_RESUME = String(process.env.AGENT_SESSION_GUARD_AUTO_RESUME || 'true').toLowerCase() !== 'false'
const AGENT_SESSION_GUARD_CHECK_MS = Math.max(5_000, Number(process.env.AGENT_SESSION_GUARD_CHECK_MS || 30_000))
const AGENT_SESSION_GUARD_REQUIRE_FRESH_LIVE_DATA = String(process.env.AGENT_SESSION_GUARD_REQUIRE_FRESH_LIVE_DATA || 'true').toLowerCase() !== 'false'
const ROOM_EVENTS_KEEPALIVE_MS = Math.max(5_000, Number(process.env.ROOM_EVENTS_KEEPALIVE_MS || 15_000))
const ROOM_EVENTS_STREAM_PACKET_INTERVAL_MS = Math.max(
  2_000,
  Number(process.env.ROOM_EVENTS_STREAM_PACKET_INTERVAL_MS || 15_000)
)
const ROOM_EVENTS_BUFFER_SIZE = Math.max(10, Math.min(2000, Number(process.env.ROOM_EVENTS_BUFFER_SIZE || 200)))
const ROOM_EVENTS_BUFFER_TTL_MS = Math.max(2_000, Number(process.env.ROOM_EVENTS_BUFFER_TTL_MS || 60_000))
const ROOM_EVENTS_TEST_MODE = String(process.env.ROOM_EVENTS_TEST_MODE || 'false').toLowerCase() === 'true'
const ROOM_EVENTS_CLEANUP_IN_TEST = ROOM_EVENTS_TEST_MODE
  ? String(process.env.ROOM_EVENTS_CLEANUP_IN_TEST || 'false').toLowerCase() === 'true'
  : false
const ROOM_EVENTS_PACKET_BUILD_DELAY_MS = ROOM_EVENTS_TEST_MODE
  ? Math.max(0, Math.min(5000, Number(process.env.ROOM_EVENTS_PACKET_BUILD_DELAY_MS || 0) || 0))
  : 0
const ROOM_EVENTS_COLLECT_STATS = ROOM_EVENTS_TEST_MODE
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const AGENT_OPENAI_MODEL = process.env.AGENT_OPENAI_MODEL || OPENAI_MODEL
const CHAT_OPENAI_MODEL = process.env.CHAT_OPENAI_MODEL || OPENAI_MODEL
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
const AGENT_LLM_TIMEOUT_MS = Math.max(1000, Number(process.env.AGENT_LLM_TIMEOUT_MS || 7000))
const AGENT_LLM_ENABLED = String(process.env.AGENT_LLM_ENABLED || 'true').toLowerCase() !== 'false'
const AGENT_LLM_DEV_TOKEN_SAVER = String(process.env.AGENT_LLM_DEV_TOKEN_SAVER || 'true').toLowerCase() !== 'false'
const AGENT_LLM_MAX_OUTPUT_TOKENS = Math.max(80, Number(process.env.AGENT_LLM_MAX_OUTPUT_TOKENS || 180))
const AGENT_COMMISSION_RATE = Math.max(0, Number(process.env.AGENT_COMMISSION_RATE || 0.0003))
const AGENT_PORTFOLIO_MAX_POSITION_COUNT = Math.max(1, Number(process.env.AGENT_PORTFOLIO_MAX_POSITION_COUNT || 4))
const AGENT_PORTFOLIO_MAX_SYMBOL_CONCENTRATION_PCT = Math.max(
  0.1,
  Math.min(1, Number(process.env.AGENT_PORTFOLIO_MAX_SYMBOL_CONCENTRATION_PCT || 0.45))
)
const AGENT_PORTFOLIO_MIN_CASH_RESERVE_PCT = Math.max(
  0,
  Math.min(0.9, Number(process.env.AGENT_PORTFOLIO_MIN_CASH_RESERVE_PCT || 0.08))
)
const AGENT_PORTFOLIO_TURNOVER_THROTTLE_PCT = Math.max(
  0.01,
  Math.min(1, Number(process.env.AGENT_PORTFOLIO_TURNOVER_THROTTLE_PCT || 0.35))
)
const AGENT_CANDIDATE_SYMBOL_LIMIT = Math.max(1, Math.min(20, Number(process.env.AGENT_CANDIDATE_SYMBOL_LIMIT || 12)))
const AGENT_STRICT_SYMBOL_LOOP = String(
  process.env.AGENT_STRICT_SYMBOL_LOOP || 'true'
).toLowerCase() !== 'false'
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
const CHAT_AGENT_MAX_CHARS = Math.max(24, Math.min(800, Math.floor(Number(process.env.CHAT_AGENT_MAX_CHARS || 120))))
const CHAT_AGENT_MAX_SENTENCES = Math.max(1, Math.min(4, Math.floor(Number(process.env.CHAT_AGENT_MAX_SENTENCES || 2))))
const CHAT_DECISION_NARRATION_ENABLED = String(process.env.CHAT_DECISION_NARRATION_ENABLED || 'true').toLowerCase() !== 'false'
const CHAT_DECISION_NARRATION_USE_LLM = String(process.env.CHAT_DECISION_NARRATION_USE_LLM || 'false').toLowerCase() === 'true'
const CHAT_DECISION_NARRATION_MIN_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.CHAT_DECISION_NARRATION_MIN_INTERVAL_MS || 60_000)
)
const CHAT_DECISION_NARRATION_HOLD_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.CHAT_DECISION_NARRATION_HOLD_INTERVAL_MS || 25_000)
)
const CHAT_DECISION_NARRATION_CONSERVATIVE_HOLD_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.CHAT_DECISION_NARRATION_CONSERVATIVE_HOLD_INTERVAL_MS || 20_000)
)
const CHAT_LLM_ENABLED = String(process.env.CHAT_LLM_ENABLED || String(AGENT_LLM_ENABLED)).toLowerCase() !== 'false'
const CHAT_LLM_TIMEOUT_MS = Math.max(1000, Number(process.env.CHAT_LLM_TIMEOUT_MS || AGENT_LLM_TIMEOUT_MS))
const CHAT_LLM_MAX_OUTPUT_TOKENS = Math.max(80, Number(process.env.CHAT_LLM_MAX_OUTPUT_TOKENS || 140))
const CHAT_PROACTIVE_VIEWER_TICK_ENABLED = String(
  process.env.CHAT_PROACTIVE_VIEWER_TICK_ENABLED || 'true'
).toLowerCase() !== 'false'
const CHAT_PROACTIVE_VIEWER_TICK_MS = Math.max(1000, Number(process.env.CHAT_PROACTIVE_VIEWER_TICK_MS || 2000))
const CHAT_PROACTIVE_VIEWER_TICK_ROOMS_PER_INTERVAL = Math.max(
  1,
  Math.min(10, Number(process.env.CHAT_PROACTIVE_VIEWER_TICK_ROOMS_PER_INTERVAL || 2))
)
const CHAT_PROACTIVE_VIEWER_TICK_MIN_ROOM_INTERVAL_MS = Math.max(
  2000,
  Number(process.env.CHAT_PROACTIVE_VIEWER_TICK_MIN_ROOM_INTERVAL_MS || 5000)
)
const CHAT_PROACTIVE_ACTIVITY_WINDOW_MS = Math.max(
  10_000,
  Number(process.env.CHAT_PROACTIVE_ACTIVITY_WINDOW_MS || 120_000)
)
const CHAT_PROACTIVE_LLM_MAX_CONCURRENCY = Math.max(
  0,
  Math.min(10, Number(process.env.CHAT_PROACTIVE_LLM_MAX_CONCURRENCY || 2))
)
const CHAT_PROACTIVE_NEWS_BURST_ENABLED = String(
  process.env.CHAT_PROACTIVE_NEWS_BURST_ENABLED || 'true'
).toLowerCase() !== 'false'
const CHAT_PROACTIVE_NEWS_BURST_INTERVAL_MS = Math.max(
  3_000,
  Number(process.env.CHAT_PROACTIVE_NEWS_BURST_INTERVAL_MS || 9_000)
)
const CHAT_PROACTIVE_NEWS_BURST_DURATION_MS = Math.max(
  0,
  Number(process.env.CHAT_PROACTIVE_NEWS_BURST_DURATION_MS || 120_000)
)
const CHAT_PROACTIVE_NEWS_BURST_COOLDOWN_MS = Math.max(
  0,
  Number(process.env.CHAT_PROACTIVE_NEWS_BURST_COOLDOWN_MS || 480_000)
)
const CHAT_PROACTIVE_NEWS_BURST_FRESH_MS = Math.max(
  10_000,
  Number(process.env.CHAT_PROACTIVE_NEWS_BURST_FRESH_MS || 20 * 60_000)
)
const CHAT_PROACTIVE_NEWS_BURST_MIN_PRIORITY = Math.max(
  1,
  Math.min(5, Number(process.env.CHAT_PROACTIVE_NEWS_BURST_MIN_PRIORITY || 3))
)
const CHAT_TTS_ENABLED = String(process.env.CHAT_TTS_ENABLED || 'false').toLowerCase() === 'true'
const CHAT_TTS_PROVIDER_DEFAULT = String(process.env.CHAT_TTS_PROVIDER_DEFAULT || 'openai').trim().toLowerCase() === 'selfhosted'
  ? 'selfhosted'
  : 'openai'
const CHAT_TTS_MODEL = String(process.env.CHAT_TTS_MODEL || 'tts-1-hd').trim() || 'tts-1-hd'
const CHAT_TTS_RESPONSE_FORMAT = String(process.env.CHAT_TTS_RESPONSE_FORMAT || 'mp3').trim().toLowerCase()
const CHAT_TTS_MAX_CHARS = Math.max(48, Math.min(600, Math.floor(Number(process.env.CHAT_TTS_MAX_CHARS || 220))))
const CHAT_TTS_SPEED = (() => {
  const parsed = Number(process.env.CHAT_TTS_SPEED || 1)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(0.25, Math.min(parsed, 4))
})()
const CHAT_TTS_TONE_SPEED_CALM = (() => {
  const parsed = Number(process.env.CHAT_TTS_TONE_SPEED_CALM || 0.94)
  if (!Number.isFinite(parsed)) return 0.94
  return Math.max(0.25, Math.min(parsed, 4))
})()
const CHAT_TTS_TONE_SPEED_FOCUSED = (() => {
  const parsed = Number(process.env.CHAT_TTS_TONE_SPEED_FOCUSED || CHAT_TTS_SPEED || 1)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(0.25, Math.min(parsed, 4))
})()
const CHAT_TTS_TONE_SPEED_ENERGETIC = (() => {
  const parsed = Number(process.env.CHAT_TTS_TONE_SPEED_ENERGETIC || 1.08)
  if (!Number.isFinite(parsed)) return 1.08
  return Math.max(0.25, Math.min(parsed, 4))
})()
const CHAT_TTS_TONE_SPEED_CAUTIOUS = (() => {
  const parsed = Number(process.env.CHAT_TTS_TONE_SPEED_CAUTIOUS || 0.9)
  if (!Number.isFinite(parsed)) return 0.9
  return Math.max(0.25, Math.min(parsed, 4))
})()
const CHAT_TTS_VOICE_FEMALE_1 = String(process.env.CHAT_TTS_VOICE_FEMALE_1 || 'nova').trim() || 'nova'
const CHAT_TTS_VOICE_FEMALE_2 = String(process.env.CHAT_TTS_VOICE_FEMALE_2 || 'shimmer').trim() || 'shimmer'
const CHAT_TTS_VOICE_MALE_1 = String(process.env.CHAT_TTS_VOICE_MALE_1 || 'onyx').trim() || 'onyx'
const CHAT_TTS_VOICE_MALE_2 = String(process.env.CHAT_TTS_VOICE_MALE_2 || 'echo').trim() || 'echo'
const CHAT_TTS_SELFHOSTED_URL = String(process.env.CHAT_TTS_SELFHOSTED_URL || 'http://101.227.82.130:13002/tts').trim()
const CHAT_TTS_SELFHOSTED_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.CHAT_TTS_SELFHOSTED_TIMEOUT_MS || 8000)
)
const CHAT_TTS_SELFHOSTED_MEDIA_TYPE = (() => {
  const mediaType = String(process.env.CHAT_TTS_SELFHOSTED_MEDIA_TYPE || 'wav').trim().toLowerCase()
  if (mediaType === 'raw' || mediaType === 'mp3' || mediaType === 'wav') {
    return mediaType
  }
  return 'wav'
})()
const CHAT_TTS_SELFHOSTED_VOICE_DEFAULT = String(process.env.CHAT_TTS_SELFHOSTED_VOICE_DEFAULT || 'xuanyijiangjie').trim() || 'xuanyijiangjie'

const MARKET_OVERVIEW_PATH_CN = path.resolve(
  ROOT_DIR,
  process.env.MARKET_OVERVIEW_PATH_CN || path.join('data', 'live', 'onlytrade', 'market_overview.cn-a.json')
)
const MARKET_OVERVIEW_PATH_US = path.resolve(
  ROOT_DIR,
  process.env.MARKET_OVERVIEW_PATH_US || path.join('data', 'live', 'onlytrade', 'market_overview.us.json')
)
const MARKET_OVERVIEW_REFRESH_MS = Math.max(500, Number(process.env.MARKET_OVERVIEW_REFRESH_MS || 15000))
const MARKET_OVERVIEW_STALE_MS = Math.max(10_000, Number(process.env.MARKET_OVERVIEW_STALE_MS || 180_000))

const NEWS_DIGEST_PATH_CN = path.resolve(
  ROOT_DIR,
  process.env.NEWS_DIGEST_PATH_CN || path.join('data', 'live', 'onlytrade', 'news_digest.cn-a.json')
)
const NEWS_DIGEST_PATH_US = path.resolve(
  ROOT_DIR,
  process.env.NEWS_DIGEST_PATH_US || path.join('data', 'live', 'onlytrade', 'news_digest.us.json')
)
const NEWS_DIGEST_REFRESH_MS = Math.max(2_000, Number(process.env.NEWS_DIGEST_REFRESH_MS || 60_000))
const NEWS_DIGEST_STALE_MS = Math.max(60_000, Number(process.env.NEWS_DIGEST_STALE_MS || 12 * 60 * 60 * 1000))

const MARKET_BREADTH_PATH_CN = path.resolve(
  ROOT_DIR,
  process.env.MARKET_BREADTH_PATH_CN || path.join('data', 'live', 'onlytrade', 'market_breadth.cn-a.json')
)
const MARKET_BREADTH_PATH_US = path.resolve(
  ROOT_DIR,
  process.env.MARKET_BREADTH_PATH_US || path.join('data', 'live', 'onlytrade', 'market_breadth.us.json')
)
const MARKET_BREADTH_REFRESH_MS = Math.max(2_000, Number(process.env.MARKET_BREADTH_REFRESH_MS || 15_000))
const MARKET_BREADTH_STALE_MS = Math.max(30_000, Number(process.env.MARKET_BREADTH_STALE_MS || 180_000))

const DATA_READINESS_MIN_INTRADAY_FRAMES = Math.max(10, Number(process.env.DATA_READINESS_MIN_INTRADAY_FRAMES || 21))
const DATA_READINESS_MIN_DAILY_FRAMES = Math.max(20, Number(process.env.DATA_READINESS_MIN_DAILY_FRAMES || 61))
const DATA_READINESS_FRESH_WARN_MS = Math.max(10_000, Number(process.env.DATA_READINESS_FRESH_WARN_MS || 150_000))
const DATA_READINESS_FRESH_ERROR_MS = Math.max(20_000, Number(process.env.DATA_READINESS_FRESH_ERROR_MS || 330_000))
const DATA_READINESS_OPENING_PHASE_ENABLED = String(process.env.DATA_READINESS_OPENING_PHASE_ENABLED || 'true').trim().toLowerCase() !== 'false'
const DATA_READINESS_OPENING_MIN_INTRADAY_FRAMES = Math.max(1, Number(process.env.DATA_READINESS_OPENING_MIN_INTRADAY_FRAMES || 2))
const OPENING_PHASE_MAX_LOTS = Math.max(1, Math.min(3, Number(process.env.OPENING_PHASE_MAX_LOTS || 1)))
const OPENING_PHASE_MAX_CONFIDENCE = Math.max(0.51, Math.min(0.95, Number(process.env.OPENING_PHASE_MAX_CONFIDENCE || 0.72)))

const REPLAY_PATH = path.join(
  ROOT_DIR,
  'onlytrade-web',
  'public',
  'replay',
  'cn-a',
  'latest',
  'frames.1m.json'
)
const REPLAY_BREADTH_PATH = path.resolve(
  ROOT_DIR,
  process.env.REPLAY_BREADTH_PATH || path.join(path.dirname(REPLAY_PATH), 'market_breadth.1m.json')
)

const LIVE_FRAMES_PATH_CN = path.resolve(
  ROOT_DIR,
  process.env.LIVE_FRAMES_PATH_CN
    || process.env.LIVE_FRAMES_PATH
    || path.join('data', 'live', 'onlytrade', 'frames.1m.json')
)

const LIVE_FRAMES_PATH_US = path.resolve(
  ROOT_DIR,
  process.env.LIVE_FRAMES_PATH_US || path.join('data', 'live', 'us', 'frames.us.json')
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
const CHAT_TTS_PROFILE_PATH = path.resolve(
  __dirname,
  process.env.CHAT_TTS_PROFILE_PATH || path.join('data', 'chat', 'tts_profiles.json')
)

const AGENTS_DIR = path.resolve(
  ROOT_DIR,
  process.env.AGENTS_DIR || 'agents'
)

const AGENT_REGISTRY_PATH = path.resolve(
  ROOT_DIR,
  process.env.AGENT_REGISTRY_PATH || path.join('data', 'agents', 'registry.json')
)

const BETS_LEDGER_PATH = path.resolve(
  ROOT_DIR,
  process.env.BETS_LEDGER_PATH || path.join('data', 'bets', 'ledger.json')
)
const BETS_HOUSE_EDGE = Math.max(0, Math.min(0.3, Number(process.env.BETS_HOUSE_EDGE || 0.08)))

if (STRICT_LIVE_MODE && RUNTIME_DATA_MODE !== 'live_file') {
  throw new Error('strict_live_mode_requires_runtime_data_mode_live_file')
}

if (STRICT_LIVE_MODE && MARKET_PROVIDER !== 'real') {
  throw new Error('strict_live_mode_requires_market_provider_real')
}

function assertReadableLiveFilePath(filePath, label) {
  const target = String(filePath || '').trim()
  if (!target) {
    throw new Error(`${label}_missing`)
  }
  try {
    accessSync(target, fsConstants.R_OK)
  } catch {
    throw new Error(`${label}_unreadable:${target}`)
  }
}

function validateLiveModeBootConfig() {
  if (RUNTIME_DATA_MODE !== 'live_file') return
  assertReadableLiveFilePath(LIVE_FRAMES_PATH_CN, 'live_frames_path_cn')

  const usPathExplicitlyConfigured = String(process.env.LIVE_FRAMES_PATH_US || '').trim()
  if (usPathExplicitlyConfigured) {
    assertReadableLiveFilePath(LIVE_FRAMES_PATH_US, 'live_frames_path_us')
  }
}

validateLiveModeBootConfig()

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
  '002050.SZ': '三花智控',
  '002131.SZ': '利欧股份',
  '002195.SZ': '岩山科技',
  '002342.SZ': '巨力索具',
  '300058.SZ': '蓝色光标',
  '300059.SZ': '东方财富',
  '600519.SH': '贵州茅台',
  '600089.SH': '特变电工',
  '600986.SH': '浙文互联',
  '601899.SH': '紫金矿业',
  '601318.SH': '中国平安',
  '600036.SH': '招商银行',
  '300750.SZ': '宁德时代',
  '000858.SZ': '五粮液',
  '000001.SZ': '平安银行',
  '688981.SH': '中芯国际',
}

const US_STOCK_NAME_BY_SYMBOL = {
  AAPL: 'Apple',
  MSFT: 'Microsoft',
  AMZN: 'Amazon',
  GOOGL: 'Alphabet (Google)',
  META: 'Meta',
  NVDA: 'NVIDIA',
  TSLA: 'Tesla',
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

function effectiveSessionNowMs({ fallbackNowMs = Date.now(), contextAsOfTsMs = null } = {}) {
  const fallback = Number.isFinite(Number(fallbackNowMs)) ? Number(fallbackNowMs) : Date.now()
  if (RUNTIME_DATA_MODE !== 'replay') return fallback

  const contextTs = Number(contextAsOfTsMs)
  if (Number.isFinite(contextTs) && contextTs > 0) return contextTs

  const replayTs = Number(replayEngine?.getStatus?.()?.current_ts_ms)
  if (Number.isFinite(replayTs) && replayTs > 0) return replayTs

  return fallback
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
  // Cache-bust assets across deploys/restarts so avatar updates show up immediately.
  return `/api/agents/${encodeURIComponent(safeAgentId)}/assets/${encodeURIComponent(safeFileName)}?v=${BOOT_TS}`
}

function normalizeStockPool(value, exchangeId = '') {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const output = []

  const exchange = String(exchangeId || '').trim().toLowerCase()

  for (const item of value) {
    const symbol = String(item || '').trim().toUpperCase()
    if (!symbol) continue
    const isCn = isCnStockSymbol(symbol)
    const isUs = isUsTicker(symbol)
    if (exchange.includes('sim-cn') && !isCn) continue
    if (exchange.includes('sim-us') && !isUs) continue
    if (!exchange && !(isCn || isUs)) continue
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
    name: (isCnStockSymbol(symbol)
      ? (CN_STOCK_NAME_BY_SYMBOL[symbol] || symbol)
      : (US_STOCK_NAME_BY_SYMBOL[String(symbol).toUpperCase()] || symbol)),
    category: 'stock',
  }))
}

function resolveStockDisplay(symbolRaw, exchangeId = '') {
  const symbol = String(symbolRaw || '').trim().toUpperCase()
  if (!symbol) return { symbol: '', name: '', display: '' }
  const exchange = String(exchangeId || '').trim().toLowerCase()
  const maybeCn = exchange.includes('sim-cn') || isCnStockSymbol(symbol)
  const maybeUs = exchange.includes('sim-us') || isUsTicker(symbol)
  const name = maybeCn
    ? (CN_STOCK_NAME_BY_SYMBOL[symbol] || '')
    : (maybeUs ? (US_STOCK_NAME_BY_SYMBOL[symbol] || '') : '')
  return {
    symbol,
    name,
    display: name ? `${name}(${symbol})` : symbol,
  }
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
  const stockPool = normalizeStockPool(agent?.stock_pool, agent?.exchange_id)

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

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function marketCloseMinute(market) {
  return market === 'US' ? (16 * 60) : (15 * 60)
}

function marketOpenMinute(market) {
  return 9 * 60 + 30
}

function bettingDayStateId(market, dayKey) {
  return `${String(market || 'CN-A')}::${String(dayKey || '').trim()}`
}

function safeStakeAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 10
  return clampNumber(Math.round(n), 1, 100000)
}

function computeDailyReturnPctForTrader(traderId) {
  const account = getAccount(traderId)
  const initial = Math.max(1, Number(account?.initial_balance || 100000))
  const dailyPnl = Number(account?.daily_pnl || 0)
  return Number(((dailyPnl / initial) * 100).toFixed(4))
}

function normalizeBetsLedgerShape(value) {
  const raw = value && typeof value === 'object' ? value : {}
  const days = raw.days && typeof raw.days === 'object' ? raw.days : {}
  const creditsBySessionRaw = raw.credits_by_session && typeof raw.credits_by_session === 'object'
    ? raw.credits_by_session
    : {}
  const creditsBySession = {}

  for (const [sessionId, row] of Object.entries(creditsBySessionRaw)) {
    const safeSessionId = String(sessionId || '').trim()
    if (!safeSessionId) continue
    const record = row && typeof row === 'object' ? row : {}
    const safeNickname = sanitizeUserNickname(record.user_nickname)
      || createDefaultUserNickname(safeSessionId)
    const updatedTs = Number(record.updated_ts_ms)
    const lastAwardTs = Number(record.last_award_ts_ms)
    creditsBySession[safeSessionId] = {
      user_session_id: safeSessionId,
      user_nickname: safeNickname,
      credit_points: Math.max(0, Math.floor(Number(record.credit_points || 0))),
      settled_bets: Math.max(0, Math.floor(Number(record.settled_bets || 0))),
      win_count: Math.max(0, Math.floor(Number(record.win_count || 0))),
      last_award_ts_ms: Number.isFinite(lastAwardTs) ? lastAwardTs : null,
      updated_ts_ms: Number.isFinite(updatedTs) ? updatedTs : Date.now(),
    }
  }

  return {
    schema_version: 'bets.ledger.v2',
    days,
    credits_by_session: creditsBySession,
  }
}

function ensureBetDayState({ market, dayKey }) {
  const stateId = bettingDayStateId(market, dayKey)
  if (!betsLedgerState.days[stateId]) {
    betsLedgerState.days[stateId] = {
      state_id: stateId,
      market,
      day_key: dayKey,
      created_ts_ms: Date.now(),
      updated_ts_ms: Date.now(),
      pools: {},
      user_bets: {},
      freeze_returns_by_trader: null,
      freeze_ts_ms: null,
      settlement_status: 'pending',
      settled_ts_ms: null,
      settlement: null,
    }
  } else {
    const dayState = betsLedgerState.days[stateId]
    if (!dayState || typeof dayState !== 'object') {
      betsLedgerState.days[stateId] = {
        state_id: stateId,
        market,
        day_key: dayKey,
        created_ts_ms: Date.now(),
        updated_ts_ms: Date.now(),
        pools: {},
        user_bets: {},
        freeze_returns_by_trader: null,
        freeze_ts_ms: null,
        settlement_status: 'pending',
        settled_ts_ms: null,
        settlement: null,
      }
    } else {
      dayState.state_id = String(dayState.state_id || stateId)
      dayState.market = String(dayState.market || market)
      dayState.day_key = String(dayState.day_key || dayKey)
      if (!Number.isFinite(Number(dayState.created_ts_ms))) {
        dayState.created_ts_ms = Date.now()
      }
      if (!Number.isFinite(Number(dayState.updated_ts_ms))) {
        dayState.updated_ts_ms = Date.now()
      }
      if (!dayState.pools || typeof dayState.pools !== 'object') {
        dayState.pools = {}
      }
      if (!dayState.user_bets || typeof dayState.user_bets !== 'object') {
        dayState.user_bets = {}
      }
      if (
        dayState.freeze_returns_by_trader != null
        && typeof dayState.freeze_returns_by_trader !== 'object'
      ) {
        dayState.freeze_returns_by_trader = null
      }
      if (!Number.isFinite(Number(dayState.freeze_ts_ms))) {
        dayState.freeze_ts_ms = null
      }
      if (dayState.settlement_status !== 'settled') {
        dayState.settlement_status = 'pending'
      }
      if (!Number.isFinite(Number(dayState.settled_ts_ms))) {
        dayState.settled_ts_ms = null
      }
      if (dayState.settlement != null && typeof dayState.settlement !== 'object') {
        dayState.settlement = null
      }
    }
  }
  return betsLedgerState.days[stateId]
}

function ensureViewerCreditPointsRecord(userSessionId, userNickname = '') {
  const safeUserSessionId = String(userSessionId || '').trim()
  if (!safeUserSessionId) return null

  if (!betsLedgerState.credits_by_session || typeof betsLedgerState.credits_by_session !== 'object') {
    betsLedgerState.credits_by_session = {}
  }

  const existing = betsLedgerState.credits_by_session[safeUserSessionId]
  const nickname = sanitizeUserNickname(userNickname)
    || sanitizeUserNickname(existing?.user_nickname)
    || createDefaultUserNickname(safeUserSessionId)
  const updatedTsMs = Date.now()

  const next = {
    user_session_id: safeUserSessionId,
    user_nickname: nickname,
    credit_points: Math.max(0, Math.floor(Number(existing?.credit_points || 0))),
    settled_bets: Math.max(0, Math.floor(Number(existing?.settled_bets || 0))),
    win_count: Math.max(0, Math.floor(Number(existing?.win_count || 0))),
    last_award_ts_ms: Number.isFinite(Number(existing?.last_award_ts_ms))
      ? Number(existing.last_award_ts_ms)
      : null,
    updated_ts_ms: updatedTsMs,
  }

  betsLedgerState.credits_by_session[safeUserSessionId] = next
  return next
}

function marketNowSnapshot(market, fallbackNowMs = Date.now()) {
  const nowTsMs = effectiveSessionNowMs({ fallbackNowMs })
  const exchangeId = market === 'US' ? 'sim-us' : 'sim-cn'
  const session = getMarketSessionStatusForExchange(exchangeId, nowTsMs)
  const closeMinute = marketCloseMinute(market)
  const openMinute = marketOpenMinute(market)
  const cutoffMinute = closeMinute - 30
  const minute = Number(session?.minutes_since_midnight)
  const hasMinute = Number.isFinite(minute)
  const weekend = Number(session?.weekday) === 0 || Number(session?.weekday) === 6
  const beforeCutoff = hasMinute && minute < cutoffMinute
  const afterCutoff = hasMinute && minute >= cutoffMinute

  return {
    ts_ms: nowTsMs,
    session,
    open_minute: openMinute,
    close_minute: closeMinute,
    cutoff_minute: cutoffMinute,
    betting_open: !weekend && beforeCutoff,
    odds_update_active: !weekend && beforeCutoff,
    after_cutoff: !weekend && afterCutoff,
    after_close: !weekend && hasMinute && minute >= closeMinute,
  }
}

function computeMarketOddsEntries({ market, returnsByTrader, poolsByTrader, traders }) {
  const safeTraders = Array.isArray(traders) ? traders : []
  const totalStake = safeTraders.reduce((sum, trader) => {
    const amount = Number(poolsByTrader?.[trader.trader_id]?.amount || 0)
    return sum + (Number.isFinite(amount) ? amount : 0)
  }, 0)

  const weighted = []
  for (const trader of safeTraders) {
    const traderId = String(trader?.trader_id || '').trim()
    if (!traderId) continue
    const retPct = Number(returnsByTrader?.[traderId] || 0)
    const perfScore = Math.exp(clampNumber(retPct, -20, 20) / 8)
    const crowdStake = Number(poolsByTrader?.[traderId]?.amount || 0)
    const crowdShare = totalStake > 0 ? crowdStake / totalStake : 0
    const weightedScore = perfScore * (1 + crowdShare * 0.75)
    weighted.push({ traderId, weightedScore, retPct })
  }

  const sumWeighted = weighted.reduce((sum, row) => sum + row.weightedScore, 0)
  const denominator = sumWeighted > 0 ? sumWeighted : Math.max(1, weighted.length)

  return weighted
    .map((row) => {
      const trader = safeTraders.find((item) => item.trader_id === row.traderId)
      const impliedProb = sumWeighted > 0 ? (row.weightedScore / denominator) : (1 / denominator)
      const odds = clampNumber((1 - BETS_HOUSE_EDGE) / Math.max(0.02, impliedProb), 1.05, 30)
      const pool = poolsByTrader?.[row.traderId] || {}
      const amount = Number(pool.amount || 0)
      const tickets = Number(pool.tickets || 0)

      return {
        trader_id: row.traderId,
        trader_name: String(trader?.trader_name || row.traderId),
        market,
        is_running: !!trader?.is_running,
        daily_return_pct: Number(row.retPct.toFixed(4)),
        implied_prob: Number(impliedProb.toFixed(6)),
        odds: Number(odds.toFixed(4)),
        total_stake: Number((Number.isFinite(amount) ? amount : 0).toFixed(2)),
        ticket_count: Number.isFinite(tickets) ? Math.max(0, Math.floor(tickets)) : 0,
      }
    })
    .sort((a, b) => {
      if (b.daily_return_pct !== a.daily_return_pct) return b.daily_return_pct - a.daily_return_pct
      return b.odds - a.odds
    })
}

function settleBetDayStateIfNeeded({ dayState, entries, tsMs }) {
  if (!dayState || typeof dayState !== 'object') return false
  if (dayState.settlement_status === 'settled') return false

  const safeEntries = Array.isArray(entries) ? entries : []
  const activeStakeEntries = safeEntries.filter((entry) => Number(entry?.total_stake || 0) > 0)
  const scoringEntries = activeStakeEntries.length > 0 ? activeStakeEntries : safeEntries

  let winningReturnPct = null
  let winningTraderIds = []
  if (scoringEntries.length > 0) {
    winningReturnPct = Math.max(
      ...scoringEntries.map((entry) => Number(entry?.daily_return_pct || 0))
    )
    winningTraderIds = scoringEntries
      .filter((entry) => Number(entry?.daily_return_pct || 0) === winningReturnPct)
      .map((entry) => String(entry?.trader_id || '').trim())
      .filter(Boolean)
  }
  const winningSet = new Set(winningTraderIds)

  const settledEntryByTraderId = new Map(
    safeEntries.map((entry) => [String(entry?.trader_id || '').trim(), entry])
  )
  const payoutBySession = {}
  const userBets = dayState.user_bets && typeof dayState.user_bets === 'object'
    ? dayState.user_bets
    : {}

  for (const [sessionIdRaw, row] of Object.entries(userBets)) {
    const safeSessionId = String(sessionIdRaw || '').trim()
    if (!safeSessionId || !row || typeof row !== 'object') continue

    const traderId = String(row.trader_id || '').trim()
    const stakeAmount = Number(row.stake_amount || 0)
    const safeStake = Number.isFinite(stakeAmount) ? Math.max(0, stakeAmount) : 0
    const settledEntry = settledEntryByTraderId.get(traderId)
    const settledOdds = Number(settledEntry?.odds || 0)
    const isWinner = winningSet.has(traderId)
    const awardedPoints = isWinner
      ? Math.max(1, Math.round(safeStake * Math.max(1, settledOdds)))
      : 0

    const creditRecord = ensureViewerCreditPointsRecord(
      safeSessionId,
      String(row.user_nickname || '')
    )
    if (creditRecord) {
      creditRecord.settled_bets = Math.max(0, Math.floor(Number(creditRecord.settled_bets || 0))) + 1
      if (awardedPoints > 0) {
        creditRecord.credit_points = Math.max(0, Math.floor(Number(creditRecord.credit_points || 0))) + awardedPoints
        creditRecord.win_count = Math.max(0, Math.floor(Number(creditRecord.win_count || 0))) + 1
        creditRecord.last_award_ts_ms = Number.isFinite(Number(tsMs)) ? Number(tsMs) : Date.now()
      }
      creditRecord.updated_ts_ms = Date.now()
    }

    payoutBySession[safeSessionId] = {
      user_session_id: safeSessionId,
      user_nickname: String(row.user_nickname || ''),
      trader_id: traderId,
      stake_amount: Number(safeStake.toFixed(2)),
      settled_odds: settledOdds > 0 ? Number(settledOdds.toFixed(4)) : null,
      is_winner: isWinner,
      credit_points_awarded: awardedPoints,
      settled_ts_ms: Number.isFinite(Number(tsMs)) ? Number(tsMs) : Date.now(),
    }
  }

  dayState.settlement_status = 'settled'
  dayState.settled_ts_ms = Number.isFinite(Number(tsMs)) ? Number(tsMs) : Date.now()
  dayState.settlement = {
    schema_version: 'bets.settlement.v1',
    settled_ts_ms: dayState.settled_ts_ms,
    winning_trader_ids: winningTraderIds,
    winning_return_pct: Number.isFinite(Number(winningReturnPct))
      ? Number(Number(winningReturnPct).toFixed(4))
      : null,
    payouts_by_session: payoutBySession,
  }
  dayState.updated_ts_ms = Date.now()
  return true
}

async function persistBetsLedgerState() {
  const dir = path.dirname(BETS_LEDGER_PATH)
  await mkdir(dir, { recursive: true })
  const tmpPath = `${BETS_LEDGER_PATH}.tmp`
  await writeFile(tmpPath, JSON.stringify(betsLedgerState, null, 2), 'utf8')
  await rename(tmpPath, BETS_LEDGER_PATH)
}

async function loadBetsLedgerState() {
  try {
    const raw = await readFile(BETS_LEDGER_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    betsLedgerState = normalizeBetsLedgerShape(parsed)
  } catch {
    betsLedgerState = normalizeBetsLedgerShape(null)
  }
}

async function buildBetsMarketPayload({ market = 'CN-A', userSessionId = '' } = {}) {
  const safeMarket = String(market || 'CN-A').toUpperCase() === 'US' ? 'US' : 'CN-A'
  const spec = getMarketSpecForExchange(safeMarket === 'US' ? 'sim-us' : 'sim-cn')
  const clock = marketNowSnapshot(safeMarket, Date.now())
  const dayKey = dayKeyInTimeZone(clock.ts_ms, spec.timezone)
  const dayState = ensureBetDayState({ market: safeMarket, dayKey })

  const candidateTraders = getLobbyTraders().filter((trader) => {
    const traderMarket = getMarketSpecForExchange(trader.exchange_id).market
    return traderMarket === safeMarket
  })

  const liveReturnsByTrader = {}
  for (const trader of candidateTraders) {
    liveReturnsByTrader[trader.trader_id] = computeDailyReturnPctForTrader(trader.trader_id)
  }

  let ledgerUpdated = false
  if (clock.after_cutoff && !dayState.freeze_returns_by_trader) {
    dayState.freeze_returns_by_trader = { ...liveReturnsByTrader }
    dayState.freeze_ts_ms = clock.ts_ms
    dayState.updated_ts_ms = Date.now()
    ledgerUpdated = true
  }

  const returnsByTrader = clock.after_cutoff && dayState.freeze_returns_by_trader
    ? dayState.freeze_returns_by_trader
    : liveReturnsByTrader

  const entriesForDisplay = computeMarketOddsEntries({
    market: safeMarket,
    returnsByTrader,
    poolsByTrader: dayState.pools || {},
    traders: candidateTraders,
  })

  const entriesForSettlement = computeMarketOddsEntries({
    market: safeMarket,
    returnsByTrader: liveReturnsByTrader,
    poolsByTrader: dayState.pools || {},
    traders: candidateTraders,
  })

  if (clock.after_close) {
    const settled = settleBetDayStateIfNeeded({
      dayState,
      entries: entriesForSettlement,
      tsMs: clock.ts_ms,
    })
    if (settled) {
      ledgerUpdated = true
    }
  }

  if (ledgerUpdated) {
    await persistBetsLedgerState()
  }

  const entries = dayState.settlement_status === 'settled' && dayState.settlement
    ? entriesForSettlement
    : entriesForDisplay

  const totalStake = entries.reduce((sum, item) => sum + Number(item.total_stake || 0), 0)
  const totalTickets = entries.reduce((sum, item) => sum + Number(item.ticket_count || 0), 0)

  const safeUserSessionId = String(userSessionId || '').trim()
  const myBet = safeUserSessionId
    ? (dayState.user_bets?.[safeUserSessionId] || null)
    : null

  const myBetWithEstimate = myBet
    ? (() => {
      const entry = entries.find((item) => item.trader_id === myBet.trader_id)
      const odds = Number(entry?.odds || 0)
      const stake = Number(myBet.stake_amount || 0)
      const estPayout = odds > 0 ? Number((odds * stake).toFixed(2)) : null
      const settlementPayout = dayState.settlement
        && typeof dayState.settlement === 'object'
        && dayState.settlement.payouts_by_session
        && typeof dayState.settlement.payouts_by_session === 'object'
        ? dayState.settlement.payouts_by_session[safeUserSessionId] || null
        : null

      return {
        ...myBet,
        estimated_odds: odds || null,
        estimated_payout: estPayout,
        settlement_status: dayState.settlement_status === 'settled' ? 'settled' : 'pending',
        settled_is_winner: !!settlementPayout?.is_winner,
        settled_credit_points: Number(settlementPayout?.credit_points_awarded || 0),
      }
    })()
    : null

  const myCredits = safeUserSessionId
    ? (betsLedgerState.credits_by_session?.[safeUserSessionId] || null)
    : null

  const settlement = dayState.settlement_status === 'settled' && dayState.settlement
    ? {
      schema_version: String(dayState.settlement.schema_version || 'bets.settlement.v1'),
      settled_ts_ms: Number(dayState.settlement.settled_ts_ms || dayState.settled_ts_ms || 0) || null,
      winning_trader_ids: Array.isArray(dayState.settlement.winning_trader_ids)
        ? dayState.settlement.winning_trader_ids.map((id) => String(id || '')).filter(Boolean)
        : [],
      winning_return_pct: Number.isFinite(Number(dayState.settlement.winning_return_pct))
        ? Number(dayState.settlement.winning_return_pct)
        : null,
    }
    : null

  return {
    schema_version: 'bets.market.v1',
    market: safeMarket,
    time_zone: spec.timezone,
    mode: RUNTIME_DATA_MODE,
    ts_ms: clock.ts_ms,
    day_key: dayKey,
    betting_open: clock.betting_open,
    odds_update_active: clock.odds_update_active,
    cutoff_minute: clock.cutoff_minute,
    close_minute: clock.close_minute,
    house_edge: BETS_HOUSE_EDGE,
    totals: {
      stake_amount: Number(totalStake.toFixed(2)),
      ticket_count: Math.max(0, Math.floor(totalTickets)),
    },
    entries,
    my_bet: myBetWithEstimate,
    my_credits: myCredits
      ? {
        credit_points: Math.max(0, Math.floor(Number(myCredits.credit_points || 0))),
        settled_bets: Math.max(0, Math.floor(Number(myCredits.settled_bets || 0))),
        win_count: Math.max(0, Math.floor(Number(myCredits.win_count || 0))),
      }
      : null,
    settlement,
    freeze_ts_ms: dayState.freeze_ts_ms || null,
  }
}

async function placeViewerBet({ userSessionId, userNickname, traderId, stakeAmount }) {
  const safeUserSessionId = String(userSessionId || '').trim()
  const safeTraderId = String(traderId || '').trim()
  if (!safeUserSessionId) {
    throw httpError('invalid_user_session_id', 400)
  }
  if (!safeTraderId) {
    throw httpError('invalid_trader_id', 400)
  }

  const trader = getTraderById(safeTraderId)
  if (!trader || trader.show_in_competition === false) {
    throw httpError('trader_not_available_for_bet', 404)
  }

  const market = getMarketSpecForExchange(trader.exchange_id).market
  const clock = marketNowSnapshot(market, Date.now())
  if (!clock.betting_open) {
    throw httpError('betting_closed_before_market_close_30m', 409)
  }

  const spec = getMarketSpecForExchange(trader.exchange_id)
  const dayKey = dayKeyInTimeZone(clock.ts_ms, spec.timezone)
  const dayState = ensureBetDayState({ market, dayKey })
  const amount = safeStakeAmount(stakeAmount)

  const existing = dayState.user_bets?.[safeUserSessionId] || null
  if (existing) {
    const oldTraderId = String(existing.trader_id || '').trim()
    const oldAmount = Number(existing.stake_amount || 0)
    if (oldTraderId) {
      const pool = dayState.pools?.[oldTraderId]
      if (pool) {
        pool.amount = Number((Math.max(0, Number(pool.amount || 0) - Math.max(0, oldAmount))).toFixed(2))
        pool.tickets = Math.max(0, Math.floor(Number(pool.tickets || 0)) - 1)
      }
    }
  }

  if (!dayState.pools[safeTraderId]) {
    dayState.pools[safeTraderId] = { amount: 0, tickets: 0 }
  }
  dayState.pools[safeTraderId].amount = Number((Number(dayState.pools[safeTraderId].amount || 0) + amount).toFixed(2))
  dayState.pools[safeTraderId].tickets = Math.max(0, Math.floor(Number(dayState.pools[safeTraderId].tickets || 0)) + 1)

  dayState.user_bets[safeUserSessionId] = {
    user_session_id: safeUserSessionId,
    user_nickname: resolveNicknameForSession(safeUserSessionId, userNickname),
    trader_id: safeTraderId,
    stake_amount: amount,
    placed_ts_ms: Date.now(),
    market,
    day_key: dayKey,
  }
  ensureViewerCreditPointsRecord(
    safeUserSessionId,
    String(dayState.user_bets[safeUserSessionId]?.user_nickname || userNickname || '')
  )
  dayState.updated_ts_ms = Date.now()

  await persistBetsLedgerState()
  return await buildBetsMarketPayload({ market, userSessionId: safeUserSessionId })
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
    stock_pool: normalizeStockPool(agent.stock_pool, agent.exchange_id),
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
    riskProfile: trader.risk_profile || '',
    personality: trader.personality || '',
    tradingStyle: trader.trading_style || '',
    stylePromptCn: trader.style_prompt_cn || '',
  }
}

function getRegisteredTraderStrict(traderId) {
  const wanted = String(traderId || '').trim()
  if (!wanted) return null
  return getRegisteredTraders().find((row) => row.trader_id === wanted) || null
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

function ensureRoomSubscriberSet(roomId) {
  const key = String(roomId || '').trim()
  if (!key) return null
  const existing = roomEventSubscribersByRoom.get(key)
  if (existing) return existing
  const set = new Set()
  roomEventSubscribersByRoom.set(key, set)
  return set
}

function writeSseEvent(res, { id = null, event = 'message', data = null } = {}) {
  try {
    if (!res || res.writableEnded) return false
    const payload = JSON.stringify(data)
    if (id != null) {
      res.write(`id: ${String(id)}\n`)
    }
    res.write(`event: ${event}\n`)
    res.write(`data: ${payload}\n\n`)
    return true
  } catch {
    return false
  }
}

function writeSseComment(res, comment = 'keepalive') {
  try {
    if (!res || res.writableEnded) return false
    res.write(`: ${String(comment || 'keepalive')}\n\n`)
    return true
  } catch {
    return false
  }
}

function nextRoomEventId(roomId) {
  const key = String(roomId || '').trim()
  if (!key) return null
  const previous = Number(roomEventSeqByRoom.get(key) || 0)
  const next = Number.isFinite(previous) ? previous + 1 : 1
  roomEventSeqByRoom.set(key, next)
  return next
}

function ensureRoomEventBuffer(roomId) {
  const key = String(roomId || '').trim()
  if (!key) return null
  const existing = roomEventBufferByRoom.get(key)
  if (existing) return existing
  const buf = []
  roomEventBufferByRoom.set(key, buf)
  return buf
}

function cleanupRoomEventBufferIfExpired(roomId, nowMs = Date.now()) {
  const key = String(roomId || '').trim()
  if (!key) return
  const expiry = roomEventBufferExpiryByRoom.get(key)
  if (expiry == null) return
  const expMs = Number(expiry)
  if (!Number.isFinite(expMs)) return
  if (nowMs < expMs) return
  roomEventBufferByRoom.delete(key)
  roomEventBufferExpiryByRoom.delete(key)
  roomEventSeqByRoom.delete(key)
}

function markRoomEventBufferActive(roomId) {
  const key = String(roomId || '').trim()
  if (!key) return
  cleanupRoomEventBufferIfExpired(key)
  ensureRoomEventBuffer(key)
  roomEventBufferExpiryByRoom.set(key, null)
}

function markRoomEventBufferExpiring(roomId, nowMs = Date.now()) {
  const key = String(roomId || '').trim()
  if (!key) return
  if (!roomEventBufferByRoom.has(key)) return
  roomEventBufferExpiryByRoom.set(key, nowMs + ROOM_EVENTS_BUFFER_TTL_MS)
}

function isRoomEventBufferActive(roomId, nowMs = Date.now()) {
  const key = String(roomId || '').trim()
  if (!key) return false
  if (!roomEventBufferByRoom.has(key)) return false
  const expiry = roomEventBufferExpiryByRoom.get(key)
  if (expiry == null) return true
  const expMs = Number(expiry)
  if (!Number.isFinite(expMs)) return false
  if (nowMs < expMs) return true
  cleanupRoomEventBufferIfExpired(key, nowMs)
  return false
}

function recordRoomEvent(roomId, event, data) {
  const key = String(roomId || '').trim()
  if (!key) return null
  const id = nextRoomEventId(key)
  if (id == null) return null
  const buf = ensureRoomEventBuffer(key)
  if (buf) {
    buf.push({ id, event, data, ts_ms: Date.now() })
    if (buf.length > ROOM_EVENTS_BUFFER_SIZE) {
      buf.splice(0, buf.length - ROOM_EVENTS_BUFFER_SIZE)
    }
  }
  return id
}

function replayRoomEventsSince(roomId, lastEventId) {
  const key = String(roomId || '').trim()
  const last = Number(lastEventId)
  if (!key || !Number.isFinite(last) || last <= 0) return []
  if (!isRoomEventBufferActive(key)) return []
  const buf = roomEventBufferByRoom.get(key)
  if (!buf || buf.length === 0) return []
  return buf.filter((item) => Number(item?.id || 0) > last)
}

function broadcastRoomComment(roomId, comment = 'keepalive') {
  const key = String(roomId || '').trim()
  if (!key) return 0
  const set = roomEventSubscribersByRoom.get(key)
  if (!set || set.size === 0) return 0
  let sent = 0
  for (const client of Array.from(set)) {
    const okWrite = writeSseComment(client?.res, comment)
    if (!okWrite) {
      try { set.delete(client) } catch { /* ignore */ }
      continue
    }
    sent += 1
  }
  if (set.size === 0) {
    roomEventSubscribersByRoom.delete(key)
    markRoomEventBufferExpiring(key, Date.now())
    clearRoomKeepaliveTimer(key)
    clearRoomStreamPacketTimer(key)
    maybeDeleteRoomStreamPacketBuildState(key)
  }
  return sent
}

function broadcastRoomStreamPacket(roomId, packet) {
  return broadcastRoomEvent(roomId, 'stream_packet', packet)
}

function computeRoomPacketIntervalMs(roomId) {
  const key = String(roomId || '').trim()
  const set = roomEventSubscribersByRoom.get(key)
  if (!key || !set || set.size === 0) return ROOM_EVENTS_STREAM_PACKET_INTERVAL_MS

  let min = ROOM_EVENTS_STREAM_PACKET_INTERVAL_MS
  for (const client of Array.from(set)) {
    const n = Number(client?.packet_interval_ms)
    if (Number.isFinite(n) && n > 0) {
      min = Math.min(min, n)
    }
  }
  return Math.max(2_000, Math.min(Math.floor(min), 60_000))
}

function computeRoomDecisionLimitMax(roomId) {
  const key = String(roomId || '').trim()
  const set = roomEventSubscribersByRoom.get(key)
  if (!key || !set || set.size === 0) return 5
  let max = 5
  for (const client of Array.from(set)) {
    const n = Number(client?.decision_limit_num)
    if (Number.isFinite(n) && n > 0) {
      max = Math.max(max, n)
    }
  }
  return Math.max(1, Math.min(Math.floor(max), 20))
}

function normalizeDecisionLimit(value, fallback = 5) {
  const fallbackNum = Math.max(1, Math.min(Number(fallback || 5) || 5, 20))
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallbackNum
  return Math.max(1, Math.min(Math.floor(parsed), 20))
}

function trimRoomStreamPacketDecisions(packet, decisionLimit) {
  const safeLimit = normalizeDecisionLimit(decisionLimit, 5)
  if (!packet || typeof packet !== 'object') return packet
  if (!Array.isArray(packet.decisions_latest)) return packet
  return {
    ...packet,
    decisions_latest: packet.decisions_latest.slice(0, safeLimit),
  }
}

function ensureRoomStreamPacketBuildState(roomId) {
  const key = String(roomId || '').trim()
  if (!key) return null
  const existing = roomStreamPacketBuildStateByRoom.get(key)
  if (existing) return existing
  const state = {
    in_flight: false,
    in_flight_promise: null,
    in_flight_decision_limit_num: null,
    current_concurrency: 0,
    max_concurrency: 0,
    build_started_count: 0,
    build_finished_count: 0,
    build_error_count: 0,
    joined_call_count: 0,
    timer_skip_count: 0,
    last_start_ts_ms: null,
    last_end_ts_ms: null,
    last_error: null,
    packet_overview_fetch_count: 0,
    packet_digest_fetch_count: 0,
    packet_breadth_fetch_count: 0,
    context_overview_fetch_count: 0,
    context_digest_fetch_count: 0,
    context_breadth_fetch_count: 0,
    caller_started_counts: {
      timer: 0,
      sse_initial: 0,
      http: 0,
      other: 0,
    },
  }
  roomStreamPacketBuildStateByRoom.set(key, state)
  return state
}

function ensureRoomStreamPacketBuildGlobalStats(roomId) {
  if (!ROOM_EVENTS_COLLECT_STATS) return null
  const key = String(roomId || '').trim()
  if (!key) return null
  const existing = roomStreamPacketBuildGlobalStatsByRoom.get(key)
  if (existing) return existing
  const stats = {
    current_concurrency: 0,
    max_concurrency: 0,
    build_started_count: 0,
    build_finished_count: 0,
    build_error_count: 0,
  }
  roomStreamPacketBuildGlobalStatsByRoom.set(key, stats)
  return stats
}

function incrementRoomStreamPacketBuildStat(roomId, field, delta = 1) {
  if (!ROOM_EVENTS_COLLECT_STATS) return
  const key = String(roomId || '').trim()
  if (!key) return
  const state = roomStreamPacketBuildStateByRoom.get(key)
  if (!state) return
  const current = Number(state[field] || 0)
  const step = Number.isFinite(Number(delta)) ? Number(delta) : 1
  state[field] = current + step
}

function markRoomStreamPacketBuildCallerStart(roomId, caller) {
  if (!ROOM_EVENTS_COLLECT_STATS) return
  const key = String(roomId || '').trim()
  if (!key) return
  const state = roomStreamPacketBuildStateByRoom.get(key)
  if (!state) return
  const bucket = (caller === 'timer' || caller === 'sse_initial' || caller === 'http') ? caller : 'other'
  const counts = state.caller_started_counts || {}
  counts[bucket] = Number(counts[bucket] || 0) + 1
  state.caller_started_counts = counts
}

function getRoomStreamPacketBuildStats(roomId) {
  const key = String(roomId || '').trim()
  if (!key) return null
  const state = roomStreamPacketBuildStateByRoom.get(key)
  const globalStats = roomStreamPacketBuildGlobalStatsByRoom.get(key)
  if (!state && !globalStats) return null
  return {
    room_id: key,
    in_flight: state?.in_flight === true,
    current_concurrency: Number(state?.current_concurrency || 0),
    max_concurrency: Number(state?.max_concurrency || 0),
    build_started_count: Number(state?.build_started_count || 0),
    build_finished_count: Number(state?.build_finished_count || 0),
    build_error_count: Number(state?.build_error_count || 0),
    joined_call_count: Number(state?.joined_call_count || 0),
    timer_skip_count: Number(state?.timer_skip_count || 0),
    last_start_ts_ms: state?.last_start_ts_ms || null,
    last_end_ts_ms: state?.last_end_ts_ms || null,
    last_error: state?.last_error || null,
    packet_overview_fetch_count: Number(state?.packet_overview_fetch_count || 0),
    packet_digest_fetch_count: Number(state?.packet_digest_fetch_count || 0),
    packet_breadth_fetch_count: Number(state?.packet_breadth_fetch_count || 0),
    context_overview_fetch_count: Number(state?.context_overview_fetch_count || 0),
    context_digest_fetch_count: Number(state?.context_digest_fetch_count || 0),
    context_breadth_fetch_count: Number(state?.context_breadth_fetch_count || 0),
    caller_started_counts: {
      timer: Number(state?.caller_started_counts?.timer || 0),
      sse_initial: Number(state?.caller_started_counts?.sse_initial || 0),
      http: Number(state?.caller_started_counts?.http || 0),
      other: Number(state?.caller_started_counts?.other || 0),
    },
    global_current_concurrency: Number(globalStats?.current_concurrency || 0),
    global_max_concurrency: Number(globalStats?.max_concurrency || 0),
    global_build_started_count: Number(globalStats?.build_started_count || 0),
    global_build_finished_count: Number(globalStats?.build_finished_count || 0),
    global_build_error_count: Number(globalStats?.build_error_count || 0),
  }
}

function maybeDeleteRoomStreamPacketBuildState(roomId, expectedState = null) {
  if (ROOM_EVENTS_TEST_MODE && !ROOM_EVENTS_CLEANUP_IN_TEST) return
  const key = String(roomId || '').trim()
  if (!key) return
  const state = roomStreamPacketBuildStateByRoom.get(key)
  if (!state) return
  if (expectedState && state !== expectedState) return
  if (state.in_flight === true || state.in_flight_promise) return
  const set = roomEventSubscribersByRoom.get(key)
  if (set && set.size > 0) return
  roomStreamPacketBuildStateByRoom.delete(key)
}

function sleep(ms) {
  const delayMs = Number(ms)
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

async function buildRoomStreamPacketSingleflight({
  roomId,
  decisionLimit = 5,
  caller = 'other',
  skipIfInFlight = false,
} = {}) {
  const key = String(roomId || '').trim()
  if (!key) {
    throw httpError('invalid_room_id', 400)
  }

  const trader = getRegisteredTraderStrict(key)
  if (!trader) {
    throw httpError('room_not_found', 404)
  }

  const safeDecisionLimit = normalizeDecisionLimit(decisionLimit, 5)

  while (true) {
    const state = ensureRoomStreamPacketBuildState(key)
    if (!state) {
      throw httpError('invalid_room_id', 400)
    }

    const activePromise = state.in_flight_promise
    const activeLimit = normalizeDecisionLimit(state.in_flight_decision_limit_num, 5)
    if (activePromise) {
      if (skipIfInFlight) {
        if (ROOM_EVENTS_COLLECT_STATS) {
          state.timer_skip_count = Number(state.timer_skip_count || 0) + 1
        }
        return { packet: null, skipped: true, joined: false }
      }

      if (safeDecisionLimit <= activeLimit) {
        if (ROOM_EVENTS_COLLECT_STATS) {
          state.joined_call_count = Number(state.joined_call_count || 0) + 1
        }
        const packet = await activePromise
        return { packet: trimRoomStreamPacketDecisions(packet, safeDecisionLimit), skipped: false, joined: true }
      }

      try {
        await activePromise
      } catch {
        // Active call failed; retry as primary caller with higher limit.
      }
      continue
    }

    state.in_flight = true
    state.in_flight_decision_limit_num = safeDecisionLimit
    const globalStats = ensureRoomStreamPacketBuildGlobalStats(key)
    if (ROOM_EVENTS_COLLECT_STATS) {
      state.current_concurrency = Number(state.current_concurrency || 0) + 1
      state.max_concurrency = Math.max(Number(state.max_concurrency || 0), Number(state.current_concurrency || 0))
      state.build_started_count = Number(state.build_started_count || 0) + 1
      state.last_start_ts_ms = Date.now()
      state.last_error = null
      markRoomStreamPacketBuildCallerStart(key, caller)
      if (globalStats) {
        globalStats.current_concurrency = Number(globalStats.current_concurrency || 0) + 1
        globalStats.max_concurrency = Math.max(
          Number(globalStats.max_concurrency || 0),
          Number(globalStats.current_concurrency || 0)
        )
        globalStats.build_started_count = Number(globalStats.build_started_count || 0) + 1
      }
    }

    const promise = buildRoomStreamPacket({ roomId: key, decisionLimit: safeDecisionLimit })
    state.in_flight_promise = promise

    try {
      const packet = await promise
      if (ROOM_EVENTS_COLLECT_STATS) {
        state.build_finished_count = Number(state.build_finished_count || 0) + 1
        if (globalStats) {
          globalStats.build_finished_count = Number(globalStats.build_finished_count || 0) + 1
        }
      }
      return { packet: trimRoomStreamPacketDecisions(packet, safeDecisionLimit), skipped: false, joined: false }
    } catch (error) {
      if (ROOM_EVENTS_COLLECT_STATS) {
        state.build_error_count = Number(state.build_error_count || 0) + 1
        state.last_error = error?.code || error?.message || 'stream_packet_failed'
        if (globalStats) {
          globalStats.build_error_count = Number(globalStats.build_error_count || 0) + 1
        }
      }
      throw error
    } finally {
      if (ROOM_EVENTS_COLLECT_STATS) {
        state.last_end_ts_ms = Date.now()
        state.current_concurrency = Math.max(0, Number(state.current_concurrency || 0) - 1)
        if (globalStats) {
          globalStats.current_concurrency = Math.max(0, Number(globalStats.current_concurrency || 0) - 1)
        }
      }
      state.in_flight = false
      state.in_flight_decision_limit_num = null
      if (state.in_flight_promise === promise) {
        state.in_flight_promise = null
      }
      maybeDeleteRoomStreamPacketBuildState(key, state)
    }
  }
}

function clearRoomKeepaliveTimer(roomId) {
  const key = String(roomId || '').trim()
  const existing = roomKeepaliveTimerByRoom.get(key)
  if (!existing) return
  try { clearInterval(existing) } catch { /* ignore */ }
  roomKeepaliveTimerByRoom.delete(key)
}

function clearRoomStreamPacketTimer(roomId) {
  const key = String(roomId || '').trim()
  const existing = roomStreamPacketTimerByRoom.get(key)
  if (!existing) return
  try { clearInterval(existing.timer) } catch { /* ignore */ }
  roomStreamPacketTimerByRoom.delete(key)
}

function ensureRoomKeepaliveTimer(roomId) {
  const key = String(roomId || '').trim()
  if (!key) return
  const set = roomEventSubscribersByRoom.get(key)
  if (!set || set.size === 0) return
  if (roomKeepaliveTimerByRoom.get(key)) return

  const timer = setInterval(() => {
    try {
      broadcastRoomComment(key, 'keepalive')
    } catch {
      // ignore
    }
  }, ROOM_EVENTS_KEEPALIVE_MS)
  roomKeepaliveTimerByRoom.set(key, timer)
}

function ensureRoomStreamPacketTimer(roomId) {
  const key = String(roomId || '').trim()
  if (!key) return
  const set = roomEventSubscribersByRoom.get(key)
  if (!set || set.size === 0) return

  const wantedIntervalMs = computeRoomPacketIntervalMs(key)
  const existing = roomStreamPacketTimerByRoom.get(key)
  if (existing && existing.intervalMs === wantedIntervalMs) return

  if (existing) {
    try { clearInterval(existing.timer) } catch { /* ignore */ }
    roomStreamPacketTimerByRoom.delete(key)
  }

  const timer = setInterval(async () => {
    try {
      const decisionLimit = computeRoomDecisionLimitMax(key)
      const result = await buildRoomStreamPacketSingleflight({
        roomId: key,
        decisionLimit,
        caller: 'timer',
        skipIfInFlight: true,
      })
      if (!result?.skipped && result?.packet) {
        broadcastRoomStreamPacket(key, result.packet)
      }
    } catch {
      // ignore
    }
  }, wantedIntervalMs)

  roomStreamPacketTimerByRoom.set(key, { timer, intervalMs: wantedIntervalMs })
}

function broadcastRoomEvent(roomId, event, data) {
  const key = String(roomId || '').trim()
  if (!key) return 0
  const set = roomEventSubscribersByRoom.get(key)
  const hasViewers = !!set && set.size > 0

  // Only buffer events for rooms that have (or recently had) viewers.
  const bufferActive = isRoomEventBufferActive(key)
  if (!hasViewers && !bufferActive) return 0

  const id = recordRoomEvent(key, event, data)

  let sent = 0
  if (!hasViewers) return 0
  for (const client of Array.from(set)) {
    const okWrite = writeSseEvent(client?.res, { id, event, data })
    if (!okWrite) {
      try {
        set.delete(client)
      } catch {
        // ignore
      }
      continue
    }
    sent += 1
  }

  if (set.size === 0) {
    roomEventSubscribersByRoom.delete(key)
    markRoomEventBufferExpiring(key, Date.now())
    clearRoomKeepaliveTimer(key)
    clearRoomStreamPacketTimer(key)
    maybeDeleteRoomStreamPacketBuildState(key)
  }
  return sent
}

function derivedDecisionCycleMs() {
  if (RUNTIME_DATA_MODE === 'live_file') {
    return agentRuntime?.getState?.().cycle_ms || AGENT_RUNTIME_CYCLE_MS
  }
  const replaySpeed = replayEngine?.getStatus?.().speed || REPLAY_SPEED
  return Math.max(1000, Math.round((60_000 * agentDecisionEveryBars) / Math.max(0.1, replaySpeed)))
}

function publicLiveFileStatus(status) {
  if (!status) return null
  return {
    stale: !!status.stale,
    last_load_ts_ms: status.last_load_ts_ms,
    last_mtime_ms: status.last_mtime_ms,
    last_error: status.last_error,
    frame_count: status.frame_count,
    symbols_1m_count: Array.isArray(status.symbols_1m) ? status.symbols_1m.length : 0,
  }
}

function buildFreshnessCheck(label, status) {
  const lastLoadTsMs = Number(status?.last_load_ts_ms)
  const staleAfterMs = Number(status?.stale_after_ms)
  const nowMs = Date.now()
  const ageMs = Number.isFinite(lastLoadTsMs) && lastLoadTsMs > 0
    ? Math.max(0, nowMs - lastLoadTsMs)
    : null
  const staleByAge = Number.isFinite(ageMs) && Number.isFinite(staleAfterMs)
    ? ageMs > staleAfterMs
    : false
  const staleFlag = status?.stale === true || staleByAge
  const ok = !!status && !status?.last_error && !staleFlag

  return {
    label,
    ok,
    stale: staleFlag,
    age_ms: ageMs,
    stale_after_ms: Number.isFinite(staleAfterMs) ? staleAfterMs : null,
    last_load_ts_ms: Number.isFinite(lastLoadTsMs) ? lastLoadTsMs : null,
    last_error: status?.last_error || null,
    file_path: status?.file_path || null,
  }
}

function buildLiveDataFreshnessSummary() {
  if (RUNTIME_DATA_MODE !== 'live_file') {
    return {
      ok: true,
      skipped: true,
      reason: 'runtime_data_mode_not_live_file',
      checks: {},
    }
  }

  const checks = [
    buildFreshnessCheck('frames_cn_a', liveFileFrameProviderCn?.getStatus?.() || null),
    buildFreshnessCheck('frames_us', liveFileFrameProviderUs?.getStatus?.() || null),
    buildFreshnessCheck('market_overview_cn_a', marketOverviewProviderCn.getStatus()),
    buildFreshnessCheck('market_overview_us', marketOverviewProviderUs.getStatus()),
    buildFreshnessCheck('news_digest_cn_a', newsDigestProviderCn.getStatus()),
    buildFreshnessCheck('news_digest_us', newsDigestProviderUs.getStatus()),
    buildFreshnessCheck('market_breadth_cn_a', marketBreadthProviderCn.getStatus()),
    buildFreshnessCheck('market_breadth_us', marketBreadthProviderUs.getStatus()),
  ]

  const checksByLabel = Object.fromEntries(checks.map((check) => [check.label, check]))
  return {
    ok: checks.every((check) => check.ok),
    checks: checksByLabel,
  }
}

function getMarketSessionGatePublicSnapshot(nowMs = Date.now()) {
  const enabled = AGENT_SESSION_GUARD_ENABLED && RUNTIME_DATA_MODE === 'live_file'
  if (!enabled) {
    return { enabled: false }
  }

  const cnSession = getMarketSessionStatusForExchange('sim-cn', nowMs)
  const usSession = getMarketSessionStatusForExchange('sim-us', nowMs)
  const cnLive = liveFileFrameProviderCn?.getStatus?.() || null
  const usLive = liveFileFrameProviderUs?.getStatus?.() || null
  const cnFreshOk = !AGENT_SESSION_GUARD_REQUIRE_FRESH_LIVE_DATA || isLiveFileFresh(cnLive)
  const usFreshOk = !AGENT_SESSION_GUARD_REQUIRE_FRESH_LIVE_DATA || isLiveFileFresh(usLive)

  return {
    enabled: true,
    check_ms: AGENT_SESSION_GUARD_CHECK_MS,
    require_fresh_live_data: !!AGENT_SESSION_GUARD_REQUIRE_FRESH_LIVE_DATA,
    manual_paused: !!agentRuntimeManualPause,
    auto_paused: !!marketSessionGateState.auto_paused,
    auto_paused_at_ms: marketSessionGateState.auto_paused_at_ms,
    last_check_ms: marketSessionGateState.last_check_ms,
    running_trader_ids: marketSessionGateState.running_trader_ids,
    active_trader_ids: marketSessionGateState.active_trader_ids,
    markets: {
      'CN-A': {
        session: cnSession,
        live_fresh_ok: cnFreshOk,
        live_file: publicLiveFileStatus(cnLive),
      },
      US: {
        session: usSession,
        live_fresh_ok: usFreshOk,
        live_file: publicLiveFileStatus(usLive),
      },
    },
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

function resolveControlActor(req) {
  const explicit = String(req.body?.actor || req.headers['x-control-actor'] || '').trim()
  if (explicit) return explicit

  const forwardedFor = String(req.headers['x-forwarded-for'] || '').trim()
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0].trim()
    if (first) return first
  }

  const ip = String(req.ip || '').trim()
  if (ip) return ip
  return 'unknown'
}

function auditControlAction({ req, action, target = null, result, error = null } = {}) {
  const payload = {
    ts: new Date().toISOString(),
    action: String(action || 'unknown'),
    actor: resolveControlActor(req || {}),
    ip: String(req?.ip || '').trim() || null,
    target: target ? String(target) : null,
    result: String(result || 'unknown'),
  }
  if (error) {
    payload.error = String(error)
  }
  console.log(`[control_audit] ${JSON.stringify(payload)}`)
}

function requireControlAuthorization(req, res, { action = 'unknown', target = null } = {}) {
  if (!CONTROL_API_TOKEN) return true

  const provided = resolveControlToken(req)
  if (!secureTokenEquals(CONTROL_API_TOKEN, provided)) {
    auditControlAction({ req, action, target, result: 'unauthorized', error: 'unauthorized_control_token' })
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

  const spec = getMarketSpecForExchange(trader.exchange_id)
  const gate = getTraderGateState(trader, Date.now())
  const liveStatus = RUNTIME_DATA_MODE === 'live_file' ? liveFileStatusForMarket(spec.market) : null

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
    market_gate: {
      enabled: AGENT_SESSION_GUARD_ENABLED && RUNTIME_DATA_MODE === 'live_file',
      market: spec.market,
      timezone: spec.timezone,
      allow_run: !!gate.allow_run,
      manual_paused: !!agentRuntimeManualPause,
      kill_switch_active: !!killSwitchState.active,
      session: gate.session,
      live_fresh_ok: !!gate.live_fresh_ok,
      live_file: publicLiveFileStatus(liveStatus),
    },
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

function generateFrames({ symbol, interval, limit, mode = 'mock', provider = 'runtime-api-generated' }) {
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
let replayBreadthSeries = []
let replayBreadthTimeline = []
let replayBreadthByTs = new Map()
let replayBreadthStatus = {
  file_path: REPLAY_BREADTH_PATH,
  last_load_ts_ms: null,
  last_error: null,
  source_kind: 'empty',
}
let dailyHistoryBatch = null
let agentRuntime = null
let replayEngine = null
let replayEngineTimer = null
let liveFileFrameProviderCn = null
let liveFileFrameProviderUs = null
let marketSessionGateTimer = null
let proactiveViewerTickTimer = null
let agentRuntimeManualPause = false
let marketSessionGateState = {
  enabled: true,
  auto_paused: false,
  auto_paused_at_ms: null,
  last_check_ms: null,
  running_trader_ids: [],
  active_trader_ids: [],
  markets: {
    'CN-A': null,
    US: null,
  },
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
let betsLedgerState = {
  schema_version: 'bets.ledger.v2',
  days: {},
  credits_by_session: {},
}
let ttsProfilesState = createDefaultTtsProfilesState()
const lastDecisionMetaByTraderId = new Map()
const roomEventSubscribersByRoom = new Map()
const roomEventBufferByRoom = new Map()
const roomEventSeqByRoom = new Map()
const roomEventBufferExpiryByRoom = new Map()
const roomPublicChatActivityByRoom = new Map()
const roomKeepaliveTimerByRoom = new Map()
const roomStreamPacketTimerByRoom = new Map()
const roomStreamPacketBuildStateByRoom = new Map()
const roomStreamPacketBuildGlobalStatsByRoom = new Map()
const proactiveEmitInFlightByRoom = new Map()
const proactiveBurstStateByRoom = new Map()
const proactiveGenerationStatsByRoom = new Map()
let proactiveLlmInFlight = 0
const proactiveViewerTickStateByRoom = new Map()
let proactiveViewerTickCursor = 0
const marketOverviewProviderCn = createLiveJsonFileProvider({
  filePath: MARKET_OVERVIEW_PATH_CN,
  refreshMs: MARKET_OVERVIEW_REFRESH_MS,
  staleAfterMs: MARKET_OVERVIEW_STALE_MS,
})
const marketOverviewProviderUs = createLiveJsonFileProvider({
  filePath: MARKET_OVERVIEW_PATH_US,
  refreshMs: MARKET_OVERVIEW_REFRESH_MS,
  staleAfterMs: MARKET_OVERVIEW_STALE_MS,
})
const newsDigestProviderCn = createLiveJsonFileProvider({
  filePath: NEWS_DIGEST_PATH_CN,
  refreshMs: NEWS_DIGEST_REFRESH_MS,
  staleAfterMs: NEWS_DIGEST_STALE_MS,
})
const newsDigestProviderUs = createLiveJsonFileProvider({
  filePath: NEWS_DIGEST_PATH_US,
  refreshMs: NEWS_DIGEST_REFRESH_MS,
  staleAfterMs: NEWS_DIGEST_STALE_MS,
})
const marketBreadthProviderCn = createLiveJsonFileProvider({
  filePath: MARKET_BREADTH_PATH_CN,
  refreshMs: MARKET_BREADTH_REFRESH_MS,
  staleAfterMs: MARKET_BREADTH_STALE_MS,
})
const marketBreadthProviderUs = createLiveJsonFileProvider({
  filePath: MARKET_BREADTH_PATH_US,
  refreshMs: MARKET_BREADTH_REFRESH_MS,
  staleAfterMs: MARKET_BREADTH_STALE_MS,
})
const chatNarrationStateByRoom = new Map()
const decisionLogStore = createDecisionLogStore({
  baseDir: path.join(ROOT_DIR, 'data', 'decisions'),
  timeZone: 'Asia/Shanghai',
})
const decisionAuditStore = createDecisionAuditStore({
  baseDir: path.join(ROOT_DIR, 'data', 'audit', 'decision_audit'),
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
    model: AGENT_OPENAI_MODEL,
    baseUrl: OPENAI_BASE_URL,
    timeoutMs: AGENT_LLM_TIMEOUT_MS,
    devTokenSaver: AGENT_LLM_DEV_TOKEN_SAVER,
    maxOutputTokens: AGENT_LLM_MAX_OUTPUT_TOKENS,
  })
  : null
const chatLlmResponder = CHAT_LLM_ENABLED
  ? createOpenAIChatResponder({
    apiKey: OPENAI_API_KEY,
    model: CHAT_OPENAI_MODEL,
    baseUrl: OPENAI_BASE_URL,
    timeoutMs: CHAT_LLM_TIMEOUT_MS,
    maxOutputTokens: CHAT_LLM_MAX_OUTPUT_TOKENS,
    maxTextLen: CHAT_MAX_TEXT_LEN,
  })
  : null

function toSafeNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function sortedFrames(frames) {
  return [...(frames || [])].sort((a, b) => toSafeNumber(a?.window?.start_ts_ms, 0) - toSafeNumber(b?.window?.start_ts_ms, 0))
}

function computeReturn(frames, lookback) {
  const series = sortedFrames(frames)
  const n = Math.max(0, Math.floor(toSafeNumber(lookback, 0)))
  if (series.length <= n) return null
  const latest = toSafeNumber(series[series.length - 1]?.bar?.close, NaN)
  const base = toSafeNumber(series[series.length - 1 - n]?.bar?.close, NaN)
  if (!Number.isFinite(latest) || !Number.isFinite(base) || base === 0) return null
  return round(latest / base - 1, 6)
}

function summarizeProxyWatchlist(proxy) {
  const rows = Array.isArray(proxy?.sample?.rows) ? proxy.sample.rows : []
  if (!rows.length) return ''
  const ret5 = rows.map((r) => Number(r?.ret_5)).filter(Number.isFinite)
  const ret20 = rows.map((r) => Number(r?.ret_20)).filter(Number.isFinite)
  const avg5 = ret5.length ? round(ret5.reduce((a, b) => a + b, 0) / ret5.length, 6) : null
  const avg20 = ret20.length ? round(ret20.reduce((a, b) => a + b, 0) / ret20.length, 6) : null
  const adv = ret5.filter((v) => v > 0).length
  const dec = ret5.filter((v) => v < 0).length
  const bits = []
  if (avg5 != null) bits.push(`5m均值${(avg5 * 100).toFixed(2)}%`)
  if (avg20 != null) bits.push(`20m均值${(avg20 * 100).toFixed(2)}%`)
  bits.push(`样本${rows.length}只（涨${adv}/跌${dec}）`)
  return bits.join('，')
}

function summarizeMarketOverviewPayload(payload, marketId) {
  if (!payload || typeof payload !== 'object') return ''
  if (typeof payload.summary === 'string' && payload.summary.trim()) {
    return payload.summary.trim().slice(0, 240)
  }

  const benchmarks = Array.isArray(payload.benchmarks) ? payload.benchmarks : []
  const sectors = Array.isArray(payload.sectors)
    ? payload.sectors
    : (Array.isArray(payload.industries) ? payload.industries : [])

  const bits = []
  if (benchmarks.length) {
    const top = [...benchmarks]
      .map((row) => ({
        symbol: String(row?.symbol || row?.ticker || '').trim(),
        ret_20: Number(row?.ret_20),
        ret_5: Number(row?.ret_5),
      }))
      .filter((row) => row.symbol)
      .sort((a, b) => (Number.isFinite(b.ret_20) ? b.ret_20 : (Number.isFinite(b.ret_5) ? b.ret_5 : 0))
        - (Number.isFinite(a.ret_20) ? a.ret_20 : (Number.isFinite(a.ret_5) ? a.ret_5 : 0)))
      .slice(0, 3)

    if (top.length) {
      const formatted = top.map((row) => {
        const v = Number.isFinite(row.ret_20) ? row.ret_20 : row.ret_5
        const pct = Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : ''
        return pct ? `${row.symbol}${v >= 0 ? '+' : ''}${pct}` : row.symbol
      }).join(' / ')
      bits.push(formatted)
    }
  }

  if (sectors.length) {
    const norm = sectors
      .map((row) => ({
        name: String(row?.name || row?.sector || row?.industry || '').trim(),
        ret_20: Number(row?.ret_20),
        ret_5: Number(row?.ret_5),
      }))
      .filter((row) => row.name)
    const leaders = [...norm]
      .sort((a, b) => (Number.isFinite(b.ret_20) ? b.ret_20 : b.ret_5) - (Number.isFinite(a.ret_20) ? a.ret_20 : a.ret_5))
      .slice(0, 2)
    const laggards = [...norm]
      .sort((a, b) => (Number.isFinite(a.ret_20) ? a.ret_20 : a.ret_5) - (Number.isFinite(b.ret_20) ? b.ret_20 : b.ret_5))
      .slice(0, 2)

    if (leaders.length) {
      bits.push(`强势：${leaders.map((r) => r.name).join('、')}`)
    }
    if (laggards.length) {
      bits.push(`偏弱：${laggards.map((r) => r.name).join('、')}`)
    }
  }

  const prefix = marketId === 'US' ? '美股' : 'A股'
  const out = bits.filter(Boolean).join('；')
  return out ? `${prefix}概览：${out}`.slice(0, 240) : ''
}

function extractNewsTitles(payload) {
  if (!payload || typeof payload !== 'object') return []
  const raw = Array.isArray(payload.headlines)
    ? payload.headlines
    : (Array.isArray(payload.items) ? payload.items : (Array.isArray(payload.news) ? payload.news : []))
  const titles = []
  for (const item of raw) {
    const title = String(item?.title || item?.headline || item?.text || '').trim()
    if (!title) continue
    titles.push(title)
    if (titles.length >= 16) break
  }
  return titles
}

function extractNewsCommentary(payload) {
  if (!payload || typeof payload !== 'object') return []
  const lines = Array.isArray(payload.commentary) ? payload.commentary : []
  return lines
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 12)
}

const DEFAULT_CASUAL_TOPICS = [
  '行情快的时候先放慢手速，别被情绪带节奏。',
  '先看风险再看收益，今天先把回撤守住。',
  '喝口水，深呼吸，再决定要不要出手。',
  '不确定就少做，这是职业交易员的耐心。',
  '控制仓位比猜涨跌更重要。',
  '连亏时先降频，先把状态找回来。',
  '今天先做高确定性机会，其他都可以放过。',
  '盘中也要留点余地，别一把梭哈。',
]

function shanghaiClockParts(tsMs = Date.now()) {
  const date = new Date(Number.isFinite(Number(tsMs)) ? Number(tsMs) : Date.now())
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const pick = (type) => String(parts.find((item) => item.type === type)?.value || '')
  const year = Number(pick('year') || 0)
  const month = Number(pick('month') || 0)
  const day = Number(pick('day') || 0)
  const hour = Number(pick('hour') || 0)
  const minute = Number(pick('minute') || 0)
  const second = Number(pick('second') || 0)
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  const ss = String(second).padStart(2, '0')
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hh}:${mm}:${ss}+08:00`
  const mins = hour * 60 + minute

  let dayPart = 'night'
  if (mins >= 330 && mins < 540) dayPart = 'early_morning'
  else if (mins >= 540 && mins < 690) dayPart = 'morning_session'
  else if (mins >= 690 && mins < 780) dayPart = 'lunch_break'
  else if (mins >= 780 && mins < 900) dayPart = 'afternoon_session'
  else if (mins >= 900 && mins < 1140) dayPart = 'evening'

  return {
    timezone: 'Asia/Shanghai',
    now_iso: iso,
    hhmm: `${hh}:${mm}`,
    minutes_since_midnight: mins,
    day_part: dayPart,
  }
}

function isTimeAwareChatTextAllowed(text, { tsMs = Date.now() } = {}) {
  const value = String(text || '').trim()
  if (!value) return false
  const dayPart = shanghaiClockParts(tsMs).day_part

  const nightLifePhrase = /(下班|晚饭|晚餐|夜宵|晚安|今晚|深夜|熬夜|睡觉|宵夜|收工)/i
  const morningOnlyPhrase = /(早安|早餐|刚起床|上班路上|早盘刚开|刚到公司)/i

  if (
    (dayPart === 'early_morning' || dayPart === 'morning_session' || dayPart === 'lunch_break' || dayPart === 'afternoon_session')
    && nightLifePhrase.test(value)
  ) {
    return false
  }

  if ((dayPart === 'evening' || dayPart === 'night') && morningOnlyPhrase.test(value)) {
    return false
  }

  return true
}

function filterTimeAwareCasualTopics(topics, { tsMs = Date.now(), limit = 8 } = {}) {
  const source = Array.isArray(topics) ? topics : []
  const filtered = source
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => isTimeAwareChatTextAllowed(item, { tsMs }))

  if (filtered.length > 0) {
    return filtered.slice(0, Math.max(1, Math.floor(Number(limit) || 8)))
  }

  return DEFAULT_CASUAL_TOPICS.slice(0, Math.max(1, Math.floor(Number(limit) || 8)))
}

function simpleHash(value) {
  const text = String(value || '')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function rotatePoolByKey(pool, key, limit = 8) {
  const rows = Array.isArray(pool) ? pool.map((item) => String(item || '').trim()).filter(Boolean) : []
  if (!rows.length) return []
  const maxLen = Math.max(1, Math.floor(Number(limit) || 8))
  const shift = simpleHash(key) % rows.length
  const rotated = rows.slice(shift).concat(rows.slice(0, shift))
  return rotated.slice(0, Math.min(maxLen, rotated.length))
}

function extractCasualTopics(payload, { dayKey = '', limit = 8 } = {}) {
  const external = payload && typeof payload === 'object' && Array.isArray(payload.casual_prompts)
    ? payload.casual_prompts
    : []
  const merged = [...external, ...DEFAULT_CASUAL_TOPICS]
  return rotatePoolByKey(merged, dayKey || String(Date.now()), limit)
}

function compactSymbolHistorySummary(row) {
  const safe = row && typeof row === 'object' ? row : {}
  return {
    symbol: String(safe.symbol || '').trim().toUpperCase(),
    past_6m: String(safe.past_6m || '').trim().slice(0, 180),
    past_1m: String(safe.past_1m || '').trim().slice(0, 180),
    past_1w: String(safe.past_1w || '').trim().slice(0, 180),
    past_1d: String(safe.past_1d || '').trim().slice(0, 180),
    lines: Array.isArray(safe.lines)
      ? safe.lines.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
      : [],
  }
}

async function buildSymbolHistorySummaryForRoom({ trader, symbol, nowMs = Date.now() } = {}) {
  const safeSymbol = String(symbol || '').trim().toUpperCase()
  if (!safeSymbol || !trader) return null

  try {
    const dailyBatch = await marketDataService.getFrames({
      symbol: safeSymbol,
      interval: '1d',
      limit: 180,
    })
    const account = getAccount(trader.trader_id)
    const positions = getPositions(trader.trader_id)
    const marketSpec = getMarketSpecForExchange(trader.exchange_id)

    const context = buildAgentMarketContext({
      symbol: safeSymbol,
      asOfTsMs: Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now(),
      intradayBatch: { frames: [] },
      dailyBatch,
      positionState: buildPositionState({ symbol: safeSymbol, account, positions }),
      marketSpec,
    })

    const descriptions = context?.daily?.price_volume_descriptions || {}
    const lines = Array.isArray(context?.daily?.price_volume_reference_lines)
      ? context.daily.price_volume_reference_lines
      : []

    return compactSymbolHistorySummary({
      symbol: safeSymbol,
      past_6m: descriptions.past_6m,
      past_1m: descriptions.past_1m,
      past_1w: descriptions.past_1w,
      past_1d: descriptions.past_1d,
      lines,
    })
  } catch {
    return null
  }
}

function newsCategoryLabel(category) {
  const key = String(category || '').trim().toLowerCase()
  if (key === 'ai') return 'AI'
  if (key === 'geopolitics') return '地缘'
  if (key === 'global_macro') return '宏观'
  if (key === 'tech') return '科技'
  if (key === 'markets_cn') return '市场'
  return key || '其他'
}

function extractNewsCategorySummary(payload, normalizedHeadlines) {
  const categories = payload && typeof payload === 'object' && payload.categories && typeof payload.categories === 'object'
    ? payload.categories
    : null

  if (categories) {
    return Object.entries(categories)
      .map(([key, value]) => ({
        category: String(key || '').trim().toLowerCase(),
        count: Array.isArray(value) ? value.length : 0,
      }))
      .filter((item) => item.category)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((item) => ({
        category: item.category,
        label: newsCategoryLabel(item.category),
        count: item.count,
      }))
  }

  const counts = new Map()
  for (const item of Array.isArray(normalizedHeadlines) ? normalizedHeadlines : []) {
    const category = String(item?.category || '').trim().toLowerCase()
    if (!category) continue
    counts.set(category, Number(counts.get(category) || 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([category, count]) => ({
      category,
      label: newsCategoryLabel(category),
      count,
    }))
}

function normalizeMarketBreadth(payload) {
  const row = payload && typeof payload === 'object'
    ? (payload.breadth && typeof payload.breadth === 'object' ? payload.breadth : payload)
    : null
  if (!row) {
    return {
      advancers: null,
      decliners: null,
      unchanged: null,
      total: null,
      advancer_ratio: null,
      red_blue_ratio: null,
    }
  }

  const advancers = Number(row.advancers)
  const decliners = Number(row.decliners)
  const unchanged = Number(row.unchanged)
  const totalRaw = Number(row.total)
  const total = Number.isFinite(totalRaw)
    ? totalRaw
    : ([advancers, decliners, unchanged].every(Number.isFinite)
      ? (advancers + decliners + unchanged)
      : NaN)

  const advRatioRaw = Number(row.advancer_ratio)
  const redBlueRaw = Number(row.red_blue_ratio)
  const advancer_ratio = Number.isFinite(advRatioRaw)
    ? round(advRatioRaw, 6)
    : (Number.isFinite(total) && total > 0 && Number.isFinite(advancers)
      ? round(advancers / total, 6)
      : null)
  const red_blue_ratio = Number.isFinite(redBlueRaw)
    ? round(redBlueRaw, 6)
    : (Number.isFinite(advancers) && Number.isFinite(decliners) && decliners > 0
      ? round(advancers / decliners, 6)
      : null)

  return {
    advancers: Number.isFinite(advancers) ? Math.max(0, Math.floor(advancers)) : null,
    decliners: Number.isFinite(decliners) ? Math.max(0, Math.floor(decliners)) : null,
    unchanged: Number.isFinite(unchanged) ? Math.max(0, Math.floor(unchanged)) : null,
    total: Number.isFinite(total) ? Math.max(0, Math.floor(total)) : null,
    advancer_ratio,
    red_blue_ratio,
  }
}

function summarizeMarketBreadth(breadth, marketId) {
  const adv = Number(breadth?.advancers)
  const dec = Number(breadth?.decliners)
  const unc = Number(breadth?.unchanged)
  if (!Number.isFinite(adv) || !Number.isFinite(dec)) return ''
  const ratio = Number(breadth?.red_blue_ratio)
  const ratioText = Number.isFinite(ratio) ? `，红蓝比${ratio.toFixed(2)}` : ''
  const flatText = Number.isFinite(unc) ? `，平${Math.floor(unc)}` : ''
  const prefix = marketId === 'US' ? '美股' : 'A股'
  return `${prefix}红${Math.floor(adv)} 蓝${Math.floor(dec)}${flatText}${ratioText}`
}

function classifyChange(currentClose, prevClose) {
  const curr = Number(currentClose)
  const prev = Number(prevClose)
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return 0
  if (curr > prev) return 1
  if (curr < prev) return -1
  return 0
}

function upperBoundSortedNumbers(sortedRows, target) {
  let left = 0
  let right = sortedRows.length
  while (left < right) {
    const mid = Math.floor((left + right) / 2)
    if (sortedRows[mid] <= target) {
      left = mid + 1
    } else {
      right = mid
    }
  }
  return left
}

function buildReplayBreadthFromFrames(batch) {
  const frames = Array.isArray(batch?.frames) ? batch.frames : []
  if (!frames.length) return []

  const bySymbol = new Map()
  for (const frame of frames) {
    if (String(frame?.interval || '') !== '1m') continue
    const symbol = String(frame?.instrument?.symbol || frame?.symbol || '').trim().toUpperCase()
    const startTs = Number(frame?.window?.start_ts_ms)
    if (!symbol || !Number.isFinite(startTs)) continue
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, [])
    bySymbol.get(symbol).push(frame)
  }

  const countsByTs = new Map()
  for (const list of bySymbol.values()) {
    list.sort((a, b) => Number(a?.window?.start_ts_ms || 0) - Number(b?.window?.start_ts_ms || 0))
    let prevClose = null
    for (const frame of list) {
      const ts = Number(frame?.window?.start_ts_ms)
      const close = Number(frame?.bar?.close)
      if (!Number.isFinite(ts) || !Number.isFinite(close)) continue

      const change = prevClose == null ? 0 : classifyChange(close, prevClose)
      const row = countsByTs.get(ts) || {
        ts_ms: ts,
        trading_day: String(frame?.window?.trading_day || ''),
        advancers: 0,
        decliners: 0,
        unchanged: 0,
      }
      if (change > 0) row.advancers += 1
      else if (change < 0) row.decliners += 1
      else row.unchanged += 1
      countsByTs.set(ts, row)
      prevClose = close
    }
  }

  const timeline = Array.from(countsByTs.keys()).sort((a, b) => a - b)
  return timeline.map((ts) => {
    const row = countsByTs.get(ts)
    const adv = Number(row?.advancers || 0)
    const dec = Number(row?.decliners || 0)
    const unc = Number(row?.unchanged || 0)
    const total = adv + dec + unc
    return {
      ts_ms: ts,
      trading_day: String(row?.trading_day || ''),
      breadth: {
        advancers: adv,
        decliners: dec,
        unchanged: unc,
        total,
        advancer_ratio: total > 0 ? round(adv / total, 6) : null,
        red_blue_ratio: dec > 0 ? round(adv / dec, 6) : null,
      },
    }
  })
}

function installReplayBreadthSeries(series, sourceKind, loadTsMs = Date.now(), error = null) {
  const safeSeries = Array.isArray(series) ? series : []
  replayBreadthSeries = safeSeries
  replayBreadthTimeline = safeSeries
    .map((item) => Number(item?.ts_ms))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
  const nextMap = new Map()
  for (const item of safeSeries) {
    const ts = Number(item?.ts_ms)
    if (!Number.isFinite(ts)) continue
    nextMap.set(ts, normalizeMarketBreadth(item?.breadth || null))
  }
  replayBreadthByTs = nextMap
  replayBreadthStatus = {
    file_path: REPLAY_BREADTH_PATH,
    last_load_ts_ms: Number.isFinite(Number(loadTsMs)) ? Number(loadTsMs) : null,
    last_error: error ? String(error) : null,
    source_kind: sourceKind || 'empty',
  }
}

async function loadReplayBreadthBatch() {
  try {
    const content = await readFile(REPLAY_BREADTH_PATH, 'utf8')
    const parsed = JSON.parse(content)
    const series = Array.isArray(parsed?.series) ? parsed.series : []
    installReplayBreadthSeries(series, 'replay_file')
    return series
  } catch {
    const derived = buildReplayBreadthFromFrames(replayBatch)
    installReplayBreadthSeries(
      derived,
      derived.length ? 'replay_derived' : 'empty',
      Date.now(),
      derived.length ? null : 'replay_breadth_file_missing'
    )
    return derived
  }
}

function replayBreadthAtTs(tsMs) {
  const ts = Number(tsMs)
  if (!Number.isFinite(ts) || replayBreadthTimeline.length === 0) return null
  const direct = replayBreadthByTs.get(ts)
  if (direct) return direct
  const ub = upperBoundSortedNumbers(replayBreadthTimeline, ts)
  if (ub <= 0) return null
  const nearest = replayBreadthTimeline[ub - 1]
  return replayBreadthByTs.get(nearest) || null
}

const proxyOverviewCacheByMarket = new Map()
const proxyOverviewInFlightByMarket = new Map()

async function getProxyWatchlistOverview(marketId) {
  const market = marketId === 'US' ? 'US' : 'CN-A'
  const now = Date.now()
  const cached = proxyOverviewCacheByMarket.get(market)
  if (cached && now - toSafeNumber(cached.cached_at_ms, 0) < 30_000) {
    return cached
  }

  if (proxyOverviewInFlightByMarket.get(market)) {
    return proxyOverviewInFlightByMarket.get(market)
  }

  const promise = Promise.resolve().then(async () => {
    const exchangeId = market === 'US' ? 'sim-us' : 'sim-cn'
    const candidates = symbolList({ exchangeId }).map((item) => item.symbol).filter(Boolean)
    const sampleSymbols = candidates.slice(0, 8)
    const rows = []
    for (const symbol of sampleSymbols) {
      try {
        const batch = await marketDataService.getFrames({ symbol, interval: '1m', limit: 25 })
        const frames = Array.isArray(batch?.frames) ? batch.frames : []
        rows.push({
          symbol,
          ret_5: computeReturn(frames, 5),
          ret_20: computeReturn(frames, 20),
          last_bar_ts_ms: toSafeNumber(frames[frames.length - 1]?.event_ts_ms, null),
        })
      } catch {
        rows.push({ symbol, ret_5: null, ret_20: null, last_bar_ts_ms: null })
      }
    }

    const payload = {
      schema_version: 'market.overview.proxy_watchlist.v1',
      market,
      source_kind: 'proxy_watchlist',
      as_of_ts_ms: now,
      sample: {
        symbol_count: sampleSymbols.length,
        symbols: sampleSymbols,
        rows,
      },
    }

    const record = {
      payload,
      cached_at_ms: now,
    }
    proxyOverviewCacheByMarket.set(market, record)
    return record
  }).finally(() => {
    proxyOverviewInFlightByMarket.delete(market)
  })

  proxyOverviewInFlightByMarket.set(market, promise)
  return promise
}

async function getMarketOverviewSnapshot(marketId) {
  const market = marketId === 'US' ? 'US' : 'CN-A'
  const provider = market === 'US' ? marketOverviewProviderUs : marketOverviewProviderCn
  const payload = await provider.getPayload({ forceRefresh: false })
  const status = provider.getStatus()

  if (payload && status && status.stale === false && !status.last_error) {
    return {
      source_kind: 'benchmark',
      market,
      payload,
      status,
      brief: summarizeMarketOverviewPayload(payload, market),
    }
  }

  const proxy = await getProxyWatchlistOverview(market)
  const proxyPayload = proxy?.payload || null
  const brief = summarizeProxyWatchlist(proxyPayload)

  return {
    source_kind: 'proxy_watchlist',
    market,
    payload: proxyPayload,
    status,
    brief: brief ? `${market === 'US' ? '美股' : 'A股'}观察池：${brief}` : '',
  }
}

async function getNewsDigestSnapshot(marketId) {
  const market = marketId === 'US' ? 'US' : 'CN-A'
  const provider = market === 'US' ? newsDigestProviderUs : newsDigestProviderCn
  const payload = await provider.getPayload({ forceRefresh: false })
  const status = provider.getStatus()
  const titles = extractNewsTitles(payload)
  const headlines = normalizeDigestHeadlines(
    payload && typeof payload === 'object'
      ? (Array.isArray(payload.headlines)
        ? payload.headlines
        : (Array.isArray(payload.items) ? payload.items : (Array.isArray(payload.news) ? payload.news : [])))
      : []
  )
  const commentary = extractNewsCommentary(payload)
  const categories = extractNewsCategorySummary(payload, headlines)
  const burstSignal = CHAT_PROACTIVE_NEWS_BURST_ENABLED
    ? selectNewsBurstSignal({
      headlines,
      nowMs: Date.now(),
      freshWindowMs: CHAT_PROACTIVE_NEWS_BURST_FRESH_MS,
      minPriority: CHAT_PROACTIVE_NEWS_BURST_MIN_PRIORITY,
    })
    : null
  const dayKey = payload && typeof payload === 'object'
    ? String(payload.day_key || '').trim()
    : ''
  const casualTopics = extractCasualTopics(payload, { dayKey, limit: 8 })

  return {
    source_kind: payload ? 'digest_file' : 'empty',
    market,
    day_key: dayKey || null,
    titles,
    commentary,
    categories,
    casual_topics: casualTopics,
    burst_signal: burstSignal,
    status,
  }
}

async function getMarketBreadthSnapshot(marketId) {
  const market = marketId === 'US' ? 'US' : 'CN-A'

  if (market === 'CN-A' && RUNTIME_DATA_MODE === 'replay') {
    const replayTs = Number(replayEngine?.getStatus?.()?.current_ts_ms)
    const replayBreadth = replayBreadthAtTs(replayTs)
    if (replayBreadth) {
      return {
        source_kind: replayBreadthStatus?.source_kind || 'replay_derived',
        market,
        breadth: replayBreadth,
        status: {
          ...replayBreadthStatus,
          stale: false,
        },
        summary: summarizeMarketBreadth(replayBreadth, market),
      }
    }
  }

  const provider = market === 'US' ? marketBreadthProviderUs : marketBreadthProviderCn
  const payload = await provider.getPayload({ forceRefresh: false })
  const status = provider.getStatus()
  const breadth = normalizeMarketBreadth(payload)

  return {
    source_kind: payload ? 'breadth_file' : 'empty',
    market,
    breadth,
    status,
    summary: summarizeMarketBreadth(breadth, market),
  }
}

function buildDataReadinessSnapshotForRoom(trader, { nowMs = Date.now() } = {}) {
  const exchangeId = String(trader?.exchange_id || '').trim().toLowerCase()
  const market = exchangeId.includes('sim-us') ? 'US' : 'CN-A'
  const sessionNowMs = effectiveSessionNowMs({ fallbackNowMs: nowMs })
  const reasons = []
  let level = 'OK'

  if (RUNTIME_DATA_MODE === 'live_file') {
    const liveStatus = liveFileStatusForMarket(market)
    if (liveStatus?.last_error) {
      level = 'ERROR'
      reasons.push('live_file_error')
    } else if (liveStatus?.stale) {
      level = 'WARN'
      reasons.push('live_file_stale')
    }
  }

  const session = getMarketSessionStatusForExchange(exchangeId || (market === 'US' ? 'sim-us' : 'sim-cn'), sessionNowMs)
  if (session?.is_open === false) {
    if (level === 'OK') level = 'WARN'
    reasons.push('market_closed')
  }

  return {
    level,
    reasons,
    market,
    ts_ms: sessionNowMs,
  }
}

async function buildRoomChatContext(roomId, {
  overview = undefined,
  digest = undefined,
  breadth = undefined,
  latestDecision = null,
  nowMs = Date.now(),
} = {}) {
  const safeRoomId = String(roomId || '').trim()
  const trader = getTraderById(safeRoomId)
  const marketSpec = getMarketSpecForExchange(trader.exchange_id)
  const market = marketSpec.market
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()
  const sessionNowMs = effectiveSessionNowMs({ fallbackNowMs: now })
  const latest = latestDecision
    ? [latestDecision]
    : (agentRuntime?.getLatestDecisions?.(safeRoomId, 1) || [])
  const effectiveDecision = latest[0] || null
  const head = effectiveDecision?.decisions?.[0] || null
  const headSymbol = String(head?.symbol || '').trim().toUpperCase()
  let positionSharesOnSymbol = 0
  if (headSymbol) {
    const positions = getPositions(safeRoomId)
    const matched = positions.find((item) => String(item?.symbol || '').trim().toUpperCase() === headSymbol)
    positionSharesOnSymbol = Number.isFinite(Number(matched?.quantity)) ? Number(matched.quantity) : 0
  }

  let effectiveOverview = overview
  let effectiveDigest = digest
  let effectiveBreadth = breadth
  const needOverview = typeof effectiveOverview === 'undefined'
  const needDigest = typeof effectiveDigest === 'undefined'
  const needBreadth = typeof effectiveBreadth === 'undefined'
  if (needOverview || needDigest || needBreadth) {
    const [fetchedOverview, fetchedDigest, fetchedBreadth] = await Promise.all([
      needOverview ? getMarketOverviewSnapshot(market) : Promise.resolve(null),
      needDigest ? getNewsDigestSnapshot(market) : Promise.resolve(null),
      needBreadth ? getMarketBreadthSnapshot(market) : Promise.resolve(null),
    ])
    if (fetchedOverview) {
      effectiveOverview = fetchedOverview
      incrementRoomStreamPacketBuildStat(safeRoomId, 'context_overview_fetch_count')
    }
    if (fetchedDigest) {
      effectiveDigest = fetchedDigest
      incrementRoomStreamPacketBuildStat(safeRoomId, 'context_digest_fetch_count')
    }
    if (fetchedBreadth) {
      effectiveBreadth = fetchedBreadth
      incrementRoomStreamPacketBuildStat(safeRoomId, 'context_breadth_fetch_count')
    }
  }

  const symbolBrief = head
    ? (() => {
      const symbolMeta = resolveStockDisplay(headSymbol, trader?.exchange_id)
      return {
        symbol: symbolMeta.symbol || head.symbol || null,
        symbol_name: symbolMeta.name || null,
        symbol_display: symbolMeta.display || symbolMeta.symbol || head.symbol || null,
      action: head.action || null,
      confidence: head.confidence ?? null,
      reasoning: typeof head.reasoning === 'string' ? head.reasoning.slice(0, 120) : null,
      order_executed: head.executed === true,
      position_shares_on_symbol: Math.max(0, Math.floor(positionSharesOnSymbol)),
      }
    })()
    : null
  const historySymbol = String(symbolBrief?.symbol || headSymbol || '').trim().toUpperCase()
  const symbolHistorySummary = await buildSymbolHistorySummaryForRoom({
    trader,
    symbol: historySymbol,
    nowMs: sessionNowMs,
  })

  return {
    data_readiness: buildDataReadinessSnapshotForRoom(trader, { nowMs: sessionNowMs }),
    time_context: shanghaiClockParts(sessionNowMs),
    market_overview_brief: effectiveOverview?.brief || '',
    news_digest_titles: Array.isArray(effectiveDigest?.titles) ? effectiveDigest.titles : [],
    news_commentary: Array.isArray(effectiveDigest?.commentary) ? effectiveDigest.commentary : [],
    news_categories: Array.isArray(effectiveDigest?.categories) ? effectiveDigest.categories : [],
    casual_topics: filterTimeAwareCasualTopics(
      Array.isArray(effectiveDigest?.casual_topics)
        ? effectiveDigest.casual_topics
        : DEFAULT_CASUAL_TOPICS,
      { tsMs: sessionNowMs, limit: 8 }
    ),
    news_burst_signal: effectiveDigest?.burst_signal || null,
    market_breadth_summary: effectiveBreadth?.summary || '',
    market_breadth: effectiveBreadth?.breadth || null,
    symbol_brief: symbolBrief,
    symbol_history_summary: symbolHistorySummary,
    symbol_history_lines: Array.isArray(symbolHistorySummary?.lines)
      ? symbolHistorySummary.lines.slice(0, 4)
      : [],
  }
}

chatService = createChatService({
  store: chatStore,
  resolveRoomAgent: resolveRoomAgentForChat,
  resolveLatestDecision: (roomId) => {
    const latest = agentRuntime?.getLatestDecisions?.(roomId, 1) || []
    return latest[0] || null
  },
  resolveRoomContext: buildRoomChatContext,
  maxTextLen: CHAT_MAX_TEXT_LEN,
  rateLimitPerMin: CHAT_RATE_LIMIT_PER_MIN,
  publicPlainReplyRate: CHAT_PUBLIC_PLAIN_REPLY_RATE,
  proactivePublicIntervalMs: Math.max(10_000, Number(process.env.CHAT_PUBLIC_PROACTIVE_INTERVAL_MS || 18_000)),
  proactiveNewsBurstEnabled: CHAT_PROACTIVE_NEWS_BURST_ENABLED,
  proactiveNewsBurstIntervalMs: CHAT_PROACTIVE_NEWS_BURST_INTERVAL_MS,
  proactiveNewsBurstDurationMs: CHAT_PROACTIVE_NEWS_BURST_DURATION_MS,
  proactiveNewsBurstCooldownMs: CHAT_PROACTIVE_NEWS_BURST_COOLDOWN_MS,
  generateAgentMessageText: chatLlmResponder,
  enableProactiveOnRead: !CHAT_PROACTIVE_VIEWER_TICK_ENABLED,
  onPublicAppend: (roomId, payload) => {
    try {
      const safeRoomId = String(roomId || '').trim()
      const msg = payload?.message
      if (!safeRoomId || !msg) return
      try {
        const previous = roomPublicChatActivityByRoom.get(safeRoomId) || createDefaultRoomPublicChatActivity()
        roomPublicChatActivityByRoom.set(safeRoomId, {
          ...previous,
          last_public_append_ms: Number(msg?.created_ts_ms) || Date.now(),
        })
      } catch {
        // ignore
      }
      broadcastRoomEvent(safeRoomId, 'chat_public_append', {
        schema_version: 'room.chat_public_append.v1',
        room_id: safeRoomId,
        ts_ms: Date.now(),
        message: msg,
      })
    } catch {
      // ignore
    }
  },
})

function normalizeForProactiveDedupe(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，,。.!！?？:：;；~`'"“”‘’\-_=+()\[\]{}<>\/\\]/g, '')
    .trim()
}

function createDefaultRoomPublicChatActivity() {
  return {
    last_public_append_ms: 0,
    last_proactive_emit_ms: 0,
    recent_proactive_keys: [],
    recent_proactive_openers: [],
    recent_proactive_tones: [],
  }
}

function createDefaultProactiveGenerationStats() {
  return {
    llm_ok: 0,
    llm_empty: 0,
    llm_error: 0,
    llm_skipped_concurrency: 0,
    llm_unavailable: 0,
    fallback_used: 0,
    opener_reroll: 0,
    tone_counts: {
      calm: 0,
      focused: 0,
      energetic: 0,
      cautious: 0,
      neutral: 0,
    },
    last_source: null,
    last_reason: null,
    last_error: null,
    last_emit_ms: 0,
  }
}

function updateProactiveGenerationStats(roomId, updater) {
  const safeRoomId = String(roomId || '').trim()
  if (!safeRoomId) return
  const previous = proactiveGenerationStatsByRoom.get(safeRoomId) || createDefaultProactiveGenerationStats()
  const next = typeof updater === 'function' ? updater({ ...previous }) : previous
  proactiveGenerationStatsByRoom.set(safeRoomId, next || previous)
}

function getProactiveGenerationStatsPublicSnapshot() {
  const perRoom = {}
  const totals = createDefaultProactiveGenerationStats()
  for (const trader of getRegisteredTraders()) {
    const roomId = String(trader?.trader_id || '').trim()
    if (!roomId) continue
    const stats = proactiveGenerationStatsByRoom.get(roomId) || createDefaultProactiveGenerationStats()
    perRoom[roomId] = {
      ...stats,
      tone_counts: { ...stats.tone_counts },
    }
    totals.llm_ok += Number(stats.llm_ok || 0)
    totals.llm_empty += Number(stats.llm_empty || 0)
    totals.llm_error += Number(stats.llm_error || 0)
    totals.llm_skipped_concurrency += Number(stats.llm_skipped_concurrency || 0)
    totals.llm_unavailable += Number(stats.llm_unavailable || 0)
    totals.fallback_used += Number(stats.fallback_used || 0)
    totals.opener_reroll += Number(stats.opener_reroll || 0)
    for (const toneKey of Object.keys(totals.tone_counts)) {
      totals.tone_counts[toneKey] += Number(stats.tone_counts?.[toneKey] || 0)
    }
    if ((stats.last_emit_ms || 0) > (totals.last_emit_ms || 0)) {
      totals.last_emit_ms = Number(stats.last_emit_ms || 0)
      totals.last_source = stats.last_source || null
      totals.last_reason = stats.last_reason || null
      totals.last_error = stats.last_error || null
    }
  }
  return {
    totals,
    by_room: perRoom,
  }
}

function sanitizeTtsText(value, { maxChars = CHAT_TTS_MAX_CHARS } = {}) {
  const text = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!text) return ''
  return text.slice(0, Math.max(24, Math.floor(Number(maxChars) || CHAT_TTS_MAX_CHARS))).trim()
}

function ttsContentType(format) {
  const key = String(format || '').trim().toLowerCase()
  if (key === 'wav') return 'audio/wav'
  if (key === 'raw') return 'audio/raw'
  if (key === 'opus') return 'audio/ogg'
  if (key === 'aac') return 'audio/aac'
  if (key === 'flac') return 'audio/flac'
  return 'audio/mpeg'
}

function clampTtsSpeed(value, fallback = CHAT_TTS_SPEED) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    const safeFallback = Number(fallback)
    if (Number.isFinite(safeFallback)) return Math.max(0.25, Math.min(safeFallback, 4))
    return 1
  }
  return Math.max(0.25, Math.min(parsed, 4))
}

function normalizeTtsProvider(value, fallback = CHAT_TTS_PROVIDER_DEFAULT) {
  const provider = String(value || '').trim().toLowerCase()
  if (provider === 'selfhosted') return 'selfhosted'
  if (provider === 'openai') return 'openai'
  if (!fallback) return ''
  return fallback === 'selfhosted' ? 'selfhosted' : 'openai'
}

function normalizeTtsFallbackProvider(value, fallback = 'none') {
  const provider = String(value || '').trim().toLowerCase()
  if (provider === 'openai') return 'openai'
  if (provider === 'none') return 'none'
  return fallback === 'openai' ? 'openai' : 'none'
}

function ttsVoiceEnvKeyByTraderId(traderId) {
  const safe = String(traderId || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
  return safe ? `CHAT_TTS_VOICE_${safe}` : ''
}

function ttsSelfHostedVoiceEnvKeyByTraderId(traderId) {
  const safe = String(traderId || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
  return safe ? `CHAT_TTS_SELFHOSTED_VOICE_${safe}` : ''
}

function normalizeTtsTone(value) {
  const tone = String(value || '').trim().toLowerCase()
  if (tone === 'calm' || tone === 'focused' || tone === 'energetic' || tone === 'cautious') {
    return tone
  }
  return ''
}

function alternateTtsVoice(baseVoice) {
  const voice = String(baseVoice || '').trim()
  if (!voice) return ''
  if (voice === CHAT_TTS_VOICE_FEMALE_1) return CHAT_TTS_VOICE_FEMALE_2
  if (voice === CHAT_TTS_VOICE_FEMALE_2) return CHAT_TTS_VOICE_FEMALE_1
  if (voice === CHAT_TTS_VOICE_MALE_1) return CHAT_TTS_VOICE_MALE_2
  if (voice === CHAT_TTS_VOICE_MALE_2) return CHAT_TTS_VOICE_MALE_1
  return ''
}

function resolveTtsVoiceForTraderId(traderId) {
  const safeTraderId = String(traderId || '').trim().toLowerCase()
  const dynamicKey = ttsVoiceEnvKeyByTraderId(safeTraderId)
  const dynamicVoice = dynamicKey ? String(process.env[dynamicKey] || '').trim() : ''
  if (dynamicVoice) return dynamicVoice

  if (safeTraderId === 't_003') return CHAT_TTS_VOICE_FEMALE_1
  if (safeTraderId === 't_004') return CHAT_TTS_VOICE_FEMALE_2
  if (safeTraderId === 't_001') return CHAT_TTS_VOICE_MALE_1
  if (safeTraderId === 't_002') return CHAT_TTS_VOICE_MALE_2
  if (safeTraderId === 'us_001') return CHAT_TTS_VOICE_MALE_1
  if (safeTraderId === 'us_002') return CHAT_TTS_VOICE_FEMALE_1
  return CHAT_TTS_VOICE_FEMALE_1
}

function resolveSelfHostedTtsVoiceForTraderId(traderId) {
  const safeTraderId = String(traderId || '').trim().toLowerCase()
  const dynamicKey = ttsSelfHostedVoiceEnvKeyByTraderId(safeTraderId)
  const dynamicVoice = dynamicKey ? String(process.env[dynamicKey] || '').trim() : ''
  if (dynamicVoice) return dynamicVoice
  return CHAT_TTS_SELFHOSTED_VOICE_DEFAULT
}

function resolveTtsProfileForMessage({ traderId, tone = '', seed = '' } = {}) {
  void tone
  const baseVoice = resolveTtsVoiceForTraderId(traderId)
  const safeSeed = String(seed || '').trim() || String(traderId || 'room').trim() || 'room'
  const derivedTone = 'energetic'
  const baseSpeed = Number(CHAT_TTS_TONE_SPEED_ENERGETIC || CHAT_TTS_SPEED || 1)
  const speedJitter = ((simpleHash(`${safeSeed}|tts-energy`) % 5) - 2) * 0.01
  const speed = Number(baseSpeed) + speedJitter
  return {
    tone: derivedTone,
    voice: baseVoice,
    speed: Number.isFinite(speed) ? Math.max(0.25, Math.min(speed, 4)) : 1,
  }
}

function createDefaultTtsProfilesState() {
  return {
    schema_version: 'chat.tts.profile.v1',
    global_default_provider: CHAT_TTS_PROVIDER_DEFAULT,
    rooms: {},
    updated_ts_ms: Date.now(),
  }
}

function normalizeTtsRoomOverride(value) {
  if (!value || typeof value !== 'object') return null
  const provider = normalizeTtsProvider(value.provider, '')
  if (provider !== 'openai' && provider !== 'selfhosted') return null

  const voice = String(value.voice || '').trim()
  let speed = null
  if (value.speed !== null && value.speed !== undefined && String(value.speed).trim() !== '') {
    const parsedSpeed = Number(value.speed)
    speed = Number.isFinite(parsedSpeed) ? clampTtsSpeed(parsedSpeed, CHAT_TTS_SPEED) : null
  }
  const fallbackProvider = normalizeTtsFallbackProvider(value.fallback_provider, provider === 'selfhosted' ? 'openai' : 'none')

  return {
    provider,
    voice,
    speed,
    fallback_provider: fallbackProvider,
    updated_ts_ms: Number.isFinite(Number(value.updated_ts_ms)) ? Number(value.updated_ts_ms) : Date.now(),
  }
}

function normalizeTtsProfilesState(value) {
  const fallback = createDefaultTtsProfilesState()
  if (!value || typeof value !== 'object') return fallback

  const rooms = {}
  if (value.rooms && typeof value.rooms === 'object') {
    for (const [roomIdRaw, row] of Object.entries(value.rooms)) {
      const roomId = String(roomIdRaw || '').trim().toLowerCase()
      if (!roomId) continue
      const normalized = normalizeTtsRoomOverride(row)
      if (!normalized) continue
      rooms[roomId] = normalized
    }
  }

  return {
    schema_version: 'chat.tts.profile.v1',
    global_default_provider: normalizeTtsProvider(value.global_default_provider, CHAT_TTS_PROVIDER_DEFAULT),
    rooms,
    updated_ts_ms: Number.isFinite(Number(value.updated_ts_ms)) ? Number(value.updated_ts_ms) : Date.now(),
  }
}

function ttsProviderCapabilities() {
  return {
    openai: {
      enabled: CHAT_TTS_ENABLED && !!OPENAI_API_KEY,
      model: CHAT_TTS_MODEL,
      response_format: CHAT_TTS_RESPONSE_FORMAT,
    },
    selfhosted: {
      enabled: CHAT_TTS_ENABLED && !!CHAT_TTS_SELFHOSTED_URL,
      model: 'selfhosted',
      response_format: CHAT_TTS_SELFHOSTED_MEDIA_TYPE,
      timeout_ms: CHAT_TTS_SELFHOSTED_TIMEOUT_MS,
      endpoint: CHAT_TTS_SELFHOSTED_URL,
    },
  }
}

function isTtsProviderEnabled(provider) {
  const capabilities = ttsProviderCapabilities()
  if (provider === 'selfhosted') return !!capabilities.selfhosted.enabled
  return !!capabilities.openai.enabled
}

function effectiveTtsDefaultProvider() {
  const preferred = normalizeTtsProvider(ttsProfilesState.global_default_provider, CHAT_TTS_PROVIDER_DEFAULT)
  if (isTtsProviderEnabled(preferred)) return preferred
  if (isTtsProviderEnabled('openai')) return 'openai'
  if (isTtsProviderEnabled('selfhosted')) return 'selfhosted'
  return preferred
}

function knownTtsRoomIds() {
  const ids = new Set()
  for (const trader of DEFAULT_TRADERS) {
    const roomId = String(trader?.trader_id || '').trim().toLowerCase()
    if (roomId) ids.add(roomId)
  }
  for (const trader of getRegisteredTraders()) {
    const roomId = String(trader?.trader_id || '').trim().toLowerCase()
    if (roomId) ids.add(roomId)
  }
  for (const roomId of Object.keys(ttsProfilesState.rooms || {})) {
    const safeRoomId = String(roomId || '').trim().toLowerCase()
    if (safeRoomId) ids.add(safeRoomId)
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

function resolveDefaultVoiceByProvider({ provider, roomId, tone = '', seed = '' } = {}) {
  if (provider === 'selfhosted') {
    return resolveSelfHostedTtsVoiceForTraderId(roomId)
  }
  const openAiProfile = resolveTtsProfileForMessage({ traderId: roomId, tone, seed: seed || roomId })
  return openAiProfile.voice
}

function resolveEffectiveTtsProfileForRoom({ roomId, tone = '', seed = '' } = {}) {
  const safeRoomId = String(roomId || '').trim().toLowerCase()
  const openAiProfile = resolveTtsProfileForMessage({
    traderId: safeRoomId,
    tone,
    seed: seed || safeRoomId,
  })
  const defaultProvider = effectiveTtsDefaultProvider()
  const defaultFallback = defaultProvider === 'selfhosted' ? 'openai' : 'none'
  const override = safeRoomId ? normalizeTtsRoomOverride(ttsProfilesState.rooms?.[safeRoomId]) : null

  const provider = normalizeTtsProvider(override?.provider, defaultProvider)
  const hasOverrideSpeed = override
    && override.speed !== null
    && override.speed !== undefined
    && String(override.speed).trim() !== ''
  const speed = hasOverrideSpeed
    ? clampTtsSpeed(override.speed, openAiProfile.speed)
    : openAiProfile.speed
  const voice = String(override?.voice || '').trim() || resolveDefaultVoiceByProvider({
    provider,
    roomId: safeRoomId,
    tone,
    seed: seed || safeRoomId,
  })
  const fallbackProvider = normalizeTtsFallbackProvider(override?.fallback_provider, defaultFallback)

  return {
    room_id: safeRoomId,
    provider,
    voice,
    speed,
    tone: openAiProfile.tone,
    fallback_provider: fallbackProvider,
    default_provider: defaultProvider,
    model: provider === 'selfhosted' ? 'selfhosted' : CHAT_TTS_MODEL,
    response_format: provider === 'selfhosted' ? CHAT_TTS_SELFHOSTED_MEDIA_TYPE : CHAT_TTS_RESPONSE_FORMAT,
    override,
  }
}

function ttsVoicesSummary() {
  const summary = {}
  for (const roomId of knownTtsRoomIds()) {
    const profile = resolveEffectiveTtsProfileForRoom({ roomId, seed: roomId })
    summary[roomId] = profile.voice
  }
  return summary
}

function ttsRoomProfilesSummary() {
  const summary = {}
  for (const roomId of knownTtsRoomIds()) {
    const profile = resolveEffectiveTtsProfileForRoom({ roomId, seed: roomId })
    summary[roomId] = {
      provider: profile.provider,
      voice: profile.voice,
      speed: profile.speed,
      fallback_provider: profile.fallback_provider,
      model: profile.model,
      response_format: profile.response_format,
      has_override: !!profile.override,
    }
  }
  return summary
}

async function persistTtsProfilesState() {
  const dir = path.dirname(CHAT_TTS_PROFILE_PATH)
  await mkdir(dir, { recursive: true })
  const tmpPath = `${CHAT_TTS_PROFILE_PATH}.tmp`
  await writeFile(tmpPath, JSON.stringify(ttsProfilesState, null, 2), 'utf8')
  await rename(tmpPath, CHAT_TTS_PROFILE_PATH)
}

async function loadTtsProfilesState() {
  try {
    const raw = await readFile(CHAT_TTS_PROFILE_PATH, 'utf8')
    ttsProfilesState = normalizeTtsProfilesState(JSON.parse(raw))
  } catch {
    ttsProfilesState = createDefaultTtsProfilesState()
  }
}

async function synthesizeOpenAITts({ text, voice, speed = CHAT_TTS_SPEED }) {
  const endpoint = `${String(OPENAI_BASE_URL).replace(/\/$/, '')}/audio/speech`
  const safeSpeed = clampTtsSpeed(speed, CHAT_TTS_SPEED)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: CHAT_TTS_MODEL,
      voice,
      input: text,
      response_format: CHAT_TTS_RESPONSE_FORMAT,
      speed: safeSpeed,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`openai_tts_http_${response.status}:${String(errText || '').slice(0, 160)}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  if (!arrayBuffer || arrayBuffer.byteLength <= 0) {
    throw new Error('openai_tts_empty_audio')
  }

  return {
    audioBuffer: Buffer.from(arrayBuffer),
    contentType: ttsContentType(CHAT_TTS_RESPONSE_FORMAT),
    model: CHAT_TTS_MODEL,
    response_format: CHAT_TTS_RESPONSE_FORMAT,
  }
}

function buildSelfHostedTtsPayload({ text, voice, speed }) {
  const safeText = (() => {
    const base = String(text || '').trim()
    if (base.length >= 10) return base
    const padded = `${base}。继续关注盘面变化。`.trim()
    return padded.slice(0, Math.max(24, CHAT_TTS_MAX_CHARS))
  })()

  return {
    text: safeText,
    text_lang: 'zh',
    prompt_lang: 'zh',
    top_k: 30,
    top_p: 1,
    temperature: 1,
    text_split_method: 'cut5',
    batch_size: 32,
    batch_threshold: 0.75,
    split_bucket: true,
    speed_factor: clampTtsSpeed(speed, CHAT_TTS_SPEED),
    media_type: CHAT_TTS_SELFHOSTED_MEDIA_TYPE,
    streaming_mode: true,
    seed: 100,
    parallel_infer: true,
    repetition_penalty: 1.35,
    sample_steps: 32,
    super_sampling: false,
    sample_rate: 32000,
    fragment_interval: 0.01,
    voice_id: String(voice || '').trim() || CHAT_TTS_SELFHOSTED_VOICE_DEFAULT,
  }
}

async function synthesizeSelfHostedTts({ text, voice, speed = CHAT_TTS_SPEED }) {
  if (!CHAT_TTS_SELFHOSTED_URL) {
    throw new Error('selfhosted_tts_unavailable')
  }

  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), CHAT_TTS_SELFHOSTED_TIMEOUT_MS)
  let response
  try {
    response = await fetch(CHAT_TTS_SELFHOSTED_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildSelfHostedTtsPayload({ text, voice, speed })),
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`selfhosted_tts_timeout_${CHAT_TTS_SELFHOSTED_TIMEOUT_MS}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeoutHandle)
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`selfhosted_tts_http_${response.status}:${String(errText || '').slice(0, 160)}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  if (!arrayBuffer || arrayBuffer.byteLength <= 0) {
    throw new Error('selfhosted_tts_empty_audio')
  }

  return {
    audioBuffer: Buffer.from(arrayBuffer),
    contentType: String(response.headers.get('content-type') || '').trim() || ttsContentType(CHAT_TTS_SELFHOSTED_MEDIA_TYPE),
    model: 'selfhosted',
    response_format: CHAT_TTS_SELFHOSTED_MEDIA_TYPE,
  }
}

async function synthesizeTtsWithProviderRouting({ roomId, text, tone = '', seed = '', profile = null } = {}) {
  const effectiveProfile = profile || resolveEffectiveTtsProfileForRoom({
    roomId,
    tone,
    seed,
  })
  const requestedProvider = normalizeTtsProvider(effectiveProfile.provider, effectiveTtsDefaultProvider())
  const fallbackProvider = normalizeTtsFallbackProvider(
    effectiveProfile.fallback_provider,
    requestedProvider === 'selfhosted' ? 'openai' : 'none'
  )
  const providerOrder = [requestedProvider]
  if (fallbackProvider !== 'none' && fallbackProvider !== requestedProvider) {
    providerOrder.push(fallbackProvider)
  }

  const openAiFallbackProfile = resolveTtsProfileForMessage({
    traderId: roomId,
    tone,
    seed: seed || roomId,
  })
  const errors = []

  for (const provider of providerOrder) {
    if (!isTtsProviderEnabled(provider)) {
      errors.push(`${provider}:provider_unavailable`)
      continue
    }

    const voice = provider === requestedProvider
      ? String(effectiveProfile.voice || '').trim()
      : resolveDefaultVoiceByProvider({ provider, roomId, tone, seed: seed || roomId })
    const speed = provider === requestedProvider
      ? clampTtsSpeed(effectiveProfile.speed, CHAT_TTS_SPEED)
      : clampTtsSpeed(openAiFallbackProfile.speed, CHAT_TTS_SPEED)

    try {
      const synthesis = provider === 'selfhosted'
        ? await synthesizeSelfHostedTts({ text, voice, speed })
        : await synthesizeOpenAITts({ text, voice, speed })

      return {
        ...synthesis,
        provider,
        voice,
        speed,
        requested_provider: requestedProvider,
        fallback_used: provider !== requestedProvider,
      }
    } catch (error) {
      errors.push(`${provider}:${String(error?.message || 'tts_failed')}`)
    }
  }

  throw new Error(`chat_tts_dispatch_failed:${errors.join('|').slice(0, 240)}`)
}

function pickFromPool(pool, seed, fallback = '') {
  const rows = Array.isArray(pool) ? pool.map((item) => String(item || '').trim()).filter(Boolean) : []
  if (!rows.length) return String(fallback || '')
  return rows[simpleHash(seed) % rows.length] || String(fallback || '')
}

function proactiveOpenerStem(value) {
  const text = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  const firstClause = text.split(/[，,。.!！?？:：;]/)[0] || text
  return firstClause
    .replace(/\b\d{6}\.(?:SZ|SH)\b/gi, '股票')
    .replace(/[0-9A-Z_.-]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 14)
}

function chooseProactiveTone({ action, burstSignal, riskProfile, previousTones, seed }) {
  const base = []
  const safeRisk = String(riskProfile || '').trim().toLowerCase()
  if (burstSignal) {
    base.push('focused', 'energetic')
  }
  if (action === 'SELL') {
    base.push('cautious', 'focused', 'calm')
  } else if (action === 'BUY') {
    if (safeRisk === 'aggressive') {
      base.push('energetic', 'focused')
    } else {
      base.push('focused', 'calm')
    }
  } else {
    base.push(safeRisk === 'conservative' ? 'cautious' : 'calm', 'focused')
  }
  base.push('calm', 'focused', 'energetic', 'cautious')
  const uniq = []
  for (const tone of base) {
    if (!uniq.includes(tone)) uniq.push(tone)
  }
  const recent = Array.isArray(previousTones)
    ? previousTones.map((item) => String(item || '').trim()).filter(Boolean).slice(-2)
    : []
  const preferred = uniq.filter((tone) => !recent.includes(tone))
  const pool = preferred.length ? preferred : uniq
  return pickFromPool(pool, seed, 'calm')
}

function fallbackProactiveText({ roomContext, latestDecision, roomAgent, previousActivity, salt = '' }) {
  const now = Date.now()
  const seedBase = `${now}|${String(salt || '')}`
  const symbolBrief = roomContext?.symbol_brief || null
  const marketBrief = String(roomContext?.market_overview_brief || '').trim()
  const breadthSummary = String(roomContext?.market_breadth_summary || '').trim()
  const burstSignal = roomContext?.news_burst_signal || null
  const newsTitles = Array.isArray(roomContext?.news_digest_titles)
    ? roomContext.news_digest_titles.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 16)
    : []
  const casualTopics = Array.isArray(roomContext?.casual_topics)
    ? roomContext.casual_topics.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 10)
    : []

  const head = latestDecision?.decisions?.[0] || null
  const symbolCode = String(symbolBrief?.symbol || head?.symbol || '').trim().toUpperCase()
  const symbolName = String(symbolBrief?.symbol_name || '').trim()
  const symbolReadable = symbolName || symbolCode
  const symbolDisplay = symbolName && symbolCode && (simpleHash(`${seedBase}|symbol-display|${symbolCode}`) % 6 === 0)
    ? `${symbolName}(${symbolCode})`
    : symbolReadable
  const symbol = symbolDisplay
  const action = String(symbolBrief?.action || head?.action || 'hold').trim().toUpperCase()
  const riskProfile = String(roomAgent?.riskProfile || '').trim().toLowerCase()
  const tone = chooseProactiveTone({
    action,
    burstSignal,
    riskProfile,
    previousTones: previousActivity?.recent_proactive_tones,
    seed: `${seedBase}|tone|${symbolCode || symbol}|${action}|${riskProfile}`,
  })

  const marketLine = marketBrief
    ? marketBrief.slice(0, 42)
    : (breadthSummary ? breadthSummary.slice(0, 30) : '指数震荡，热点轮动')

  const topic = burstSignal?.title
    ? String(burstSignal.title).trim().slice(0, 26)
    : pickFromPool(newsTitles, `${seedBase}|topic`, '').slice(0, 26)
  const casual = pickFromPool(casualTopics, `${seedBase}|casual`, '').slice(0, 26)

  const holdTemplatesByTone = {
    calm: [
      symbol ? `${symbol}我先放在观察位，等下一次共振再确认。` : '这轮先稳住手速，等信号更整齐再动。',
      symbol ? `先看${symbol}的确认K线，不急着抢一步。` : '先看盘面共振，不在噪音里频繁切换。',
      symbol ? `${symbol}这边保持耐心，先让结构走清楚。` : '先把节奏放慢，高确定性机会再出手。',
    ],
    focused: [
      symbol ? `我继续盯${symbol}的量价配合，确认后再执行。` : '我先对齐信号和风险，再决定动作。',
      symbol ? `${symbol}先跟踪关键位，突破确认才推进。` : '我先看关键位是否站稳，再做下一步。',
      symbol ? `当前${symbol}先观察，不满足条件就继续等待。` : '信号没齐之前我先按计划等待。',
    ],
    energetic: [
      symbol ? `${symbol}这波有节奏感，但我先等确认再提速。` : '节奏开始加快，我先等确认再提速。',
      symbol ? `这轮${symbol}先盯住盘口变化，机会出来就跟。` : '盘口在提速，我会盯住第一波有效信号。',
      symbol ? `${symbol}先看下一根是否延续，确认再上动作。` : '节奏偏快，我先确认再执行。',
    ],
    cautious: [
      symbol ? `${symbol}先以风控为先，信号不够就继续观望。` : '先把风险放第一位，宁可慢半拍。',
      symbol ? `这轮${symbol}先防回撤，确认后再考虑参与。` : '先守回撤线，确认后再考虑动作。',
      symbol ? `${symbol}先做防守观察，不急着增加敞口。` : '先防守，等更清晰的入场条件。',
    ],
  }
  const buyTemplatesByTone = {
    calm: [
      symbol ? `${symbol}偏多但不追高，我会等回踩确认再跟。` : '偏多思路不变，等更舒服的位置推进。',
      symbol ? `我对${symbol}保持顺势视角，仓位会循序增加。` : '顺势为主，先小步推进。',
      symbol ? `${symbol}若延续量能，我会按计划逐步跟进。` : '量能延续再加速，先按计划执行。',
    ],
    focused: [
      symbol ? `${symbol}若突破关键位并放量，我会直接跟随。` : '突破+放量才执行，不满足就等待。',
      symbol ? `我盯${symbol}的延续确认，条件满足就推进。` : '我盯延续确认，条件到位立即执行。',
      symbol ? `${symbol}这边看多，但必须看到结构确认。` : '看多但先要结构确认。',
    ],
    energetic: [
      symbol ? `${symbol}节奏在变快，确认后我会果断推进。` : '节奏在提速，确认后我会果断执行。',
      symbol ? `这轮${symbol}如果继续放量，我会积极跟上。` : '量能继续放大我就积极跟上。',
      symbol ? `${symbol}只要不破关键位，我会继续顺势推进。` : '只要结构不破，我会继续顺势。',
    ],
    cautious: [
      symbol ? `${symbol}方向偏多，但我会把止损线放前面。` : '偏多但先把风险边界锁住。',
      symbol ? `我会先小仓试探${symbol}，确认后再加。` : '先小仓试探，确认后再加。',
      symbol ? `${symbol}若冲高乏力我就不追，等回踩再说。` : '冲高不追，回踩确认再处理。',
    ],
  }
  const sellTemplatesByTone = {
    calm: [
      symbol ? `${symbol}这里先收缩风险，反弹力度不足就继续减。` : '先降风险，反弹无力就继续收。',
      symbol ? `我先降低${symbol}仓位，等结构稳定再评估。` : '先降仓，等结构稳定后再看。',
      symbol ? `${symbol}这轮优先兑现，回撤控制放第一位。` : '先兑现一部分，把回撤控制住。',
    ],
    focused: [
      symbol ? `${symbol}失守关键位我会继续减仓，不犹豫。` : '关键位失守就继续减仓。',
      symbol ? `我先盯${symbol}反抽强度，弱反弹就不恋战。` : '弱反弹不恋战，优先防守。',
      symbol ? `${symbol}先防守，等下一个稳定结构再考虑回补。` : '先防守，等稳定结构再说。',
    ],
    energetic: [
      symbol ? `${symbol}这边我先快速降风险，先退出拥挤区。` : '先快速降风险，离开拥挤区。',
      symbol ? `这轮${symbol}我会偏快处理，避免回撤放大。` : '这轮偏快处理，避免回撤扩大。',
      symbol ? `${symbol}冲高承接弱的话，我会直接收缩仓位。` : '冲高承接弱就直接收缩仓位。',
    ],
    cautious: [
      symbol ? `${symbol}先把风险敞口降下来，再观察反弹质量。` : '先降敞口，再看反弹质量。',
      symbol ? `${symbol}这里先防守，不做情绪化硬扛。` : '先防守，不做情绪化硬扛。',
      symbol ? `我会先守住止损纪律，${symbol}不强就继续减。` : '先守止损纪律，不强就继续减。',
    ],
  }

  const holdPool = holdTemplatesByTone[tone] || holdTemplatesByTone.calm
  const buyPool = buyTemplatesByTone[tone] || buyTemplatesByTone.calm
  const sellPool = sellTemplatesByTone[tone] || sellTemplatesByTone.calm
  const actionPool = action === 'BUY' ? buyPool : (action === 'SELL' ? sellPool : holdPool)
  const actionLine = pickFromPool(actionPool, `${seedBase}|action|${symbolCode || symbol}|${action}|${tone}`, holdPool[0])

  const compactMarketLine = String(marketLine || '')
    .replace(/^A股概览：/, 'A股')
    .replace(/^美股概览：/, '美股')
    .replace(/\b[0-9]{6}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
  const normalizedMarketLine = /\d{3,}|\//.test(compactMarketLine)
    ? '指数窄幅震荡，热点轮动'
    : (compactMarketLine || '指数震荡，等待方向')

  const marketTemplates = [
    `盘面节奏是：${normalizedMarketLine}。`,
    `当前市场状态：${normalizedMarketLine}。`,
    `盘口给我的感觉是：${normalizedMarketLine}。`,
    `今天盘面主线偏${normalizedMarketLine}。`,
    `市场侧重点看起来是${normalizedMarketLine}。`,
    `资金节奏上，${normalizedMarketLine}。`,
    `我这边看到的盘面是${normalizedMarketLine}。`,
    `短线环境大概是${normalizedMarketLine}。`,
  ]
  const marketLineText = pickFromPool(marketTemplates, `${seedBase}|market|${tone}`, marketTemplates[0])

  const topicTemplates = topic
    ? [
      `新闻端我会继续跟：${topic}。`,
      `消息线暂时聚焦在：${topic}。`,
      `我会把这条消息放进观察清单：${topic}。`,
      `这条消息值得盯一盯：${topic}。`,
      `今天的外部变量我先看这条：${topic}。`,
      `消息面最新关注点是：${topic}。`,
    ]
    : []
  const topicLine = topicTemplates.length
    ? pickFromPool(topicTemplates, `${seedBase}|topicline|${tone}`, '')
    : ''

  const casualLine = casual ? `${casual.replace(/[。！？!?]+$/g, '')}。` : ''
  const casualBias = (simpleHash(`${seedBase}|casual-bias|${symbolCode}|${action}|${tone}`) % 100) < (action === 'HOLD' ? 65 : 45)
  const tailByTone = {
    calm: [
      '我会继续稳着跟，信号出来第一时间同步。',
      '这一段先按计划走，别被噪音带跑。',
      '先把节奏拿住，机会到了再提速。',
    ],
    focused: [
      '下一轮我会重点看确认位，到了就给动作。',
      '我会继续盯关键位和量能变化。',
      '确认条件满足的话，我会直接给更新。',
    ],
    energetic: [
      '这段节奏可能会加快，有变化我马上喊。',
      '如果出现加速信号，我会立刻同步。',
      '这一波我会盯得更紧，机会来了不拖。',
    ],
    cautious: [
      '我先把风险边界守好，再等下一次机会。',
      '不确定性还在，我先把防守做到位。',
      '先稳住回撤，再考虑下一次进攻。',
    ],
  }
  const chatterTail = pickFromPool(tailByTone[tone] || tailByTone.calm, `${seedBase}|tail|${tone}`, tailByTone.calm[0])

  const sentence1 = `${String(actionLine).replace(/[。！？!?]+$/g, '')}，${String(marketLineText).replace(/[。！？!?]+$/g, '')}`
  const sentence2 = casualBias
    ? (casualLine || topicLine || chatterTail)
    : (topicLine || casualLine || chatterTail)
  const text = `${sentence1}。${sentence2}`.trim() || '房间在线，我先继续跟踪盘面和消息变化。'

  return {
    text,
    tone,
    opener_stem: proactiveOpenerStem(actionLine),
  }
}

const PROACTIVE_LEGACY_OPENER_PREFIXES = [
  '当前我对',
  '盘面上看',
  '消息面我在盯',
]

async function maybeEmitProactivePublicMessageForRoom(roomId) {
  if (!CHAT_PROACTIVE_VIEWER_TICK_ENABLED) return false
  const safeRoomId = String(roomId || '').trim()
  if (!safeRoomId) return false

  const set = roomEventSubscribersByRoom.get(safeRoomId)
  const hasSubscribers = !!set && set.size > 0
  const activity = roomPublicChatActivityByRoom.get(safeRoomId) || null
  const lastPublicAppendMs = Number(activity?.last_public_append_ms || 0)
  const hasRecentPublicActivity = Number.isFinite(lastPublicAppendMs)
    && (Date.now() - lastPublicAppendMs) <= CHAT_PROACTIVE_ACTIVITY_WINDOW_MS
  if (!hasSubscribers && !hasRecentPublicActivity) return false

  const roomAgent = resolveRoomAgentForChat(safeRoomId)
  if (!roomAgent || roomAgent.isRunning !== true) return false

  if (proactiveEmitInFlightByRoom.get(safeRoomId) === true) return false
  proactiveEmitInFlightByRoom.set(safeRoomId, true)

  try {
    const now = Date.now()
    const defaultIntervalMs = Math.max(10_000, Number(process.env.CHAT_PUBLIC_PROACTIVE_INTERVAL_MS || 18_000))

    const previous = roomPublicChatActivityByRoom.get(safeRoomId) || createDefaultRoomPublicChatActivity()

    const latest = agentRuntime?.getLatestDecisions?.(safeRoomId, 1) || []
    const latestDecision = latest[0] || null
    const roomContext = await buildRoomChatContext(safeRoomId)

    const cadence = resolveProactiveCadence({
      nowMs: now,
      defaultIntervalMs,
      burstIntervalMs: CHAT_PROACTIVE_NEWS_BURST_INTERVAL_MS,
      burstDurationMs: CHAT_PROACTIVE_NEWS_BURST_DURATION_MS,
      cooldownMs: CHAT_PROACTIVE_NEWS_BURST_COOLDOWN_MS,
      previousState: proactiveBurstStateByRoom.get(safeRoomId) || null,
      burstSignal: CHAT_PROACTIVE_NEWS_BURST_ENABLED ? (roomContext?.news_burst_signal || null) : null,
    })
    proactiveBurstStateByRoom.set(safeRoomId, cadence.state)

    const lastProactive = Number(previous.last_proactive_emit_ms || 0)
    if (now - lastProactive < cadence.intervalMs) return false

    let text = ''
    let generationSource = 'fallback'
    let generationReason = 'fallback_default'
    let generationTone = 'neutral'
    let openerStem = ''
    let llmError = null

    const llmEnabledForProactive = !!chatLlmResponder && CHAT_PROACTIVE_LLM_MAX_CONCURRENCY > 0
    if (!llmEnabledForProactive) {
      generationReason = chatLlmResponder ? 'llm_concurrency_disabled' : 'llm_unavailable'
      updateProactiveGenerationStats(safeRoomId, (stats) => {
        if (!chatLlmResponder) stats.llm_unavailable += 1
        return stats
      })
    } else if (proactiveLlmInFlight >= CHAT_PROACTIVE_LLM_MAX_CONCURRENCY) {
      generationReason = 'llm_skipped_concurrency'
      updateProactiveGenerationStats(safeRoomId, (stats) => {
        stats.llm_skipped_concurrency += 1
        return stats
      })
    } else {
      proactiveLlmInFlight += 1
      try {
        const raw = await chatLlmResponder({
          kind: 'proactive',
          roomAgent,
          roomContext,
          latestDecision,
          historyContext: null,
          inboundMessage: null,
        })
        text = String(raw || '').trim()
        if (text) {
          generationSource = 'llm'
          generationReason = 'llm_ok'
          updateProactiveGenerationStats(safeRoomId, (stats) => {
            stats.llm_ok += 1
            return stats
          })
        } else {
          generationReason = 'llm_empty'
          updateProactiveGenerationStats(safeRoomId, (stats) => {
            stats.llm_empty += 1
            return stats
          })
        }
      } catch (error) {
        text = ''
        llmError = String(error instanceof Error ? error.message : 'llm_error')
        generationReason = 'llm_error'
        updateProactiveGenerationStats(safeRoomId, (stats) => {
          stats.llm_error += 1
          return stats
        })
      } finally {
        proactiveLlmInFlight = Math.max(0, proactiveLlmInFlight - 1)
      }
    }

    if (!text) {
      const fallback = fallbackProactiveText({
        roomContext,
        latestDecision,
        roomAgent,
        previousActivity: previous,
        salt: generationReason,
      })
      text = String(fallback?.text || '').trim()
      generationTone = String(fallback?.tone || 'neutral').trim().toLowerCase() || 'neutral'
      openerStem = String(fallback?.opener_stem || '').trim()
      generationSource = 'fallback'
      updateProactiveGenerationStats(safeRoomId, (stats) => {
        stats.fallback_used += 1
        return stats
      })
    } else {
      openerStem = proactiveOpenerStem(text)
    }

    text = String(text || '').trim()
    if (!text) return false

    if (!isTimeAwareChatTextAllowed(text, { tsMs: now })) {
      const safeCasual = filterTimeAwareCasualTopics(roomContext?.casual_topics, { tsMs: now, limit: 6 })
      const safeTail = pickFromPool(safeCasual, `${safeRoomId}|time-aware-fallback|${now}`, '先稳住节奏，等信号更清晰再同步。')
      text = String(safeTail || '先稳住节奏，等信号更清晰再同步。').trim()
      generationSource = 'fallback'
      generationReason = 'fallback_time_context'
      generationTone = generationTone === 'neutral' ? 'calm' : generationTone
    }

    const recentOpeners = Array.isArray(previous.recent_proactive_openers)
      ? previous.recent_proactive_openers.map((item) => String(item || '').trim()).filter(Boolean).slice(-8)
      : []
    const stemConflict = openerStem
      && (
        recentOpeners.includes(openerStem)
        || PROACTIVE_LEGACY_OPENER_PREFIXES.some((prefix) => {
          if (!openerStem.startsWith(prefix)) return false
          return recentOpeners.some((item) => String(item || '').startsWith(prefix))
        })
      )

    if (stemConflict) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const alt = fallbackProactiveText({
          roomContext,
          latestDecision,
          roomAgent,
          previousActivity: {
            ...previous,
            recent_proactive_openers: recentOpeners,
          },
          salt: `${generationReason}|reroll|${attempt}`,
        })
        const altText = String(alt?.text || '').trim()
        const altStem = String(alt?.opener_stem || '').trim()
        if (!altText || !altStem) continue
        if (recentOpeners.includes(altStem)) continue
        text = altText
        openerStem = altStem
        generationTone = String(alt?.tone || generationTone || 'neutral').trim().toLowerCase() || 'neutral'
        const switchedFromLlm = generationSource !== 'fallback'
        generationSource = 'fallback'
        generationReason = 'fallback_opener_reroll'
        updateProactiveGenerationStats(safeRoomId, (stats) => {
          if (switchedFromLlm) stats.fallback_used += 1
          stats.opener_reroll += 1
          return stats
        })
        break
      }
    }

    let key = normalizeForProactiveDedupe(text)
    const recentKeys = Array.isArray(previous.recent_proactive_keys) ? previous.recent_proactive_keys : []
    if (key && recentKeys.includes(key)) {
      const alt = fallbackProactiveText({
        roomContext,
        latestDecision,
        roomAgent,
        previousActivity: previous,
        salt: `${generationReason}|dedupe`,
      })
      const altText = String(alt?.text || '').trim()
      const altKey = normalizeForProactiveDedupe(altText)
      if (altText && altKey && altKey !== key && !recentKeys.includes(altKey)) {
        text = altText
        key = altKey
        openerStem = String(alt?.opener_stem || openerStem || '').trim()
        generationTone = String(alt?.tone || generationTone || 'neutral').trim().toLowerCase() || 'neutral'
        const switchedFromLlm = generationSource !== 'fallback'
        generationSource = 'fallback'
        generationReason = 'fallback_dedupe_reroll'
        updateProactiveGenerationStats(safeRoomId, (stats) => {
          if (switchedFromLlm) stats.fallback_used += 1
          return stats
        })
      } else {
        return false
      }
    }

    const message = buildProactiveAgentMessage({
      roomAgent,
      roomId: safeRoomId,
      text,
      nowMs: now,
      maxChars: CHAT_AGENT_MAX_CHARS,
      maxSentences: CHAT_AGENT_MAX_SENTENCES,
    })
    message.generation_source = generationSource
    message.generation_reason = generationReason
    message.generation_tone = generationTone

    await chatStore.appendPublic(safeRoomId, message)
    roomPublicChatActivityByRoom.set(safeRoomId, {
      ...previous,
      last_public_append_ms: Number(message?.created_ts_ms) || now,
      last_proactive_emit_ms: now,
      recent_proactive_keys: key ? [...recentKeys, key].slice(-8) : recentKeys.slice(-8),
      recent_proactive_openers: openerStem
        ? [...recentOpeners, openerStem].slice(-8)
        : recentOpeners.slice(-8),
      recent_proactive_tones: generationTone
        ? [...(Array.isArray(previous.recent_proactive_tones) ? previous.recent_proactive_tones : []), generationTone].slice(-8)
        : (Array.isArray(previous.recent_proactive_tones) ? previous.recent_proactive_tones.slice(-8) : []),
    })

    updateProactiveGenerationStats(safeRoomId, (stats) => {
      const toneKey = Object.prototype.hasOwnProperty.call(stats.tone_counts || {}, generationTone)
        ? generationTone
        : 'neutral'
      stats.tone_counts[toneKey] = Number(stats.tone_counts[toneKey] || 0) + 1
      stats.last_source = generationSource
      stats.last_reason = generationReason
      stats.last_error = llmError
      stats.last_emit_ms = now
      return stats
    })

    broadcastRoomEvent(safeRoomId, 'chat_public_append', {
      schema_version: 'room.chat_public_append.v1',
      room_id: safeRoomId,
      ts_ms: Date.now(),
      message,
    })

    return true
  } finally {
    proactiveEmitInFlightByRoom.set(safeRoomId, false)
  }
}

function tickChatProactiveForRoomsWithViewers() {
  if (!CHAT_PROACTIVE_VIEWER_TICK_ENABLED) return
  if (!chatService) return

  const roomIds = Array.from(new Set([
    ...roomEventSubscribersByRoom.keys(),
    ...roomPublicChatActivityByRoom.keys(),
  ]))
  if (roomIds.length === 0) return

  // Cleanup any stale tick state for rooms that no longer have subscribers.
  if (proactiveViewerTickStateByRoom.size > roomIds.length * 2) {
    const active = new Set(roomIds)
    for (const key of Array.from(proactiveViewerTickStateByRoom.keys())) {
      if (!active.has(key)) proactiveViewerTickStateByRoom.delete(key)
    }
    for (const key of Array.from(proactiveBurstStateByRoom.keys())) {
      if (!active.has(key)) proactiveBurstStateByRoom.delete(key)
    }
    for (const key of Array.from(proactiveGenerationStatsByRoom.keys())) {
      if (!active.has(key)) proactiveGenerationStatsByRoom.delete(key)
    }
  }

  const now = Date.now()
  const start = proactiveViewerTickCursor % roomIds.length
  let processed = 0
  let advanced = 0

  for (let i = 0; i < roomIds.length; i++) {
    if (processed >= CHAT_PROACTIVE_VIEWER_TICK_ROOMS_PER_INTERVAL) break
    const idx = (start + i) % roomIds.length
    const roomId = roomIds[idx]
    advanced = i + 1

    const set = roomEventSubscribersByRoom.get(roomId)
    const hasSubscribers = !!set && set.size > 0
    const activity = roomPublicChatActivityByRoom.get(roomId) || null
    const lastPublicAppendMs = Number(activity?.last_public_append_ms || 0)
    const hasRecentPublicActivity = Number.isFinite(lastPublicAppendMs)
      && (now - lastPublicAppendMs) <= CHAT_PROACTIVE_ACTIVITY_WINDOW_MS
    if (!hasSubscribers && !hasRecentPublicActivity) continue

    const lastTick = Number(proactiveViewerTickStateByRoom.get(roomId) || 0)
    if (now - lastTick < CHAT_PROACTIVE_VIEWER_TICK_MIN_ROOM_INTERVAL_MS) continue

    proactiveViewerTickStateByRoom.set(roomId, now)
    processed += 1

    Promise.resolve(maybeEmitProactivePublicMessageForRoom(roomId)).catch(() => {})
  }

  proactiveViewerTickCursor = (start + Math.max(1, advanced)) % roomIds.length
}

function toPct(value, digits = 2) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Number((n * 100).toFixed(digits))
}

function stripStepPrefix(value) {
  return String(value || '').replace(/^\s*\d+\s+/, '').trim()
}

function narrationTextFromReasoningSteps(steps) {
  const rows = Array.isArray(steps) ? steps.map(stripStepPrefix).filter(Boolean) : []
  if (!rows.length) return ''

  const actionLine = rows.find((line) => line.includes('动作：')) || rows[rows.length - 1]
  const signalLine = rows.find((line) => line.includes('信号快照：'))
    || rows.find((line) => line.includes('市场概览：') || line.includes('消息面：'))
    || rows[0]

  const actionPlain = String(actionLine || '').replace(/^动作：/, '').trim()
  const signalPlain = String(signalLine || '')
    .replace(/^信号快照：/, '')
    .replace(/^市场概览：/, '')
    .replace(/^消息面：/, '')
    .trim()
  const isHold = /\bhold\b|观望|继续观察|不交易|先看/.test(actionPlain.toLowerCase()) || /观望|继续观察|不交易|先看/.test(actionPlain)

  let text = ''
  if (isHold) {
    const holdOpeners = ['当前判断', '这轮看法', '先看盘面']
    const opener = holdOpeners[simpleHash(`${signalPlain}|${actionPlain}|hold`) % holdOpeners.length]
    text = signalPlain
      ? `${opener}：${signalPlain}，这轮先观望。`
      : `${opener}：${actionPlain || '先观望'}。`
  } else {
    const decisionOpeners = ['当前动作', '本轮决策', '这轮执行']
    const opener = decisionOpeners[simpleHash(`${signalPlain}|${actionPlain}|decision`) % decisionOpeners.length]
    text = signalPlain && signalPlain !== actionPlain
      ? `${opener}：${actionPlain}；依据：${signalPlain}`
      : `${opener}：${actionPlain}`
  }

  if (!/[。！？!?]$/.test(text)) {
    text += '。'
  }
  return text
}

function fallbackDecisionNarrationText({ trader, decision, context }) {
  const d = decision?.decisions?.[0] || null
  if (!d) return ''
  const action = String(d.action || 'hold').toUpperCase()
  const symbol = String(d.symbol || '').trim() || (String(context?.symbol || '').trim() || 'UNKNOWN')
  const conf = Number.isFinite(Number(d.confidence)) ? Number(d.confidence).toFixed(2) : ''
  const ret5 = toPct(context?.intraday?.feature_snapshot?.ret_5, 2)
  const rsi = Number(context?.daily?.feature_snapshot?.rsi_14)
  const bits = []
  if (ret5 != null) bits.push(`5m涨跌${ret5 >= 0 ? '+' : ''}${ret5}%`)
  if (Number.isFinite(rsi)) bits.push(`RSI${Number(rsi.toFixed(0))}`)
  const brief = bits.length ? `（${bits.join('，')}）` : ''
  const confText = conf ? `，置信度${conf}` : ''
  return `本轮${symbol}给出${action}${brief}${confText}。`
}

async function maybeEmitDecisionNarration({ trader, decision, context }) {
  if (!CHAT_DECISION_NARRATION_ENABLED) return
  const roomId = String(trader?.trader_id || '').trim()
  if (!roomId) return

  const roomAgent = resolveRoomAgentForChat(roomId)
  if (!roomAgent || roomAgent.isRunning !== true) return

  const now = Date.now()
  const previous = chatNarrationStateByRoom.get(roomId) || {
    last_emit_ms: 0,
    last_decision_ts: '',
    last_cycle: 0,
  }
  const latestAction = String(decision?.decisions?.[0]?.action || '').trim().toLowerCase()
  const riskProfile = String(trader?.risk_profile || '').trim().toLowerCase()
  const narrationMinIntervalMs = latestAction === 'hold'
    ? (riskProfile === 'conservative'
      ? CHAT_DECISION_NARRATION_CONSERVATIVE_HOLD_INTERVAL_MS
      : CHAT_DECISION_NARRATION_HOLD_INTERVAL_MS)
    : CHAT_DECISION_NARRATION_MIN_INTERVAL_MS

  if (now - Number(previous.last_emit_ms || 0) < narrationMinIntervalMs) {
    return
  }

  const decisionTs = String(decision?.timestamp || '').trim()
  const cycle = Number(decision?.cycle_number || 0)
  if (decisionTs && previous.last_decision_ts === decisionTs) {
    return
  }
  if (!decisionTs && Number.isFinite(cycle) && cycle > 0 && Number(previous.last_cycle || 0) === cycle) {
    return
  }

  let text = ''
  text = narrationTextFromReasoningSteps(decision?.reasoning_steps_cn)

  if (!text && CHAT_DECISION_NARRATION_USE_LLM && chatLlmResponder) {
    try {
      const roomContext = await buildRoomChatContext(roomId)
      text = await chatLlmResponder({
        kind: 'narration',
        roomAgent,
        roomContext,
        latestDecision: decision,
        historyContext: null,
        inboundMessage: null,
      })
    } catch {
      text = ''
    }
  }
  if (!text) {
    text = fallbackDecisionNarrationText({ trader, decision, context })
  }
  if (!text) return

  const message = buildNarrationAgentMessage({
    roomAgent,
    roomId,
    text,
    nowMs: now,
    maxChars: CHAT_AGENT_MAX_CHARS,
    maxSentences: CHAT_AGENT_MAX_SENTENCES,
  })

  try {
    await chatStore.appendPublic(roomId, message)
    try {
      const previous = roomPublicChatActivityByRoom.get(roomId) || createDefaultRoomPublicChatActivity()
      roomPublicChatActivityByRoom.set(roomId, {
        ...previous,
        last_public_append_ms: Number(message?.created_ts_ms) || now,
      })
    } catch {
      // ignore
    }
    try {
      broadcastRoomEvent(roomId, 'chat_public_append', {
        schema_version: 'room.chat_public_append.v1',
        room_id: roomId,
        ts_ms: Date.now(),
        message,
      })
    } catch {
      // ignore
    }
    chatNarrationStateByRoom.set(roomId, {
      last_emit_ms: now,
      last_decision_ts: decisionTs,
      last_cycle: Number.isFinite(cycle) ? cycle : 0,
    })
  } catch {
    // ignore: narration is best-effort
  }
}

function liveFileProviderForSymbol(symbol) {
  const market = inferMarketFromSymbol(symbol)
  if (market === 'US') return liveFileFrameProviderUs
  return liveFileFrameProviderCn
}

function liveFileStatusForMarket(marketId) {
  if (marketId === 'US') return liveFileFrameProviderUs?.getStatus?.() || null
  return liveFileFrameProviderCn?.getStatus?.() || null
}

async function refreshLiveFileProviders() {
  if (liveFileFrameProviderCn?.refresh) {
    try { await liveFileFrameProviderCn.refresh(false) } catch { /* ignore */ }
  }
  if (liveFileFrameProviderUs?.refresh) {
    try { await liveFileFrameProviderUs.refresh(false) } catch { /* ignore */ }
  }
}

async function refreshSupplementalLiveProviders() {
  const providers = [
    marketOverviewProviderCn,
    marketOverviewProviderUs,
    newsDigestProviderCn,
    newsDigestProviderUs,
    marketBreadthProviderCn,
    marketBreadthProviderUs,
  ]
  await Promise.all(
    providers.map(async (provider) => {
      if (!provider?.refresh) return
      try {
        await provider.refresh(false)
      } catch {
        // keep status endpoint resilient
      }
    })
  )
}

function buildLivePreflightPayload() {
  const gate = getMarketSessionGatePublicSnapshot()
  const registeredCount = getRegisteredTraders().length
  const runningCount = getRunningRuntimeTraders().length
  const activeCount = Array.isArray(gate?.active_trader_ids) ? gate.active_trader_ids.length : 0
  const expectedRegistryCount = LIVE_PREFLIGHT_EXPECTED_REGISTRY_COUNT
  const registryCountOk = expectedRegistryCount > 0
    ? registeredCount >= expectedRegistryCount
    : registeredCount > 0

  const liveFiles = {
    cn_a: buildFreshnessCheck('frames_cn_a', liveFileFrameProviderCn?.getStatus?.() || null),
    us: buildFreshnessCheck('frames_us', liveFileFrameProviderUs?.getStatus?.() || null),
  }

  const checks = {
    data_mode: {
      ok: RUNTIME_DATA_MODE === 'live_file',
      expected: 'live_file',
      actual: RUNTIME_DATA_MODE,
    },
    strict_live_mode: {
      ok: STRICT_LIVE_MODE === true,
      expected: true,
      actual: STRICT_LIVE_MODE,
    },
    freshness: {
      ok: liveFiles.cn_a.ok,
      markets: liveFiles,
    },
    registry_count: {
      ok: registryCountOk,
      registered_count: registeredCount,
      running_count: runningCount,
      active_count: activeCount,
      expected_min_count: expectedRegistryCount > 0 ? expectedRegistryCount : 1,
    },
    market_gate: {
      ok: !!gate?.enabled,
      state: gate,
    },
  }

  return {
    ok: Object.values(checks).every((item) => item?.ok === true),
    ts_ms: Date.now(),
    checks,
  }
}

function isLiveFileFresh(status) {
  if (!status) return false
  if (status.last_error) return false
  if (status.stale) return false
  if (!Number.isFinite(Number(status.frame_count)) || Number(status.frame_count) <= 0) return false
  return true
}

function getTraderGateState(trader, nowMs = Date.now()) {
  const guardEnabled = AGENT_SESSION_GUARD_ENABLED && RUNTIME_DATA_MODE === 'live_file'
  const spec = getMarketSpecForExchange(trader?.exchange_id)
  const session = getMarketSessionStatusForExchange(trader?.exchange_id, nowMs)
  const liveStatus = RUNTIME_DATA_MODE === 'live_file' ? liveFileStatusForMarket(spec.market) : null
  const liveFresh = RUNTIME_DATA_MODE === 'live_file' ? isLiveFileFresh(liveStatus) : true
  return {
    market: spec.market,
    timezone: spec.timezone,
    session,
    live_file: liveStatus,
    live_fresh_ok: liveFresh,
    allow_run: guardEnabled ? (!!session?.is_open && liveFresh) : true,
  }
}

async function syncMarketSessionGate({ reason = 'interval', nowMs = Date.now() } = {}) {
  if (!agentRuntime) return { running: [], active: [] }

  marketSessionGateState.enabled = AGENT_SESSION_GUARD_ENABLED && RUNTIME_DATA_MODE === 'live_file'
  marketSessionGateState.last_check_ms = nowMs

  if (killSwitchState.active) {
    agentRuntime.pause?.()
    marketSessionGateState.active_trader_ids = []
    marketSessionGateState.running_trader_ids = []
    marketSessionGateState.auto_paused = true
    if (!marketSessionGateState.auto_paused_at_ms) marketSessionGateState.auto_paused_at_ms = nowMs
    return { running: [], active: [] }
  }

  const running = getRunningRuntimeTraders()

  if (!marketSessionGateState.enabled) {
    marketSessionGateState.reason = reason
    marketSessionGateState.running_trader_ids = running.map((t) => t.trader_id)
    marketSessionGateState.active_trader_ids = running.map((t) => t.trader_id)
    agentRuntime.setTraders(running)

    if (running.length === 0) {
      agentRuntime.pause?.()
      marketSessionGateState.auto_paused = true
      if (!marketSessionGateState.auto_paused_at_ms) marketSessionGateState.auto_paused_at_ms = nowMs
    } else if (!agentRuntime.getState?.().running && !agentRuntimeManualPause) {
      agentRuntime.resume?.()
      marketSessionGateState.auto_paused = false
      marketSessionGateState.auto_paused_at_ms = null
    }

    return { running, active: running }
  }

  await refreshLiveFileProviders()

  // Update per-market snapshots for UI/debugging.
  marketSessionGateState.markets['CN-A'] = {
    session: getMarketSessionStatusForExchange('sim-cn', nowMs),
    live_file: liveFileFrameProviderCn?.getStatus?.() || null,
  }
  marketSessionGateState.markets.US = {
    session: getMarketSessionStatusForExchange('sim-us', nowMs),
    live_file: liveFileFrameProviderUs?.getStatus?.() || null,
  }
  marketSessionGateState.reason = reason

  const active = running.filter((trader) => {
    if (RUNTIME_DATA_MODE !== 'live_file') return true
    return getTraderGateState(trader, nowMs).allow_run
  })

  marketSessionGateState.running_trader_ids = running.map((t) => t.trader_id)
  marketSessionGateState.active_trader_ids = active.map((t) => t.trader_id)

  agentRuntime.setTraders(active)

  if (active.length === 0) {
    agentRuntime.pause?.()
    marketSessionGateState.auto_paused = true
    if (!marketSessionGateState.auto_paused_at_ms) marketSessionGateState.auto_paused_at_ms = nowMs
  } else if (!agentRuntime.getState?.().running && !agentRuntimeManualPause) {
    agentRuntime.resume?.()
    marketSessionGateState.auto_paused = false
    marketSessionGateState.auto_paused_at_ms = null
  }

  return { running, active }
}

let marketDataService = createMarketDataService({
  provider: MARKET_PROVIDER,
  upstreamBaseUrl: MARKET_UPSTREAM_URL,
  upstreamApiKey: MARKET_UPSTREAM_API_KEY,
  strictLive: STRICT_LIVE_MODE && RUNTIME_DATA_MODE === 'live_file',
  replayBatch,
  dailyHistoryBatch,
  replayFrameProvider: async ({ symbol, interval, limit }) => {
    if (RUNTIME_DATA_MODE === 'live_file') {
      const provider = liveFileProviderForSymbol(symbol)
      if (provider) {
        return provider.getFrames({ symbol, interval, limit })
      }
    }

    if (!replayEngine) return []
    if (interval === '1m') {
      return replayEngine.getVisibleFrames(symbol, limit)
    }
    return []
  },
})

function syncMarketDataService() {
  if (RUNTIME_DATA_MODE === 'live_file') {
    if (!liveFileFrameProviderCn) {
      liveFileFrameProviderCn = createLiveFileFrameProvider({
        filePath: LIVE_FRAMES_PATH_CN,
        refreshMs: LIVE_FILE_REFRESH_MS,
        staleAfterMs: LIVE_FILE_STALE_MS,
      })
    }
    if (!liveFileFrameProviderUs) {
      liveFileFrameProviderUs = createLiveFileFrameProvider({
        filePath: LIVE_FRAMES_PATH_US,
        refreshMs: LIVE_FILE_REFRESH_MS,
        staleAfterMs: LIVE_FILE_STALE_MS,
      })
    }
  }

  marketDataService = createMarketDataService({
    provider: MARKET_PROVIDER,
    upstreamBaseUrl: MARKET_UPSTREAM_URL,
    upstreamApiKey: MARKET_UPSTREAM_API_KEY,
    strictLive: STRICT_LIVE_MODE && RUNTIME_DATA_MODE === 'live_file',
    replayBatch,
    dailyHistoryBatch,
    replayFrameProvider: async ({ symbol, interval, limit }) => {
      if (RUNTIME_DATA_MODE === 'live_file') {
        const provider = liveFileProviderForSymbol(symbol)
        if (provider) {
          return provider.getFrames({ symbol, interval, limit })
        }
      }

      if (!replayEngine) return []
      if (interval === '1m') {
        return replayEngine.getVisibleFrames(symbol, limit)
      }
      return []
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

  if (agentRuntime) {
    await syncMarketSessionGate({ reason: 'refresh_agent_state', nowMs: Date.now() })
  }

  return {
    available_agents: availableAgents,
    registered_agents: registeredAgents,
    running_agent_ids: runtimeTraders.map((trader) => trader.trader_id),
    active_agent_ids: marketSessionGateState.active_trader_ids,
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
    await loadReplayBreadthBatch()
    resetReplayEngine()
    return replayBatch
  } catch {
    replayBatch = null
    installReplayBreadthSeries([], 'empty', Date.now(), 'replay_frames_file_missing')
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
    const pool = normalizeStockPool(agent?.stock_pool, agent?.exchange_id)
    for (const symbol of pool) {
      if (seen.has(symbol)) continue
      seen.add(symbol)
      output.push(symbol)
    }
  }
  return output
}

function symbolList({ traderId = '', exchangeId = '' } = {}) {
  const wantedTraderId = String(traderId || '').trim()
  const wantedExchangeId = String(exchangeId || '').trim() || (wantedTraderId
    ? String(getTraderById(wantedTraderId)?.exchange_id || '').trim()
    : '')
  const wantedMarket = getMarketSpecForExchange(wantedExchangeId).market
  if (wantedTraderId) {
    const traderPool = normalizeStockPool(getTraderById(wantedTraderId)?.stock_pool, wantedExchangeId)
    if (traderPool.length) {
      return symbolsToEntries(traderPool)
    }
  }

  const manifestPool = aggregateManifestStockPool()
  if (manifestPool.length) {
    return symbolsToEntries(manifestPool)
  }

  if (RUNTIME_DATA_MODE === 'live_file') {
    const provider = wantedMarket === 'US' ? liveFileFrameProviderUs : liveFileFrameProviderCn
    const symbols = provider?.getSymbols?.('1m') || []
    if (symbols.length) return symbolsToEntries(symbols)

    // No market hint: return union across markets.
    if (!wantedTraderId && !wantedExchangeId) {
      const cn = liveFileFrameProviderCn?.getSymbols?.('1m') || []
      const us = liveFileFrameProviderUs?.getSymbols?.('1m') || []
      const merged = Array.from(new Set([...cn, ...us]))
      if (merged.length) return symbolsToEntries(merged)
    }

    if (STRICT_LIVE_MODE) return []
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
  const traderPool = normalizeStockPool(trader?.stock_pool, trader?.exchange_id)
  const symbols = (traderPool.length
    ? traderPool
    : symbolList({ traderId: trader?.trader_id, exchangeId: trader?.exchange_id }).map((item) => item.symbol)
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

function normalizeTraderStyleForRanking(trader) {
  const explicit = String(trader?.trading_style || '').trim().toLowerCase()
  if (explicit) return explicit
  const strategy = String(trader?.strategy_name || '').trim().toLowerCase()
  if (strategy.includes('momentum')) return 'momentum_trend'
  if (strategy.includes('reversion') || strategy.includes('value')) return 'mean_reversion'
  if (strategy.includes('event')) return 'event_driven'
  if (strategy.includes('macro')) return 'macro_swing'
  return 'balanced'
}

function rankCandidateRows(candidateRows, trader) {
  const style = normalizeTraderStyleForRanking(trader)
  const scored = candidateRows
    .map((row) => {
      const ret5 = toSafeNumber(row?.ret_5, 0)
      const ret20 = toSafeNumber(row?.ret_20, 0)
      const vol = toSafeNumber(row?.vol_ratio_20, 1)
      const rsi = toSafeNumber(row?.rsi_14, 50)
      const sma20 = toSafeNumber(row?.sma_20, 0)
      const sma60 = toSafeNumber(row?.sma_60, 0)
      const trendUp = sma20 > 0 && sma60 > 0 && sma20 >= sma60
      const trendDown = sma20 > 0 && sma60 > 0 && sma20 < sma60
      const hasPosition = toSafeNumber(row?.position_shares, 0) > 0

      let score = 0
      if (style === 'mean_reversion') {
        score = (-ret5 * 1.0) + (-ret20 * 0.35)
        if (rsi <= 45) score += 0.35
        if (rsi >= 70) score -= 0.25
        if (trendDown) score -= 0.12
      } else if (style === 'event_driven') {
        score = (ret5 * 0.8) + (ret20 * 0.6) + (Math.max(0, vol - 1) * 0.22)
        if (trendUp) score += 0.12
        if (trendDown) score -= 0.12
      } else if (style === 'macro_swing') {
        score = (ret20 * 1.3) + (ret5 * 0.35)
        if (trendUp) score += 0.24
        if (trendDown) score -= 0.22
      } else {
        score = (ret20 * 1.0) + (ret5 * 0.8) + (Math.max(0, vol - 1) * 0.12)
        if (trendUp) score += 0.2
        if (trendDown) score -= 0.18
      }

      if (hasPosition) score += 0.05

      return {
        ...row,
        score: round(score, 6),
        trend: trendUp ? 'up' : (trendDown ? 'down' : 'flat'),
      }
    })
    .sort((a, b) => toSafeNumber(b.score, 0) - toSafeNumber(a.score, 0))

  const ret5Sorted = [...scored]
    .sort((a, b) => toSafeNumber(b.ret_5, 0) - toSafeNumber(a.ret_5, 0))
    .map((item) => item.symbol)
  const ret20Sorted = [...scored]
    .sort((a, b) => toSafeNumber(b.ret_20, 0) - toSafeNumber(a.ret_20, 0))
    .map((item) => item.symbol)

  return scored.map((item, index) => ({
    ...item,
    rank_score: index + 1,
    rank_ret_5: ret5Sorted.indexOf(item.symbol) + 1,
    rank_ret_20: ret20Sorted.indexOf(item.symbol) + 1,
  }))
}

async function evaluateTraderContext(trader, { cycleNumber }) {
  const traderPool = normalizeStockPool(trader?.stock_pool, trader?.exchange_id)
  const symbolPool = (traderPool.length
    ? traderPool
    : symbolList({ traderId: trader?.trader_id, exchangeId: trader?.exchange_id }).map((item) => item.symbol)
  ).slice(0, AGENT_CANDIDATE_SYMBOL_LIMIT)
  const fallbackSymbol = pickTraderSymbol(trader, cycleNumber)
  const candidateSymbols = symbolPool.length ? symbolPool : [fallbackSymbol]

  const account = getAccount(trader.trader_id)
  const positions = getPositions(trader.trader_id)
  const marketSpec = getMarketSpecForExchange(trader.exchange_id)
  const candidateErrors = []
  const candidateContexts = await Promise.all(candidateSymbols.map(async (symbol) => {
    try {
      if (RUNTIME_DATA_MODE === 'live_file' && STRICT_LIVE_MODE) {
        const provider = liveFileProviderForSymbol(symbol)
        const liveStatus = provider?.getStatus?.() || null
        if (liveStatus?.last_error) {
          candidateErrors.push('live_file_error')
          return null
        }
        if (liveStatus?.stale) {
          candidateErrors.push('live_file_stale')
          return null
        }
      }

      const [intradayBatch, dailyBatch] = await Promise.all([
        marketDataService.getFrames({
          symbol,
          interval: '1m',
          limit: 180,
        }),
        marketDataService.getFrames({
          symbol,
          interval: '1d',
          limit: 180,
        }),
      ])

      const intradayFrames = Array.isArray(intradayBatch?.frames) ? intradayBatch.frames : []
      const latestEventTs = intradayFrames[intradayFrames.length - 1]?.event_ts_ms
      const positionState = buildPositionState({ symbol, account, positions })
      const context = buildAgentMarketContext({
        symbol,
        asOfTsMs: Number.isFinite(latestEventTs) ? latestEventTs : Date.now(),
        intradayBatch,
        dailyBatch,
        positionState,
        marketSpec,
      })

      return {
        symbol,
        intradayBatch,
        dailyBatch,
        context,
        latestEventTs,
      }
    } catch {
      candidateErrors.push('fetch_error')
      return null
    }
  }))

  const validCandidates = candidateContexts.filter(Boolean)
  if (!validCandidates.length) {
    if (RUNTIME_DATA_MODE === 'live_file' && STRICT_LIVE_MODE) {
      const code = candidateErrors.includes('live_file_error') ? 'live_file_error' : 'live_file_stale'
      const error = new Error(code)
      error.code = code
      throw error
    }
    const [intradayBatch, dailyBatch] = await Promise.all([
      marketDataService.getFrames({
        symbol: fallbackSymbol,
        interval: '1m',
        limit: 180,
      }),
      marketDataService.getFrames({
        symbol: fallbackSymbol,
        interval: '1d',
        limit: 180,
      }),
    ])
    const intradayFrames = Array.isArray(intradayBatch?.frames) ? intradayBatch.frames : []
    const fallbackLatestTs = intradayFrames[intradayFrames.length - 1]?.event_ts_ms
    const fallbackContext = buildAgentMarketContext({
      symbol: fallbackSymbol,
      asOfTsMs: Number.isFinite(fallbackLatestTs) ? fallbackLatestTs : Date.now(),
      intradayBatch,
      dailyBatch,
      positionState: buildPositionState({ symbol: fallbackSymbol, account, positions }),
      marketSpec,
    })
    validCandidates.push({
      symbol: fallbackSymbol,
      intradayBatch,
      dailyBatch,
      context: fallbackContext,
      latestEventTs: fallbackLatestTs,
    })
  }

  const rankedCandidates = rankCandidateRows(validCandidates.map((item) => {
    const rowContext = item.context || {}
    const intraday = rowContext?.intraday?.feature_snapshot || {}
    const daily = rowContext?.daily?.feature_snapshot || {}
    const dailyRefs = rowContext?.daily?.price_volume_descriptions || {}
    const positionState = rowContext?.position_state || {}
    const frames = Array.isArray(rowContext?.intraday?.frames) ? rowContext.intraday.frames : []
    const latestFrame = frames[frames.length - 1]
    const latestPrice = toSafeNumber(latestFrame?.bar?.close, 0)
    const symbolMeta = resolveStockDisplay(item.symbol, trader?.exchange_id)

    return {
      symbol: item.symbol,
      symbol_name: symbolMeta.name || null,
      symbol_display: symbolMeta.display || item.symbol,
      latest_price: latestPrice,
      ret_5: toSafeNumber(intraday.ret_5, 0),
      ret_20: toSafeNumber(intraday.ret_20, 0),
      atr_14: toSafeNumber(intraday.atr_14, 0),
      vol_ratio_20: toSafeNumber(intraday.vol_ratio_20, 0),
      rsi_14: toSafeNumber(daily.rsi_14, 50),
      sma_20: toSafeNumber(daily.sma_20, 0),
      sma_60: toSafeNumber(daily.sma_60, 0),
      range_20d_pct: toSafeNumber(daily.range_20d_pct, 0),
      price_volume_descriptions: {
        past_6m: String(dailyRefs?.past_6m || '').slice(0, 180),
        past_1m: String(dailyRefs?.past_1m || '').slice(0, 180),
        past_1w: String(dailyRefs?.past_1w || '').slice(0, 180),
        past_1d: String(dailyRefs?.past_1d || '').slice(0, 180),
      },
      price_volume_reference_text: String(rowContext?.daily?.price_volume_reference_text || '').slice(0, 420),
      position_shares: toSafeNumber(positionState.shares, 0),
    }
  }), trader)

  const rankedTopSymbol = rankedCandidates[0]?.symbol || validCandidates[0]?.symbol || fallbackSymbol
  let selectedSymbol = rankedTopSymbol
  let loopSymbol = null

  if (AGENT_STRICT_SYMBOL_LOOP) {
    const nextLoopSymbol = pickTraderSymbol(trader, cycleNumber)
    if (nextLoopSymbol) {
      loopSymbol = nextLoopSymbol
      if (validCandidates.some((item) => item.symbol === nextLoopSymbol)) {
        selectedSymbol = nextLoopSymbol
      }
    }
  }

  const selectedCandidate = validCandidates.find((item) => item.symbol === selectedSymbol) || validCandidates[0]
  const symbol = selectedCandidate?.symbol || selectedSymbol
  const latestEventTs = selectedCandidate?.latestEventTs
  const selectedIntradayFrames = Array.isArray(selectedCandidate?.intradayBatch?.frames)
    ? selectedCandidate.intradayBatch.frames
    : []
  const selectedDailyFrames = Array.isArray(selectedCandidate?.dailyBatch?.frames)
    ? selectedCandidate.dailyBatch.frames
    : []
  const context = selectedCandidate?.context || buildAgentMarketContext({
    symbol,
    asOfTsMs: Date.now(),
    intradayBatch: { frames: [] },
    dailyBatch: { frames: [] },
    positionState: buildPositionState({ symbol, account, positions }),
    marketSpec,
  })

  context.candidate_set = {
    symbols: rankedCandidates.map((item) => item.symbol),
    selected_symbol: symbol,
    selected_by: AGENT_STRICT_SYMBOL_LOOP ? 'strict_loop' : 'rank_score',
    loop_symbol: loopSymbol,
    ranked_top_symbol: rankedTopSymbol,
    items: rankedCandidates.map((item) => ({
      symbol: item.symbol,
      symbol_name: item.symbol_name || null,
      symbol_display: item.symbol_display || item.symbol,
      latest_price: item.latest_price,
      ret_5: item.ret_5,
      ret_20: item.ret_20,
      atr_14: item.atr_14,
      vol_ratio_20: item.vol_ratio_20,
      rsi_14: item.rsi_14,
      sma_20: item.sma_20,
      sma_60: item.sma_60,
      range_20d_pct: item.range_20d_pct,
      price_volume_descriptions: item.price_volume_descriptions || {},
      price_volume_reference_text: item.price_volume_reference_text || '',
      position_shares: item.position_shares,
      score: item.score,
      trend: item.trend,
      rank_score: item.rank_score,
      rank_ret_5: item.rank_ret_5,
      rank_ret_20: item.rank_ret_20,
    })),
  }

  context.runtime_config = {
    commission_rate: AGENT_COMMISSION_RATE,
    lot_size: marketSpec.lot_size,
    t_plus_one: marketSpec.t_plus_one,
    currency: marketSpec.currency,
    max_position_count: AGENT_PORTFOLIO_MAX_POSITION_COUNT,
    max_symbol_concentration_pct: AGENT_PORTFOLIO_MAX_SYMBOL_CONCENTRATION_PCT,
    min_cash_reserve_pct: AGENT_PORTFOLIO_MIN_CASH_RESERVE_PCT,
    turnover_throttle_pct: AGENT_PORTFOLIO_TURNOVER_THROTTLE_PCT,
  }

  context.preopen_price_volume_reference = {
    generated_at_ts_ms: Date.now(),
    selected_symbol: symbol,
    selected_symbol_name: resolveStockDisplay(symbol, trader?.exchange_id).name || null,
    selected_lines: Array.isArray(context?.daily?.price_volume_reference_lines)
      ? context.daily.price_volume_reference_lines.slice(0, 4)
      : [],
    by_symbol: rankedCandidates.slice(0, 10).map((item) => ({
      symbol: item.symbol,
      symbol_name: item.symbol_name || null,
      descriptions: item.price_volume_descriptions || {},
    })),
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

  const readiness = evaluateDataReadiness({
    context,
    intradayFrames: selectedIntradayFrames,
    dailyFrames: selectedDailyFrames,
    nowMs: (RUNTIME_DATA_MODE === 'live_file'
      ? Date.now()
      : (Number.isFinite(Number(context?.as_of_ts_ms)) ? Number(context.as_of_ts_ms) : Date.now())),
    minIntradayFrames: DATA_READINESS_MIN_INTRADAY_FRAMES,
    minDailyFrames: DATA_READINESS_MIN_DAILY_FRAMES,
    freshnessWarnMs: DATA_READINESS_FRESH_WARN_MS,
    freshnessErrorMs: DATA_READINESS_FRESH_ERROR_MS,
    openingPhaseEnabled: DATA_READINESS_OPENING_PHASE_ENABLED,
    openingPhaseMinIntradayFrames: DATA_READINESS_OPENING_MIN_INTRADAY_FRAMES,
  })
  context.data_readiness = readiness
  const openingPhaseActive = readiness?.opening_phase_active === true

  if (openingPhaseActive) {
    context.runtime_config.opening_phase_mode = 'true'
    context.runtime_config.opening_phase_max_lots = OPENING_PHASE_MAX_LOTS
    context.runtime_config.opening_phase_max_confidence = OPENING_PHASE_MAX_CONFIDENCE
  }

  const readinessError = readiness?.level === 'ERROR'
  if (readinessError) {
    // Force HOLD and avoid any LLM calls. Also disable flat-entry guardrail.
    context.runtime_config.flat_entry_enabled = 'false'
    context.llm_decision = {
      source: 'readiness_gate',
      model: null,
      action: 'hold',
      confidence: 0.51,
      quantity: 0,
      reasoning: `data readiness ERROR: ${(readiness?.reasons || []).slice(0, 3).join(', ')}`.slice(0, 200),
      system_prompt: 'agent.data_readiness.v1',
      input_prompt: JSON.stringify({ symbol, readiness }),
      cot_trace: 'forced_hold_due_to_data_readiness_error',
    }
  }

  try {
    const [overview, digest, breadth] = await Promise.all([
      getMarketOverviewSnapshot(context.market),
      getNewsDigestSnapshot(context.market),
      getMarketBreadthSnapshot(context.market),
    ])

    context.market_overview = {
      source_kind: overview?.source_kind || null,
      brief: overview?.brief || '',
    }
    context.news_digest = {
      source_kind: digest?.source_kind || null,
      titles: Array.isArray(digest?.titles) ? digest.titles : [],
    }
    context.market_breadth = breadth?.breadth || null
    const sessionNowMs = effectiveSessionNowMs({
      fallbackNowMs: Date.now(),
      contextAsOfTsMs: context?.as_of_ts_ms,
    })
    context.session_gate = buildDataReadinessSnapshotForRoom(trader, { nowMs: sessionNowMs })
    context.symbol_brief = {
      symbol,
      symbol_name: resolveStockDisplay(symbol, context.market === 'CN-A' ? 'sim-cn' : 'sim-us').name || null,
      symbol_display: resolveStockDisplay(symbol, context.market === 'CN-A' ? 'sim-cn' : 'sim-us').display || symbol,
      last_bar_ts_ms: Number.isFinite(Number(latestEventTs)) ? Number(latestEventTs) : null,
      ret_5: context?.intraday?.feature_snapshot?.ret_5 ?? null,
      ret_20: context?.intraday?.feature_snapshot?.ret_20 ?? null,
    }
  } catch {
    const sessionNowMs = effectiveSessionNowMs({
      fallbackNowMs: Date.now(),
      contextAsOfTsMs: context?.as_of_ts_ms,
    })
    context.session_gate = buildDataReadinessSnapshotForRoom(trader, { nowMs: sessionNowMs })
  }

  if (llmDecider && !killSwitchState.active && !readinessError) {
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
  res.json({ ok: true, service: 'opentrade-runtime-api', uptime_s: Math.round((Date.now() - BOOT_TS) / 1000) })
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
  const agentId = String(req.params.id || '').trim()
  if (!requireControlAuthorization(req, res, { action: 'agent.register', target: agentId })) return

  try {
    const registered = await agentRegistryStore.registerAgent(agentId)
    await refreshAgentState()
    auditControlAction({ req, action: 'agent.register', target: agentId, result: 'ok' })
    res.json(ok(registered))
  } catch (error) {
    auditControlAction({ req, action: 'agent.register', target: agentId, result: 'error', error: error?.code || error?.message })
    res.status(agentErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'agent_register_failed' })
  }
})

app.post('/api/agents/:id/unregister', async (req, res) => {
  const agentId = String(req.params.id || '').trim()
  if (!requireControlAuthorization(req, res, { action: 'agent.unregister', target: agentId })) return

  try {
    const removed = await agentRegistryStore.unregisterAgent(agentId)
    const state = await refreshAgentState()
    auditControlAction({ req, action: 'agent.unregister', target: agentId, result: 'ok' })
    res.json(ok({
      ...removed,
      running_agent_ids: state.running_agent_ids,
    }))
  } catch (error) {
    auditControlAction({ req, action: 'agent.unregister', target: agentId, result: 'error', error: error?.code || error?.message })
    res.status(agentErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'agent_unregister_failed' })
  }
})

app.post('/api/agents/:id/start', async (req, res) => {
  const agentId = String(req.params.id || '').trim()
  if (!requireControlAuthorization(req, res, { action: 'agent.start', target: agentId })) return

  try {
    const started = await agentRegistryStore.startAgent(agentId)
    await refreshAgentState()
    auditControlAction({ req, action: 'agent.start', target: agentId, result: 'ok' })
    res.json(ok(started))
  } catch (error) {
    auditControlAction({ req, action: 'agent.start', target: agentId, result: 'error', error: error?.code || error?.message })
    res.status(agentErrorStatus(error)).json({ success: false, error: error?.code || error?.message || 'agent_start_failed' })
  }
})

app.post('/api/agents/:id/stop', async (req, res) => {
  const agentId = String(req.params.id || '').trim()
  if (!requireControlAuthorization(req, res, { action: 'agent.stop', target: agentId })) return

  try {
    const stopped = await agentRegistryStore.stopAgent(agentId)
    await refreshAgentState()
    auditControlAction({ req, action: 'agent.stop', target: agentId, result: 'ok' })
    res.json(ok(stopped))
  } catch (error) {
    auditControlAction({ req, action: 'agent.stop', target: agentId, result: 'error', error: error?.code || error?.message })
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

  const creditRecord = ensureViewerCreditPointsRecord(userSessionId, userNickname)

  res.json(ok({
    user_session_id: userSessionId,
    user_nickname: userNickname,
    credit_points: Number(creditRecord?.credit_points || 0),
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

app.get('/api/chat/tts/config', (_req, res) => {
  const capabilities = ttsProviderCapabilities()
  const defaultProvider = effectiveTtsDefaultProvider()
  const defaultModel = defaultProvider === 'selfhosted' ? 'selfhosted' : CHAT_TTS_MODEL
  const defaultResponseFormat = defaultProvider === 'selfhosted'
    ? CHAT_TTS_SELFHOSTED_MEDIA_TYPE
    : CHAT_TTS_RESPONSE_FORMAT
  res.json(ok({
    enabled: CHAT_TTS_ENABLED && (capabilities.openai.enabled || capabilities.selfhosted.enabled),
    provider: defaultProvider,
    model: defaultModel,
    response_format: defaultResponseFormat,
    speed: CHAT_TTS_SPEED,
    max_chars: CHAT_TTS_MAX_CHARS,
    voice_map: ttsVoicesSummary(),
    room_profiles: ttsRoomProfilesSummary(),
    providers: capabilities,
    default_provider: defaultProvider,
    tone_modes: ['energetic'],
    tone_speed_map: {
      energetic: CHAT_TTS_TONE_SPEED_ENERGETIC,
    },
  }))
})

app.get('/api/chat/tts/profile', (req, res) => {
  try {
    const roomId = String(req.query.room_id || '').trim().toLowerCase()
    if (roomId) {
      const trader = getRegisteredTraderStrict(roomId)
      if (!trader) {
        res.status(404).json({ success: false, error: 'room_not_found' })
        return
      }
      const profile = resolveEffectiveTtsProfileForRoom({ roomId, seed: roomId })
      res.json(ok({
        room_id: roomId,
        profile: {
          provider: profile.provider,
          voice: profile.voice,
          speed: profile.speed,
          fallback_provider: profile.fallback_provider,
          model: profile.model,
          response_format: profile.response_format,
          has_override: !!profile.override,
        },
        override: profile.override,
        global_default_provider: effectiveTtsDefaultProvider(),
      }))
      return
    }

    const overrides = {}
    for (const [id, row] of Object.entries(ttsProfilesState.rooms || {})) {
      const safeId = String(id || '').trim().toLowerCase()
      const normalized = normalizeTtsRoomOverride(row)
      if (!safeId || !normalized) continue
      overrides[safeId] = {
        provider: normalized.provider,
        voice: normalized.voice,
        speed: normalized.speed,
        fallback_provider: normalized.fallback_provider,
        updated_ts_ms: normalized.updated_ts_ms,
      }
    }

    res.json(ok({
      global_default_provider: effectiveTtsDefaultProvider(),
      room_overrides: overrides,
      room_profiles: ttsRoomProfilesSummary(),
    }))
  } catch (error) {
    res.status(500).json({ success: false, error: error?.message || 'chat_tts_profile_read_failed' })
  }
})

app.post('/api/chat/tts/profile', async (req, res) => {
  if (!requireControlAuthorization(req, res, { action: 'chat.tts.profile.set', target: String(req.body?.room_id || '').trim() || null })) return

  try {
    const roomId = String(req.body?.room_id || '').trim().toLowerCase()
    if (!roomId) {
      res.status(400).json({ success: false, error: 'room_id_required' })
      return
    }
    const trader = getRegisteredTraderStrict(roomId)
    if (!trader) {
      res.status(404).json({ success: false, error: 'room_not_found' })
      return
    }

    const providerRaw = String(req.body?.provider || '').trim().toLowerCase()
    if (providerRaw !== 'openai' && providerRaw !== 'selfhosted') {
      res.status(400).json({ success: false, error: 'provider_required' })
      return
    }
    const provider = normalizeTtsProvider(providerRaw, effectiveTtsDefaultProvider())
    const fallbackRaw = String(req.body?.fallback_provider ?? req.body?.fallback ?? '').trim().toLowerCase()
    if (fallbackRaw && fallbackRaw !== 'openai' && fallbackRaw !== 'none') {
      res.status(400).json({ success: false, error: 'invalid_fallback_provider' })
      return
    }
    const fallbackProvider = normalizeTtsFallbackProvider(
      fallbackRaw,
      provider === 'selfhosted' ? 'openai' : 'none'
    )
    const voice = String(req.body?.voice || '').trim()

    let speed = null
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'speed')) {
      const parsedSpeed = Number(req.body.speed)
      if (!Number.isFinite(parsedSpeed)) {
        res.status(400).json({ success: false, error: 'invalid_speed' })
        return
      }
      speed = clampTtsSpeed(parsedSpeed, CHAT_TTS_SPEED)
    }

    ttsProfilesState.rooms[roomId] = {
      provider,
      voice,
      speed,
      fallback_provider: fallbackProvider,
      updated_ts_ms: Date.now(),
    }
    ttsProfilesState.updated_ts_ms = Date.now()
    await persistTtsProfilesState()

    const profile = resolveEffectiveTtsProfileForRoom({ roomId, seed: roomId })
    res.json(ok({
      room_id: roomId,
      profile: {
        provider: profile.provider,
        voice: profile.voice,
        speed: profile.speed,
        fallback_provider: profile.fallback_provider,
        model: profile.model,
        response_format: profile.response_format,
        has_override: !!profile.override,
      },
      override: profile.override,
      persisted: true,
    }))
  } catch (error) {
    res.status(500).json({ success: false, error: error?.message || 'chat_tts_profile_write_failed' })
  }
})

app.delete('/api/chat/tts/profile', async (req, res) => {
  if (!requireControlAuthorization(req, res, { action: 'chat.tts.profile.clear', target: String(req.query.room_id || '').trim() || null })) return

  try {
    const roomId = String(req.query.room_id || '').trim().toLowerCase()
    if (!roomId) {
      res.status(400).json({ success: false, error: 'room_id_required' })
      return
    }
    const trader = getRegisteredTraderStrict(roomId)
    if (!trader) {
      res.status(404).json({ success: false, error: 'room_not_found' })
      return
    }

    delete ttsProfilesState.rooms[roomId]
    ttsProfilesState.updated_ts_ms = Date.now()
    await persistTtsProfilesState()

    const profile = resolveEffectiveTtsProfileForRoom({ roomId, seed: roomId })
    res.json(ok({
      room_id: roomId,
      profile: {
        provider: profile.provider,
        voice: profile.voice,
        speed: profile.speed,
        fallback_provider: profile.fallback_provider,
        model: profile.model,
        response_format: profile.response_format,
        has_override: !!profile.override,
      },
      override_cleared: true,
    }))
  } catch (error) {
    res.status(500).json({ success: false, error: error?.message || 'chat_tts_profile_clear_failed' })
  }
})

app.post('/api/chat/tts', async (req, res) => {
  try {
    if (!CHAT_TTS_ENABLED) {
      res.status(503).json({ success: false, error: 'chat_tts_disabled' })
      return
    }
    const capabilities = ttsProviderCapabilities()
    if (!capabilities.openai.enabled && !capabilities.selfhosted.enabled) {
      res.status(503).json({ success: false, error: 'chat_tts_unavailable' })
      return
    }

    const roomId = String(req.body?.room_id || '').trim()
    const text = sanitizeTtsText(req.body?.text, { maxChars: CHAT_TTS_MAX_CHARS })
    if (!roomId) {
      res.status(400).json({ success: false, error: 'room_id_required' })
      return
    }
    if (!text) {
      res.status(400).json({ success: false, error: 'text_required' })
      return
    }

    const trader = getRegisteredTraderStrict(roomId)
    if (!trader) {
      res.status(404).json({ success: false, error: 'room_not_found' })
      return
    }

    const tone = normalizeTtsTone(req.body?.tone)
    const seed = String(req.body?.message_id || '').trim() || text
    const ttsProfile = resolveEffectiveTtsProfileForRoom({ roomId, tone, seed })
    const synthesis = await synthesizeTtsWithProviderRouting({
      roomId,
      text,
      tone,
      seed,
      profile: ttsProfile,
    })

    res.set('Content-Type', synthesis.contentType)
    res.set('Cache-Control', 'no-store')
    res.set('x-tts-provider', synthesis.provider)
    res.set('x-tts-provider-requested', synthesis.requested_provider)
    res.set('x-tts-fallback-used', synthesis.fallback_used ? 'true' : 'false')
    res.set('x-tts-model', synthesis.model)
    res.set('x-tts-voice', synthesis.voice)
    res.set('x-tts-speed', String(synthesis.speed))
    res.set('x-tts-tone', ttsProfile.tone)
    res.send(synthesis.audioBuffer)
  } catch (error) {
    res.status(502).json({ success: false, error: error?.message || 'chat_tts_failed' })
  }
})

function httpError(code, status = 400) {
  const error = new Error(code)
  error.code = code
  error.status = status
  return error
}

async function buildRoomStreamPacket({ roomId, decisionLimit = 5 } = {}) {
  const safeRoomId = String(roomId || '').trim()
  if (!safeRoomId) {
    throw httpError('invalid_room_id', 400)
  }

  if (ROOM_EVENTS_PACKET_BUILD_DELAY_MS > 0) {
    await sleep(ROOM_EVENTS_PACKET_BUILD_DELAY_MS)
  }

  const trader = getRegisteredTraderStrict(safeRoomId)
  if (!trader) {
    throw httpError('room_not_found', 404)
  }

  const limit = Math.max(1, Math.min(Number(decisionLimit || 5) || 5, 20))
  const tsMs = Date.now()
  const tz = getMarketSpecForExchange(trader.exchange_id).timezone

  const market = getMarketSpecForExchange(trader.exchange_id).market
  incrementRoomStreamPacketBuildStat(safeRoomId, 'packet_overview_fetch_count')
  incrementRoomStreamPacketBuildStat(safeRoomId, 'packet_digest_fetch_count')
  incrementRoomStreamPacketBuildStat(safeRoomId, 'packet_breadth_fetch_count')
  const [overview, digest, breadth] = await Promise.all([
    getMarketOverviewSnapshot(market),
    getNewsDigestSnapshot(market),
    getMarketBreadthSnapshot(market),
  ])
  const roomContext = await buildRoomChatContext(safeRoomId, {
    overview,
    digest,
    breadth,
    nowMs: tsMs,
  })

  let publicChatMessages = []
  try {
    publicChatMessages = await chatStore.readPublic(safeRoomId, 30, null)
  } catch {
    publicChatMessages = []
  }
  const safePublicChatMessages = Array.isArray(publicChatMessages)
    ? publicChatMessages
    : []
  const latestPublicChatTsMs = Number(
    safePublicChatMessages[safePublicChatMessages.length - 1]?.created_ts_ms || 0
  )

  const runtimeDecisions = agentRuntime?.getLatestDecisions?.(safeRoomId, limit) || []
  let persisted = []
  try {
    persisted = await decisionLogStore.listLatest({
      traderId: safeRoomId,
      limit,
      timeZone: tz,
    })
  } catch {
    persisted = []
  }
  const decisionsLatest = runtimeDecisions.length > 0 ? runtimeDecisions : persisted
  const latestDecision = (decisionsLatest && decisionsLatest[0]) || null

  const head = latestDecision?.decisions?.[0] || null
  const meta = lastDecisionMetaByTraderId.get(safeRoomId) || null
  const metaMatchesDecision = meta
    ? ((meta.decision_ts && meta.decision_ts === String(latestDecision?.timestamp || ''))
      || (Number(meta.cycle_number || 0) > 0 && Number(meta.cycle_number || 0) === Number(latestDecision?.cycle_number || 0)))
    : false
  const effectiveMeta = metaMatchesDecision ? meta : null

  const decisionAuditPreview = latestDecision ? {
    schema_version: 'agent.decision_audit.v1',
    saved_ts_ms: effectiveMeta?.saved_ts_ms || null,
    timestamp: latestDecision?.timestamp || null,
    cycle_number: Number(latestDecision?.cycle_number || 0),
    symbol: head?.symbol || null,
    action: head?.action || null,
    decision_source: latestDecision?.decision_source || null,
    forced_hold: effectiveMeta?.forced_hold || false,
    data_readiness: effectiveMeta?.data_readiness || null,
    session_gate: effectiveMeta?.session_gate || null,
    market_overview: effectiveMeta?.market_overview || null,
    market_breadth: effectiveMeta?.market_breadth || null,
    news_digest: effectiveMeta?.news_digest || null,
  } : null

  return {
    schema_version: 'room.stream_packet.v1',
    room_id: safeRoomId,
    ts_ms: tsMs,
    trader: {
      trader_id: trader.trader_id,
      trader_name: trader.trader_name,
      exchange_id: trader.exchange_id,
      is_running: trader.is_running === true,
    },
    room_context: roomContext,
    market_overview: {
      source_kind: overview?.source_kind || null,
      brief: overview?.brief || '',
      status: overview?.status || null,
    },
    market_breadth: {
      source_kind: breadth?.source_kind || null,
      summary: breadth?.summary || '',
      breadth: breadth?.breadth || null,
      status: breadth?.status || null,
    },
    news_digest: {
      source_kind: digest?.source_kind || null,
      titles: Array.isArray(digest?.titles) ? digest.titles : [],
      status: digest?.status || null,
    },
    status: getStatus(safeRoomId),
    account: getAccount(safeRoomId),
    positions: getPositions(safeRoomId),
    decisions_latest: decisionsLatest,
    decision_latest: latestDecision,
    public_chat_preview: {
      room_id: safeRoomId,
      visibility: 'public',
      messages: safePublicChatMessages,
      count: safePublicChatMessages.length,
      last_ts_ms: Number.isFinite(latestPublicChatTsMs) && latestPublicChatTsMs > 0
        ? latestPublicChatTsMs
        : null,
    },
    decision_audit_preview: decisionAuditPreview,
    decision_meta: effectiveMeta,
    runtime: {
      state: agentRuntime?.getState?.() || null,
      metrics: agentRuntime?.getMetrics?.() || null,
    },
    files: {
      market_overview: {
        cn_a: marketOverviewProviderCn.getStatus(),
        us: marketOverviewProviderUs.getStatus(),
      },
      news_digest: {
        cn_a: newsDigestProviderCn.getStatus(),
        us: newsDigestProviderUs.getStatus(),
      },
      market_breadth: {
        cn_a: marketBreadthProviderCn.getStatus(),
        us: marketBreadthProviderUs.getStatus(),
      },
    },
  }
}

function isValidDayKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim())
}

async function readJsonlRecords(filePath, { limit = 100, fromEnd = true } = {}) {
  return await readJsonlRecordsStreaming(filePath, { limit, fromEnd })
}

async function listDecisionAuditLatest(traderId, { limit = 50 } = {}) {
  const safeTraderId = String(traderId || '').trim()
  if (!safeTraderId) return []

  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500))
  const traderDir = path.join(DECISION_AUDIT_BASE_DIR, safeTraderId)

  let entries = []
  try {
    entries = await readdir(traderDir)
  } catch {
    return []
  }

  const files = entries
    .filter((name) => String(name || '').endsWith('.jsonl'))
    .sort()
    .reverse()

  const records = []
  for (const file of files) {
    const remaining = safeLimit - records.length
    if (remaining <= 0) break
    const fp = path.join(traderDir, file)
    const chunk = await readJsonlRecords(fp, { limit: remaining, fromEnd: true })
    records.push(...chunk)
  }

  records.sort((a, b) => Number(b?.saved_ts_ms || 0) - Number(a?.saved_ts_ms || 0))
  return records.slice(0, safeLimit)
}

async function listDecisionAuditDay(traderId, dayKey, { limit = 2000 } = {}) {
  const safeTraderId = String(traderId || '').trim()
  const safeDayKey = String(dayKey || '').trim()
  if (!safeTraderId || !isValidDayKey(safeDayKey)) return []
  const fp = path.join(DECISION_AUDIT_BASE_DIR, safeTraderId, `${safeDayKey}.jsonl`)
  return await readJsonlRecords(fp, { limit, fromEnd: false })
}

app.get('/api/rooms/:roomId/stream-packet', async (req, res) => {
  try {
    const result = await buildRoomStreamPacketSingleflight({
      roomId: req.params.roomId,
      decisionLimit: req.query.decision_limit,
      caller: 'http',
    })
    res.json(ok(result?.packet || null))
  } catch (error) {
    res
      .status(Number.isFinite(Number(error?.status)) ? Number(error.status) : 500)
      .json({ success: false, error: error?.code || error?.message || 'stream_packet_failed' })
  }
})

app.get('/api/rooms/:roomId/events', async (req, res) => {
  const roomId = String(req.params.roomId || '').trim()
  const decisionLimit = req.query.decision_limit
  const intervalOverride = Number(req.query.interval_ms)
  const packetIntervalMs = Number.isFinite(intervalOverride)
    ? Math.max(2_000, Math.min(Math.floor(intervalOverride), 60_000))
    : ROOM_EVENTS_STREAM_PACKET_INTERVAL_MS
  const decisionLimitNum = Math.max(1, Math.min(Number(decisionLimit || 5) || 5, 20))

  try {
    // Validate room existence early.
    getRegisteredTraderStrict(roomId) || (() => { throw httpError('room_not_found', 404) })()

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // Initial comment to open the stream.
    res.write(': connected\n\n')

    const set = ensureRoomSubscriberSet(roomId)
    if (!set) {
      res.end()
      return
    }

    const client = {
      res,
      roomId,
      decisionLimit,
      decision_limit_num: decisionLimitNum,
      packet_interval_ms: packetIntervalMs,
      connected_ts_ms: Date.now(),
    }
    set.add(client)

    markRoomEventBufferActive(roomId)

    ensureRoomKeepaliveTimer(roomId)
    ensureRoomStreamPacketTimer(roomId)

    // Best-effort replay: if the browser reconnects with Last-Event-ID,
    // replay buffered broadcast events so the client can catch up.
    try {
      const lastEventIdRaw = req.headers['last-event-id']
      const missed = replayRoomEventsSince(roomId, lastEventIdRaw)
      for (const item of missed) {
        writeSseEvent(res, { id: item.id, event: item.event, data: item.data })
      }
    } catch {
      // ignore
    }

    // Push an initial packet immediately.
    try {
      const result = await buildRoomStreamPacketSingleflight({
        roomId,
        decisionLimit: decisionLimitNum,
        caller: 'sse_initial',
      })
      if (result?.packet) {
        writeSseEvent(res, { id: nextRoomEventId(roomId), event: 'stream_packet', data: result.packet })
      }
    } catch (error) {
      writeSseEvent(res, { event: 'error', data: { error: error?.code || error?.message || 'stream_packet_failed' } })
    }

    req.on('close', () => {
      try {
        set.delete(client)
      } catch {
        // ignore
      }
      if (set.size === 0) {
        roomEventSubscribersByRoom.delete(roomId)
        markRoomEventBufferExpiring(roomId, Date.now())
        clearRoomKeepaliveTimer(roomId)
        clearRoomStreamPacketTimer(roomId)
        maybeDeleteRoomStreamPacketBuildState(roomId)
      } else {
        // Re-evaluate desired per-room packet interval when subscriber set changes.
        ensureRoomStreamPacketTimer(roomId)
      }
    })
  } catch (error) {
    res
      .status(Number.isFinite(Number(error?.status)) ? Number(error.status) : 500)
      .json({ success: false, error: error?.code || error?.message || 'room_events_failed' })
  }
})

app.get('/api/_test/rooms/:roomId/packet-build-stats', (req, res) => {
  if (!ROOM_EVENTS_TEST_MODE) {
    res.status(404).json({ success: false, error: 'not_found' })
    return
  }

  const stats = getRoomStreamPacketBuildStats(req.params.roomId)
  if (!stats) {
    res.status(404).json({ success: false, error: 'room_not_found' })
    return
  }
  res.json(ok(stats))
})

app.get('/api/agents/:agentId/decision-audit/latest', async (req, res) => {
  try {
    const agentId = String(req.params.agentId || '').trim()
    const trader = getRegisteredTraderStrict(agentId)
    if (!trader) {
      res.status(404).json({ success: false, error: 'agent_not_registered' })
      return
    }

    const limit = Math.max(1, Math.min(Number(req.query.limit || 50) || 50, 500))
    const records = await listDecisionAuditLatest(agentId, { limit })
    res.json(ok({
      trader_id: agentId,
      count: records.length,
      records,
    }))
  } catch (error) {
    res.status(500).json({ success: false, error: error?.code || error?.message || 'decision_audit_latest_failed' })
  }
})

app.get('/api/agents/:agentId/decision-audit/day', async (req, res) => {
  try {
    const agentId = String(req.params.agentId || '').trim()
    const trader = getRegisteredTraderStrict(agentId)
    if (!trader) {
      res.status(404).json({ success: false, error: 'agent_not_registered' })
      return
    }

    const dayKey = String(req.query.day_key || '').trim()
    if (!isValidDayKey(dayKey)) {
      res.status(400).json({ success: false, error: 'invalid_day_key' })
      return
    }

    const limit = Math.max(1, Math.min(Number(req.query.limit || 2000) || 2000, 5000))
    const records = await listDecisionAuditDay(agentId, dayKey, { limit })
    res.json(ok({
      trader_id: agentId,
      day_key: dayKey,
      count: records.length,
      records,
    }))
  } catch (error) {
    res.status(500).json({ success: false, error: error?.code || error?.message || 'decision_audit_day_failed' })
  }
})

app.get('/api/bets/market', async (req, res) => {
  try {
    const traderId = String(req.query.trader_id || '').trim()
    const userSessionId = String(req.query.user_session_id || '').trim()
    const requestedMarket = String(req.query.market || '').trim().toUpperCase()

    let market = requestedMarket === 'US' ? 'US' : 'CN-A'
    if (traderId) {
      const trader = getTraderById(traderId)
      const traderMarket = getMarketSpecForExchange(trader?.exchange_id).market
      market = traderMarket === 'US' ? 'US' : 'CN-A'
    }

    const payload = await buildBetsMarketPayload({ market, userSessionId })
    res.json(ok(payload))
  } catch (error) {
    res.status(500).json({ success: false, error: error?.code || error?.message || 'bets_market_failed' })
  }
})

app.post('/api/bets/place', async (req, res) => {
  try {
    const userSessionId = String(req.body?.user_session_id || '').trim()
    const userNickname = String(req.body?.user_nickname || '').trim()
    const traderId = String(req.body?.trader_id || '').trim()
    const stakeAmount = req.body?.stake_amount

    const payload = await placeViewerBet({
      userSessionId,
      userNickname,
      traderId,
      stakeAmount,
    })

    res.json(ok(payload))
  } catch (error) {
    const status = Number.isFinite(Number(error?.status)) ? Number(error.status) : 500
    res.status(status).json({ success: false, error: error?.code || error?.message || 'bets_place_failed' })
  }
})

app.get('/api/bets/credits', async (req, res) => {
  try {
    const userSessionId = String(req.query.user_session_id || '').trim()
    const limit = Math.max(1, Math.min(Number(req.query.limit || 20) || 20, 200))
    const records = Object.values(betsLedgerState.credits_by_session || {})
      .filter((row) => row && typeof row === 'object')
      .map((row) => ({
        user_session_id: String(row.user_session_id || ''),
        user_nickname: String(row.user_nickname || ''),
        credit_points: Math.max(0, Math.floor(Number(row.credit_points || 0))),
        settled_bets: Math.max(0, Math.floor(Number(row.settled_bets || 0))),
        win_count: Math.max(0, Math.floor(Number(row.win_count || 0))),
        updated_ts_ms: Number(row.updated_ts_ms || 0) || null,
      }))
      .sort((a, b) => {
        if (b.credit_points !== a.credit_points) return b.credit_points - a.credit_points
        if (b.win_count !== a.win_count) return b.win_count - a.win_count
        return Number(b.updated_ts_ms || 0) - Number(a.updated_ts_ms || 0)
      })

    const myCredits = userSessionId
      ? records.find((row) => row.user_session_id === userSessionId) || null
      : null

    res.json(ok({
      schema_version: 'bets.credits.v1',
      count: records.length,
      leaderboard: records.slice(0, limit),
      my_credits: myCredits,
    }))
  } catch (error) {
    res.status(500).json({ success: false, error: error?.code || error?.message || 'bets_credits_failed' })
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

  const traderExchangeId = traderId ? String(getTraderById(traderId)?.exchange_id || '') : ''
  const tz = getMarketSpecForExchange(traderExchangeId).timezone

  if (!traderId) {
    res.json(ok(runtimeDecisions))
    return
  }

  Promise.resolve()
    .then(async () => {
      const logged = await decisionLogStore.listLatest({ traderId, limit: safeLimit, timeZone: tz })
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
        const todayKey = dayKeyInTimeZone(Date.now(), tz)
        const filtered = recent.filter((action) => {
          const ts = Date.parse(String(action?.ts || ''))
          if (!Number.isFinite(ts)) return false
          return dayKeyInTimeZone(ts, tz) === todayKey
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

app.get('/api/agent/runtime/status', async (_req, res) => {
  if (RUNTIME_DATA_MODE === 'live_file') {
    await refreshLiveFileProviders()
    await refreshSupplementalLiveProviders()
  }

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
  const ttsCapabilities = ttsProviderCapabilities()
  const ttsDefaultProvider = effectiveTtsDefaultProvider()
  const ttsDefaultModel = ttsDefaultProvider === 'selfhosted' ? 'selfhosted' : CHAT_TTS_MODEL
  const ttsDefaultFormat = ttsDefaultProvider === 'selfhosted'
    ? CHAT_TTS_SELFHOSTED_MEDIA_TYPE
    : CHAT_TTS_RESPONSE_FORMAT

  res.json(ok({
    ...state,
    cycle_ms: derivedDecisionCycleMs(),
    metrics,
    decision_every_bars: agentDecisionEveryBars,
    symbol_selection: {
      strict_symbol_loop: AGENT_STRICT_SYMBOL_LOOP,
    },
    market_session_guard: getMarketSessionGatePublicSnapshot(),
    market_overview_files: {
      cn_a: marketOverviewProviderCn.getStatus(),
      us: marketOverviewProviderUs.getStatus(),
    },
    news_digest_files: {
      cn_a: newsDigestProviderCn.getStatus(),
      us: newsDigestProviderUs.getStatus(),
    },
    market_breadth_files: {
      cn_a: marketBreadthProviderCn.getStatus(),
      us: marketBreadthProviderUs.getStatus(),
    },
    live_data_freshness: buildLiveDataFreshnessSummary(),
    chat_streaming: {
      proactive_interval_ms: Math.max(10_000, Number(process.env.CHAT_PUBLIC_PROACTIVE_INTERVAL_MS || 18_000)),
      proactive_news_burst_enabled: CHAT_PROACTIVE_NEWS_BURST_ENABLED,
      proactive_news_burst_interval_ms: CHAT_PROACTIVE_NEWS_BURST_INTERVAL_MS,
      proactive_news_burst_duration_ms: CHAT_PROACTIVE_NEWS_BURST_DURATION_MS,
      proactive_news_burst_cooldown_ms: CHAT_PROACTIVE_NEWS_BURST_COOLDOWN_MS,
      proactive_news_burst_fresh_ms: CHAT_PROACTIVE_NEWS_BURST_FRESH_MS,
      proactive_news_burst_min_priority: CHAT_PROACTIVE_NEWS_BURST_MIN_PRIORITY,
      proactive_llm_enabled: !!chatLlmResponder,
      proactive_llm_model: chatLlmResponder ? CHAT_OPENAI_MODEL : null,
      proactive_llm_max_concurrency: CHAT_PROACTIVE_LLM_MAX_CONCURRENCY,
      proactive_llm_in_flight: proactiveLlmInFlight,
      agent_max_chars: CHAT_AGENT_MAX_CHARS,
      agent_max_sentences: CHAT_AGENT_MAX_SENTENCES,
      proactive_generation_stats: getProactiveGenerationStatsPublicSnapshot(),
      decision_narration_enabled: CHAT_DECISION_NARRATION_ENABLED,
      decision_narration_use_llm: CHAT_DECISION_NARRATION_USE_LLM,
      decision_narration_min_interval_ms: CHAT_DECISION_NARRATION_MIN_INTERVAL_MS,
      decision_narration_hold_interval_ms: CHAT_DECISION_NARRATION_HOLD_INTERVAL_MS,
      decision_narration_conservative_hold_interval_ms: CHAT_DECISION_NARRATION_CONSERVATIVE_HOLD_INTERVAL_MS,
      tts_enabled: CHAT_TTS_ENABLED && (ttsCapabilities.openai.enabled || ttsCapabilities.selfhosted.enabled),
      tts_provider: ttsDefaultProvider,
      tts_provider_default: ttsDefaultProvider,
      tts_model: ttsDefaultModel,
      tts_response_format: ttsDefaultFormat,
      tts_speed: CHAT_TTS_SPEED,
      tts_tone_modes: ['energetic'],
      tts_tone_speed_map: {
        energetic: CHAT_TTS_TONE_SPEED_ENERGETIC,
      },
      tts_max_chars: CHAT_TTS_MAX_CHARS,
      tts_voice_map: ttsVoicesSummary(),
      tts_provider_capabilities: ttsCapabilities,
      tts_room_profiles: ttsRoomProfilesSummary(),
    },
    kill_switch: killSwitchPublicState(),
    llm: {
      enabled: !!llmDecider,
      effective_enabled: !!llmDecider && !killSwitchState.active,
      model: llmDecider ? AGENT_OPENAI_MODEL : null,
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
  if (!requireControlAuthorization(req, res, { action: `agent.runtime.control.${action || 'unknown'}`, target: 'agent_runtime' })) return

  if (!agentRuntime) {
    auditControlAction({ req, action: `agent.runtime.control.${action || 'unknown'}`, target: 'agent_runtime', result: 'rejected', error: 'agent_runtime_unavailable' })
    res.status(503).json({ success: false, error: 'agent_runtime_unavailable' })
    return
  }

  if (killSwitchState.active && (action === 'resume' || action === 'step')) {
    auditControlAction({ req, action: `agent.runtime.control.${action}`, target: 'agent_runtime', result: 'rejected', error: 'kill_switch_active' })
    res.status(423).json({ success: false, error: 'kill_switch_active' })
    return
  }

  if (action === 'pause') {
    agentRuntime.pause()
    agentRuntimeManualPause = true
  } else if (action === 'resume') {
    agentRuntimeManualPause = false
    // Resume only if market gate allows running traders.
    await syncMarketSessionGate({ reason: 'manual_resume', nowMs: Date.now() })
  } else if (action === 'step') {
    await agentRuntime.stepOnce()
  } else if (action === 'set_cycle_ms') {
    const cycleMs = Number(req.body?.cycle_ms)
    if (!Number.isFinite(cycleMs)) {
      auditControlAction({ req, action: 'agent.runtime.control.set_cycle_ms', target: 'agent_runtime', result: 'invalid', error: 'invalid_cycle_ms' })
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
      auditControlAction({ req, action: 'agent.runtime.control.set_decision_every_bars', target: 'agent_runtime', result: 'invalid', error: 'invalid_decision_every_bars' })
      res.status(400).json({ success: false, error: 'invalid_decision_every_bars' })
      return
    }
    agentDecisionEveryBars = Math.max(1, Math.min(Math.floor(bars), 240))
  } else {
    auditControlAction({ req, action: `agent.runtime.control.${action || 'unknown'}`, target: 'agent_runtime', result: 'invalid', error: 'invalid_action' })
    res.status(400).json({ success: false, error: 'invalid_action' })
    return
  }

  auditControlAction({ req, action: `agent.runtime.control.${action}`, target: 'agent_runtime', result: 'ok' })

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
  const action = String(req.body?.action || '').trim().toLowerCase()
  if (!requireControlAuthorization(req, res, { action: `agent.runtime.kill_switch.${action || 'unknown'}`, target: 'agent_runtime' })) return

  const reason = String(req.body?.reason || '').trim()
  const actor = String(req.body?.actor || req.ip || 'api').trim() || 'api'

  if (action !== 'activate' && action !== 'deactivate') {
    auditControlAction({ req, action: `agent.runtime.kill_switch.${action || 'unknown'}`, target: 'agent_runtime', result: 'invalid', error: 'invalid_action' })
    res.status(400).json({ success: false, error: 'invalid_action' })
    return
  }

  await setKillSwitch({
    active: action === 'activate',
    reason,
    actor,
  })

  auditControlAction({ req, action: `agent.runtime.kill_switch.${action}`, target: 'agent_runtime', result: 'ok' })

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
  if (RUNTIME_DATA_MODE === 'live_file') {
    await refreshLiveFileProviders()
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

  const cnLive = RUNTIME_DATA_MODE === 'live_file' ? (liveFileFrameProviderCn?.getStatus?.() || null) : null
  const usLive = RUNTIME_DATA_MODE === 'live_file' ? (liveFileFrameProviderUs?.getStatus?.() || null) : null

  res.json(ok({
    ...replayState,
    data_mode: RUNTIME_DATA_MODE,
    live_file: cnLive,
    live_files: {
      'CN-A': cnLive,
      US: usLive,
    },
    symbols: symbolList().map((item) => item.symbol),
  }))
})

app.get('/api/ops/live-preflight', async (_req, res) => {
  await refreshAgentState({ reconcile: true })
  await refreshLiveFileProviders()
  await refreshSupplementalLiveProviders()
  const payload = buildLivePreflightPayload()
  res.json(ok(payload))
})

app.post('/api/replay/runtime/control', (req, res) => {
  const action = String(req.body?.action || '').trim().toLowerCase()
  if (!requireControlAuthorization(req, res, { action: `replay.runtime.control.${action || 'unknown'}`, target: 'replay_runtime' })) return

  if (!replayEngine) {
    auditControlAction({ req, action: `replay.runtime.control.${action || 'unknown'}`, target: 'replay_runtime', result: 'rejected', error: 'replay_unavailable' })
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
      auditControlAction({ req, action: 'replay.runtime.control.set_speed', target: 'replay_runtime', result: 'invalid', error: 'invalid_speed' })
      res.status(400).json({ success: false, error: 'invalid_speed' })
      return
    }
    replayEngine.setSpeed(speed)
  } else if (action === 'set_cursor') {
    const cursor = Number(req.body?.cursor_index)
    if (!Number.isFinite(cursor)) {
      auditControlAction({ req, action: 'replay.runtime.control.set_cursor', target: 'replay_runtime', result: 'invalid', error: 'invalid_cursor_index' })
      res.status(400).json({ success: false, error: 'invalid_cursor_index' })
      return
    }
    replayEngine.setCursor(cursor)
  } else if (action === 'set_loop') {
    const loop = req.body?.loop
    if (typeof loop !== 'boolean') {
      auditControlAction({ req, action: 'replay.runtime.control.set_loop', target: 'replay_runtime', result: 'invalid', error: 'invalid_loop' })
      res.status(400).json({ success: false, error: 'invalid_loop' })
      return
    }
    replayEngine.setLoop(loop)
  } else {
    auditControlAction({ req, action: `replay.runtime.control.${action || 'unknown'}`, target: 'replay_runtime', result: 'invalid', error: 'invalid_action' })
    res.status(400).json({ success: false, error: 'invalid_action' })
    return
  }

  auditControlAction({ req, action: `replay.runtime.control.${action}`, target: 'replay_runtime', result: 'ok' })

  res.json(ok({
    action,
    state: replayEngine.getStatus(),
  }))
})

app.post('/api/dev/factory-reset', async (req, res) => {
  if (!requireControlAuthorization(req, res, { action: 'dev.factory_reset', target: 'runtime' })) return

  try {
    const confirm = String(req.body?.confirm || '').trim()
    const dryRun = String(req.body?.dry_run ?? 'false').toLowerCase() === 'true'
    if (confirm !== 'RESET') {
      auditControlAction({ req, action: 'dev.factory_reset', target: 'runtime', result: 'rejected', error: 'reset_confirmation_required' })
      res.status(400).json({ success: false, error: 'reset_confirmation_required' })
      return
    }

    const useWarmup = String(req.body?.use_warmup ?? 'false').toLowerCase() === 'true'
    const warmupCursor = Math.max(0, REPLAY_WARMUP_BARS - 1)
    const requestedCursor = Number(req.body?.cursor_index)
    const cursorIndex = Number.isFinite(requestedCursor)
      ? Math.max(0, Math.floor(requestedCursor))
      : (useWarmup ? warmupCursor : 0)

    if (dryRun) {
      auditControlAction({ req, action: 'dev.factory_reset', target: 'runtime', result: 'dry_run' })
      res.json(ok({
        action: 'factory_reset',
        dry_run: true,
        cursor_index: cursorIndex,
        use_warmup: useWarmup,
      }))
      return
    }

    const state = await factoryResetRuntime({ cursorIndex })
    auditControlAction({ req, action: 'dev.factory_reset', target: 'runtime', result: 'ok' })
    res.json(ok({
      action: 'factory_reset',
      cursor_index: cursorIndex,
      use_warmup: useWarmup,
      dry_run: false,
      state,
    }))
  } catch (error) {
    auditControlAction({ req, action: 'dev.factory_reset', target: 'runtime', result: 'error', error: error?.message || 'factory_reset_failed' })
    res.status(500).json({ success: false, error: error?.message || 'factory_reset_failed' })
  }
})

app.post('/api/dev/reset-agent', async (req, res) => {
  const traderId = String(req.body?.trader_id || '').trim()
  if (!requireControlAuthorization(req, res, { action: 'dev.reset_agent', target: traderId || null })) return

  if (!traderId) {
    auditControlAction({ req, action: 'dev.reset_agent', target: null, result: 'invalid', error: 'invalid_trader_id' })
    res.status(400).json({ success: false, error: 'invalid_trader_id' })
    return
  }

  const trader = getTraderById(traderId)
  if (String(trader?.trader_id || '') !== traderId) {
    auditControlAction({ req, action: 'dev.reset_agent', target: traderId, result: 'invalid', error: 'trader_not_found' })
    res.status(404).json({ success: false, error: 'trader_not_found' })
    return
  }

  const confirm = String(req.body?.confirm || '').trim()
  if (confirm !== traderId) {
    auditControlAction({ req, action: 'dev.reset_agent', target: traderId, result: 'rejected', error: 'reset_confirmation_required' })
    res.status(400).json({ success: false, error: 'reset_confirmation_required' })
    return
  }

  const resetMemory = String(req.body?.reset_memory ?? 'false').toLowerCase() === 'true'
  const resetPositions = String(req.body?.reset_positions ?? 'false').toLowerCase() === 'true'
  const resetStats = String(req.body?.reset_stats ?? 'false').toLowerCase() === 'true'
  const dryRun = String(req.body?.dry_run ?? 'false').toLowerCase() === 'true'

  if (!resetMemory && !resetPositions && !resetStats) {
    auditControlAction({ req, action: 'dev.reset_agent', target: traderId, result: 'invalid', error: 'no_reset_scope_selected' })
    res.status(400).json({ success: false, error: 'no_reset_scope_selected' })
    return
  }

  if (dryRun) {
    auditControlAction({ req, action: 'dev.reset_agent', target: traderId, result: 'dry_run' })
    res.json(ok({
      action: 'reset_agent',
      trader_id: traderId,
      reset_memory: resetMemory,
      reset_positions: resetPositions,
      reset_stats: resetStats,
      dry_run: true,
    }))
    return
  }

  try {
    const snapshot = await memoryStore.resetTrader(traderId, {
      resetMemory,
      resetPositions,
      resetStats,
      persistSnapshot: true,
    })
    auditControlAction({ req, action: 'dev.reset_agent', target: traderId, result: 'ok' })
    res.json(ok({
      action: 'reset_agent',
      trader_id: traderId,
      reset_memory: resetMemory,
      reset_positions: resetPositions,
      reset_stats: resetStats,
      dry_run: false,
      memory: snapshot,
    }))
  } catch (error) {
    const code = String(error?.code || '')
    if (code === 'memory_trader_not_found') {
      auditControlAction({ req, action: 'dev.reset_agent', target: traderId, result: 'error', error: 'trader_not_found' })
      res.status(404).json({ success: false, error: 'trader_not_found' })
      return
    }

    auditControlAction({ req, action: 'dev.reset_agent', target: traderId, result: 'error', error: error?.message || 'reset_agent_failed' })
    res.status(500).json({ success: false, error: error?.message || 'reset_agent_failed' })
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
    const marketSpec = getMarketSpecForExchange(getTraderById(traderId)?.exchange_id)
    const positionState = buildPositionState({ symbol, account, positions })
    const intradayFrames = Array.isArray(intradayBatch?.frames) ? intradayBatch.frames : []
    const latestEventTs = intradayFrames[intradayFrames.length - 1]?.event_ts_ms
    const payload = buildAgentMarketContext({
      symbol,
      asOfTsMs: Number.isFinite(latestEventTs) ? latestEventTs : Date.now(),
      intradayBatch,
      dailyBatch,
      positionState,
      marketSpec,
    })

    payload.runtime_config = {
      commission_rate: AGENT_COMMISSION_RATE,
      lot_size: marketSpec.lot_size,
      t_plus_one: marketSpec.t_plus_one,
      currency: marketSpec.currency,
    }

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
  res.json(ok({ message: 'Virtual position close queued in runtime-api mode' }))
})

app.use('/api', (_req, res) => {
  const payload = fail('not_found', 404)
  res.status(404).json({ success: false, error: payload.error })
})

await loadKillSwitchState()
await loadTtsProfilesState()
await loadReplayBatch()
await loadDailyHistoryBatch()
await loadBetsLedgerState()
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
  onDecision: async ({ trader, decision, context }) => {
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
      const tz = getMarketSpecForExchange(trader.exchange_id).timezone
      await decisionLogStore.appendDecision({ traderId: trader.trader_id, decision, timeZone: tz })
    } catch {
      // keep runtime robust: failure to persist decisions must not break trading loop
    }

    try {
      lastDecisionMetaByTraderId.set(trader.trader_id, {
        saved_ts_ms: Date.now(),
        decision_ts: String(decision?.timestamp || ''),
        cycle_number: Number(decision?.cycle_number || 0),
        thinking_symbol: String(
          context?.symbol
          || context?.symbol_brief?.symbol
          || decision?.decisions?.[0]?.symbol
          || ''
        ).trim() || null,
        forced_hold: context?.llm_decision?.source === 'readiness_gate',
        data_readiness: context?.data_readiness || null,
        session_gate: context?.session_gate || null,
        market_overview: context?.market_overview || null,
        market_breadth: context?.market_breadth || null,
        news_digest: context?.news_digest || null,
      })
    } catch {
      // ignore
    }

    try {
      broadcastRoomEvent(trader.trader_id, 'decision', {
        schema_version: 'room.decision_event.v1',
        room_id: trader.trader_id,
        ts_ms: Date.now(),
        decision,
        decision_meta: lastDecisionMetaByTraderId.get(trader.trader_id) || null,
      })
    } catch {
      // ignore
    }

    try {
      const tz = getMarketSpecForExchange(trader.exchange_id).timezone
      const head = decision?.decisions?.[0] || null
      const headSymbol = String(head?.symbol || '')
      const action = String(head?.action || '').toLowerCase()
      const matchedPosition = Array.isArray(positions)
        ? positions.find((item) => String(item?.symbol || '') === headSymbol)
        : null
      const positionSharesOnSymbol = Number(
        matchedPosition?.quantity ?? matchedPosition?.shares ?? 0
      )
      const orderExecuted = Boolean(head?.executed)
      const holdWithoutPosition = (
        action === 'hold'
        && !orderExecuted
        && positionSharesOnSymbol <= 0
      )
      const holdWithPosition = (
        action === 'hold'
        && !orderExecuted
        && positionSharesOnSymbol > 0
      )

      await decisionAuditStore.appendAudit({
        traderId: trader.trader_id,
        timeZone: tz,
        audit: {
          timestamp: decision?.timestamp || new Date().toISOString(),
          cycle_number: Number(decision?.cycle_number || 0),
          symbol: head?.symbol || null,
          action: head?.action || null,
          decision_source: decision?.decision_source || null,
          forced_hold: context?.llm_decision?.source === 'readiness_gate',
          order_executed: orderExecuted,
          position_shares_on_symbol: Number.isFinite(positionSharesOnSymbol)
            ? positionSharesOnSymbol
            : 0,
          hold_semantics: holdWithoutPosition
            ? 'no_position_no_order'
            : holdWithPosition
              ? 'keep_existing_position'
              : null,
          data_readiness: context?.data_readiness || null,
          session_gate: context?.session_gate || null,
          market_overview: context?.market_overview || null,
          market_breadth: context?.market_breadth || null,
          news_digest: context?.news_digest || null,
          live_files: {
            cn_a: publicLiveFileStatus(liveFileFrameProviderCn?.getStatus?.() || null),
            us: publicLiveFileStatus(liveFileFrameProviderUs?.getStatus?.() || null),
          },
        },
      })
    } catch {
      // ignore: audit is best-effort
    }

    try {
      await maybeEmitDecisionNarration({ trader, decision, context })
    } catch {
      // ignore: narration is best-effort
    }
  },
})

agentRuntime.start()
await refreshAgentState()

if (CHAT_PROACTIVE_VIEWER_TICK_ENABLED) {
  proactiveViewerTickTimer = setInterval(() => {
    try {
      tickChatProactiveForRoomsWithViewers()
    } catch {
      // ignore
    }
  }, CHAT_PROACTIVE_VIEWER_TICK_MS)
}

if (killSwitchState.active) {
  replayEngine?.pause?.()
  agentRuntime?.pause?.()
  replayBarsSinceAgentDecision = 0
  queuedAgentDecisionSteps = 0
  agentDispatchInFlight = false
}

if (AGENT_SESSION_GUARD_ENABLED && RUNTIME_DATA_MODE === 'live_file') {
  syncMarketSessionGate({ reason: 'boot', nowMs: Date.now() }).catch(() => {})
  marketSessionGateTimer = setInterval(() => {
    syncMarketSessionGate({ reason: 'interval', nowMs: Date.now() }).catch(() => {})
  }, AGENT_SESSION_GUARD_CHECK_MS)
}

function handleShutdown() {
  agentRuntime?.stop()
  if (proactiveViewerTickTimer) {
    clearInterval(proactiveViewerTickTimer)
    proactiveViewerTickTimer = null
  }
  if (marketSessionGateTimer) {
    clearInterval(marketSessionGateTimer)
    marketSessionGateTimer = null
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
    ? `llm=openai decision_model=${AGENT_OPENAI_MODEL} chat_model=${chatLlmResponder ? CHAT_OPENAI_MODEL : 'disabled'} timeout_ms=${AGENT_LLM_TIMEOUT_MS} token_saver=${AGENT_LLM_DEV_TOKEN_SAVER} max_output_tokens=${AGENT_LLM_MAX_OUTPUT_TOKENS}`
    : 'llm=disabled (set OPENAI_API_KEY to enable gpt-4o-mini)'
  const startupTtsCapabilities = ttsProviderCapabilities()
  const startupTtsDefaultProvider = effectiveTtsDefaultProvider()
  const ttsEnabledAtBoot = CHAT_TTS_ENABLED
    && (startupTtsCapabilities.openai.enabled || startupTtsCapabilities.selfhosted.enabled)
  const ttsInfo = ttsEnabledAtBoot
    ? `chat_tts=enabled default_provider=${startupTtsDefaultProvider} openai=${startupTtsCapabilities.openai.enabled ? 'on' : 'off'} selfhosted=${startupTtsCapabilities.selfhosted.enabled ? 'on' : 'off'} model=${startupTtsDefaultProvider === 'selfhosted' ? 'selfhosted' : CHAT_TTS_MODEL} format=${startupTtsDefaultProvider === 'selfhosted' ? CHAT_TTS_SELFHOSTED_MEDIA_TYPE : CHAT_TTS_RESPONSE_FORMAT} speed=${CHAT_TTS_SPEED}`
    : `chat_tts=disabled enabled_flag=${CHAT_TTS_ENABLED} openai_key=${OPENAI_API_KEY ? 'configured' : 'missing'} selfhosted_url=${CHAT_TTS_SELFHOSTED_URL ? 'configured' : 'missing'}`
  const replayRuntimeInfo = RUNTIME_DATA_MODE === 'live_file'
    ? `data_mode=live_file live_frames_cn=${LIVE_FRAMES_PATH_CN} live_frames_us=${LIVE_FRAMES_PATH_US} refresh_ms=${LIVE_FILE_REFRESH_MS} stale_ms=${LIVE_FILE_STALE_MS}`
    : (replayEngine?.getStatus?.()
      ? `replay_runtime speed=${replayEngine.getStatus().speed}x tick_ms=${REPLAY_TICK_MS}`
      : 'replay_runtime unavailable')
  const registryInfo = `agent_registry path=${AGENT_REGISTRY_PATH}`
  const agentInfo = `agents_dir=${AGENTS_DIR} available=${availableAgents.length} registered=${registeredAgents.length}`
  console.log(`[runtime-api] listening on http://localhost:${PORT}`)
  console.log(`[runtime-api] ${replayInfo}`)
  console.log(`[runtime-api] ${dailyHistoryInfo}`)
  console.log(`[runtime-api] ${providerInfo}`)
  console.log(`[runtime-api] ${strictLiveInfo}`)
  console.log(`[runtime-api] ${runtimeInfo}`)
  console.log(`[runtime-api] ${controlInfo}`)
  console.log(`[runtime-api] ${killSwitchInfo}`)
  console.log(`[runtime-api] ${resetInfo}`)
  console.log(`[runtime-api] ${llmInfo}`)
  console.log(`[runtime-api] ${ttsInfo}`)
  console.log(`[runtime-api] ${replayRuntimeInfo}`)
  console.log(`[runtime-api] ${registryInfo}`)
  console.log(`[runtime-api] ${agentInfo}`)
})
