import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import { useFullscreenLock } from '../../hooks/useFullscreenLock'
import { PhoneRealtimeKlineChart } from '../../components/PhoneRealtimeKlineChart'
import {
  type FormalStreamDesignPageProps,
  formatSignedPct,
  PhoneAvatarSlot,
  useAutoScrollFeed,
  useAvatarSize,
  usePhoneStreamData,
} from './phoneStreamShared'

export default function Expert2MobileBroadcastPage(
  props: FormalStreamDesignPageProps
) {
  useFullscreenLock()
  const {
    selectedTrader,
    decisionItems,
    positions,
    publicMessages,
    focusedSymbol,
    modeLabel,
    freshnessLabel,
    marketBreadth,
    sseStatus,
    language,
  } = usePhoneStreamData(props)
  const { sizePx, decrease, increase } = useAvatarSize('stream-avatar-size-expert2')
  const { containerRef, unseenCount, onScroll, jumpToLatest } = useAutoScrollFeed(
    publicMessages.length
  )
  const [headlineIndex, setHeadlineIndex] = useState(0)

  useEffect(() => {
    if (decisionItems.length <= 1) return
    const timer = window.setInterval(() => {
      setHeadlineIndex((prev) => (prev + 1) % decisionItems.length)
    }, 4500)
    return () => window.clearInterval(timer)
  }, [decisionItems.length])

  const featuredDecision = decisionItems[headlineIndex] || decisionItems[0]
  const tickerItems = useMemo(
    () =>
      positions.slice(0, 5).map((pos) => {
        return `${pos.symbol} ${formatSignedPct(pos.unrealized_pnl_pct)} ${pos.side}`
      }),
    [positions]
  )

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#111116] text-white">
      <div className="relative mx-auto h-full w-full max-w-[480px] overflow-hidden border-x border-white/5">
        <div className="relative" style={{ height: '56vh' }}>
          <PhoneRealtimeKlineChart
            symbol={focusedSymbol}
            interval="1d"
            limit={30}
            refreshMs={30_000}
            height="100%"
          />

          <div className="absolute left-0 right-0 top-0 z-20 bg-gradient-to-b from-black/85 to-transparent px-3 pb-4 pt-[max(10px,env(safe-area-inset-top,0px))]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-black">{modeLabel}</span>
                <span className="text-sm font-bold tracking-tight">{selectedTrader.trader_name}</span>
              </div>
              <span className="rounded-full border border-white/20 bg-black/45 px-2 py-0.5 text-[10px] font-mono">
                {sseStatus} · {freshnessLabel}
              </span>
            </div>
            <div className="mt-2 text-[10px] font-mono text-white/75">focus: {focusedSymbol}</div>
            {marketBreadth.advancers != null && marketBreadth.decliners != null && (
              <div className="mt-1 text-[10px] font-mono text-white/75">
                R {marketBreadth.advancers} / B {marketBreadth.decliners}
                {marketBreadth.redBlueRatio != null && ` · ${marketBreadth.redBlueRatio.toFixed(2)}`}
              </div>
            )}
          </div>

          <PhoneAvatarSlot
            trader={selectedTrader}
            sizePx={Math.max(96, Math.min(sizePx - 36, 190))}
            language={language}
            onDecrease={decrease}
            onIncrease={increase}
            className="z-30"
          />

          {featuredDecision && (
            <div className="absolute bottom-2 left-0 right-0 z-20 px-2">
              <AnimatePresence mode="wait">
                <motion.div
                  key={featuredDecision.id}
                  initial={{ y: 14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 10, opacity: 0 }}
                  className="rounded-lg border border-white/15 bg-black/75 px-3 py-2 backdrop-blur-sm"
                >
                  <div className="flex items-center justify-between text-[10px] font-mono text-white/60">
                    <span>{featuredDecision.timestamp}</span>
                    <span>{featuredDecision.symbol}</span>
                  </div>
                  <div className="mt-0.5 text-sm font-bold text-white">
                    {featuredDecision.action}
                    {featuredDecision.confidence != null && (
                      <span className="ml-2 text-xs text-amber-400">
                        {(featuredDecision.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-white/75">
                    {featuredDecision.reasoning}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="relative h-[calc(44vh-28px)] overflow-hidden border-t border-white/10 bg-[#0d0d12]">
          <div className="flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-widest text-white/40">
            <span>{language === 'zh' ? '实时聊天（仅展示）' : 'Public chat (display only)'}</span>
            <span>{publicMessages.length}</span>
          </div>

          <div
            ref={containerRef}
            onScroll={onScroll}
            className="h-[calc(100%-32px)] overflow-y-auto px-3 pb-4"
          >
            <div className="space-y-2">
              {publicMessages.map((msg) => (
                <div key={msg.id} className="flex items-end gap-1.5">
                  <span className={`text-[10px] font-bold ${msg.sender_type === 'agent' ? 'text-amber-400' : 'text-white/55'}`}>
                    {msg.sender_name}:
                  </span>
                  <span className="text-[11px] text-white/85">{msg.text}</span>
                </div>
              ))}
              {!publicMessages.length && (
                <div className="py-8 text-center text-xs text-white/45">
                  {language === 'zh' ? '暂无聊天消息' : 'No chat messages yet'}
                </div>
              )}
            </div>
          </div>

          {unseenCount > 0 && (
            <button
              type="button"
              onClick={jumpToLatest}
              className="absolute bottom-2 right-2 rounded-full border border-cyan-400/40 bg-black/85 px-2 py-1 text-[10px] text-cyan-300"
            >
              {language === 'zh' ? `新消息 ${unseenCount}` : `New ${unseenCount}`}
            </button>
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 z-50 h-7 overflow-hidden border-t border-black/30 bg-[#CC0000]">
          <div className="animate-stream-ticker flex h-full items-center gap-7 px-4 text-[10px] font-bold text-white">
            {tickerItems.concat(tickerItems).map((item, idx) => (
              <span key={`${idx}-${item}`} className="whitespace-nowrap">
                {item}
              </span>
            ))}
          </div>
        </div>

        <style>{`
          @keyframes streamTicker {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
          .animate-stream-ticker {
            animation: streamTicker 24s linear infinite;
          }
        `}</style>
      </div>
    </div>
  )
}
