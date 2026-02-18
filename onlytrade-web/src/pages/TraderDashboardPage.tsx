import { useEffect, useState, useRef, useMemo } from 'react'
import useSWR from 'swr'
import { ChartTabs } from '../components/ChartTabs'
import { DecisionCard } from '../components/DecisionCard'
import { PositionHistory } from '../components/PositionHistory'
import { TraderAvatar } from '../components/TraderAvatar'
import { formatPrice, formatQuantity } from '../utils/format'
import { t, type Language } from '../i18n/translations'
import { MessageSquare } from 'lucide-react'
import { DeepVoidBackground } from '../components/DeepVoidBackground'
import { RoomPublicChatPanel } from '../components/chat/RoomPublicChatPanel'
import { RoomPrivateChatPanel } from '../components/chat/RoomPrivateChatPanel'
import { AuditExplorerPanel } from '../components/AuditExplorerPanel'
import { RoomClockBadge } from '../components/RoomClockBadge'
import { api } from '../lib/api'
import { useUserSessionId } from '../hooks/useUserSessionId'
import type {
  SystemStatus,
  AccountInfo,
  Position,
  DecisionRecord,
  TraderInfo,
  RoomStreamPacket,
  ReplayRuntimeStatus,
  ViewerBetMarketPayload,
} from '../types'

type RoomSseStatus = 'connecting' | 'connected' | 'reconnecting' | 'error'
type RoomSseState = {
  status: RoomSseStatus
  last_open_ts_ms: number | null
  last_error_ts_ms: number | null
  last_event_ts_ms: number | null
}

// --- Helper Functions ---

// 获取友好的AI模型名称
function getModelDisplayName(modelId: string): string {
  switch (modelId.toLowerCase()) {
    case 'deepseek':
      return 'DeepSeek'
    case 'qwen':
      return 'Qwen'
    case 'claude':
      return 'Claude'
    default:
      return modelId.toUpperCase()
  }
}

function getMarketDisplay(exchangeId: string | undefined): string {
  if (!exchangeId) return 'CN-SIM'
  if (exchangeId.toLowerCase().includes('sim-cn')) return 'CN-SIM'
  if (exchangeId.toLowerCase().includes('sim-us')) return 'US-SIM'
  return exchangeId.toUpperCase()
}

function getExchangeType(exchangeId: string | undefined): string {
  if (!exchangeId) return 'sim-cn'
  if (exchangeId.toLowerCase().includes('sim-cn')) return 'sim-cn'
  return exchangeId.toLowerCase()
}

// --- Components ---

interface TraderDashboardPageProps {
  selectedTrader?: TraderInfo
  traders?: TraderInfo[]
  tradersError?: Error
  selectedTraderId?: string
  onTraderSelect: (traderId: string) => void
  onNavigateToLobby: () => void
  status?: SystemStatus
  account?: AccountInfo
  positions?: Position[]
  decisions?: DecisionRecord[]
  streamPacket?: RoomStreamPacket
  roomSseState?: RoomSseState
  replayRuntimeStatus?: ReplayRuntimeStatus
  decisionsLimit: number
  onDecisionsLimitChange: (limit: number) => void
  lastUpdate: string
  language: Language
}

