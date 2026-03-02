import { useEffect, useState } from 'react'

import { useFullscreenLock } from '../../hooks/useFullscreenLock'
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

// Format numbers like 25,000,000 -> 25M
function formatCompactAmount(num: number) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M'
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k'
    }
    return num.toString()
}

function formatHHMMSS(ms: number) {
    const d = new Date(ms)
    return [
        d.getHours().toString().padStart(2, '0'),
        d.getMinutes().toString().padStart(2, '0'),
        d.getSeconds().toString().padStart(2, '0')
    ].join(':')
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

    // Poll the static JSON file
    useEffect(() => {
        let active = true

        const fetchData = async () => {
            try {
                // Add timestamp to foil caching
                const res = await fetch(`/cyber_market_live.json?t=${Date.now()}`)
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`)
                const data = await res.json()
                if (active) {
                    setState(data as MarketState)
                    setErrorCount(0)
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
    }, [])

    if (!state && errorCount > 5) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-black text-red-500 font-mono tracking-widest text-xl">
                [!!] DATA LINK SEVERED [!!]
            </div>
        )
    }

    if (!state) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-black text-cyan-500 font-mono tracking-widest text-xl animate-pulse">
                [ INITIALIZING CYBER-ORACLE FEED... ]
            </div>
        )
    }

    const { market, logs, balances, ai_pnl } = state
    const yesProbStr = (market.current_prob * 100).toFixed(1)
    const noProbStr = ((1 - market.current_prob) * 100).toFixed(1)

    // Format log reversed so newest is at the bottom (or top depending on preference, here we render top-down)
    const displayLogs = [...logs].reverse().slice(0, 15)

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
                                Prediction Net // Live
                            </h1>
                            <div className="text-[8px] text-white/50 tracking-widest font-mono">
                                NODE: {selectedTrader.trader_id}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 font-mono">
                        <div className="flex flex-col items-end">
                            <span className="text-[8px] text-white/50">PNL</span>
                            <span className={`text-xs font-bold tracking-tighter ${ai_pnl >= 0 ? 'text-[#00f5a0]' : 'text-red-500'}`}>
                                {ai_pnl >= 0 ? '+' : ''}${ai_pnl.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[8px] text-white/50">VOL</span>
                            <span className="text-xs font-bold text-white/90">${formatCompactAmount(market.volume)}</span>
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
                            CAM_01
                        </div>
                    </div>

                    {/* Market Question */}
                    <div className="mb-6 w-full mt-2 pr-32">
                        <div className="inline-block px-2 py-0.5 mb-3 rounded border border-[#00d9ff]/30 bg-[#00d9ff]/10 text-[#00d9ff] text-[10px] tracking-wider font-mono">
                            RESOLVES: {market.close_time}
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
                                    {market.yes_outcome}
                                </div>
                            </div>
                            {/* NO fill */}
                            <div className="h-full flex-1 bg-gradient-to-l from-rose-600 to-rose-400 flex items-center justify-end shadow-[inset_0_0_15px_rgba(255,255,255,0.2)]">
                                <div className="pr-3 text-lg font-black text-white/90 drop-shadow-md tracking-wider font-mono whitespace-nowrap overflow-hidden">
                                    {market.no_outcome}
                                </div>
                            </div>
                        </div>

                        {/* Numbers below the bar */}
                        <div className="flex justify-between items-start mt-2 px-1">
                            <div className="flex flex-col">
                                <span className="text-3xl font-black text-emerald-400 font-mono tracking-tighter drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]">
                                    {yesProbStr}%
                                </span>
                                <span className="text-[9px] font-bold text-emerald-400/60 uppercase tracking-widest mt-0.5">Price: ${market.current_prob.toFixed(2)}</span>
                            </div>
                            <div className="flex flex-col items-end">
                                <span className="text-3xl font-black text-rose-400 font-mono tracking-tighter drop-shadow-[0_0_8px_rgba(251,113,133,0.4)]">
                                    {noProbStr}%
                                </span>
                                <span className="text-[9px] font-bold text-rose-400/60 uppercase tracking-widest mt-0.5">Price: ${(1 - market.current_prob).toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    {/* AI Agent Status Block */}
                    <div className="mt-8 relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-lg blur opacity-20"></div>
                        <div className="relative bg-black/60 border border-white/10 rounded-lg p-3 flex gap-4 items-center backdrop-blur-md">
                            <div className="shrink-0 pl-1">
                                <div className="w-10 h-10 rounded-full border border-cyan-400 p-0.5 flex items-center justify-center bg-[#050B14] overflow-hidden">
                                    <img src="/icons/ai_brain.png" alt="AI Core" className="w-full h-full object-cover opacity-80" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                    <span className="absolute text-[#00d9ff] font-mono text-[6px] font-bold">{selectedTrader.trader_id.slice(-4)}</span>
                                </div>
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                                <div className="flex justify-between items-center w-full">
                                    <h3 className="text-cyan-400 font-bold text-[10px] uppercase tracking-widest flex items-center gap-1.5">
                                        <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-pulse"></span>
                                        AGENT ZERO
                                    </h3>
                                    <div className="text-[10px] text-white/50 font-mono uppercase tracking-widest">Bankroll</div>
                                </div>
                                <div className="text-sm mt-0.5 font-mono text-white tracking-widest font-semibold flex justify-between items-baseline">
                                    <span>READY</span>
                                    <span className="text-cyan-50">${balances["AI_Agent_Zero"]?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* BOTTOM SECTION: The Public Square Feed (Scrollable) */}
                <section className="flex-1 min-h-0 border-t border-white/10 bg-[#050914]/80 backdrop-blur-xl flex flex-col relative z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
                    <div className="h-8 border-b border-white/5 flex items-center justify-between px-4 shrink-0 bg-[#0A101C]">
                        <h3 className="text-[10px] font-bold text-white/60 uppercase tracking-[0.2em] font-mono">Live Protocol Feed</h3>
                        <span className="flex h-1.5 w-1.5 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                        </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-[11px]">
                        {displayLogs.length === 0 && (
                            <div className="text-white/30 text-center py-10 tracking-widest text-xs">AWAITING SIGNALS...</div>
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
