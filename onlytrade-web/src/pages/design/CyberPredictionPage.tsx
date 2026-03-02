import { useEffect, useRef, useState } from 'react'

import { useFullscreenLock } from '../../hooks/useFullscreenLock'
import { api } from '../../lib/api'
import {
    type FormalStreamDesignPageProps,
    usePhoneStreamData,
} from './phoneStreamShared'
import { motion, AnimatePresence } from 'framer-motion'

interface MarketState {
    market: {
        id: string
        title: string
        yes_outcome: string
        no_outcome: string
        initial_prob: number
        current_prob: number
        close_time: string
        volume: number
        liquidity: number
    }
    balances: {
        [username: string]: number
    }
    logs: Array<{
        id: number
        sender: string
        type: string
        text: string
        time: number
    }>
    ai_pnl: number
    last_update: number
}

interface CommentaryItem {
    id: string
    event_type: string
    text: string
    speaker_id: string
    speaker_name: string
    voice_id: string
    source: string
    created_ts_ms: number
    market_id?: string | null
}

function normalizeProb(value: unknown): number | null {
    const n = Number(value)
    if (!Number.isFinite(n)) return null
    return Math.max(0, Math.min(1, n))
}

function normalizeCommentaryItem(raw: unknown): CommentaryItem | null {
    if (!raw || typeof raw !== 'object') return null
    const row = raw as Record<string, unknown>
    const id = String(row.id || '').trim()
    const text = String(row.text || '').trim()
    if (!id || !text) return null
    return {
        id,
        event_type: String(row.event_type || 'market_tick').trim().toLowerCase(),
        text,
        speaker_id: String(row.speaker_id || '').trim().toLowerCase() || 'host_a',
        speaker_name: String(row.speaker_name || '').trim() || '主播',
        voice_id: String(row.voice_id || '').trim(),
        source: String(row.source || '').trim(),
        created_ts_ms: Number(row.created_ts_ms) || Date.now(),
        market_id: row.market_id ? String(row.market_id) : null,
    }
}

// Format numbers like 25,000,000 -> 25M
function formatCompactAmount(num: number) {
    if (num >= 100000000) {
        return (num / 100000000).toFixed(1) + '亿'
    }
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + '万'
    }
    return Number(num || 0).toLocaleString('zh-CN')
}

function formatHHMMSS(ms: number) {
    const d = new Date(ms)
    return [
        d.getHours().toString().padStart(2, '0'),
        d.getMinutes().toString().padStart(2, '0'),
        d.getSeconds().toString().padStart(2, '0')
    ].join(':')
}

function localizeOutcomeLabel(label: string, fallback: string) {
    const text = String(label || '').trim()
    if (!text) return fallback
    const normalized = text.toLowerCase()
    if (['yes', 'true', 'up'].includes(normalized)) return '支持'
    if (['no', 'false', 'down'].includes(normalized)) return '不支持'
    return text
}