export function TraderDashboardPage({
  selectedTrader,
  status,
  account,
  positions,
  decisions,
  streamPacket,
  roomSseState,
  replayRuntimeStatus,
  decisionsLimit,
  onDecisionsLimitChange,
  lastUpdate,
  language,
  traders,
  tradersError,
  selectedTraderId,
  onTraderSelect,
  onNavigateToLobby,
}: TraderDashboardPageProps) {
  const quoteCurrency = selectedTrader?.exchange_id
    ?.toLowerCase()
    .includes('sim-us')
    ? 'USD'
    : 'CNY'
  const decisionsScrollRef = useRef<HTMLDivElement | null>(null)
  const [highlightDecisionCycle, setHighlightDecisionCycle] =
    useState<number>(0)

  const { data: latestDecisionsFallback } = useSWR<DecisionRecord[]>(
    selectedTrader?.trader_id
      ? `dashboard-latest-decisions-${selectedTrader.trader_id}-${decisionsLimit}`
      : null,
    () =>
      api.getLatestDecisions(
        selectedTrader!.trader_id,
        Math.max(5, Number(decisionsLimit) || 5)
      ),
    {
      refreshInterval: 10000,
      revalidateOnFocus: false,
      dedupingInterval: 2000,
    }
  )

  const effectiveDecisions = useMemo(() => {
    if (Array.isArray(decisions) && decisions.length > 0) {
      return decisions
    }
    return Array.isArray(latestDecisionsFallback) ? latestDecisionsFallback : []
  }, [decisions, latestDecisionsFallback])

  useEffect(() => {
    const handler = (evt: any) => {
      try {
        const detail = evt?.detail || {}
        const cycle = Number(detail?.cycle_number || 0)
        const timestamp = String(detail?.timestamp || '').trim()

        const container = decisionsScrollRef.current
        if (!container) return

        let target: HTMLElement | null = null
        if (Number.isFinite(cycle) && cycle > 0) {
          target = container.querySelector(
            `[data-decision-cycle="${String(cycle)}"]`
          )
        }
        if (!target && timestamp) {
          target = container.querySelector(
            `[data-decision-ts="${CSS.escape(timestamp)}"]`
          )
        }
        if (!target) return

        container.scrollTop = Math.max(0, (target as any).offsetTop - 8)

        if (Number.isFinite(cycle) && cycle > 0) {
          setHighlightDecisionCycle(cycle)
          window.setTimeout(() => {
            setHighlightDecisionCycle((prev) => (prev === cycle ? 0 : prev))
          }, 1800)
        }
      } catch {
        // ignore
      }
    }

    window.addEventListener('jump-to-decision', handler as any)
    return () => {
      window.removeEventListener('jump-to-decision', handler as any)
    }
  }, [])

  const noDecisionsHint = (() => {
    if (!selectedTrader) return null
    if (!selectedTrader.is_running) {
      return language === 'zh'
        ? '该交易员当前未运行：请先在大厅启动。'
        : 'This trader is stopped. Start it in the lobby first.'
    }

    const gate = status?.market_gate
    if (!gate) {
      return t('aiDecisionsWillAppear', language)
    }
    if (gate.kill_switch_active) {
      return language === 'zh'
        ? '已触发紧急停止（Kill Switch）：系统暂停生成新的决策。'
        : 'Kill switch is active: decisions are paused.'
    }
    if (gate.manual_paused) {
      return language === 'zh'
        ? '运行已手动暂停：恢复运行后将继续产生决策。'
        : 'Runtime is manually paused. Resume to generate decisions.'
    }
    if (gate.enabled && gate.session && gate.session.is_open === false) {
      const tzLabel = gate.market === 'US' ? 'New York' : 'Shanghai'
      return language === 'zh'
        ? `市场休市（${tzLabel}）：下一交易时段将自动恢复。`
        : `Market is closed (${tzLabel}). Decisions will resume next session.`
    }
    if (gate.enabled && gate.live_fresh_ok === false) {
      return language === 'zh'
        ? '实时行情尚未就绪或已过期：等待数据更新后将自动恢复。'
        : 'Live market data is not ready or stale. Will resume when data refreshes.'
    }

    return t('aiDecisionsWillAppear', language)
  })()

  const fuel = (() => {
    const readiness =
      (streamPacket as any)?.room_context?.data_readiness ||
      (streamPacket as any)?.room_context?.dataReadiness ||
      (streamPacket as any)?.decision_meta?.data_readiness ||
      null
    const level = String(readiness?.level || '').toUpperCase() || 'OK'
    const reasons = Array.isArray(readiness?.reasons)
      ? readiness.reasons.map((r: any) => String(r || '')).filter(Boolean)
      : []

    const readinessMetrics = readiness?.metrics || null
    const readinessAsOf = readiness?.as_of_ts_ms ?? null
    const readinessNow = readiness?.now_ts_ms ?? null

    const sessionGate =
      (streamPacket as any)?.decision_meta?.session_gate || null

    const overviewBrief = String(
      (streamPacket as any)?.market_overview?.brief ||
        (streamPacket as any)?.room_context?.market_overview_brief ||
        ''
    ).trim()
    const overviewSource =
      (streamPacket as any)?.market_overview?.source_kind || null
    const overviewStatus =
      (streamPacket as any)?.market_overview?.status || null

    const newsTitles = Array.isArray((streamPacket as any)?.news_digest?.titles)
      ? (streamPacket as any).news_digest.titles
      : Array.isArray((streamPacket as any)?.room_context?.news_digest_titles)
        ? (streamPacket as any).room_context.news_digest_titles
        : []
    const newsSource = (streamPacket as any)?.news_digest?.source_kind || null
    const newsStatus = (streamPacket as any)?.news_digest?.status || null

    const staleOverview = !!overviewStatus?.stale
    const staleNews = !!newsStatus?.stale

    return {
      level,
      reasons,
      readinessMetrics,
      readinessAsOf,
      readinessNow,
      sessionGate,
      overviewBrief,
      overviewSource,
      overviewStatus,
      staleOverview,
      newsTitles,
      newsSource,
      newsStatus,
      staleNews,
    }
  })()

  const [showFuelDetails, setShowFuelDetails] = useState<boolean>(false)
  const [showStreamPacketJson, setShowStreamPacketJson] =
    useState<boolean>(false)
  const [copiedKey, setCopiedKey] = useState<string>('')

  const formatTs = (ts: any) => {
    const n = Number(ts)
    if (!Number.isFinite(n) || n <= 0) return '--'
    try {
      return new Date(n).toLocaleTimeString()
    } catch {
      return String(n)
    }
  }

  const formatMinuteLabel = (minuteValue: any) => {
    const minute = Number(minuteValue)
    if (!Number.isFinite(minute) || minute < 0) return '--:--'
    const h = Math.floor(minute / 60)
    const m = Math.floor(minute % 60)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const placeBet = async () => {
    if (!selectedTrader) return
    if (!userSessionId || !userNickname) {
      setBetError(
        language === 'zh'
          ? '聊天会话尚未初始化。'
          : 'Chat session is not ready yet.'
      )
      return
    }

    const traderId = String(betTraderId || selectedTrader.trader_id).trim()
    const stakeAmount = Number(betStakeInput)
    if (!traderId) {
      setBetError(language === 'zh' ? '请选择下注交易员。' : 'Select a trader first.')
      return
    }
    if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) {
      setBetError(
        language === 'zh' ? '请输入有效下注金额。' : 'Enter a valid stake amount.'
      )
      return
    }

    setBetSubmitting(true)
    setBetError('')
    setBetNotice('')
    try {
      const payload = await api.placeViewerBet({
        user_session_id: userSessionId,
        user_nickname: userNickname,
        trader_id: traderId,
        stake_amount: stakeAmount,
      })
      await mutateBetMarket(payload, { revalidate: false })
      setBetNotice(language === 'zh' ? '下注已更新。' : 'Bet updated.')
    } catch (error) {
      setBetError(error instanceof Error ? error.message : 'bet_place_failed')
    } finally {
      setBetSubmitting(false)
    }
  }

  const safeJson = (value: any, maxLen: number = 2500) => {
    try {
      const text = JSON.stringify(value, null, 2)
      if (!text) return ''
      return text.length > maxLen
        ? `${text.slice(0, maxLen)}\n... (truncated)`
        : text
    } catch {
      return ''
    }
  }

  const stringifyJson = (value: any) => {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return ''
    }
  }

  const copyToClipboard = async (text: string, key: string) => {
    const payload = String(text || '')
    if (!payload) return
    try {
      await navigator.clipboard.writeText(payload)
      setCopiedKey(key)
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? '' : prev))
      }, 1200)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }
  const [selectedChartSymbol, setSelectedChartSymbol] = useState<
    string | undefined
  >(undefined)
  const [chartUpdateKey, setChartUpdateKey] = useState<number>(0)
  const chartSectionRef = useRef<HTMLDivElement>(null)
  const [chatTab, setChatTab] = useState<'public' | 'private'>('public')
  const {
    userSessionId,
    userNickname,
    isLoading: chatSessionLoading,
    error: chatSessionError,
  } = useUserSessionId()

  const [betStakeInput, setBetStakeInput] = useState<string>('100')
  const [betTraderId, setBetTraderId] = useState<string>('')
  const [betSubmitting, setBetSubmitting] = useState<boolean>(false)
  const [betError, setBetError] = useState<string>('')
  const [betNotice, setBetNotice] = useState<string>('')

  const {
    data: betMarket,
    error: betMarketError,
    isLoading: betMarketLoading,
    mutate: mutateBetMarket,
  } = useSWR<ViewerBetMarketPayload>(
    selectedTrader && userSessionId
      ? ['bets-market', selectedTrader.trader_id, userSessionId]
      : null,
    () =>
      api.getBetsMarket({
        traderId: selectedTrader?.trader_id,
        userSessionId: userSessionId || undefined,
      }),
    {
      refreshInterval: 8000,
      revalidateOnFocus: false,
    }
  )

  useEffect(() => {
    const candidateIds = Array.isArray(betMarket?.entries)
      ? betMarket.entries
          .map((entry) => String(entry?.trader_id || '').trim())
          .filter(Boolean)
      : []
    const fallbackId = String(selectedTrader?.trader_id || '').trim()
    const current = String(betTraderId || '').trim()
    if (current && candidateIds.includes(current)) return
    if (fallbackId && candidateIds.includes(fallbackId)) {
      setBetTraderId(fallbackId)
      return
    }
    if (candidateIds.length > 0) {
      setBetTraderId(candidateIds[0])
      return
    }
    setBetTraderId(fallbackId)
  }, [selectedTrader?.trader_id, betMarket?.day_key, betMarket?.entries, betTraderId])

  // Current positions pagination
  const [positionsPageSize, setPositionsPageSize] = useState<number>(20)
  const [positionsCurrentPage, setPositionsCurrentPage] = useState<number>(1)

  // Calculate paginated positions
  const totalPositions = positions?.length || 0
  const totalPositionPages = Math.ceil(totalPositions / positionsPageSize)
  const paginatedPositions =
    positions?.slice(
      (positionsCurrentPage - 1) * positionsPageSize,
      positionsCurrentPage * positionsPageSize
    ) || []

  // Reset page when positions change
  useEffect(() => {
    setPositionsCurrentPage(1)
  }, [selectedTraderId, positionsPageSize])

  // Auto-set chart symbol from runtime hint if provided.
  useEffect(() => {
    if (status?.grid_symbol) {
      setSelectedChartSymbol(status.grid_symbol)
    }
  }, [status?.grid_symbol])

  useEffect(() => {
    setChatTab('public')
  }, [selectedTrader?.trader_id])

  // Handle symbol click from Decision Card
  const handleSymbolClick = (symbol: string) => {
    // Set the selected symbol
    setSelectedChartSymbol(symbol)
    // Scroll to chart section
    setTimeout(() => {
      chartSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 100)
  }

  // If API failed with error, show empty state (likely backend not running)
  if (tradersError) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] relative z-10">
        <div className="text-center max-w-md mx-auto px-6">
          <div
            className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center nofx-glass"
            style={{
              background: 'rgba(240, 185, 11, 0.1)',
              borderColor: 'rgba(240, 185, 11, 0.3)',
            }}
          >
            <svg
              className="w-12 h-12 text-nofx-gold"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-3 text-nofx-text-main">
            {language === 'zh' ? '无法连接到服务器' : 'Connection Failed'}
          </h2>
          <p className="text-base mb-6 text-nofx-text-muted">
            {language === 'zh'
              ? '请确认后端服务已启动。'
              : 'Please check if the backend service is running.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 rounded-lg font-semibold transition-all hover:scale-105 active:scale-95 nofx-glass border border-nofx-gold/30 text-nofx-gold hover:bg-nofx-gold/10"
          >
            {language === 'zh' ? '重试' : 'Retry'}
          </button>
        </div>
      </div>
    )
  }

  // If traders is loaded and empty, show empty state
  if (traders && traders.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] relative z-10">
        <div className="text-center max-w-md mx-auto px-6">
          <div
            className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center nofx-glass"
            style={{
              background: 'rgba(240, 185, 11, 0.1)',
              borderColor: 'rgba(240, 185, 11, 0.3)',
            }}
          >
            <svg
              className="w-12 h-12 text-nofx-gold"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-3 text-nofx-text-main">
            {t('dashboardEmptyTitle', language)}
          </h2>
          <p className="text-base mb-6 text-nofx-text-muted">
            {t('dashboardEmptyDescription', language)}
          </p>
          <button
            onClick={onNavigateToLobby}
            className="px-6 py-3 rounded-lg font-semibold transition-all hover:scale-105 active:scale-95 nofx-glass border border-nofx-gold/30 text-nofx-gold hover:bg-nofx-gold/10"
          >
            {language === 'zh' ? '返回大厅' : 'Back to Lobby'}
          </button>
        </div>
      </div>
    )
  }

  // If traders is still loading or selectedTrader is not ready, show skeleton
  if (!selectedTrader) {
    return (
      <div className="space-y-6 relative z-10">
        <div className="nofx-glass p-6 animate-pulse">
          <div className="h-8 w-48 mb-3 bg-nofx-bg/50 rounded"></div>
          <div className="flex gap-4">
            <div className="h-4 w-32 bg-nofx-bg/50 rounded"></div>
            <div className="h-4 w-24 bg-nofx-bg/50 rounded"></div>
            <div className="h-4 w-28 bg-nofx-bg/50 rounded"></div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="nofx-glass p-5 animate-pulse">
              <div className="h-4 w-24 mb-3 bg-nofx-bg/50 rounded"></div>
              <div className="h-8 w-32 bg-nofx-bg/50 rounded"></div>
            </div>
          ))}
        </div>
        <div className="nofx-glass p-6 animate-pulse">
          <div className="h-6 w-40 mb-4 bg-nofx-bg/50 rounded"></div>
          <div className="h-64 w-full bg-nofx-bg/50 rounded"></div>
        </div>
      </div>
    )
  }

  return (
    <DeepVoidBackground className="min-h-screen pb-12" disableAnimation>
      <div
        className="w-full px-4 md:px-8 relative z-10 pt-6"
        data-testid="trader-dashboard"
      >
        {/* Trader Header */}
        <div
          className="mb-6 rounded-lg p-6 animate-scale-in nofx-glass group"
          style={{
            background:
              'linear-gradient(135deg, rgba(15, 23, 42, 0.6) 0%, rgba(15, 23, 42, 0.4) 100%)',
          }}
        >
          <div className="flex items-start justify-between mb-4">
            <h2 className="text-2xl font-bold flex items-center gap-4 text-nofx-text-main">
              <div className="relative">
                <TraderAvatar
                  traderId={selectedTrader.trader_id}
                  traderName={selectedTrader.trader_name}
                  avatarUrl={selectedTrader.avatar_url}
                  avatarHdUrl={selectedTrader.avatar_hd_url}
                  size={56}
                  enableHdPreview
                  className="rounded-xl border-2 border-nofx-gold/30 shadow-[0_0_15px_rgba(240,185,11,0.2)]"
                />
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-nofx-green rounded-full border-2 border-[#0B0E11] shadow-[0_0_8px_rgba(14,203,129,0.8)] animate-pulse" />
              </div>
              <div className="flex flex-col">
                <span className="text-3xl tracking-tight text-nofx-text font-semibold">
                  {selectedTrader.trader_name}
                </span>
                <span className="text-xs font-mono text-nofx-text-muted opacity-60 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-nofx-gold rounded-full" />
                  ID: {selectedTrader.trader_id.slice(0, 8)}...
                </span>
              </div>
            </h2>

            <div className="flex items-center gap-4">
              {/* Trader Selector */}
              {traders && traders.length > 0 && (
                <div className="flex items-center gap-2 nofx-glass px-1 py-1 rounded-lg border border-white/5">
                  <select
                    value={selectedTraderId}
                    onChange={(e) => onTraderSelect(e.target.value)}
                    className="bg-transparent text-sm font-medium cursor-pointer transition-colors text-nofx-text-main focus:outline-none px-2 py-1"
                  >
                    {traders.map((trader) => (
                      <option
                        key={trader.trader_id}
                        value={trader.trader_id}
                        className="bg-[#0B0E11]"
                      >
                        {trader.trader_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-6 text-sm flex-wrap text-nofx-text-muted font-mono pl-2">
            <span className="flex items-center gap-2">
              <span className="opacity-60">AI Model:</span>
              <span
                className="font-bold px-2 py-0.5 rounded text-xs tracking-wide"
                style={{
                  background: selectedTrader.ai_model.includes('qwen')
                    ? 'rgba(192, 132, 252, 0.15)'
                    : 'rgba(96, 165, 250, 0.15)',
                  color: selectedTrader.ai_model.includes('qwen')
                    ? '#c084fc'
                    : '#60a5fa',
                  border: `1px solid ${selectedTrader.ai_model.includes('qwen') ? '#c084fc' : '#60a5fa'}40`,
                }}
              >
                {getModelDisplayName(
                  selectedTrader.ai_model.split('_').pop() ||
                    selectedTrader.ai_model
                )}
              </span>
            </span>
            <span className="w-px h-3 bg-white/10 hidden md:block" />
            <span className="flex items-center gap-2">
              <span className="opacity-60">Market:</span>
              <span className="text-nofx-text-main font-semibold">
                {getMarketDisplay(selectedTrader.exchange_id)}
              </span>
            </span>
            <span className="w-px h-3 bg-white/10 hidden md:block" />
            <span className="flex items-center gap-2">
              <span className="opacity-60">Persona:</span>
              <span className="text-nofx-gold font-semibold tracking-wide">
                {selectedTrader.strategy_name || 'Virtual AI'}
              </span>
            </span>
            <span className="w-px h-3 bg-white/10 hidden md:block" />
            <RoomClockBadge
              replayRuntimeStatus={replayRuntimeStatus}
              language={language}
            />
            {status && (
              <div className="hidden md:contents">
                <span className="w-px h-3 bg-white/10" />
                <span>
                  Cycles:{' '}
                  <span className="text-nofx-text-main">
                    {status.call_count}
                  </span>
                </span>
                <span className="w-px h-3 bg-white/10" />
                <span>
                  Runtime:{' '}
                  <span className="text-nofx-text-main">
                    {status.runtime_minutes} min
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Debug Info */}
        {account && (
          <div className="mb-4 px-3 py-1.5 rounded bg-black/40 border border-white/5 text-[10px] font-mono text-nofx-text-muted flex justify-between items-center opacity-60 hover:opacity-100 transition-opacity">
            <span>SYSTEM_STATUS::ONLINE</span>
            <div className="flex gap-4">
              <span>LAST_UPDATE::{lastUpdate}</span>
              <span>EQ::{account?.total_equity?.toFixed(2)}</span>
              <span>PNL::{account?.total_pnl?.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Account Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            title={t('totalEquity', language)}
            value={`${account?.total_equity?.toFixed(2) || '0.00'}`}
            unit={quoteCurrency}
            change={account?.total_pnl_pct || 0}
            positive={(account?.total_pnl ?? 0) > 0}
            icon="💰"
          />
          <StatCard
            title={t('availableBalance', language)}
            value={`${account?.available_balance?.toFixed(2) || '0.00'}`}
            unit={quoteCurrency}
            subtitle={`${account?.available_balance && account?.total_equity ? ((account.available_balance / account.total_equity) * 100).toFixed(1) : '0.0'}% ${t('free', language)}`}
            icon="💳"
          />
          <StatCard
            title={t('totalPnL', language)}
            value={`${account?.total_pnl !== undefined && account.total_pnl >= 0 ? '+' : ''}${account?.total_pnl?.toFixed(2) || '0.00'}`}
            unit={quoteCurrency}
            change={account?.total_pnl_pct || 0}
            positive={(account?.total_pnl ?? 0) >= 0}
            icon="📈"
          />
          <StatCard
            title={t('positions', language)}
            value={`${account?.position_count || 0}`}
            unit={language === 'zh' ? '活跃' : 'ACTIVE'}
            subtitle={
              language === 'zh'
                ? `资金占用: ${account?.margin_used_pct?.toFixed(1) || '0.0'}%`
                : `Capital in use: ${account?.margin_used_pct?.toFixed(1) || '0.0'}%`
            }
            icon="📊"
          />
        </div>

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Left Column: Charts + Positions */}
          <div className="space-y-6">
            {/* Chart Tabs (Equity / K-line) */}
            <div
              ref={chartSectionRef}
              className="chart-container animate-slide-in scroll-mt-32 backdrop-blur-sm"
              style={{ animationDelay: '0.1s' }}
            >
              <ChartTabs
                traderId={selectedTrader.trader_id}
                selectedSymbol={selectedChartSymbol}
                updateKey={chartUpdateKey}
                exchangeId={getExchangeType(selectedTrader.exchange_id)}
              />
            </div>

            {/* Current Positions */}
            <div
              className="nofx-glass p-6 animate-slide-in relative overflow-hidden group"
              style={{ animationDelay: '0.15s' }}
            >
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <div className="w-24 h-24 rounded-full bg-blue-500 blur-3xl" />
              </div>
              <div className="flex items-center justify-between mb-5 relative z-10">
                <h2 className="text-lg font-bold flex items-center gap-2 text-nofx-text-main uppercase tracking-wide">
                  <span className="text-blue-500">◈</span>{' '}
                  {t('currentPositions', language)}
                </h2>
                {positions && positions.length > 0 && (
                  <div className="text-xs px-2 py-1 rounded bg-nofx-gold/10 text-nofx-gold border border-nofx-gold/20 font-mono shadow-[0_0_10px_rgba(240,185,11,0.1)]">
                    {positions.length}{' '}
                    {language === 'zh' ? '活跃仓位' : 'active positions'}
                  </div>
                )}
              </div>
              {positions && positions.length > 0 ? (
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left border-b border-white/5">
                        <tr>
                          <th className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-left">
                            {t('symbol', language)}
                          </th>
                          <th className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-center">
                            {t('side', language)}
                          </th>
                          <th
                            className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-right hidden md:table-cell"
                            title={t('entryPrice', language)}
                          >
                            {language === 'zh' ? '入场价' : 'Entry'}
                          </th>
                          <th
                            className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-right hidden md:table-cell"
                            title={t('markPrice', language)}
                          >
                            {language === 'zh' ? '标记价' : 'Mark'}
                          </th>
                          <th
                            className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-right"
                            title={t('quantity', language)}
                          >
                            {language === 'zh' ? '股数' : 'Shares'}
                          </th>
                          <th
                            className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-right hidden md:table-cell"
                            title={t('positionValue', language)}
                          >
                            {language === 'zh' ? '价值' : 'Value'}
                          </th>
                          <th
                            className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-right"
                            title={t('unrealizedPnL', language)}
                          >
                            {language === 'zh' ? '未实现盈亏' : 'uPnL'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedPositions.map((pos, i) => (
                          <tr
                            key={i}
                            className="border-b border-white/5 last:border-0 transition-all hover:bg-white/5 cursor-pointer group/row"
                            onClick={() => {
                              setSelectedChartSymbol(pos.symbol)
                              setChartUpdateKey(Date.now())
                              if (chartSectionRef.current) {
                                chartSectionRef.current.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'start',
                                })
                              }
                            }}
                          >
                            <td className="px-1 py-3 font-mono font-semibold whitespace-nowrap text-left text-nofx-text-main group-hover/row:text-white transition-colors">
                              {pos.symbol}
                            </td>
                            {(() => {
                              const isLong =
                                String(pos.side || '').toLowerCase() === 'long'
                              return (
                                <td className="px-1 py-3 whitespace-nowrap text-center">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${isLong ? 'bg-nofx-green/10 text-nofx-green shadow-[0_0_8px_rgba(14,203,129,0.2)]' : 'bg-nofx-red/10 text-nofx-red shadow-[0_0_8px_rgba(246,70,93,0.2)]'}`}
                                  >
                                    {isLong
                                      ? language === 'zh'
                                        ? '多'
                                        : 'LONG'
                                      : language === 'zh'
                                        ? '空'
                                        : 'SHORT'}
                                  </span>
                                </td>
                              )
                            })()}
                            <td className="px-1 py-3 font-mono whitespace-nowrap text-right text-nofx-text-main hidden md:table-cell">
                              {formatPrice(pos.entry_price)}
                            </td>
                            <td className="px-1 py-3 font-mono whitespace-nowrap text-right text-nofx-text-main hidden md:table-cell">
                              {formatPrice(pos.mark_price)}
                            </td>
                            <td className="px-1 py-3 font-mono whitespace-nowrap text-right text-nofx-text-main">
                              {formatQuantity(pos.quantity)}
                            </td>
                            <td className="px-1 py-3 font-mono font-bold whitespace-nowrap text-right text-nofx-text-main hidden md:table-cell">
                              {(pos.quantity * pos.mark_price).toFixed(2)}
                            </td>
                            <td className="px-1 py-3 font-mono whitespace-nowrap text-right">
                              <span
                                className={`font-bold ${pos.unrealized_pnl >= 0 ? 'text-nofx-green shadow-nofx-green' : 'text-nofx-red shadow-nofx-red'}`}
                                style={{
                                  textShadow:
                                    pos.unrealized_pnl >= 0
                                      ? '0 0 10px rgba(14,203,129,0.3)'
                                      : '0 0 10px rgba(246,70,93,0.3)',
                                }}
                              >
                                {pos.unrealized_pnl >= 0 ? '+' : ''}
                                {pos.unrealized_pnl.toFixed(2)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination footer */}
                  {totalPositions > 10 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-4 text-xs border-t border-white/5 text-nofx-text-muted">
                      <span>
                        {language === 'zh'
                          ? `显示 ${paginatedPositions.length} / ${totalPositions} 个持仓`
                          : `Showing ${paginatedPositions.length} of ${totalPositions} positions`}
                      </span>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span>
                            {language === 'zh' ? '每页' : 'Per page'}:
                          </span>
                          <select
                            value={positionsPageSize}
                            onChange={(e) =>
                              setPositionsPageSize(Number(e.target.value))
                            }
                            className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-nofx-text-main focus:outline-none focus:border-nofx-gold/50 transition-colors"
                          >
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                          </select>
                        </div>
                        {totalPositionPages > 1 && (
                          <div className="flex items-center gap-1">
                            {[
                              '«',
                              '‹',
                              `${positionsCurrentPage} / ${totalPositionPages}`,
                              '›',
                              '»',
                            ].map((label, idx) => {
                              const isText = idx === 2
                              const isFirst = idx === 0
                              const isPrev = idx === 1
                              const isNext = idx === 3
                              const isLast = idx === 4
                              if (isText)
                                return (
                                  <span
                                    key={idx}
                                    className="px-3 text-nofx-text-main"
                                  >
                                    {label}
                                  </span>
                                )

                              let onClick = () => {}
                              let disabled = false

                              if (isFirst) {
                                onClick = () => setPositionsCurrentPage(1)
                                disabled = positionsCurrentPage === 1
                              }
                              if (isPrev) {
                                onClick = () =>
                                  setPositionsCurrentPage((p) =>
                                    Math.max(1, p - 1)
                                  )
                                disabled = positionsCurrentPage === 1
                              }
                              if (isNext) {
                                onClick = () =>
                                  setPositionsCurrentPage((p) =>
                                    Math.min(totalPositionPages, p + 1)
                                  )
                                disabled =
                                  positionsCurrentPage === totalPositionPages
                              }
                              if (isLast) {
                                onClick = () =>
                                  setPositionsCurrentPage(totalPositionPages)
                                disabled =
                                  positionsCurrentPage === totalPositionPages
                              }

                              return (
                                <button
                                  key={idx}
                                  onClick={onClick}
                                  disabled={disabled}
                                  className={`px-2 py-1 rounded transition-colors ${disabled ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white/10 text-nofx-text-main bg-white/5'}`}
                                >
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-16 text-nofx-text-muted opacity-60">
                  <div className="text-6xl mb-4 opacity-50 grayscale">📊</div>
                  <div className="text-lg font-semibold mb-2">
                    {t('noPositions', language)}
                  </div>
                  <div className="text-sm">
                    {t('noActivePositions', language)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Interaction + Thought Feed */}
          <div className="space-y-6">
            <div
              className="nofx-glass p-5 animate-slide-in"
              style={{ animationDelay: '0.18s' }}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-nofx-text-main flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-nofx-gold" />
                    {language === 'zh' ? '房间聊天' : 'Room Chat'}
                  </h2>
                  <p className="text-xs text-nofx-text-muted mt-1">
                    {language === 'zh'
                      ? '真实 Public / Private 双通道，匿名会话可持久化。'
                      : 'Persistent Public + Private channels with anonymous session identity.'}
                  </p>
                </div>
                <div className="text-[11px] text-nofx-text-muted text-right">
                  <div>{selectedTrader.trader_id}</div>
                  {userNickname && <div>{userNickname}</div>}
                </div>
              </div>

              <div className="inline-flex rounded border border-white/10 bg-black/30 p-1 mb-3">
                <button
                  type="button"
                  onClick={() => setChatTab('public')}
                  className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${chatTab === 'public' ? 'bg-nofx-gold text-black' : 'text-nofx-text-muted hover:text-nofx-text-main'}`}
                >
                  Public
                </button>
                <button
                  type="button"
                  onClick={() => setChatTab('private')}
                  className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${chatTab === 'private' ? 'bg-nofx-gold text-black' : 'text-nofx-text-muted hover:text-nofx-text-main'}`}
                >
                  Private
                </button>
              </div>

              {chatSessionLoading && (
                <div className="text-xs text-nofx-text-muted">
                  Initializing chat session...
                </div>
              )}

              {!chatSessionLoading && chatSessionError && (
                <div className="text-xs text-nofx-red">
                  Failed to bootstrap chat session.
                </div>
              )}

              {!chatSessionLoading &&
                !chatSessionError &&
                userSessionId &&
                userNickname && (
                  <>
                    {chatTab === 'public' ? (
                      <RoomPublicChatPanel
                        roomId={selectedTrader.trader_id}
                        roomAgentName={selectedTrader.trader_name}
                        userSessionId={userSessionId}
                        userNickname={userNickname}
                        roomSseState={roomSseState}
                      />
                    ) : (
                      <RoomPrivateChatPanel
                        roomId={selectedTrader.trader_id}
                        userSessionId={userSessionId}
                        userNickname={userNickname}
                      />
                    )}
                  </>
                )}
            </div>

            <div className="nofx-glass p-5 border border-white/10 rounded-lg">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="text-base font-bold text-nofx-text-main">
                    {language === 'zh' ? '当日竞猜盘' : 'Daily Bet Board'}
                  </div>
                  <div className="text-xs text-nofx-text-muted mt-1">
                    {language === 'zh'
                      ? '按当日收益率动态赔率，收盘前30分钟截止。'
                      : 'Dynamic odds by daily return; cutoff is 30 minutes before close.'}
                  </div>
                </div>
                <div
                  className={`px-2 py-1 rounded text-[11px] font-mono border ${betMarket?.betting_open ? 'border-nofx-green/35 text-nofx-green bg-nofx-green/10' : 'border-nofx-red/35 text-nofx-red bg-nofx-red/10'}`}
                >
                  {betMarket?.betting_open ? 'OPEN' : 'CLOSED'}
                </div>
              </div>

              <div className="text-[11px] text-nofx-text-muted font-mono mb-3 flex flex-wrap gap-x-3 gap-y-1">
                <span>{`day=${betMarket?.day_key || '--'}`}</span>
                <span>{`cutoff=${formatMinuteLabel(betMarket?.cutoff_minute)}`}</span>
                <span>{`close=${formatMinuteLabel(betMarket?.close_minute)}`}</span>
                <span>{`pool=${formatPrice(Number(betMarket?.totals?.stake_amount || 0))}`}</span>
                {betMarket?.my_credits && (
                  <span>{`points=${Math.max(0, Math.floor(Number(betMarket.my_credits.credit_points || 0)))}`}</span>
                )}
              </div>

              {betMarket?.settlement && (
                <div className="mb-3 text-xs text-nofx-text-main bg-black/25 border border-white/10 rounded px-3 py-2">
                  <div className="font-semibold">
                    {language === 'zh' ? '已结算' : 'Settled'}
                  </div>
                  <div className="text-nofx-text-muted mt-1">
                    {language === 'zh' ? '胜方' : 'Winners'}:{' '}
                    {(betMarket.settlement.winning_trader_ids || []).join(', ') || '--'}
                    {betMarket.settlement.winning_return_pct != null && (
                      <span>{` · ret=${Number(betMarket.settlement.winning_return_pct).toFixed(2)}%`}</span>
                    )}
                  </div>
                </div>
              )}

              {betMarketLoading && (
                <div className="text-xs text-nofx-text-muted mb-2">
                  {language === 'zh' ? '加载盘口中...' : 'Loading market...'}
                </div>
              )}

              {(betMarketError || betError) && (
                <div className="text-xs text-nofx-red mb-2">
                  {String(
                    (betError || (betMarketError as any)?.message || '').trim() ||
                      (language === 'zh'
                        ? '盘口加载失败。'
                        : 'Bet market failed to load.')
                  )}
                </div>
              )}

              {betNotice && (
                <div className="text-xs text-nofx-green mb-2">{betNotice}</div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_110px] gap-2 mb-3">
                <select
                  value={betTraderId}
                  onChange={(e) => setBetTraderId(String(e.target.value || ''))}
                  className="px-3 py-2 rounded bg-black/35 border border-white/10 text-sm text-nofx-text-main"
                >
                  {(betMarket?.entries || []).map((entry) => (
                    <option key={entry.trader_id} value={entry.trader_id}>
                      {entry.trader_name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  value={betStakeInput}
                  onChange={(e) => setBetStakeInput(String(e.target.value || ''))}
                  className="px-3 py-2 rounded bg-black/35 border border-white/10 text-sm text-nofx-text-main"
                  placeholder={language === 'zh' ? '金额' : 'Stake'}
                />
                <button
                  type="button"
                  onClick={placeBet}
                  disabled={!betMarket?.betting_open || betSubmitting || !userSessionId}
                  className="px-3 py-2 rounded text-sm font-semibold bg-nofx-gold text-black disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {betSubmitting
                    ? language === 'zh'
                      ? '提交中...'
                      : 'Placing...'
                    : language === 'zh'
                      ? '下注'
                      : 'Place'}
                </button>
              </div>

              {betMarket?.my_bet && (
                <div className="mb-3 text-xs text-nofx-text-main bg-black/25 border border-white/10 rounded px-3 py-2">
                  {language === 'zh' ? '我的下注' : 'My bet'}:{' '}
                  {betMarket.my_bet.trader_id} ·{' '}
                  {formatPrice(betMarket.my_bet.stake_amount)}
                  {betMarket.my_bet.estimated_odds != null && (
                    <span className="text-nofx-text-muted">
                      {` · x${Number(betMarket.my_bet.estimated_odds).toFixed(2)}`}
                    </span>
                  )}
                  {betMarket.my_bet.settlement_status === 'settled' && (
                    <span className="text-nofx-text-muted">
                      {betMarket.my_bet.settled_is_winner
                        ? ` · ${language === 'zh' ? '胜出' : 'won'} +${Math.max(0, Math.floor(Number(betMarket.my_bet.settled_credit_points || 0)))} pts`
                        : ` · ${language === 'zh' ? '未胜出' : 'lost'}`}
                    </span>
                  )}
                </div>
              )}

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {(betMarket?.entries || []).slice(0, 8).map((entry) => (
                  <div
                    key={entry.trader_id}
                    className="rounded border border-white/10 bg-black/25 px-3 py-2 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-nofx-text-main truncate">
                        {entry.trader_name}
                      </div>
                      <div className="text-[11px] font-mono text-nofx-text-muted">
                        ret {Number(entry.daily_return_pct || 0).toFixed(2)}% · odds
                        {' '}x{Number(entry.odds || 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="text-right text-[11px] font-mono text-nofx-text-muted shrink-0">
                      <div>{formatPrice(entry.total_stake)}</div>
                      <div>{entry.ticket_count} tk</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="nofx-glass p-5 border border-white/5 rounded-lg">
              <div className="flex items-center justify-between gap-4 mb-3">
                <div>
                  <div className="text-lg font-bold text-nofx-text-main">
                    {language === 'zh' ? '燃料面板' : 'Fuel Panel'}
                  </div>
                  <div className="text-xs text-nofx-text-muted mt-1">
                    {language === 'zh'
                      ? '用于主播式解说：数据就绪 + 市场概览 + 消息面。'
                      : 'For streamer-style context: readiness + overview + headlines.'}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFuelDetails((v) => !v)}
                    className="text-[11px] px-2 py-1 rounded font-semibold transition-colors border border-white/10 bg-black/30 text-nofx-text-muted hover:text-nofx-text-main"
                  >
                    {showFuelDetails
                      ? language === 'zh'
                        ? '收起'
                        : 'Collapse'
                      : language === 'zh'
                        ? '详情'
                        : 'Details'}
                  </button>

                  <div
                    className="text-[11px] px-2 py-1 rounded font-mono"
                    style={{
                      background:
                        fuel.level === 'ERROR'
                          ? 'rgba(246, 70, 93, 0.15)'
                          : fuel.level === 'WARN'
                            ? 'rgba(240, 185, 11, 0.15)'
                            : 'rgba(14, 203, 129, 0.12)',
                      color:
                        fuel.level === 'ERROR'
                          ? '#F6465D'
                          : fuel.level === 'WARN'
                            ? '#F0B90B'
                            : '#0ECB81',
                      border: `1px solid ${
                        fuel.level === 'ERROR'
                          ? 'rgba(246, 70, 93, 0.35)'
                          : fuel.level === 'WARN'
                            ? 'rgba(240, 185, 11, 0.35)'
                            : 'rgba(14, 203, 129, 0.3)'
                      }`,
                    }}
                    title={fuel.reasons.length ? fuel.reasons.join(', ') : ''}
                  >
                    {language === 'zh' ? '数据' : 'DATA'}:{fuel.level}
                  </div>
                </div>
              </div>

              {fuel.reasons.length > 0 && (
                <div className="text-xs text-nofx-text-muted mb-3">
                  {language === 'zh' ? '原因：' : 'Reasons: '}
                  <span className="font-mono">
                    {fuel.reasons.slice(0, 4).join(' / ')}
                  </span>
                </div>
              )}

              {showFuelDetails && (
                <div
                  className="mb-3 rounded-lg p-3 text-[11px] font-mono whitespace-pre-wrap"
                  style={{
                    background: '#0B0E11',
                    border: '1px solid #2B3139',
                    color: '#EAECEF',
                  }}
                >
                  <div className="opacity-80">
                    packet_ts: {formatTs((streamPacket as any)?.ts_ms)}
                  </div>
                  <div className="opacity-80">
                    readiness_as_of: {formatTs(fuel.readinessAsOf)} |
                    readiness_now: {formatTs(fuel.readinessNow)}
                  </div>
                  {fuel.readinessMetrics && (
                    <div className="opacity-80">
                      frames: intraday=
                      {String(
                        (fuel.readinessMetrics as any)?.intraday_frames ?? '--'
                      )}{' '}
                      daily=
                      {String(
                        (fuel.readinessMetrics as any)?.daily_frames ?? '--'
                      )}
                    </div>
                  )}
                  {fuel.sessionGate && (
                    <div className="opacity-80">
                      session_gate: level=
                      {String((fuel.sessionGate as any)?.level || '--')}{' '}
                      reasons=
                      {Array.isArray((fuel.sessionGate as any)?.reasons)
                        ? (fuel.sessionGate as any).reasons.join(',')
                        : '--'}
                    </div>
                  )}

                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="opacity-70">readiness.reasons</div>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          fuel.reasons.join('\n') ||
                            stringifyJson(
                              (streamPacket as any)?.room_context
                                ?.data_readiness
                            ),
                          'fuel.reasons'
                        )
                      }
                      className="text-[11px] px-2 py-1 rounded border border-white/10 bg-black/30 text-nofx-text-muted hover:text-nofx-text-main"
                    >
                      {copiedKey === 'fuel.reasons'
                        ? language === 'zh'
                          ? '已复制'
                          : 'Copied'
                        : language === 'zh'
                          ? '复制'
                          : 'Copy'}
                    </button>
                  </div>

                  <div className="opacity-80">
                    overview_file:{' '}
                    {String((fuel.overviewStatus as any)?.file_path || '--')} |
                    last_load=
                    {formatTs((fuel.overviewStatus as any)?.last_load_ts_ms)} |
                    err=
                    {String((fuel.overviewStatus as any)?.last_error || '') ||
                      'none'}
                  </div>
                  <div className="opacity-80">
                    news_file:{' '}
                    {String((fuel.newsStatus as any)?.file_path || '--')} |
                    last_load=
                    {formatTs((fuel.newsStatus as any)?.last_load_ts_ms)} | err=
                    {String((fuel.newsStatus as any)?.last_error || '') ||
                      'none'}
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="opacity-70">file_status</div>
                    <button
                      type="button"
                      onClick={() => {
                        const overviewLine = `overview_file: ${String((fuel.overviewStatus as any)?.file_path || '--')} | last_load=${formatTs((fuel.overviewStatus as any)?.last_load_ts_ms)} | err=${String((fuel.overviewStatus as any)?.last_error || '') || 'none'}`
                        const newsLine = `news_file: ${String((fuel.newsStatus as any)?.file_path || '--')} | last_load=${formatTs((fuel.newsStatus as any)?.last_load_ts_ms)} | err=${String((fuel.newsStatus as any)?.last_error || '') || 'none'}`
                        copyToClipboard(
                          `${overviewLine}\n${newsLine}`,
                          'fuel.files'
                        )
                      }}
                      className="text-[11px] px-2 py-1 rounded border border-white/10 bg-black/30 text-nofx-text-muted hover:text-nofx-text-main"
                    >
                      {copiedKey === 'fuel.files'
                        ? language === 'zh'
                          ? '已复制'
                          : 'Copied'
                        : language === 'zh'
                          ? '复制'
                          : 'Copy'}
                    </button>
                  </div>

                  <div className="mt-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="opacity-70">
                        decision_audit_preview.json
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            stringifyJson(
                              (streamPacket as any)?.decision_audit_preview
                            ),
                            'fuel.audit'
                          )
                        }
                        className="text-[11px] px-2 py-1 rounded border border-white/10 bg-black/30 text-nofx-text-muted hover:text-nofx-text-main"
                      >
                        {copiedKey === 'fuel.audit'
                          ? language === 'zh'
                            ? '已复制'
                            : 'Copied'
                          : language === 'zh'
                            ? '复制'
                            : 'Copy'}
                      </button>
                    </div>
                    <div className="mt-2 opacity-90">
                      {safeJson((streamPacket as any)?.decision_audit_preview)}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <div className="opacity-70">stream_packet.json</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            stringifyJson(streamPacket),
                            'fuel.packet'
                          )
                        }
                        className="text-[11px] px-2 py-1 rounded border border-white/10 bg-black/30 text-nofx-text-muted hover:text-nofx-text-main"
                      >
                        {copiedKey === 'fuel.packet'
                          ? language === 'zh'
                            ? '已复制'
                            : 'Copied'
                          : language === 'zh'
                            ? '复制'
                            : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowStreamPacketJson((v) => !v)}
                        className="text-[11px] px-2 py-1 rounded border border-white/10 bg-black/30 text-nofx-text-muted hover:text-nofx-text-main"
                      >
                        {showStreamPacketJson
                          ? language === 'zh'
                            ? '收起'
                            : 'Collapse'
                          : language === 'zh'
                            ? '展开'
                            : 'Expand'}
                      </button>
                    </div>
                  </div>
                  {showStreamPacketJson && (
                    <div className="mt-2 opacity-90">
                      {safeJson(streamPacket)}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-xs text-nofx-text-muted mb-1">
                    {language === 'zh' ? '市场概览' : 'Market Overview'}
                    {fuel.overviewSource && (
                      <span className="ml-2 text-[10px] font-mono opacity-70">
                        src={String(fuel.overviewSource)}
                        {fuel.staleOverview ? ':stale' : ''}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-nofx-text-main leading-snug">
                    {fuel.overviewBrief ||
                      (language === 'zh'
                        ? '暂无概览（将自动回退观察池）。'
                        : 'No overview yet (will fall back to proxy watchlist).')}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-nofx-text-muted mb-1">
                    {language === 'zh' ? '消息面' : 'Headlines'}
                    {fuel.newsSource && (
                      <span className="ml-2 text-[10px] font-mono opacity-70">
                        src={String(fuel.newsSource)}
                        {fuel.staleNews ? ':stale' : ''}
                      </span>
                    )}
                  </div>
                  {fuel.newsTitles.length > 0 ? (
                    <div className="text-sm text-nofx-text-main leading-snug space-y-1">
                      {fuel.newsTitles
                        .slice(0, 3)
                        .map((title: any, idx: number) => (
                          <div key={`${idx}-${title}`} className="opacity-95">
                            · {String(title)}
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="text-sm text-nofx-text-muted opacity-70">
                      {language === 'zh'
                        ? '暂无新闻摘要。'
                        : 'No digest available.'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              className="nofx-glass p-6 animate-slide-in h-fit lg:self-start"
              style={{ animationDelay: '0.2s' }}
            >
              <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/5 shrink-0">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow-[0_4px_14px_rgba(99,102,241,0.4)]"
                  style={{
                    background:
                      'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
                  }}
                >
                  🧠
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-nofx-text-main">
                    {language === 'zh' ? '思考与行动' : 'Thought & Actions'}
                  </h2>
                  {effectiveDecisions.length > 0 && (
                    <div className="text-xs text-nofx-text-muted">
                      {t('lastCycles', language, { count: effectiveDecisions.length })}
                    </div>
                  )}
                </div>
                <select
                  value={decisionsLimit}
                  onChange={(e) =>
                    onDecisionsLimitChange(Number(e.target.value))
                  }
                  className="px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-all bg-black/40 text-nofx-text-main border border-white/10 hover:border-nofx-accent focus:outline-none"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div
                className="space-y-4 overflow-y-auto pr-2 custom-scrollbar min-h-[260px]"
                style={{ maxHeight: 'min(70vh, 720px)' }}
                ref={decisionsScrollRef}
              >
                {effectiveDecisions.length > 0 ? (
                  effectiveDecisions.map((decision, i) => (
                    <div
                      key={`${decision.timestamp}-${i}`}
                      data-decision-cycle={decision.cycle_number}
                      data-decision-ts={decision.timestamp}
                      className={`flex items-start gap-3 ${Number(decision.cycle_number || 0) === highlightDecisionCycle ? 'rounded-lg ring-1 ring-nofx-gold/40 bg-white/5 p-1' : ''}`}
                    >
                      <div className="pt-1 shrink-0">
                        <TraderAvatar
                          traderId={selectedTrader.trader_id}
                          traderName={selectedTrader.trader_name}
                          avatarUrl={selectedTrader.avatar_url}
                          avatarHdUrl={selectedTrader.avatar_hd_url}
                          size={34}
                          className="rounded-lg border border-white/10"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <DecisionCard
                          decision={decision}
                          language={language}
                          onSymbolClick={handleSymbolClick}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-16 text-center text-nofx-text-muted opacity-60">
                    <div className="text-6xl mb-4 opacity-30 grayscale">🧠</div>
                    <div className="text-lg font-semibold mb-2 text-nofx-text-main">
                      {t('noDecisionsYet', language)}
                    </div>
                    <div className="text-sm">
                      {noDecisionsHint || t('aiDecisionsWillAppear', language)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {selectedTrader && (
          <div
            className="nofx-glass p-6 animate-slide-in"
            style={{ animationDelay: '0.23s' }}
          >
            <AuditExplorerPanel
              roomId={selectedTrader.trader_id}
              language={language}
            />
          </div>
        )}

        {/* Position History Section */}
        {selectedTraderId && (
          <div
            className="nofx-glass p-6 animate-slide-in"
            style={{ animationDelay: '0.25s' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold flex items-center gap-2 text-nofx-text-main">
                <span className="text-2xl">📜</span>
                {t('positionHistory.title', language)}
              </h2>
            </div>
            <PositionHistory traderId={selectedTraderId} />
          </div>
        )}
      </div>
    </DeepVoidBackground>
  )
}

// Stat Card Component - Deep Void Style
function StatCard({
  title,
  value,
  unit,
  change,
  positive,
  subtitle,
  icon,
}: {
  title: string
  value: string
  unit?: string
  change?: number
  positive?: boolean
  subtitle?: string
  icon?: string
}) {
  return (
    <div className="group nofx-glass p-5 rounded-lg transition-all duration-300 hover:bg-white/5 hover:translate-y-[-2px] border border-white/5 hover:border-nofx-gold/20 relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity text-4xl grayscale group-hover:grayscale-0">
        {icon}
      </div>
      <div className="text-xs mb-2 font-mono uppercase tracking-wider text-nofx-text-muted flex items-center gap-2">
        {title}
      </div>
      <div className="flex items-baseline gap-1 mb-1">
        <div className="text-2xl font-bold font-mono text-nofx-text-main tracking-tight group-hover:text-white transition-colors">
          {value}
        </div>
        {unit && (
          <span className="text-xs font-mono text-nofx-text-muted opacity-60">
            {unit}
          </span>
        )}
      </div>

      {change !== undefined && (
        <div className="flex items-center gap-1">
          <div
            className={`text-sm mono font-bold flex items-center gap-1 ${positive ? 'text-nofx-green' : 'text-nofx-red'}`}
          >
            <span>{positive ? '▲' : '▼'}</span>
            <span>
              {positive ? '+' : ''}
              {change.toFixed(2)}%
            </span>
          </div>
        </div>
      )}
      {subtitle && (
        <div className="text-xs mt-2 mono text-nofx-text-muted opacity-80">
          {subtitle}
        </div>
      )}
    </div>
  )
}
