import { useEffect, useMemo, useState } from 'react'

import { useFullscreenLock } from '../../hooks/useFullscreenLock'
import { useRoomBgm } from '../../hooks/useRoomBgm'
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
  useAgentTtsAutoplay,
  usePhoneStreamData,
} from './phoneStreamShared'

type SymbolInfo = {
  symbol?: string
  name?: string
}

const MOCK_METRICS = {
  peerRankText: '10/49',
  totalReturnPct: 149,
  industryReturnPct: 89,
  hs300ReturnPct: 31,
  weekReturnPct: 17.8,
  halfYearReturnPct: 132,
  maxDrawdownPct: 18.6,
  recoveryDays: 26,
} as const

const DEFAULT_CN_SYMBOL_NAMES: Record<string, string> = {
  '600519.SH': '贵州茅台',
  '601318.SH': '中国平安',
  '300750.SZ': '宁德时代',
  '000001.SZ': '平安银行',
  '688981.SH': '中芯国际',
}

type MessageVisual = {
  bubbleClass: string
  senderClass: string
}

type ViewerStyle = {
  bubbleClass: string
  senderClass: string
}

const VIEWER_STYLES: ViewerStyle[] = [
  {
    bubbleClass: 'border border-cyan-400/35 bg-cyan-500/10 text-cyan-100',
    senderClass: 'text-cyan-300',
  },
  {
    bubbleClass: 'border border-fuchsia-400/35 bg-fuchsia-500/10 text-fuchsia-100',
    senderClass: 'text-fuchsia-300',
  },
  {
    bubbleClass: 'border border-emerald-400/35 bg-emerald-500/10 text-emerald-100',
    senderClass: 'text-emerald-300',
  },
  {
    bubbleClass: 'border border-orange-400/35 bg-orange-500/10 text-orange-100',
    senderClass: 'text-orange-300',
  },
]

const DECISION_STYLE: MessageVisual = {
  bubbleClass: 'border border-blue-400/40 bg-blue-500/10 text-blue-100',
  senderClass: 'text-blue-300',
}

const AGENT_DEFAULT_STYLE: MessageVisual = {
  bubbleClass: 'border border-amber-400/25 bg-amber-500/10 text-amber-50',
  senderClass: 'text-amber-300',
}

function hashText(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function viewerStyleForMessage(msg: ChatMessage): ViewerStyle {
  const key = String(msg.user_session_id || msg.sender_name || msg.id || 'viewer')
  const index = hashText(key) % VIEWER_STYLES.length
  return VIEWER_STYLES[index]
}

function getMessageVisual(msg: ChatMessage): MessageVisual {
  if (msg.agent_message_kind === 'narration') {
    return DECISION_STYLE
  }

  return AGENT_DEFAULT_STYLE
}

function formatBeijingTimeHHmm(createdTsMs: number): string {
  const n = Number(createdTsMs || 0)
  if (!Number.isFinite(n) || n <= 0) return '--:--'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Shanghai',
    }).format(new Date(n))
  } catch {
    return '--:--'
  }
}

function formatMetricPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '--'
  const n = Number(value)
  const abs = Math.abs(n)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  const body = Number(abs.toFixed(digits)).toString()
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${body}%`
}

function metricPctClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return 'text-white/80'
  const n = Number(value)
  if (n > 0) return 'text-red-300'
  if (n < 0) return 'text-green-300'
  return 'text-white/80'
}

function isWeComLikeIPhoneClient(): boolean {
  if (typeof window === 'undefined') return false
  const ua = String(window.navigator?.userAgent || '').toLowerCase()
  if (!ua) return false
  const isIOS = ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')
  if (!isIOS) return false
  return ua.includes('wxwork') || ua.includes('micromessenger')
}

function localizePositionSide(side: string): string {
  const normalized = String(side || '').trim().toUpperCase()
  if (normalized === 'LONG') return '多头'
  if (normalized === 'SHORT') return '空头'
  return String(side || '--')
}

function localizeDecisionAction(action: string): string {
  const normalized = String(action || '').trim().toUpperCase()
  if (normalized === 'BUY') return '买入'
  if (normalized === 'SELL') return '卖出'
  if (normalized === 'HOLD') return '观望'
  if (normalized === 'SHORT') return '开空'
  return String(action || '--')
}

function localizeDecisionReasoning(reasoning: string): string {
  const raw = String(reasoning || '').trim()
  if (!raw) return '--'

  const replacements: Array<[RegExp, string]> = [
    [/data readiness error:\s*data_too_stale/gi, '数据就绪异常：数据过旧'],
    [/data_too_stale/gi, '数据过旧'],
    [/data readiness error/gi, '数据就绪异常'],
    [/HOLD/gi, '观望'],
    [/BUY/gi, '买入'],
    [/SELL/gi, '卖出'],
    [/SHORT/gi, '开空'],
  ]

  let text = raw
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement)
  }
  return text
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
  const { ttsAvailable, setTtsAutoPlay, ttsSpeaking } = useAgentTtsAutoplay({
    roomId,
    publicMessages,
    openaiOnly: true,
  })
  const { bgmAvailable, setBgmEnabled, setBgmVolume } = useRoomBgm({
    roomId,
    ducking: ttsSpeaking,
  })

  const [pinnedSymbol, setPinnedSymbol] = useState<string>('')
  const [supportPct, setSupportPct] = useState<number>(73)
  const [symbolNameMap, setSymbolNameMap] = useState<Record<string, string>>(DEFAULT_CN_SYMBOL_NAMES)
  const isWeComIPhone = useMemo(() => isWeComLikeIPhoneClient(), [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSupportPct((prev) => {
        const driftPool = [-1, 0, 0, 0, 0, 1]
        const baseDelta = driftPool[Math.floor(Math.random() * driftPool.length)]
        const next = prev + baseDelta
        return Math.max(70, Math.min(next, 77))
      })
    }, 5000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!ttsAvailable) return
    setTtsAutoPlay(true)
  }, [roomId, ttsAvailable, setTtsAutoPlay])

  useEffect(() => {
    if (!bgmAvailable) return
    setBgmEnabled(true)
    setBgmVolume(isWeComIPhone ? 0.02 : 0.06)
  }, [roomId, bgmAvailable, setBgmEnabled, setBgmVolume, isWeComIPhone])

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
  const dailyPnl = Number(account?.daily_pnl || 0)
  const totalEquity = Number(account?.total_equity || 0)
  const dayBaseEquity = totalEquity - dailyPnl
  const dayReturnPct = dayBaseEquity > 0 ? (dailyPnl / dayBaseEquity) * 100 : null

  const messageVisuals = useMemo(() => {
    let lastViewerStyle: ViewerStyle = VIEWER_STYLES[0]

    return publicMessages.map((msg) => {
      if (msg.sender_type === 'user') {
        lastViewerStyle = viewerStyleForMessage(msg)
        return {
          bubbleClass: lastViewerStyle.bubbleClass,
          senderClass: lastViewerStyle.senderClass,
        }
      }

      if (msg.agent_message_kind === 'reply') {
        return {
          bubbleClass: lastViewerStyle.bubbleClass,
          senderClass: lastViewerStyle.senderClass,
        }
      }

      return getMessageVisual(msg)
    })
  }, [publicMessages])

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#050510] text-white">
      <div className="relative mx-auto flex h-full w-full max-w-[480px] flex-col overflow-hidden border-x border-white/5">
        <div className="shrink-0 border-b border-white/10 bg-black/65 px-2 py-1 backdrop-blur-sm">
          <div className="h-1 w-full overflow-hidden rounded-full bg-blue-500/80 shadow-[0_0_14px_rgba(59,130,246,0.55)]">
            <div
              className="h-full rounded-full bg-red-500/85 transition-all duration-700"
              style={{ width: `${supportPct}%` }}
            />
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[9px] font-semibold text-white/85">
            <span>支持 {supportPct}%</span>
            <span>反对 {againstPct}%</span>
          </div>

          <div className="mt-1 rounded border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.03] px-1.5 py-1 text-[9px]">
            <div className="flex items-center gap-1">
              <span className="rounded border border-white/15 bg-black/30 px-1 py-[1px] text-[8px] text-white/75">
                同类排名 {MOCK_METRICS.peerRankText}
              </span>
              <span className="ml-auto text-[8px] text-white/55">累计表现</span>
              <span className={`text-[11px] font-black ${metricPctClass(MOCK_METRICS.totalReturnPct)}`}>
                {formatMetricPct(MOCK_METRICS.totalReturnPct)}
              </span>
            </div>

            <div className="mt-1 grid grid-cols-4 gap-1 text-[7px]">
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/55">行业收益</div>
                <div className={`font-bold ${metricPctClass(MOCK_METRICS.industryReturnPct)}`}>
                  {formatMetricPct(MOCK_METRICS.industryReturnPct)}
                </div>
              </div>
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/55">沪深300</div>
                <div className={`font-bold ${metricPctClass(MOCK_METRICS.hs300ReturnPct)}`}>
                  {formatMetricPct(MOCK_METRICS.hs300ReturnPct)}
                </div>
              </div>
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/55">最大回撤</div>
                <div className={`font-bold ${metricPctClass(-Math.abs(Number(MOCK_METRICS.maxDrawdownPct || 0)))}`}>
                  -{Number(MOCK_METRICS.maxDrawdownPct.toFixed(2)).toString()}%
                </div>
              </div>
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/55">修复天数</div>
                <div className="font-bold text-white/85">{MOCK_METRICS.recoveryDays}天</div>
              </div>
            </div>

            <div className="mt-1 grid grid-cols-3 gap-1 text-[8px]">
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/55">当日收益</div>
                <div className={`font-bold ${metricPctClass(dayReturnPct)}`}>{formatMetricPct(dayReturnPct)}</div>
              </div>
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/55">本周收益</div>
                <div className={`font-bold ${metricPctClass(MOCK_METRICS.weekReturnPct)}`}>
                  {formatMetricPct(MOCK_METRICS.weekReturnPct)}
                </div>
              </div>
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/55">半年收益</div>
                <div className={`font-bold ${metricPctClass(MOCK_METRICS.halfYearReturnPct)}`}>
                  {formatMetricPct(MOCK_METRICS.halfYearReturnPct)}
                </div>
              </div>
            </div>


          </div>
        </div>

        <div
          className="relative shrink-0 border-b border-white/10"
          style={{ height: 'clamp(250px, 38vh, 340px)' }}
        >
          <PhoneRealtimeKlineChart
            symbol={activeSymbol}
            symbolName={activeSymbolName}
            interval="1m"
            intervalHint="1分钟（时:分）"
            limit={240}
            refreshMs={12_000}
            height="100%"
          />

          <PhoneAvatarSlot
            trader={selectedTrader}
            sizePx={Math.max(30, Math.round(sizePx / 3))}
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
                            {localizePositionSide(pos.side)} · {Number(pos.quantity).toLocaleString()} @ {pos.entry_price.toFixed(2)}
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
                          className="block w-full rounded border border-blue-400/40 bg-blue-500/[0.06] px-2 py-1 text-left"
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
                            {localizeDecisionAction(item.action)} {item.symbol}
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-[9px] leading-snug text-white/55">
                            {localizeDecisionReasoning(item.reasoning)}
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
                  {publicMessages.map((msg, index) => {
                    const visual = messageVisuals[index] || AGENT_DEFAULT_STYLE
                    return (
                      <div key={msg.id} className={`flex flex-col ${msg.sender_type === 'agent' ? 'items-end' : 'items-start'}`}>
                        <div className={`mb-0.5 flex items-center gap-1 text-[8px] ${visual.senderClass}`}>
                          <span>{msg.sender_name}</span>
                          <span className="text-white/45">{formatBeijingTimeHHmm(msg.created_ts_ms)}</span>
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
