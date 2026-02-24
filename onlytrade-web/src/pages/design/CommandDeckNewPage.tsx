import { useEffect, useMemo, useState } from 'react'

import { useFullscreenLock } from '../../hooks/useFullscreenLock'
import { PhoneRealtimeKlineChart } from '../../components/PhoneRealtimeKlineChart'
import type { Language } from '../../i18n/translations'
import type { ChatMessage } from '../../types'
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

type MessageVisual = {
  label: string
  bubbleClass: string
  senderClass: string
  badgeClass: string
}

function getMessageVisual(msg: ChatMessage): MessageVisual {
  if (msg.sender_type === 'user') {
    return {
      label: '观众',
      bubbleClass: 'border border-cyan-400/35 bg-cyan-500/10 text-cyan-100',
      senderClass: 'text-cyan-300',
      badgeClass: 'border border-cyan-400/35 bg-cyan-500/10 text-cyan-100',
    }
  }

  if (msg.agent_message_kind === 'reply') {
    return {
      label: '回复',
      bubbleClass: 'border border-cyan-400/35 bg-cyan-500/8 text-cyan-50',
      senderClass: 'text-cyan-300',
      badgeClass: 'border border-cyan-400/35 bg-cyan-500/10 text-cyan-100',
    }
  }

  if (msg.agent_message_kind === 'narration') {
    return {
      label: '决策',
      bubbleClass: 'border border-red-400/35 bg-red-500/12 text-red-100',
      senderClass: 'text-red-300',
      badgeClass: 'border border-red-400/35 bg-red-500/12 text-red-100',
    }
  }

  return {
    label: '闲聊',
    bubbleClass: 'border border-amber-400/25 bg-amber-500/10 text-amber-50',
    senderClass: 'text-amber-300',
    badgeClass: 'border border-amber-400/25 bg-amber-500/10 text-amber-100',
  }
}

export default function CommandDeckNewPage(props: FormalStreamDesignPageProps) {
  useFullscreenLock()
  const pageLanguage: Language = 'zh'
  const {
    selectedTrader,
    roomId,
    account,
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
        const driftPool = [-1, 0, 0, 0, 1]
        const baseDelta = driftPool[Math.floor(Math.random() * driftPool.length)]
        const next = prev + baseDelta
        return Math.max(68, Math.min(next, 79))
      })
    }, 5000)

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
  const totalPnl = Number(account?.total_pnl || 0)
  const totalPnlPct = Number(account?.total_pnl_pct || 0)
  const positionCount = Number(account?.position_count || positions.length || 0)
  const marginUsedPct = Number(account?.margin_used_pct || 0)

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#050510] text-white">
      <div className="relative mx-auto flex h-full w-full max-w-[480px] flex-col overflow-hidden border-x border-white/5">
        <div className="shrink-0 border-b border-white/10 bg-black/65 px-2 py-1 backdrop-blur-sm">
          <div className="h-1 w-full overflow-hidden rounded-full bg-blue-500/35">
            <div
              className="h-full rounded-full bg-red-500/85 transition-all duration-700"
              style={{ width: `${supportPct}%` }}
            />
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[9px] font-semibold text-white/85">
            <span>支持 {supportPct}%</span>
            <span>反对 {againstPct}%</span>
          </div>

          <div className="mt-1 grid grid-cols-2 gap-1 text-[9px]">
            <div className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-1">
              <div className="text-white/55">累计收益率</div>
              <div className={`font-bold ${totalPnlPct >= 0 ? 'text-red-300' : 'text-green-300'}`}>
                {formatSignedPct(totalPnlPct)}
              </div>
            </div>
            <div className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-1">
              <div className="text-white/55">累计盈亏</div>
              <div className={`font-bold ${totalPnl >= 0 ? 'text-red-300' : 'text-green-300'}`}>
                {formatSignedMoney(totalPnl)}
              </div>
            </div>
            <div className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-1">
              <div className="text-white/55">持仓数量</div>
              <div className="font-bold text-white/90">{positionCount}</div>
            </div>
            <div className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-1">
              <div className="text-white/55">保证金使用率</div>
              <div className="font-bold text-white/90">{marginUsedPct.toFixed(1)}%</div>
            </div>
          </div>

          <div className="mt-1 text-[9px] text-white/55">K线周期: 1分钟</div>
        </div>

        <div
          className="relative shrink-0 border-b border-white/10"
          style={{ height: 'clamp(250px, 38vh, 340px)' }}
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

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#080816]">
          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] border-b border-white/10">
            <div className="border-r border-white/5 py-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-red-400">
              持仓 / 决策
            </div>
            <div className="py-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-cyan-400">
              聊天
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] divide-x divide-white/5">
            <div className="min-h-0">
              <div className="flex h-full min-h-0 flex-col">
                <section className="min-h-0 flex-1 border-b border-white/10">
                  <div className="border-b border-white/5 px-2 py-1 text-[9px] font-bold tracking-wider text-red-300">
                    持仓
                  </div>
                  <div className="h-[calc(100%-24px)] overflow-y-auto p-2">
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
                </section>

                <section className="min-h-0 flex-1">
                  <div className="border-b border-white/5 px-2 py-1 text-[9px] font-bold tracking-wider text-amber-300">
                    决策
                  </div>
                  <div className="h-[calc(100%-24px)] overflow-y-auto p-2">
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
                </section>
              </div>
            </div>

            <div className="relative min-h-0">
              <div
                ref={containerRef}
                onScroll={onScroll}
                className="h-full overflow-y-auto p-2 pb-10"
              >
                <div className="space-y-1.5">
                  {publicMessages.map((msg) => {
                    const visual = getMessageVisual(msg)
                    return (
                      <div key={msg.id} className={`flex flex-col ${msg.sender_type === 'agent' ? 'items-end' : 'items-start'}`}>
                        <div className={`mb-0.5 flex items-center gap-1 text-[8px] ${visual.senderClass}`}>
                          <span>{msg.sender_name}</span>
                          <span className={`rounded px-1 py-[1px] ${visual.badgeClass}`}>
                            {visual.label}
                          </span>
                        </div>
                        <div className={`max-w-[92%] rounded-lg px-2 py-1 text-[10px] ${visual.bubbleClass}`}>
                          {msg.text}
                        </div>
                      </div>
                    )
                  })}

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
