import { useEffect, useMemo, useState, useRef } from 'react'
import { ChartTabs } from '../components/ChartTabs'
import { DecisionCard } from '../components/DecisionCard'
import { PositionHistory } from '../components/PositionHistory'
import { PunkAvatar, getTraderAvatar } from '../components/PunkAvatar'
import { formatPrice, formatQuantity } from '../utils/format'
import { t, type Language } from '../i18n/translations'
import { Flame, Info, MessageSquare, Pause, Play, Send, StepForward } from 'lucide-react'
import { DeepVoidBackground } from '../components/DeepVoidBackground'
import type {
    SystemStatus,
    AccountInfo,
    Position,
    DecisionRecord,
    TraderInfo,
    AgentRuntimeStatus,
    AgentRuntimeControlAction,
} from '../types'

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
    decisionsLimit: number
    onDecisionsLimitChange: (limit: number) => void
    runtimeStatus?: AgentRuntimeStatus
    runtimeControlsEnabled?: boolean
    onRuntimeControl?: (action: AgentRuntimeControlAction, cycleMs?: number) => Promise<void>
    lastUpdate: string
    language: Language
}

type RoomEvent = {
    id: number
    text: string
    type: 'ask' | 'fuel' | 'system'
    ts: string
}

export function TraderDashboardPage({
    selectedTrader,
    status,
    account,
    positions,
    decisions,
    decisionsLimit,
    onDecisionsLimitChange,
    runtimeStatus,
    runtimeControlsEnabled,
    onRuntimeControl,
    lastUpdate,
    language,
    traders,
    tradersError,
    selectedTraderId,
    onTraderSelect,
    onNavigateToLobby,
}: TraderDashboardPageProps) {
    const [selectedChartSymbol, setSelectedChartSymbol] = useState<string | undefined>(undefined)
    const [chartUpdateKey, setChartUpdateKey] = useState<number>(0)
    const chartSectionRef = useRef<HTMLDivElement>(null)
    const [askInput, setAskInput] = useState('')
    const [fuelInput, setFuelInput] = useState('30')
    const [runtimeCycleInput, setRuntimeCycleInput] = useState('15000')
    const [runtimeActionPending, setRuntimeActionPending] = useState(false)
    const [runtimeActionMessage, setRuntimeActionMessage] = useState<string>('')
    const [roomEvents, setRoomEvents] = useState<RoomEvent[]>([
        {
            id: 1,
            type: 'system',
            text: language === 'zh' ? '房间已连接到模拟会话。' : 'Room connected to simulated session.',
            ts: new Date().toLocaleTimeString(),
        },
    ])

    // Current positions pagination
    const [positionsPageSize, setPositionsPageSize] = useState<number>(20)
    const [positionsCurrentPage, setPositionsCurrentPage] = useState<number>(1)

    // Calculate paginated positions
    const totalPositions = positions?.length || 0
    const totalPositionPages = Math.ceil(totalPositions / positionsPageSize)
    const paginatedPositions = positions?.slice(
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
        if (runtimeStatus?.cycle_ms) {
            setRuntimeCycleInput(String(runtimeStatus.cycle_ms))
        }
    }, [runtimeStatus?.cycle_ms])

    const handleAskSubmit = () => {
        const trimmed = askInput.trim()
        if (!trimmed) return
        setRoomEvents((prev) => [
            {
                id: Date.now(),
                type: 'ask' as const,
                text: trimmed,
                ts: new Date().toLocaleTimeString(),
            },
            ...prev,
        ].slice(0, 8))
        setAskInput('')
    }

    const handleFuel = () => {
        const amount = Number(fuelInput)
        if (!Number.isFinite(amount) || amount <= 0) return
        setRoomEvents((prev) => [
            {
                id: Date.now(),
                type: 'fuel' as const,
                text: language === 'zh' ? `为该房间增加 ${amount} 点燃料` : `Added ${amount} fuel points to this room`,
                ts: new Date().toLocaleTimeString(),
            },
            ...prev,
        ].slice(0, 8))
    }

    const roomEventSummary = useMemo(() => {
        const asks = roomEvents.filter((e) => e.type === 'ask').length
        const fuels = roomEvents.filter((e) => e.type === 'fuel').length
        return { asks, fuels }
    }, [roomEvents])

    const selectedRuntimeTrader = useMemo(
        () => runtimeStatus?.traders?.find((trader) => trader.trader_id === selectedTraderId),
        [runtimeStatus?.traders, selectedTraderId]
    )

    const triggerRuntimeAction = async (action: AgentRuntimeControlAction) => {
        if (!onRuntimeControl || runtimeActionPending) return

        setRuntimeActionPending(true)
        setRuntimeActionMessage('')

        try {
            if (action === 'set_cycle_ms') {
                const cycleMs = Number(runtimeCycleInput)
                if (!Number.isFinite(cycleMs) || cycleMs <= 0) {
                    setRuntimeActionMessage(language === 'zh' ? '请输入有效的毫秒间隔。' : 'Please enter a valid cycle interval in milliseconds.')
                    return
                }
                await onRuntimeControl(action, cycleMs)
                setRuntimeActionMessage(language === 'zh' ? `已更新决策节奏至 ${cycleMs}ms 等效` : `Decision cadence updated to ${cycleMs}ms equivalent`)
                return
            }

            await onRuntimeControl(action)
            const actionMap = {
                pause: language === 'zh' ? '已暂停运行时' : 'Runtime paused',
                resume: language === 'zh' ? '已恢复运行时' : 'Runtime resumed',
                step: language === 'zh' ? '已执行一步循环' : 'Executed one cycle step',
                set_cycle_ms: '',
            }
            setRuntimeActionMessage(actionMap[action])
        } catch (error) {
            const fallback = language === 'zh' ? '运行时控制失败，请稍后重试。' : 'Runtime control failed. Please retry.'
            const message = error instanceof Error && error.message ? error.message : fallback
            setRuntimeActionMessage(message)
        } finally {
            setRuntimeActionPending(false)
        }
    }

    // Handle symbol click from Decision Card
    const handleSymbolClick = (symbol: string) => {
        // Set the selected symbol
        setSelectedChartSymbol(symbol)
        // Scroll to chart section
        setTimeout(() => {
            chartSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
            <div className="w-full px-4 md:px-8 relative z-10 pt-6">
                {/* Trader Header */}
                <div
                    className="mb-6 rounded-lg p-6 animate-scale-in nofx-glass group"
                    style={{
                        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.6) 0%, rgba(15, 23, 42, 0.4) 100%)',
                    }}
                >
                    <div className="flex items-start justify-between mb-4">
                        <h2 className="text-2xl font-bold flex items-center gap-4 text-nofx-text-main">
                            <div className="relative">
                                <PunkAvatar
                                    seed={getTraderAvatar(
                                        selectedTrader.trader_id,
                                        selectedTrader.trader_name
                                    )}
                                    size={56}
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
                                            <option key={trader.trader_id} value={trader.trader_id} className="bg-[#0B0E11]">
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
                                    background: selectedTrader.ai_model.includes('qwen') ? 'rgba(192, 132, 252, 0.15)' : 'rgba(96, 165, 250, 0.15)',
                                    color: selectedTrader.ai_model.includes('qwen') ? '#c084fc' : '#60a5fa',
                                    border: `1px solid ${selectedTrader.ai_model.includes('qwen') ? '#c084fc' : '#60a5fa'}40`
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
                        {status && (
                            <div className="hidden md:contents">
                                <span className="w-px h-3 bg-white/10" />
                                <span>Cycles: <span className="text-nofx-text-main">{status.call_count}</span></span>
                                <span className="w-px h-3 bg-white/10" />
                                <span>Runtime: <span className="text-nofx-text-main">{status.runtime_minutes} min</span></span>
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
                        unit="CNY"
                        change={account?.total_pnl_pct || 0}
                        positive={(account?.total_pnl ?? 0) > 0}
                        icon="💰"
                    />
                    <StatCard
                        title={t('availableBalance', language)}
                        value={`${account?.available_balance?.toFixed(2) || '0.00'}`}
                        unit="CNY"
                        subtitle={`${account?.available_balance && account?.total_equity ? ((account.available_balance / account.total_equity) * 100).toFixed(1) : '0.0'}% ${t('free', language)}`}
                        icon="💳"
                    />
                    <StatCard
                        title={t('totalPnL', language)}
                        value={`${account?.total_pnl !== undefined && account.total_pnl >= 0 ? '+' : ''}${account?.total_pnl?.toFixed(2) || '0.00'}`}
                        unit="CNY"
                        change={account?.total_pnl_pct || 0}
                        positive={(account?.total_pnl ?? 0) >= 0}
                        icon="📈"
                    />
                    <StatCard
                        title={t('positions', language)}
                        value={`${account?.position_count || 0}`}
                        unit={language === 'zh' ? '活跃' : 'ACTIVE'}
                        subtitle={language === 'zh'
                            ? `资金占用: ${account?.margin_used_pct?.toFixed(1) || '0.0'}%`
                            : `Capital in use: ${account?.margin_used_pct?.toFixed(1) || '0.0'}%`}
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
                                    <span className="text-blue-500">◈</span> {t('currentPositions', language)}
                                </h2>
                                {positions && positions.length > 0 && (
                                    <div className="text-xs px-2 py-1 rounded bg-nofx-gold/10 text-nofx-gold border border-nofx-gold/20 font-mono shadow-[0_0_10px_rgba(240,185,11,0.1)]">
                                        {positions.length} {language === 'zh' ? '活跃仓位' : 'active positions'}
                                    </div>
                                )}
                            </div>
                            {positions && positions.length > 0 ? (
                                <div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead className="text-left border-b border-white/5">
                                                <tr>
                                                    <th className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-left">{t('symbol', language)}</th>
                                                    <th className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-center">{t('side', language)}</th>
                                                    <th className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-right hidden md:table-cell" title={t('entryPrice', language)}>{language === 'zh' ? '入场价' : 'Entry'}</th>
                                                    <th className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-right hidden md:table-cell" title={t('markPrice', language)}>{language === 'zh' ? '标记价' : 'Mark'}</th>
                                                    <th className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-right" title={t('quantity', language)}>{language === 'zh' ? '股数' : 'Shares'}</th>
                                                    <th className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-right hidden md:table-cell" title={t('positionValue', language)}>{language === 'zh' ? '价值' : 'Value'}</th>
                                                    <th className="px-1 pb-3 font-semibold text-nofx-text-muted whitespace-nowrap text-right" title={t('unrealizedPnL', language)}>{language === 'zh' ? '未实现盈亏' : 'uPnL'}</th>
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
                                                            const isLong = String(pos.side || '').toLowerCase() === 'long'
                                                            return (
                                                        <td className="px-1 py-3 whitespace-nowrap text-center">
                                                            <span
                                                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${isLong ? 'bg-nofx-green/10 text-nofx-green shadow-[0_0_8px_rgba(14,203,129,0.2)]' : 'bg-nofx-red/10 text-nofx-red shadow-[0_0_8px_rgba(246,70,93,0.2)]'}`}
                                                            >
                                                                {isLong ? (language === 'zh' ? '多' : 'LONG') : (language === 'zh' ? '空' : 'SHORT')}
                                                            </span>
                                                        </td>
                                                            )
                                                        })()}
                                                        <td className="px-1 py-3 font-mono whitespace-nowrap text-right text-nofx-text-main hidden md:table-cell">{formatPrice(pos.entry_price)}</td>
                                                        <td className="px-1 py-3 font-mono whitespace-nowrap text-right text-nofx-text-main hidden md:table-cell">{formatPrice(pos.mark_price)}</td>
                                                        <td className="px-1 py-3 font-mono whitespace-nowrap text-right text-nofx-text-main">{formatQuantity(pos.quantity)}</td>
                                                        <td className="px-1 py-3 font-mono font-bold whitespace-nowrap text-right text-nofx-text-main hidden md:table-cell">{(pos.quantity * pos.mark_price).toFixed(2)}</td>
                                                        <td className="px-1 py-3 font-mono whitespace-nowrap text-right">
                                                            <span
                                                                className={`font-bold ${pos.unrealized_pnl >= 0 ? 'text-nofx-green shadow-nofx-green' : 'text-nofx-red shadow-nofx-red'}`}
                                                                style={{ textShadow: pos.unrealized_pnl >= 0 ? '0 0 10px rgba(14,203,129,0.3)' : '0 0 10px rgba(246,70,93,0.3)' }}
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
                                                    <span>{language === 'zh' ? '每页' : 'Per page'}:</span>
                                                    <select
                                                        value={positionsPageSize}
                                                        onChange={(e) => setPositionsPageSize(Number(e.target.value))}
                                                        className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-nofx-text-main focus:outline-none focus:border-nofx-gold/50 transition-colors"
                                                    >
                                                        <option value={20}>20</option>
                                                        <option value={50}>50</option>
                                                        <option value={100}>100</option>
                                                    </select>
                                                </div>
                                                {totalPositionPages > 1 && (
                                                    <div className="flex items-center gap-1">
                                                        {['«', '‹', `${positionsCurrentPage} / ${totalPositionPages}`, '›', '»'].map((label, idx) => {
                                                            const isText = idx === 2;
                                                            const isFirst = idx === 0;
                                                            const isPrev = idx === 1;
                                                            const isNext = idx === 3;
                                                            const isLast = idx === 4;
                                                            if (isText) return <span key={idx} className="px-3 text-nofx-text-main">{label}</span>;

                                                            let onClick = () => { };
                                                            let disabled = false;

                                                            if (isFirst) { onClick = () => setPositionsCurrentPage(1); disabled = positionsCurrentPage === 1; }
                                                            if (isPrev) { onClick = () => setPositionsCurrentPage(p => Math.max(1, p - 1)); disabled = positionsCurrentPage === 1; }
                                                            if (isNext) { onClick = () => setPositionsCurrentPage(p => Math.min(totalPositionPages, p + 1)); disabled = positionsCurrentPage === totalPositionPages; }
                                                            if (isLast) { onClick = () => setPositionsCurrentPage(totalPositionPages); disabled = positionsCurrentPage === totalPositionPages; }

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
                                    <div className="text-lg font-semibold mb-2">{t('noPositions', language)}</div>
                                    <div className="text-sm">{t('noActivePositions', language)}</div>
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
                                        {language === 'zh' ? '房间互动' : 'Room Interactions'}
                                    </h2>
                                    <p className="text-xs text-nofx-text-muted mt-1">
                                        {language === 'zh'
                                            ? '前端演示版：提交问题和燃料操作会记录在本地事件流。'
                                            : 'Frontend demo mode: ask/fuel actions are written to a local room event stream.'}
                                    </p>
                                </div>
                                <div className="text-[11px] text-nofx-text-muted text-right">
                                    <div>{language === 'zh' ? '提问' : 'Asks'}: <span className="text-white font-semibold">{roomEventSummary.asks}</span></div>
                                    <div>{language === 'zh' ? '燃料' : 'Fuel'}: <span className="text-white font-semibold">{roomEventSummary.fuels}</span></div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 mb-3">
                                <input
                                    value={askInput}
                                    onChange={(e) => setAskInput(e.target.value)}
                                    placeholder={language === 'zh' ? '例如：为什么今天减仓 600519.SH？' : 'e.g. Why reduce 600519.SH today?'}
                                    className="px-3 py-2 rounded bg-black/40 border border-white/10 text-sm text-nofx-text-main focus:outline-none focus:border-nofx-gold/50"
                                />
                                <button
                                    onClick={handleAskSubmit}
                                    className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-semibold bg-nofx-gold text-black hover:opacity-90 transition-opacity"
                                >
                                    <Send className="w-3.5 h-3.5" />
                                    {language === 'zh' ? '提问' : 'Ask'}
                                </button>
                            </div>

                            <div className="grid grid-cols-[1fr_auto] gap-2 mb-4">
                                <input
                                    value={fuelInput}
                                    onChange={(e) => setFuelInput(e.target.value)}
                                    className="px-3 py-2 rounded bg-black/40 border border-white/10 text-sm text-nofx-text-main focus:outline-none focus:border-nofx-gold/50"
                                />
                                <button
                                    onClick={handleFuel}
                                    className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-semibold border border-nofx-gold/30 text-nofx-gold bg-nofx-gold/10 hover:bg-nofx-gold/20 transition-colors"
                                >
                                    <Flame className="w-3.5 h-3.5" />
                                    {language === 'zh' ? '加燃料' : 'Fuel'}
                                </button>
                            </div>

                            <div className="rounded border border-white/10 bg-black/30 p-3 space-y-2">
                                {roomEvents.map((event) => (
                                    <div key={event.id} className="flex items-center justify-between gap-3 text-xs">
                                        <span className="text-nofx-text-main">
                                            {event.type === 'ask' ? 'Q' : event.type === 'fuel' ? 'F' : 'I'} - {event.text}
                                        </span>
                                        <span className="text-nofx-text-muted whitespace-nowrap">{event.ts}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {runtimeControlsEnabled && (
                            <div className="nofx-glass p-4 border border-white/10 rounded-lg">
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <div>
                                        <div className="text-sm font-semibold text-nofx-text-main">
                                            {language === 'zh' ? 'Agent Runtime 控制台' : 'Agent Runtime Console'}
                                        </div>
                                        <div className="text-[11px] text-nofx-text-muted mt-1">
                                            {language === 'zh'
                                                ? '用于演示：暂停/恢复/单步执行，并调整决策节奏。'
                                                : 'Demo controls: pause/resume/step and tune decision cadence.'}
                                        </div>
                                    </div>
                                    <span
                                        className={`text-[11px] px-2 py-1 rounded border ${runtimeStatus?.running
                                            ? 'border-nofx-green/30 text-nofx-green bg-nofx-green/10'
                                            : 'border-nofx-gold/30 text-nofx-gold bg-nofx-gold/10'
                                            }`}
                                    >
                                        {runtimeStatus?.running
                                            ? (language === 'zh' ? '运行中' : 'Running')
                                            : (language === 'zh' ? '已暂停' : 'Paused')}
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 mb-2">
                                    <input
                                        value={runtimeCycleInput}
                                        onChange={(e) => setRuntimeCycleInput(e.target.value)}
                                        placeholder={language === 'zh' ? '决策节奏(ms 等效)' : 'decision cadence (ms equiv)'}
                                        className="px-3 py-2 rounded bg-black/40 border border-white/10 text-sm text-nofx-text-main focus:outline-none focus:border-nofx-gold/50"
                                        disabled={runtimeActionPending}
                                    />
                                    <button
                                        onClick={() => triggerRuntimeAction('set_cycle_ms')}
                                        disabled={runtimeActionPending}
                                        className="px-3 py-2 rounded text-sm font-semibold border border-white/15 text-nofx-text-main hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {language === 'zh' ? '更新节奏' : 'Apply Cadence'}
                                    </button>
                                </div>

                                <div className="grid grid-cols-3 gap-2 mb-3">
                                    <button
                                        onClick={() => triggerRuntimeAction('pause')}
                                        disabled={runtimeActionPending}
                                        className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-semibold border border-white/15 text-nofx-text-main hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Pause className="w-3.5 h-3.5" />
                                        {language === 'zh' ? '暂停' : 'Pause'}
                                    </button>
                                    <button
                                        onClick={() => triggerRuntimeAction('resume')}
                                        disabled={runtimeActionPending}
                                        className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-semibold bg-nofx-green/20 border border-nofx-green/30 text-nofx-green hover:bg-nofx-green/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Play className="w-3.5 h-3.5" />
                                        {language === 'zh' ? '恢复' : 'Resume'}
                                    </button>
                                    <button
                                        onClick={() => triggerRuntimeAction('step')}
                                        disabled={runtimeActionPending}
                                        className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-semibold bg-nofx-gold/15 border border-nofx-gold/35 text-nofx-gold hover:bg-nofx-gold/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <StepForward className="w-3.5 h-3.5" />
                                        {language === 'zh' ? '单步' : 'Step'}
                                    </button>
                                </div>

                                <div className="text-[11px] text-nofx-text-muted space-y-1">
                                    <div>
                                        {language === 'zh' ? '当前周期' : 'Cycle'}:
                                        <span className="text-nofx-text-main ml-1">{runtimeStatus?.cycle_ms ?? '--'} ms</span>
                                    </div>
                                    <div>
                                        {language === 'zh' ? '决策节奏' : 'Decision cadence'}:
                                        <span className="text-nofx-text-main ml-1">{runtimeStatus?.decision_every_bars ?? '--'} {language === 'zh' ? '根K线/次' : 'bars/decision'}</span>
                                    </div>
                                    <div>
                                        {language === 'zh' ? '总循环' : 'Total cycles'}:
                                        <span className="text-nofx-text-main ml-1">{runtimeStatus?.metrics?.totalCycles ?? '--'}</span>
                                        <span className="mx-2">|</span>
                                        {language === 'zh' ? '成功' : 'Success'}:
                                        <span className="text-nofx-green ml-1">{runtimeStatus?.metrics?.successfulCycles ?? '--'}</span>
                                        <span className="mx-2">|</span>
                                        {language === 'zh' ? '失败' : 'Fail'}:
                                        <span className="text-nofx-red ml-1">{runtimeStatus?.metrics?.failedCycles ?? '--'}</span>
                                    </div>
                                    <div>
                                        {language === 'zh' ? '当前交易员调用数' : 'Selected trader calls'}:
                                        <span className="text-nofx-text-main ml-1">{selectedRuntimeTrader?.call_count ?? '--'}</span>
                                    </div>
                                    {runtimeActionMessage && (
                                        <div className="text-nofx-text-main">{runtimeActionMessage}</div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="nofx-glass p-4 border border-nofx-gold/20 rounded-lg">
                            <div className="flex items-center gap-2 text-sm font-semibold text-nofx-gold mb-2">
                                <Info className="w-4 h-4" />
                                {language === 'zh' ? '模拟规则（Demo）' : 'Simulation Rules (Demo)'}
                            </div>
                            <ul className="text-xs text-nofx-text-muted space-y-1">
                                <li>{language === 'zh' ? 'HS300 标的，虚拟仓位，无真实资金。' : 'HS300 symbols, virtual positions, no real funds.'}</li>
                                <li>{language === 'zh' ? '成交按下一根K线开盘价 + 固定滑点。' : 'Fills use next-bar open + fixed slippage.'}</li>
                                <li>{language === 'zh' ? 'A股约束：100股一手，T+1。' : 'A-share constraints: 100-share lots, T+1.'}</li>
                            </ul>
                        </div>

                        <div
                            className="nofx-glass p-6 animate-slide-in h-fit lg:sticky lg:top-24 lg:max-h-[calc(100vh-120px)] flex flex-col"
                            style={{ animationDelay: '0.2s' }}
                        >
                            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/5 shrink-0">
                                <div
                                    className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow-[0_4px_14px_rgba(99,102,241,0.4)]"
                                    style={{
                                        background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
                                    }}
                                >
                                    🧠
                                </div>
                                <div className="flex-1">
                                    <h2 className="text-xl font-bold text-nofx-text-main">
                                        {language === 'zh' ? '思考与行动' : 'Thought & Actions'}
                                    </h2>
                                    {decisions && decisions.length > 0 && (
                                        <div className="text-xs text-nofx-text-muted">
                                            {t('lastCycles', language, { count: decisions.length })}
                                        </div>
                                    )}
                                </div>
                                <select
                                    value={decisionsLimit}
                                    onChange={(e) => onDecisionsLimitChange(Number(e.target.value))}
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
                                className="space-y-4 overflow-y-auto pr-2 custom-scrollbar"
                                style={{ maxHeight: 'calc(100vh - 280px)' }}
                            >
                                {decisions && decisions.length > 0 ? (
                                    decisions.map((decision, i) => (
                                        <DecisionCard key={i} decision={decision} language={language} onSymbolClick={handleSymbolClick} />
                                    ))
                                ) : (
                                    <div className="py-16 text-center text-nofx-text-muted opacity-60">
                                        <div className="text-6xl mb-4 opacity-30 grayscale">🧠</div>
                                        <div className="text-lg font-semibold mb-2 text-nofx-text-main">
                                            {t('noDecisionsYet', language)}
                                        </div>
                                        <div className="text-sm">
                                            {t('aiDecisionsWillAppear', language)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

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
                {unit && <span className="text-xs font-mono text-nofx-text-muted opacity-60">{unit}</span>}
            </div>

            {change !== undefined && (
                <div className="flex items-center gap-1">
                    <div
                        className={`text-sm mono font-bold flex items-center gap-1 ${positive ? 'text-nofx-green' : 'text-nofx-red'}`}
                    >
                        <span>{positive ? '▲' : '▼'}</span>
                        <span>{positive ? '+' : ''}{change.toFixed(2)}%</span>
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
