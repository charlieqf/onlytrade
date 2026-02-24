import { useEffect, useState } from 'react'

import { useFullscreenLock } from '../../hooks/useFullscreenLock'
import { useRoomBgm } from '../../hooks/useRoomBgm'
import { PhoneRealtimeKlineChart } from '../../components/PhoneRealtimeKlineChart'
import {
  type FormalStreamDesignPageProps,
  formatSignedMoney,
  formatSignedPct,
  PhoneAvatarSlot,
  useAutoScrollFeed,
  useAvatarSize,
  usePhoneStreamData,
  useAgentTtsAutoplay,
} from './phoneStreamShared'

export default function Expert1CommandDeckPage(
  props: FormalStreamDesignPageProps
) {
  useFullscreenLock()
  const {
    selectedTrader,
    roomId,
    positions,
    decisionItems,
    publicMessages,
    focusedSymbol,
    modeLabel,
    freshnessLabel,
    packetAgeLabel,
    decisionAgeLabel,
    chatAgeLabel,
    transportLabel,
    chatSyncState,
    isDegraded,
    marketBreadth,
    sseStatus,
    language,
  } = usePhoneStreamData(props)
  const { sizePx, decrease, increase } = useAvatarSize('stream-avatar-size-expert1')
  const { ttsAvailable, ttsAutoPlay, setTtsAutoPlay, ttsError, roomVoice, ttsSpeaking } = useAgentTtsAutoplay({
    roomId,
    publicMessages,
  })
  const {
    bgmAvailable,
    bgmEnabled,
    setBgmEnabled,
    bgmTrackTitle,
    bgmError,
  } = useRoomBgm({ roomId, ducking: ttsSpeaking })
  const { containerRef, unseenCount, onScroll, jumpToLatest } = useAutoScrollFeed(
    publicMessages.length
  )
  const [pinnedSymbol, setPinnedSymbol] = useState<string>('')
  const [pinnedUntilMs, setPinnedUntilMs] = useState<number>(0)
  const [nowMs, setNowMs] = useState<number>(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!pinnedSymbol) return
    const remainingMs = Math.max(0, pinnedUntilMs - Date.now())
    if (remainingMs <= 0) {
      setPinnedSymbol('')
      return
    }
    const timer = window.setTimeout(() => setPinnedSymbol(''), remainingMs)
    return () => window.clearTimeout(timer)
  }, [pinnedSymbol, pinnedUntilMs])

  const activeSymbol = pinnedSymbol || focusedSymbol
  const pinRemainingSec = pinnedSymbol
    ? Math.max(0, Math.ceil((pinnedUntilMs - nowMs) / 1000))
    : 0

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#050510] text-white">
      <div className="relative mx-auto h-full w-full max-w-[480px] overflow-hidden border-x border-white/5">
        <div
          className="relative border-b border-white/10"
          style={{ height: 'clamp(280px, 44vh, 420px)' }}
        >
          <PhoneRealtimeKlineChart
            symbol={activeSymbol}
            interval="1d"
            limit={30}
            refreshMs={30_000}
            height="100%"
          />

          <div className="absolute right-2 top-2 z-20 flex items-center gap-1.5">
            <span className="rounded-full border border-white/20 bg-black/50 px-2 py-0.5 text-[10px] font-black">
              {modeLabel}
            </span>
            <span className="rounded-full border border-white/20 bg-black/50 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
              {transportLabel}
            </span>
            <span className="rounded-full border border-white/20 bg-black/50 px-2 py-0.5 text-[10px] font-mono text-white/80">
              {sseStatus}
            </span>
            <span className="rounded-full border border-white/20 bg-black/50 px-2 py-0.5 text-[10px] font-mono text-white/80">
              {freshnessLabel}
            </span>
          </div>

          <div className="absolute right-2 top-9 z-20 flex items-center gap-1 text-[9px] font-mono">
            <span className="rounded bg-black/55 px-1.5 py-0.5 text-white/85">pkt {packetAgeLabel}</span>
            <span className="rounded bg-black/55 px-1.5 py-0.5 text-white/85">dec {decisionAgeLabel}</span>
            <span className="rounded bg-black/55 px-1.5 py-0.5 text-white/85">chat {chatAgeLabel}</span>
            <button
              type="button"
              onClick={() => setTtsAutoPlay((prev) => !prev)}
              disabled={!ttsAvailable}
              className={`rounded px-1.5 py-0.5 text-[9px] ${ttsAutoPlay ? 'bg-emerald-600/65 text-white' : 'bg-black/55 text-white/80'} disabled:opacity-50`}
            >
              {ttsAutoPlay ? 'voice on' : 'voice off'}
            </button>
            <button
              type="button"
              onClick={() => setBgmEnabled((prev) => !prev)}
              disabled={!bgmAvailable}
              className={`rounded px-1.5 py-0.5 text-[9px] ${bgmEnabled ? 'bg-amber-500/70 text-black' : 'bg-black/55 text-white/80'} disabled:opacity-50`}
            >
              {bgmEnabled ? 'bgm on' : 'bgm off'}
            </button>
          </div>

          {(roomVoice || ttsError || bgmTrackTitle || bgmError) && (
            <div className="absolute right-2 top-14 z-20 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-mono text-white/80">
              {ttsError
                ? 'voice err'
                : bgmError
                  ? 'bgm err'
                  : bgmTrackTitle
                    ? `voice ${roomVoice} · bgm ${bgmTrackTitle}`
                    : `voice ${roomVoice}`}
            </div>
          )}

          <div className="absolute left-2 top-2 z-20 rounded bg-black/50 px-2 py-1 text-[10px] font-mono text-white/90">
            {selectedTrader.trader_name} · {activeSymbol}
          </div>

          <div className="absolute left-2 top-9 z-20 flex items-center gap-1 text-[9px] font-mono text-white/85">
            <span className="rounded bg-black/55 px-1.5 py-0.5">chat {chatSyncState}</span>
            {pinnedSymbol && (
              <>
                <span className="rounded bg-black/55 px-1.5 py-0.5 text-amber-300">
                  pin {pinRemainingSec}s
                </span>
                <button
                  type="button"
                  onClick={() => setPinnedSymbol('')}
                  className="rounded border border-white/20 bg-black/60 px-1.5 py-0.5 text-[9px] text-white"
                >
                  clear
                </button>
              </>
            )}
          </div>

          {isDegraded && (
            <div className="absolute inset-x-2 top-16 z-20 rounded border border-red-400/35 bg-red-500/15 px-2 py-1 text-[10px] font-medium text-red-200">
              {language === 'zh'
                ? '数据降级：SSE/数据新鲜度异常，已自动切换轮询兜底。'
                : 'Degraded stream: SSE/freshness issue detected, polling fallback active.'}
            </div>
          )}

          {marketBreadth.advancers != null && marketBreadth.decliners != null && (
            <div className="absolute left-2 top-10 z-20 rounded bg-black/55 px-2 py-1 text-[10px] font-mono text-white/90">
              R {marketBreadth.advancers} / B {marketBreadth.decliners}
              {marketBreadth.redBlueRatio != null && ` · ${marketBreadth.redBlueRatio.toFixed(2)}`}
            </div>
          )}

          <PhoneAvatarSlot
            trader={selectedTrader}
            sizePx={Math.max(24, Math.round(sizePx / 4))}
            language={language}
            onDecrease={decrease}
            onIncrease={increase}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#080816]" style={{ height: 'calc(100% - clamp(280px, 44vh, 420px))' }}>
          <div className="grid shrink-0 grid-cols-3 border-b border-white/10">
            <div className="border-r border-white/5 py-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-red-400">
              {language === 'zh' ? '持仓' : 'positions'}
            </div>
            <div className="border-r border-white/5 py-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-amber-400">
              {language === 'zh' ? '决策' : 'decisions'}
            </div>
            <div className="py-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-cyan-400">
              {language === 'zh' ? '聊天' : 'chat'}
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-3 divide-x divide-white/5">
            <div className="overflow-y-auto p-2">
              <div className="space-y-1.5">
                {positions.slice(0, 6).map((pos) => (
                  <div key={`${pos.symbol}-${pos.side}`} className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <div className="text-[11px] font-bold text-white">{pos.symbol}</div>
                    <div className="text-[9px] font-mono text-white/55">
                      {pos.side} · {Number(pos.quantity).toLocaleString()} @ {pos.entry_price.toFixed(2)}
                    </div>
                    <div
                      className={`mt-1 text-[10px] font-mono font-bold ${pos.unrealized_pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}
                    >
                      {formatSignedMoney(pos.unrealized_pnl)} ({formatSignedPct(pos.unrealized_pnl_pct)})
                    </div>
                  </div>
                ))}
                {!positions.length && (
                  <div className="py-6 text-center text-[10px] text-white/45">
                    {language === 'zh' ? '暂无持仓' : 'No positions'}
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-y-auto p-2">
              <div className="space-y-2">
                {decisionItems.slice(0, 8).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setPinnedSymbol(item.symbol)
                      setPinnedUntilMs(Date.now() + 20_000)
                    }}
                    className="block w-full border-l-2 border-white/20 pl-2 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] font-mono text-white/40">{item.timestamp}</span>
                      {item.confidence != null && (
                        <span className="text-[8px] font-mono text-amber-400">
                          {(item.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <div
                      className={`text-[11px] font-bold ${item.action === 'BUY' ? 'text-red-400' : item.action === 'SELL' ? 'text-green-400' : 'text-white/75'}`}
                    >
                      {item.action} {item.symbol}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[9px] leading-snug text-white/55">
                      {item.reasoning}
                    </div>
                  </button>
                ))}
                {!decisionItems.length && (
                  <div className="py-6 text-center text-[10px] text-white/45">
                    {language === 'zh' ? '等待决策...' : 'Waiting for decisions...'}
                  </div>
                )}
              </div>
            </div>

            <div className="relative min-h-0">
              <div
                ref={containerRef}
                onScroll={onScroll}
                className="h-full overflow-y-auto p-2 pb-10"
              >
                <div className="space-y-1.5">
                  {publicMessages.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.sender_type === 'agent' ? 'items-end' : 'items-start'}`}>
                      <div className={`mb-0.5 text-[8px] ${msg.sender_type === 'agent' ? 'text-amber-500' : 'text-white/45'}`}>
                        {msg.sender_name}
                      </div>
                      <div className={`max-w-[96%] rounded-lg px-2 py-1 text-[10px] ${msg.sender_type === 'agent' ? 'border border-amber-500/20 bg-amber-500/10 text-amber-100' : 'bg-white/5 text-white/80'}`}>
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  {!publicMessages.length && (
                    <div className="py-6 text-center text-[10px] text-white/45">
                      {language === 'zh' ? '暂无公开聊天' : 'No public chat yet'}
                    </div>
                  )}
                </div>
              </div>

              {unseenCount > 0 && (
                <button
                  type="button"
                  onClick={jumpToLatest}
                  className="absolute bottom-2 right-2 rounded-full border border-cyan-400/40 bg-black/80 px-2 py-1 text-[10px] text-cyan-300"
                >
                  {language === 'zh'
                    ? `新消息 ${unseenCount}`
                    : `New ${unseenCount}`}
                </button>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-white/10 px-2 py-1 text-[9px] font-mono text-white/40">
            room {roomId} · packet {props.streamPacket?.ts_ms ? new Date(props.streamPacket.ts_ms).toLocaleTimeString('en-GB', { hour12: false }) : '--:--:--'}
          </div>
        </div>
      </div>
    </div>
  )
}
