import { useEffect, useMemo, useState } from 'react'

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

type TimelineType = 'decision' | 'chat'

export default function Expert3StudioTimelinePage(
  props: FormalStreamDesignPageProps
) {
  const clampVolume = (value: number) => Math.max(0, Math.min(0.3, value))

  useFullscreenLock()
  const {
    selectedTrader,
    decisionItems,
    positions,
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
  const { sizePx, decrease, increase } = useAvatarSize('stream-avatar-size-expert3')
  const { ttsAvailable, ttsAutoPlay, setTtsAutoPlay, ttsError, roomVoice } = useAgentTtsAutoplay({
    roomId: selectedTrader.trader_id,
    publicMessages,
  })
  const {
    bgmAvailable,
    bgmEnabled,
    setBgmEnabled,
    bgmVolume,
    setBgmVolume,
    bgmTrackTitle,
    bgmError,
  } = useRoomBgm({ roomId: selectedTrader.trader_id, ducking: false })
  const { containerRef, unseenCount, onScroll, jumpToLatest } = useAutoScrollFeed(
    publicMessages.length
  )
  const [selectedEventId, setSelectedEventId] = useState<string>('')
  const [pinnedSymbol, setPinnedSymbol] = useState<string>('')

  useEffect(() => {
    if (!pinnedSymbol) return
    const timer = window.setTimeout(() => setPinnedSymbol(''), 20_000)
    return () => window.clearTimeout(timer)
  }, [pinnedSymbol])

  const timeline = useMemo(() => {
    const decisionEvents = decisionItems.slice(0, 8).map((item) => ({
      id: `d-${item.id}`,
      type: 'decision' as TimelineType,
      tsLabel: item.timestamp,
      tsMs: Number(item.timestampMs || 0),
      title: `${item.action} ${item.symbol}`,
      detail: item.reasoning,
      symbol: item.symbol,
      confidence: item.confidence,
    }))
    const chatEvents = publicMessages.slice(-8).map((msg) => ({
      id: `c-${msg.id}`,
      type: 'chat' as TimelineType,
      tsLabel: new Date(msg.created_ts_ms).toLocaleTimeString('en-GB', { hour12: false }),
      tsMs: Number(msg.created_ts_ms || 0),
      title: `${msg.sender_name}`,
      detail: msg.text,
      symbol: '',
      confidence: null as number | null,
    }))
    return [...decisionEvents, ...chatEvents]
      .sort((a, b) => Number(b.tsMs || 0) - Number(a.tsMs || 0))
      .slice(0, 20)
  }, [decisionItems, publicMessages])

  const activeSymbol = pinnedSymbol || focusedSymbol

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#14141a] text-white">
      <div className="relative mx-auto flex h-full w-full max-w-[480px] flex-col overflow-hidden border-x border-white/5">
        <div className="shrink-0 border-b border-white/5 bg-[#1e1e24] px-3 pb-2 pt-[max(8px,env(safe-area-inset-top,0px))]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-white">{selectedTrader.trader_name}</div>
              <div className="text-[10px] font-mono text-indigo-300">
                {modeLabel} · {transportLabel} · {sseStatus} · {freshnessLabel}
              </div>
              <div className="mt-1 flex items-center gap-1 text-[9px] font-mono text-indigo-100/90">
                <span className="rounded bg-black/35 px-1.5 py-0.5">pkt {packetAgeLabel}</span>
                <span className="rounded bg-black/35 px-1.5 py-0.5">dec {decisionAgeLabel}</span>
                <span className="rounded bg-black/35 px-1.5 py-0.5">chat {chatAgeLabel}</span>
                <span className="rounded bg-black/35 px-1.5 py-0.5">{chatSyncState}</span>
                <button
                  type="button"
                  onClick={() => setTtsAutoPlay((prev) => !prev)}
                  disabled={!ttsAvailable}
                  className={`rounded px-1.5 py-0.5 ${ttsAutoPlay ? 'bg-emerald-600/65 text-white' : 'bg-black/35 text-white/80'} disabled:opacity-50`}
                >
                  {ttsAutoPlay ? 'voice on' : 'voice off'}
                </button>
                <button
                  type="button"
                  onClick={() => setBgmEnabled((prev) => !prev)}
                  disabled={!bgmAvailable}
                  className={`rounded px-1.5 py-0.5 ${bgmEnabled ? 'bg-amber-500/70 text-black' : 'bg-black/35 text-white/80'} disabled:opacity-50`}
                >
                  {bgmEnabled ? 'bgm on' : 'bgm off'}
                </button>
                <label className="flex items-center gap-1 rounded bg-black/35 px-1 py-0.5 text-[9px] text-white/85">
                  <span>bgm</span>
                  <button
                    type="button"
                    onClick={() => setBgmVolume((prev) => clampVolume(prev - 0.02))}
                    disabled={!bgmAvailable || !bgmEnabled}
                    className="rounded bg-black/50 px-1 text-white/90 disabled:opacity-40"
                    aria-label="Lower BGM volume"
                  >
                    -
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={0.3}
                    step={0.01}
                    value={bgmVolume}
                    onInput={(event) => {
                      const target = event.target as HTMLInputElement
                      setBgmVolume(clampVolume(Number(target.value)))
                    }}
                    onChange={(event) => {
                      const target = event.target as HTMLInputElement
                      setBgmVolume(clampVolume(Number(target.value)))
                    }}
                    disabled={!bgmAvailable || !bgmEnabled}
                    className="h-4 w-20 accent-amber-300 disabled:opacity-40"
                    style={{ touchAction: 'pan-x' }}
                    aria-label="BGM volume"
                  />
                  <button
                    type="button"
                    onClick={() => setBgmVolume((prev) => clampVolume(prev + 0.02))}
                    disabled={!bgmAvailable || !bgmEnabled}
                    className="rounded bg-black/50 px-1 text-white/90 disabled:opacity-40"
                    aria-label="Raise BGM volume"
                  >
                    +
                  </button>
                  <span>{Math.round((bgmVolume || 0) * 100)}%</span>
                </label>
              </div>
              {(roomVoice || ttsError || bgmTrackTitle || bgmError) && (
                <div className="mt-1 text-[9px] font-mono text-indigo-100/85">
                  {ttsError
                    ? 'voice err'
                    : bgmError
                      ? 'bgm err'
                      : bgmTrackTitle
                        ? `voice ${roomVoice} · bgm ${bgmTrackTitle}`
                        : `voice ${roomVoice}`}
                </div>
              )}
              {marketBreadth.advancers != null && marketBreadth.decliners != null && (
                <div className="text-[10px] font-mono text-indigo-200/85">
                  R {marketBreadth.advancers} / B {marketBreadth.decliners}
                  {marketBreadth.redBlueRatio != null && ` · ${marketBreadth.redBlueRatio.toFixed(2)}`}
                </div>
              )}
              {isDegraded && (
                <div className="mt-1 rounded border border-red-300/35 bg-red-500/15 px-2 py-1 text-[10px] text-red-100">
                  {language === 'zh'
                    ? '数据降级中：已启用轮询兜底，请关注时效标签。'
                    : 'Degraded stream: polling fallback active, watch freshness tags.'}
                </div>
              )}
            </div>
            <div className="rounded bg-white/5 px-2 py-1 text-[10px] font-mono text-white/70">timeline</div>
          </div>
        </div>

        <div className="relative shrink-0 border-b border-white/5" style={{ height: '30vh' }}>
          <PhoneRealtimeKlineChart
            symbol={activeSymbol}
            interval="1m"
            limit={240}
            refreshMs={12_000}
            height="100%"
          />
          <PhoneAvatarSlot
            trader={selectedTrader}
            sizePx={Math.max(48, Math.round(Math.max(96, Math.min(sizePx - 54, 170)) / 2))}
            language={language}
            onDecrease={decrease}
            onIncrease={increase}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-3 py-2">
            <div className="mb-2 rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-2.5 text-[11px] leading-snug text-white/85">
              {language === 'zh'
                ? '时间线聚合决策与聊天事件。点击决策事件可锁定图表 symbol 20 秒。'
                : 'Timeline merges decisions and chat events. Tap decision events to lock chart symbol for 20s.'}
            </div>

            <div className="space-y-1.5">
              {timeline.map((event, idx) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => {
                    setSelectedEventId(event.id)
                    if (event.type === 'decision' && event.symbol) {
                      setPinnedSymbol(event.symbol)
                    }
                  }}
                  className={`flex w-full gap-2 text-left ${selectedEventId === event.id ? 'opacity-100' : 'opacity-85'}`}
                >
                  <div className="flex w-5 shrink-0 flex-col items-center">
                    <div
                      className={`h-2.5 w-2.5 rounded-full border-2 ${event.type === 'decision' ? 'border-red-400 bg-red-400/20' : 'border-cyan-400 bg-cyan-400/20'}`}
                    />
                    {idx < timeline.length - 1 && <div className="min-h-[18px] w-px flex-1 bg-white/10" />}
                  </div>
                  <div className={`flex-1 rounded-lg border p-2 ${selectedEventId === event.id ? 'border-indigo-400/35 bg-white/[0.07]' : 'border-white/10 bg-white/[0.03]'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono text-white/35">{event.tsLabel}</span>
                      {event.confidence != null && (
                        <span className="text-[9px] font-mono text-amber-400">
                          {(event.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <div className={`text-[11px] font-bold ${event.type === 'decision' ? 'text-red-400' : 'text-cyan-300'}`}>
                      {event.title}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[10px] text-white/55">{event.detail}</div>
                  </div>
                </button>
              ))}
              {!timeline.length && (
                <div className="py-8 text-center text-xs text-white/45">
                  {language === 'zh' ? '暂无时间线事件' : 'No timeline events yet'}
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-white/10 bg-[#1a1a22]">
            <div className="border-b border-white/5 px-3 py-2">
              <div className="mb-1 text-[9px] uppercase tracking-widest text-white/35">
                {language === 'zh' ? '当前持仓' : 'positions'}
              </div>
              {positions.slice(0, 3).map((pos) => (
                <div key={`${pos.symbol}-${pos.side}`} className="flex items-center justify-between py-0.5 text-[10px]">
                  <div className="font-mono text-white">
                    {pos.symbol} <span className="text-white/35">{pos.side}</span>
                  </div>
                  <div className={`font-mono font-bold ${pos.unrealized_pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {formatSignedMoney(pos.unrealized_pnl)} ({formatSignedPct(pos.unrealized_pnl_pct)})
                  </div>
                </div>
              ))}
            </div>

            <div className="relative px-3 py-2">
              <div className="mb-1 text-[9px] uppercase tracking-widest text-white/35">
                {language === 'zh' ? '公开聊天（仅展示）' : 'public chat (display only)'}
              </div>
              <div ref={containerRef} onScroll={onScroll} className="max-h-[12vh] overflow-y-auto pr-1">
                <div className="space-y-1">
                  {publicMessages.slice(-14).map((msg) => (
                    <div key={msg.id} className="flex items-baseline gap-1.5 text-[10px]">
                      <span className={`font-bold ${msg.sender_type === 'agent' ? 'text-amber-400' : 'text-white/45'}`}>
                        {msg.sender_name}:
                      </span>
                      <span className="text-white/70">{msg.text}</span>
                    </div>
                  ))}
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
          </div>
        </div>
      </div>
    </div>
  )
}
