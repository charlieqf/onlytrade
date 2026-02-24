import { useEffect, useMemo, useState } from 'react'

import { useFullscreenLock } from '../../hooks/useFullscreenLock'
import { PhoneRealtimeKlineChart } from '../../components/PhoneRealtimeKlineChart'
import type { Language } from '../../i18n/translations'
import {
  type FormalStreamDesignPageProps,
  formatSignedMoney,
  formatSignedPct,
  PhoneAvatarSlot,
  useAutoScrollFeed,
  useAvatarSize,
  usePhoneStreamData,
} from './phoneStreamShared'

type SymbolInfo = {
  symbol?: string
  name?: string
}

const DEFAULT_CN_SYMBOL_NAMES: Record<string, string> = {
  '600519.SH': '贵州茅台',
  '601318.SH': '中国平安',
  '300750.SZ': '宁德时代',
  '000001.SZ': '平安银行',
  '688981.SH': '中芯国际',
}

export default function CommandDeckNewPage(props: FormalStreamDesignPageProps) {
  useFullscreenLock()
  const pageLanguage: Language = 'zh'
  const {
    selectedTrader,
    roomId,
    positions,
    decisionItems,
    publicMessages,
    focusedSymbol,
  } = usePhoneStreamData({
    ...props,
    language: pageLanguage,
  })
  const { sizePx, decrease, increase } = useAvatarSize('stream-avatar-size-command-deck-new')
  const { containerRef, unseenCount, onScroll, jumpToLatest } = useAutoScrollFeed(
    publicMessages.length
  )
  const [pinnedSymbol, setPinnedSymbol] = useState<string>('')
  const [supportPct, setSupportPct] = useState<number>(73)
  const [symbolNameMap, setSymbolNameMap] = useState<Record<string, string>>(DEFAULT_CN_SYMBOL_NAMES)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSupportPct((prev) => {
        const delta = Math.floor(Math.random() * 9) - 4
        const next = prev + delta
        return Math.max(52, Math.min(next, 88))
      })
    }, 4000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const query = new URLSearchParams({
      exchange: 'sim-cn',
      trader_id: selectedTrader.trader_id,
    })
    fetch(`/api/symbols?${query.toString()}`)
      .then((res) => res.json())
      .then((payload) => {
        const rows = Array.isArray(payload?.symbols) ? (payload.symbols as SymbolInfo[]) : []
        if (!rows.length) return
        setSymbolNameMap((prev) => {
          const next = { ...prev }
          for (const row of rows) {
            const symbol = String(row?.symbol || '').trim().toUpperCase()
            const name = String(row?.name || '').trim()
            if (symbol && name) {
              next[symbol] = name
            }
          }
          return next
        })
      })
      .catch(() => {})
  }, [selectedTrader.trader_id])

  const activeSymbol = pinnedSymbol || focusedSymbol
  const activeSymbolName = useMemo(
    () => symbolNameMap[String(activeSymbol || '').trim().toUpperCase()] || '',
    [activeSymbol, symbolNameMap]
  )
  const againstPct = Math.max(0, 100 - supportPct)

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#050510] text-white">
      <div className="relative mx-auto h-full w-full max-w-[480px] overflow-hidden border-x border-white/5">
        <div className="absolute inset-x-0 top-0 z-30 border-b border-white/10 bg-black/65 px-2 py-1 backdrop-blur-sm">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-500/35">
            <div
              className="h-full rounded-full bg-red-500/85 transition-all duration-700"
              style={{ width: `${supportPct}%` }}
            />
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[9px] font-semibold text-white/85">
            <span>支持 {supportPct}%</span>
            <span>反对 {againstPct}%</span>
          </div>
        </div>

        <div
          className="relative border-b border-white/10 pt-6"
          style={{ height: 'clamp(280px, 44vh, 420px)' }}
        >
          <PhoneRealtimeKlineChart
            symbol={activeSymbol}
            symbolName={activeSymbolName}
            interval="1m"
            limit={240}
            refreshMs={12_000}
            height="100%"
          />

          <PhoneAvatarSlot
            trader={selectedTrader}
            sizePx={Math.max(24, Math.round(sizePx / 4))}
            language={pageLanguage}
            showPlaceholderLabel={false}
            showTraderName
            onDecrease={decrease}
            onIncrease={increase}
          />
        </div>

        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#080816]"
          style={{ height: 'calc(100% - clamp(280px, 44vh, 420px))' }}
        >
          <div className="grid shrink-0 grid-cols-3 border-b border-white/10">
            <div className="border-r border-white/5 py-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-red-400">
              持仓
            </div>
            <div className="border-r border-white/5 py-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-amber-400">
              决策
            </div>
            <div className="py-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-cyan-400">
              聊天
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
                    暂无持仓
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
                    onClick={() => setPinnedSymbol(item.symbol)}
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
                    等待决策...
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
                      暂无公开聊天
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
                  新消息 {unseenCount}
                </button>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-white/10 px-2 py-1 text-[9px] font-mono text-white/40">
            room {roomId}
          </div>
        </div>
      </div>
    </div>
  )
}
