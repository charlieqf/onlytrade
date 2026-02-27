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

function guessSector(symbol: string, name: string): string {
  const sym = String(symbol || '').toUpperCase()
  const n = String(name || '')
  if (n.includes('银行') || sym.startsWith('60') && n.includes('证券')) return '金融'
  if (n.includes('医药') || n.includes('生物')) return '医药'
  if (n.includes('芯') || n.includes('半导体') || n.includes('电子') || n.includes('科技')) return '科技'
  if (n.includes('新能源') || n.includes('电') || n.includes('锂')) return '新能源'
  if (n.includes('酒') || n.includes('食品') || n.includes('消费')) return '消费'
  if (n.includes('有色') || n.includes('矿') || n.includes('资源')) return '资源'
  if (sym.startsWith('688') || sym.startsWith('300')) return '科技'
  if (sym.startsWith('000') || sym.startsWith('002')) return '成长'
  if (sym.startsWith('60')) return '蓝筹'
  return '其他'
}

function formatOnlineCount(count: number): string {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k 在线`
  if (n >= 1000) {
    const body = (n / 1000).toFixed(1).replace(/\.0$/, '')
    return `${body}k 在线`
  }
  return `${n} 在线`
}

export default function CommandDeckNewPage(props: FormalStreamDesignPageProps) {
  useFullscreenLock()
  const pageLanguage: Language = 'zh'
  const {
    selectedTrader,
    roomId,
    account,
    positions,
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

  const activeSymbol = focusedSymbol || positions[0]?.symbol || ''
  const activeSymbolName = useMemo(
    () => symbolNameMap[String(activeSymbol || '').trim().toUpperCase()] || '',
    [activeSymbol, symbolNameMap]
  )

  const sectorDistribution = useMemo(() => {
    const bucket = new Map<string, number>()
    let total = 0
    for (const pos of positions) {
      const symbol = String(pos.symbol || '').trim().toUpperCase()
      const cnName = symbolNameMap[symbol] || ''
      const sector = guessSector(symbol, cnName)
      const value = Math.abs(Number(pos.quantity || 0) * Number(pos.mark_price || pos.entry_price || 0))
      if (!Number.isFinite(value) || value <= 0) continue
      total += value
      bucket.set(sector, (bucket.get(sector) || 0) + value)
    }

    const colors = ['#FF4D6D', '#3B82F6', '#22D3EE', '#F59E0B', '#A3E635', '#C084FC', '#34D399']
    const slices = Array.from(bucket.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([sector, value], idx) => ({
        sector,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
        color: colors[idx % colors.length],
      }))
    return { slices, total }
  }, [positions, symbolNameMap])

  const sectorPieBackground = useMemo(() => {
    const slices = sectorDistribution.slices
    if (!slices.length) {
      return 'radial-gradient(circle, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 70%, rgba(255,255,255,0.01) 100%)'
    }
    let start = 0
    const stops = slices.map((slice) => {
      const end = start + slice.pct
      const seg = `${slice.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`
      start = end
      return seg
    })
    return `conic-gradient(${stops.join(', ')})`
  }, [sectorDistribution])

  const onlineCountLabel = useMemo(() => {
    const uniqueUsers = new Set(
      publicMessages
        .filter((msg) => msg.sender_type === 'user')
        .map((msg) => String(msg.user_session_id || msg.sender_name || msg.id || ''))
        .filter(Boolean)
    ).size
    const estimated = 880 + uniqueUsers * 95 + Math.min(450, publicMessages.length * 4)
    return formatOnlineCount(estimated)
  }, [publicMessages])

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
        <div className="shrink-0 flex flex-col border-b border-white/10" style={{ height: '38.2dvh' }}>
          <div className="shrink-0 bg-black/65 px-2 py-1.5 backdrop-blur-sm">
            <div className="rounded border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.03] px-2 py-1.5 text-[10px]">
            <div className="flex items-center gap-1">
              <span className="rounded border border-white/15 bg-black/30 px-1.5 py-[1px] text-[9px] text-white/80">
                同类排名 {MOCK_METRICS.peerRankText}
              </span>
              <span className="ml-auto text-[9px] text-white/60">累计表现</span>
              <span className={`text-[13px] font-black ${metricPctClass(MOCK_METRICS.totalReturnPct)}`}>
                {formatMetricPct(MOCK_METRICS.totalReturnPct)}
              </span>
            </div>

            <div className="mt-1 grid grid-cols-4 gap-1 text-[8px]">
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/60">行业收益</div>
                <div className={`font-bold ${metricPctClass(MOCK_METRICS.industryReturnPct)}`}>
                  {formatMetricPct(MOCK_METRICS.industryReturnPct)}
                </div>
              </div>
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/60">沪深300</div>
                <div className={`font-bold ${metricPctClass(MOCK_METRICS.hs300ReturnPct)}`}>
                  {formatMetricPct(MOCK_METRICS.hs300ReturnPct)}
                </div>
              </div>
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/60">最大回撤</div>
                <div className={`font-bold ${metricPctClass(-Math.abs(Number(MOCK_METRICS.maxDrawdownPct || 0)))}`}>
                  -{Number(MOCK_METRICS.maxDrawdownPct.toFixed(2)).toString()}%
                </div>
              </div>
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/60">修复天数</div>
                <div className="font-bold text-white/85">{MOCK_METRICS.recoveryDays}天</div>
              </div>
            </div>

            <div className="mt-1 grid grid-cols-3 gap-1 text-[9px]">
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/60">当日收益</div>
                <div className={`font-bold ${metricPctClass(dayReturnPct)}`}>{formatMetricPct(dayReturnPct)}</div>
              </div>
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/60">本周收益</div>
                <div className={`font-bold ${metricPctClass(MOCK_METRICS.weekReturnPct)}`}>
                  {formatMetricPct(MOCK_METRICS.weekReturnPct)}
                </div>
              </div>
              <div className="rounded border border-white/10 bg-black/25 px-1 py-0.5 text-center">
                <div className="text-white/60">半年收益</div>
                <div className={`font-bold ${metricPctClass(MOCK_METRICS.halfYearReturnPct)}`}>
                  {formatMetricPct(MOCK_METRICS.halfYearReturnPct)}
                </div>
              </div>
            </div>
          </div>
          </div>

          <div className="relative min-h-0 flex-1 border-y border-white/10">
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
              sizePx={Math.max(36, Math.round(sizePx / 3))}
              language={pageLanguage}
              showPlaceholderLabel={false}
              showTraderName
              onDecrease={decrease}
              onIncrease={increase}
            />
          </div>

          <div className="shrink-0 bg-black/75 px-2 py-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#1D4ED8] shadow-[0_0_20px_rgba(37,99,235,0.7)]">
              <div
                className="h-full rounded-full bg-[#FF2D55] transition-all duration-700 shadow-[0_0_20px_rgba(255,45,85,0.7)]"
                style={{ width: `${supportPct}%` }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] font-semibold">
              <span className="text-[#FF4D73]">支持 {supportPct}%</span>
              <span className="text-[#60A5FA]">反对 {againstPct}%</span>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#080816]">
          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] border-b border-white/10">
            <div className="border-r border-white/5 py-2 text-center text-[11px] font-bold tracking-wider text-red-300">
              持仓分布 / 持仓
            </div>
            <div className="flex items-center justify-center gap-2 py-2 text-[11px] font-bold tracking-wider text-cyan-300">
              <span>实时互动</span>
              <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-200">{onlineCountLabel}</span>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] divide-x divide-white/5">
            <div className="min-h-0">
              <div className="flex h-full min-h-0 flex-col">
                <section className="shrink-0 border-b border-white/10">
                  <div className="border-b border-white/5 px-2 py-1.5 text-[10px] font-bold tracking-wider text-fuchsia-300">
                    持仓分布
                  </div>
                  <div className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <div className="relative h-24 w-24 shrink-0 rounded-full border border-white/15" style={{ background: sectorPieBackground }}>
                        <div className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#0A0A16] text-[10px] font-bold text-white/85">
                          {sectorDistribution.slices.length}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        {sectorDistribution.slices.slice(0, 4).map((slice) => (
                          <div key={slice.sector} className="flex items-center justify-between text-[10px]">
                            <span className="inline-flex items-center gap-1 text-white/85">
                              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: slice.color }} />
                              {slice.sector}
                            </span>
                            <span className="font-mono text-white/75">{slice.pct.toFixed(slice.pct >= 10 ? 0 : 1)}%</span>
                          </div>
                        ))}
                        {!sectorDistribution.slices.length && (
                          <div className="text-[10px] text-white/50">暂无持仓分布</div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="min-h-0 flex-1">
                  <div className="border-b border-white/5 px-2 py-1.5 text-[10px] font-bold tracking-wider text-red-300">
                    持仓
                  </div>
                  <div className="h-[calc(100%-28px)] overflow-y-auto p-2">
                    <div className="space-y-2">
                      {positions.slice(0, 6).map((pos) => (
                        <div key={`${pos.symbol}-${pos.side}`} className="rounded border border-white/10 bg-white/[0.03] p-2">
                          <div className="text-[12px] font-bold text-white">{pos.symbol}</div>
                          <div className="mt-0.5 text-[10px] text-white/75">
                            {symbolNameMap[String(pos.symbol || '').toUpperCase()] || '—'}
                          </div>
                          <div className="mt-0.5 text-[10px] font-mono text-white/55">
                            {localizePositionSide(pos.side)} · {Number(pos.quantity).toLocaleString()} @ {pos.entry_price.toFixed(2)}
                          </div>
                          <div
                            className={`mt-1 text-[11px] font-mono font-bold ${pos.unrealized_pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}
                          >
                            {formatSignedMoney(pos.unrealized_pnl)} ({formatSignedPct(pos.unrealized_pnl_pct)})
                          </div>
                        </div>
                      ))}
                      {!positions.length && (
                        <div className="py-6 text-center text-[11px] text-white/45">
                          暂无持仓
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
                className="h-full overflow-y-auto p-2.5 pb-10"
              >
                <div className="space-y-2">
                  {publicMessages.map((msg, index) => {
                    const visual = messageVisuals[index] || AGENT_DEFAULT_STYLE
                    return (
                      <div key={msg.id} className={`flex flex-col ${msg.sender_type === 'agent' ? 'items-end' : 'items-start'}`}>
                        <div className={`mb-0.5 flex items-center gap-1 text-[9px] ${visual.senderClass}`}>
                          <span>{msg.sender_name}</span>
                          <span className="text-white/45">{formatBeijingTimeHHmm(msg.created_ts_ms)}</span>
                        </div>
                        <div className={`max-w-[92%] rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${visual.bubbleClass}`}>
                          {msg.text}
                        </div>
                      </div>
                    )
                  })}

                  {!publicMessages.length && (
                    <div className="py-6 text-center text-[11px] text-white/45">
                      暂无公开聊天
                    </div>
                  )}
                </div>
              </div>

              {unseenCount > 0 && (
                <button
                  type="button"
                  onClick={jumpToLatest}
                  className="absolute bottom-2 right-2 rounded-full border border-cyan-400/40 bg-black/80 px-2.5 py-1 text-[11px] text-cyan-300"
                >
                  新消息 {unseenCount}
                </button>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-white/10 px-2 py-1.5 text-[10px] font-mono text-white/45">
            room {roomId}
          </div>
        </div>
      </div>
    </div>
  )
}