export default function CyberPredictionPage(props: FormalStreamDesignPageProps) {
    useFullscreenLock()
    const pageLanguage = 'zh'
    const {
        selectedTrader,
    } = usePhoneStreamData({
        ...props,
        language: pageLanguage,
    })

    const [state, setState] = useState<MarketState | null>(null)
    const [errorCount, setErrorCount] = useState(0)
    const [commentaryItems, setCommentaryItems] = useState<CommentaryItem[]>([])
    const [speakingCommentaryId, setSpeakingCommentaryId] = useState<string | null>(null)

    const snapshotRef = useRef<{
        marketId: string
        prob: number | null
        lastLogId: number | null
        lastCommentaryTs: number
    }>({
        marketId: '',
        prob: null,
        lastLogId: null,
        lastCommentaryTs: 0,
    })
    const inFlightRef = useRef(false)
    const audioQueueRef = useRef<Array<{ id: string; url: string }>>([])
    const audioPlayingRef = useRef(false)
    const activeAudioRef = useRef<HTMLAudioElement | null>(null)
    const knownCommentaryIdsRef = useRef<Set<string>>(new Set())

    const appendCommentary = (item: CommentaryItem) => {
        if (knownCommentaryIdsRef.current.has(item.id)) return
        knownCommentaryIdsRef.current.add(item.id)
        setCommentaryItems((prev) => {
            const next = [...prev, item]
            if (next.length > 40) next.splice(0, next.length - 40)
            return next
        })
    }

    const playNextCommentaryAudio = () => {
        if (audioPlayingRef.current) return
        const next = audioQueueRef.current.shift()
        if (!next) {
            setSpeakingCommentaryId(null)
            return
        }

        const audio = new Audio(next.url)
        activeAudioRef.current = audio
        audioPlayingRef.current = true
        setSpeakingCommentaryId(next.id)

        const done = () => {
            audioPlayingRef.current = false
            setSpeakingCommentaryId(null)
            URL.revokeObjectURL(next.url)
            activeAudioRef.current = null
            playNextCommentaryAudio()
        }

        audio.onended = done
        audio.onerror = done
        void audio.play().catch(done)
    }

    const enqueueCommentaryAudio = (id: string, blob: Blob) => {
        if (!(blob instanceof Blob) || blob.size <= 0) return
        const url = URL.createObjectURL(blob)
        audioQueueRef.current.push({ id, url })
        playNextCommentaryAudio()
    }

    const requestCommentaryForEvent = async (payload: {
        eventType: string
        eventKey: string
        market: MarketState['market']
        recentLogs: MarketState['logs']
        triggerReason: string
        probDelta?: number
    }) => {
        if (inFlightRef.current) return
        inFlightRef.current = true
        try {
            const generated = await api.generatePolymarketCommentary({
                room_id: selectedTrader.trader_id,
                event_type: payload.eventType,
                event_key: payload.eventKey,
                market: payload.market,
                recent_logs: payload.recentLogs.slice(-6),
                trigger: {
                    reason: payload.triggerReason,
                    delta_prob: payload.probDelta,
                },
            })
            const item = normalizeCommentaryItem(generated.commentary)
            if (!item) return
            appendCommentary(item)

            try {
                const speechBlob = await api.synthesizeRoomSpeech({
                    room_id: selectedTrader.trader_id,
                    text: item.text,
                    message_id: item.id,
                    tone: 'energetic',
                    speaker_id: item.speaker_id,
                })
                enqueueCommentaryAudio(item.id, speechBlob)
            } catch {
                // keep text commentary even if TTS fails
            }
        } catch {
            // generation failures should not break render loop
        } finally {
            inFlightRef.current = false
        }
    }

    // Poll the static JSON file
    useEffect(() => {
        let active = true

        const fetchData = async () => {
            try {
                // Add timestamp to foil caching
                const res = await fetch(`/cyber_market_live.json?t=${Date.now()}`)
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`)
                const data = await res.json()
                const nextState = data as MarketState
                const nowMs = Date.now()
                const prev = snapshotRef.current
                const marketId = String(nextState?.market?.id || '').trim()
                const prob = normalizeProb(nextState?.market?.current_prob)
                const logs = Array.isArray(nextState?.logs) ? nextState.logs : []
                const lastLog = logs.length ? logs[logs.length - 1] : null
                const lastLogId = Number.isFinite(Number(lastLog?.id)) ? Number(lastLog?.id) : null

                let pendingEvent: {
                    eventType: string
                    eventKey: string
                    triggerReason: string
                    probDelta?: number
                } | null = null

                const elapsedSinceCommentary = nowMs - Number(prev.lastCommentaryTs || 0)
                if (!prev.marketId && marketId) {
                    pendingEvent = {
                        eventType: 'initial_snapshot',
                        eventKey: `${marketId}|init`,
                        triggerReason: 'initial_market_snapshot',
                    }
                } else if (prev.marketId && marketId && marketId !== prev.marketId) {
                    pendingEvent = {
                        eventType: 'market_switch',
                        eventKey: `${marketId}|switch`,
                        triggerReason: 'market_switched',
                    }
                } else if (
                    prob != null
                    && prev.prob != null
                    && elapsedSinceCommentary >= 3500
                ) {
                    const delta = prob - prev.prob
                    if (Math.abs(delta) >= 0.012) {
                        const sign = delta > 0 ? 'up' : 'down'
                        pendingEvent = {
                            eventType: delta > 0 ? 'prob_spike_up' : 'prob_spike_down',
                            eventKey: `${marketId}|prob|${sign}|${Math.round(prob * 1000)}`,
                            triggerReason: `probability_${sign}_${(Math.abs(delta) * 100).toFixed(2)}pct`,
                            probDelta: delta,
                        }
                    }
                }

                if (!pendingEvent && lastLogId != null && lastLogId !== prev.lastLogId && elapsedSinceCommentary >= 3500) {
                    const logType = String(lastLog?.type || '').trim().toLowerCase()
                    if (logType === 'info') {
                        pendingEvent = {
                            eventType: 'headline_change',
                            eventKey: `${marketId}|info|${lastLogId}`,
                            triggerReason: 'system_info_log_changed',
                        }
                    } else if (logType === 'agent' && elapsedSinceCommentary >= 4500) {
                        pendingEvent = {
                            eventType: 'agent_execution',
                            eventKey: `${marketId}|agent|${lastLogId}`,
                            triggerReason: 'agent_trade_log_changed',
                        }
                    }
                }

                snapshotRef.current = {
                    marketId,
                    prob,
                    lastLogId,
                    lastCommentaryTs: pendingEvent ? nowMs : prev.lastCommentaryTs,
                }

                if (active) {
                    setState(nextState)
                    setErrorCount(0)
                    if (pendingEvent) {
                        void requestCommentaryForEvent({
                            ...pendingEvent,
                            market: nextState.market,
                            recentLogs: logs,
                        })
                    }
                }
            } catch (err) {
                console.warn('Failed to fetch market data:', err)
                if (active) setErrorCount((c) => c + 1)
            }
        }

        fetchData() // initial fetch
        const timer = setInterval(fetchData, 1500) // Poll every 1.5s

        return () => {
            active = false
            clearInterval(timer)
        }
    }, [selectedTrader.trader_id])

    useEffect(() => {
        return () => {
            if (activeAudioRef.current) {
                activeAudioRef.current.pause()
                activeAudioRef.current = null
            }
            for (const item of audioQueueRef.current) {
                URL.revokeObjectURL(item.url)
            }
            audioQueueRef.current = []
        }
    }, [])

    useEffect(() => {
        let active = true
        let afterTsMs = Date.now() - 4000

        const pullFeed = async () => {
            try {
                const rows = await api.getPolymarketCommentaryFeed({
                    room_id: selectedTrader.trader_id,
                    after_ts_ms: afterTsMs,
                    limit: 20,
                })
                if (!active || !rows.length) return

                for (const raw of rows) {
                    const item = normalizeCommentaryItem(raw)
                    if (!item) continue
                    afterTsMs = Math.max(afterTsMs, Number(item.created_ts_ms) || 0)
                    const alreadyKnown = knownCommentaryIdsRef.current.has(item.id)
                    appendCommentary(item)
                    if (alreadyKnown) continue
                    try {
                        const speechBlob = await api.synthesizeRoomSpeech({
                            room_id: selectedTrader.trader_id,
                            text: item.text,
                            message_id: item.id,
                            tone: 'energetic',
                            speaker_id: item.speaker_id,
                        })
                        enqueueCommentaryAudio(item.id, speechBlob)
                    } catch {
                        // keep text-only feed if speech fails
                    }
                }
            } catch {
                // ignore feed polling errors
            }
        }

        void pullFeed()
        const timer = setInterval(() => {
            void pullFeed()
        }, 2500)

        return () => {
            active = false
            clearInterval(timer)
        }
    }, [selectedTrader.trader_id])

    if (!state && errorCount > 5) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-black text-red-500 font-mono tracking-widest text-xl">
                [!!] 数据连接中断 [!!]
            </div>
        )
    }

    if (!state) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-black text-cyan-500 font-mono tracking-widest text-xl animate-pulse">
                [ 正在初始化预测解说流... ]
            </div>
        )
    }

    const { market, logs, balances, ai_pnl } = state
    const yesProbStr = (market.current_prob * 100).toFixed(1)
    const noProbStr = ((1 - market.current_prob) * 100).toFixed(1)
    const yesOutcomeLabel = localizeOutcomeLabel(market.yes_outcome, '支持')
    const noOutcomeLabel = localizeOutcomeLabel(market.no_outcome, '不支持')

    // Format log reversed so newest is at the bottom (or top depending on preference, here we render top-down)
    const displayLogs = [...logs].reverse().slice(0, 15)
    const displayCommentary = [...commentaryItems].slice(-4).reverse()

    return (
        <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#020509] text-white font-sans max-w-lg mx-auto border-x border-white/5 shadow-2xl relative">

            {/* --- TOP BRANDING HEADER --- */}
            <header className="flex h-12 shrink-0 border-b border-[#00f5a0]/30 bg-black/80 px-4 shadow-[0_4px_30px_rgba(0,245,160,0.15)] relative">
                <div className="absolute top-0 left-0 h-[1px] w-full bg-gradient-to-r from-[#00f5a0] via-[#00d9ff] to-transparent"></div>
                <div className="flex w-full items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="text-[#00f5a0] text-xl animate-pulse">❖</div>
                        <div>
                            <h1 className="text-[10px] font-black tracking-widest text-[#00f5a0] drop-shadow-[0_0_8px_rgba(0,245,160,0.6)] font-mono uppercase">
                                预测解说台 // 直播中
                            </h1>
                            <div className="text-[8px] text-white/50 tracking-widest font-mono">
                                节点: {selectedTrader.trader_id}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 font-mono">
                        <div className="flex flex-col items-end">
                            <span className="text-[8px] text-white/50">趋势分</span>
                            <span className={`text-xs font-bold tracking-tighter ${ai_pnl >= 0 ? 'text-[#00f5a0]' : 'text-red-500'}`}>
                                {ai_pnl >= 0 ? '+' : ''}{ai_pnl.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[8px] text-white/50">热度</span>
                            <span className="text-xs font-bold text-white/90">{formatCompactAmount(market.volume)}</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* --- MAIN VERTICAL LAYOUT --- */}
            <main className="flex min-h-0 flex-1 flex-col relative overflow-hidden">

                {/* Background grid accent */}
                <div className="absolute inset-0 pointer-events-none" style={{
                    backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
                    backgroundSize: '40px 40px'
                }}></div>

                {/* TOP SECTION: Market Title and Odds */}
                <section className="flex flex-col flex-none p-5 relative z-10 w-full shrink-0">

                    {/* Guest Avatar / Video Slot (Future-Proofed) - Approx 1/16 of screen area */}
                    <div className="absolute top-4 right-4 w-28 h-28 rounded-xl border border-white/20 shadow-[0_0_15px_rgba(0,0,0,0.5)] overflow-hidden bg-black/60 z-50">
                        {/* Dynamic video loop replacing static image */}
                        <video
                            src="/avatar.mp4"
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="w-full h-full object-cover opacity-90"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                        <div className="absolute bottom-1 right-2 text-[8px] font-mono text-white/50 bg-black/40 px-1 rounded">
                            机位_01
                        </div>
                    </div>

                    {/* Market Question */}
                    <div className="mb-6 w-full mt-2 pr-32">
                        <div className="inline-block px-2 py-0.5 mb-3 rounded border border-[#00d9ff]/30 bg-[#00d9ff]/10 text-[#00d9ff] text-[10px] tracking-wider font-mono">
                            截止时间: {market.close_time}
                        </div>
                        <AnimatePresence mode="wait">
                            <motion.h2
                                key={market.id}
                                initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
                                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                                exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)', transition: { duration: 0.2 } }}
                                transition={{ duration: 0.8, ease: "easeOut" }}
                                className="text-2xl font-bold leading-tight tracking-tight text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]"
                            >
                                {market.title}
                            </motion.h2>
                        </AnimatePresence>
                    </div>

                    {/* The Binary Odds Arena */}
                    <div className="flex flex-col w-full mt-1">
                        {/* Visual Bar */}
                        <div className="relative h-12 w-full rounded-xl flex overflow-hidden border border-white/10 shadow-xl bg-[#0B1015]">
                            {/* YES fill */}
                            <div
                                className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-[1200ms] ease-out flex items-center shadow-[inset_0_0_15px_rgba(255,255,255,0.2)]"
                                style={{ width: `${market.current_prob * 100}%` }}
                            >
                                <div className="pl-3 text-lg font-black text-white/90 drop-shadow-md tracking-wider font-mono whitespace-nowrap overflow-hidden">
                                    {yesOutcomeLabel}
                                </div>
                            </div>
                            {/* NO fill */}
                            <div className="h-full flex-1 bg-gradient-to-l from-rose-600 to-rose-400 flex items-center justify-end shadow-[inset_0_0_15px_rgba(255,255,255,0.2)]">
                                <div className="pr-3 text-lg font-black text-white/90 drop-shadow-md tracking-wider font-mono whitespace-nowrap overflow-hidden">
                                    {noOutcomeLabel}
                                </div>
                            </div>
                        </div>

                        {/* Numbers below the bar */}
                        <div className="flex justify-between items-start mt-2 px-1">
                            <div className="flex flex-col">
                                <span className="text-3xl font-black text-emerald-400 font-mono tracking-tighter drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]">
                                    {yesProbStr}%
                                </span>
                                <span className="text-[9px] font-bold text-emerald-400/60 tracking-widest mt-0.5">当前概率: {(market.current_prob * 100).toFixed(2)}%</span>
                            </div>
                            <div className="flex flex-col items-end">
                                <span className="text-3xl font-black text-rose-400 font-mono tracking-tighter drop-shadow-[0_0_8px_rgba(251,113,133,0.4)]">
                                    {noProbStr}%
                                </span>
                                <span className="text-[9px] font-bold text-rose-400/60 tracking-widest mt-0.5">当前概率: {((1 - market.current_prob) * 100).toFixed(2)}%</span>
                            </div>
                        </div>
                    </div>

                    {/* AI Agent Status Block */}
                    <div className="mt-8 relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-lg blur opacity-20"></div>
                        <div className="relative bg-black/60 border border-white/10 rounded-lg p-3 flex gap-4 items-center backdrop-blur-md">
                            <div className="shrink-0 pl-1">
                                <div className="w-10 h-10 rounded-full border border-cyan-400 p-0.5 flex items-center justify-center bg-[#050B14] overflow-hidden">
                                    <img src="/icons/ai_brain.png" alt="解说引擎核心" className="w-full h-full object-cover opacity-80" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                    <span className="absolute text-[#00d9ff] font-mono text-[6px] font-bold">{selectedTrader.trader_id.slice(-4)}</span>
                                </div>
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                                <div className="flex justify-between items-center w-full">
                                    <h3 className="text-cyan-400 font-bold text-[10px] uppercase tracking-widest flex items-center gap-1.5">
                                        <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-pulse"></span>
                                        解说引擎
                                    </h3>
                                    <div className="text-[10px] text-white/50 font-mono tracking-widest">能量值</div>
                                </div>
                                <div className="text-sm mt-0.5 font-mono text-white tracking-widest font-semibold flex justify-between items-baseline">
                                    <span>在线</span>
                                    <span className="text-cyan-50">{Number(balances['AI_Agent_Zero'] || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* BOTTOM SECTION: The Public Square Feed (Scrollable) */}
                <section className="flex-1 min-h-0 border-t border-white/10 bg-[#050914]/80 backdrop-blur-xl flex flex-col relative z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
                    <div className="h-8 border-b border-white/5 flex items-center justify-between px-4 shrink-0 bg-[#0A101C]">
                        <h3 className="text-[10px] font-bold text-white/60 tracking-[0.2em] font-mono">实时观察流</h3>
                        <span className="flex h-1.5 w-1.5 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                        </span>
                    </div>

                    <div className="shrink-0 border-b border-white/5 bg-[#070d18]/70 px-3 py-2">
                        <div className="mb-1 flex items-center justify-between text-[9px] font-mono uppercase tracking-widest text-cyan-300/80">
                            <span>实时解说</span>
                            {speakingCommentaryId ? <span className="text-emerald-300">播报中</span> : <span className="text-white/40">待机</span>}
                        </div>
                        {displayCommentary.length === 0 ? (
                            <div className="text-[10px] text-white/35 font-mono">暂无解说内容</div>
                        ) : (
                            <div className="space-y-1.5">
                                {displayCommentary.map((item) => {
                                    const speaking = speakingCommentaryId === item.id
                                    return (
                                        <div
                                            key={item.id}
                                            className={`rounded border px-2 py-1.5 font-mono ${speaking
                                                ? 'border-emerald-400/60 bg-emerald-400/10'
                                                : 'border-cyan-400/20 bg-cyan-500/5'}`}
                                        >
                                            <div className="mb-0.5 flex items-center justify-between text-[9px] text-white/60">
                                                <span className="text-cyan-200/90">{item.speaker_name}</span>
                                                <span>{formatHHMMSS(item.created_ts_ms)}</span>
                                            </div>
                                            <div className="text-[11px] leading-snug text-white/90">{item.text}</div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-[11px]">
                        {displayLogs.length === 0 && (
                            <div className="text-white/30 text-center py-10 tracking-widest text-xs">等待新信号...</div>
                        )}
                        {displayLogs.map(log => {
                            const isAgent = log.type === 'agent'
                            const isSystem = log.type === 'info'
                            return (
                                <div key={log.id} className={`flex flex-col pt-1 pb-2 border-b border-white/[0.03] animate-in fade-in slide-in-from-bottom-2 duration-500 ${isSystem ? 'opacity-50' : ''}`}>
                                    <div className="flex items-center justify-between mb-1 opacity-60">
                                        <span className={isAgent ? 'text-amber-400 font-bold tracking-widest text-[10px]' : isSystem ? 'text-white/40 text-[10px]' : 'text-cyan-400 tracking-widest text-[10px]'}>
                                            {log.sender}
                                        </span>
                                        <span className="text-[9px] text-white/30">{formatHHMMSS(log.time)}</span>
                                    </div>
                                    <div className={`leading-snug ${isAgent ? 'text-amber-50 shadow-sm' : isSystem ? 'text-white/40 italic' : 'text-white/80'}`}>
                                        {isAgent && <span className="mr-1.5 text-amber-500">&gt;_</span>}
                                        {log.text}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                    {/* Bottom gradient fade for text */}
                    <div className="h-16 bg-gradient-to-t from-[#020509] to-transparent absolute bottom-0 left-0 w-full pointer-events-none"></div>
                </section>
            </main>
        </div>
    )
}
