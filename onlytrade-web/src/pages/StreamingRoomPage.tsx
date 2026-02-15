import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import useSWR from 'swr'
import { api } from '../lib/api'
import { DeepVoidBackground } from '../components/DeepVoidBackground'
import { TraderAvatar } from '../components/TraderAvatar'
import { formatPrice, formatQuantity } from '../utils/format'
import type { ChatMessage, DecisionRecord, Position, RoomStreamPacket, TraderInfo } from '../types'
import type { Language } from '../i18n/translations'

type ChatMode = 'window' | 'danmu'
type RoomSseStatus = 'connecting' | 'connected' | 'reconnecting' | 'error'
type RoomSseState = {
  status: RoomSseStatus
  last_open_ts_ms: number | null
  last_error_ts_ms: number | null
  last_event_ts_ms: number | null
}

function formatTime(tsMs: number | null | undefined) {
  const n = Number(tsMs)
  if (!Number.isFinite(n) || n <= 0) return '--:--:--'
  try {
    return new Date(n).toLocaleTimeString()
  } catch {
    return String(n)
  }
}

function compactReasoning(decision: DecisionRecord | null) {
  if (!decision) return ''
  const head = decision.decisions?.[0]
  if (head?.reasoning) return String(head.reasoning).trim()
  const steps = Array.isArray(decision.reasoning_steps_cn) ? decision.reasoning_steps_cn : []
  const cleaned = steps.map((s) => String(s || '').trim()).filter(Boolean)
  return cleaned.slice(0, 3).join(' / ')
}

function actionTone(action?: string | null) {
  const a = String(action || '').toLowerCase()
  if (a === 'buy' || a === 'long') return { label: 'BUY', cls: 'bg-nofx-green/15 text-nofx-green border-nofx-green/25' }
  if (a === 'sell' || a === 'short') return { label: 'SELL', cls: 'bg-nofx-red/15 text-nofx-red border-nofx-red/25' }
  if (a === 'hold') return { label: 'HOLD', cls: 'bg-white/10 text-nofx-text-main border-white/15' }
  return { label: String(action || '—').toUpperCase(), cls: 'bg-white/10 text-nofx-text-main border-white/15' }
}

function topPosition(positions: Position[]) {
  const rows = Array.isArray(positions) ? positions : []
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => Math.abs(Number(b?.unrealized_pnl || 0)) - Math.abs(Number(a?.unrealized_pnl || 0)))
  return sorted[0] || null
}

function senderLabel(message: ChatMessage) {
  const fromPayload = String(message.sender_name || '').trim()
  if (fromPayload) return fromPayload
  return message.sender_type === 'agent' ? 'Agent' : 'Viewer'
}

function DanmuOverlay({ messages }: { messages: ChatMessage[] }) {
  const [items, setItems] = useState<Array<{ id: string; text: string; top: number; createdMs: number; tone: 'agent' | 'user' }>>([])
  const seenRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const seen = seenRef.current
    const fresh = [] as Array<{ id: string; text: string; top: number; createdMs: number; tone: 'agent' | 'user' }>
    for (const msg of messages.slice(-12)) {
      const id = String(msg?.id || '')
      if (!id || seen.has(id)) continue
      seen.add(id)

      const text = String(msg?.text || '').trim()
      if (!text) continue

      const tone = msg?.sender_type === 'agent' ? 'agent' : 'user'
      // Keep safe margins so danmu doesn't overlap key UI.
      const top = 8 + Math.floor(Math.random() * 62)
      fresh.push({ id, text: `${senderLabel(msg)}: ${text}`, top, createdMs: Date.now(), tone })
    }
    if (fresh.length) {
      setItems((prev) => [...prev, ...fresh].slice(-40))
    }
  }, [messages])

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <AnimatePresence>
        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={{ x: '110%', opacity: 0 }}
            animate={{ x: '-120%', opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 9.5, ease: 'linear' }}
            style={{ top: `${item.top}%` }}
            className={
              `absolute left-0 whitespace-nowrap rounded-full px-3 py-1 text-sm shadow-[0_10px_35px_rgba(0,0,0,0.35)] `
              + (item.tone === 'agent'
                ? 'bg-black/55 border border-nofx-gold/25 text-nofx-gold'
                : 'bg-black/45 border border-white/10 text-nofx-text-main')
            }
            onAnimationComplete={() => {
              setItems((prev) => prev.filter((x) => x.id !== item.id))
            }}
          >
            {item.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function StreamingRoomPage({
  selectedTrader,
  streamPacket,
  roomSseState,
  language,
}: {
  selectedTrader: TraderInfo
  streamPacket?: RoomStreamPacket
  roomSseState?: RoomSseState
  language: Language
}) {
  const [chatMode, setChatMode] = useState<ChatMode>('danmu')
  const roomId = selectedTrader.trader_id

  const { data: chatData } = useSWR(
    roomId ? ['room-public-chat', roomId] : null,
    () => api.getRoomPublicMessages(roomId, 80),
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
    }
  )

  const publicMessages: ChatMessage[] = useMemo(() => {
    const rows = Array.isArray(chatData) ? chatData : []
    return [...rows].sort((a, b) => Number(a?.created_ts_ms || 0) - Number(b?.created_ts_ms || 0)).slice(-80)
  }, [chatData])

  const decision: DecisionRecord | null = useMemo(() => {
    const fromPacket = (streamPacket as any)?.decision_latest || null
    if (fromPacket) return fromPacket
    const latest = Array.isArray((streamPacket as any)?.decisions_latest) ? (streamPacket as any).decisions_latest : []
    return latest[0] || null
  }, [streamPacket])

  const head = decision?.decisions?.[0] || null
  const tone = actionTone(head?.action)

  const fuel = useMemo(() => {
    const readiness = (streamPacket as any)?.room_context?.data_readiness
      || (streamPacket as any)?.decision_meta?.data_readiness
      || null
    const level = String(readiness?.level || '').toUpperCase() || 'OK'
    const reasons = Array.isArray(readiness?.reasons) ? readiness.reasons.map((r: any) => String(r || '')).filter(Boolean) : []
    const overviewBrief = String((streamPacket as any)?.market_overview?.brief || (streamPacket as any)?.room_context?.market_overview_brief || '').trim()
    const newsTitles = Array.isArray((streamPacket as any)?.news_digest?.titles)
      ? (streamPacket as any).news_digest.titles
      : (Array.isArray((streamPacket as any)?.room_context?.news_digest_titles)
        ? (streamPacket as any).room_context.news_digest_titles
        : [])

    return {
      level,
      reasons,
      overviewBrief,
      newsTitles: Array.isArray(newsTitles) ? newsTitles : [],
    }
  }, [streamPacket])

  const account = (streamPacket as any)?.account || null
  const positions: Position[] = Array.isArray((streamPacket as any)?.positions) ? (streamPacket as any).positions : []
  const featuredPos = useMemo(() => topPosition(positions), [positions])

  const sseStatus = roomSseState?.status || 'connecting'
  const sseCls = sseStatus === 'connected'
    ? 'bg-nofx-green/10 text-nofx-green border-nofx-green/25'
    : sseStatus === 'reconnecting'
      ? 'bg-nofx-gold/10 text-nofx-gold border-nofx-gold/25'
      : sseStatus === 'error'
        ? 'bg-nofx-red/10 text-nofx-red border-nofx-red/25'
        : 'bg-white/5 text-nofx-text-muted border-white/10'

  return (
    <div className="relative min-h-[calc(100vh-64px)]">
      <DeepVoidBackground />

      <div className="relative z-10 px-4 py-5">
        <div className="max-w-[1600px] mx-auto">
          <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
            {/* Stage */}
            <div className="nofx-glass border border-white/10 rounded-2xl overflow-hidden">
              <div className="relative">
                {/* Top bar */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5 bg-black/25">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="shrink-0">
                      <div className="relative">
                        <TraderAvatar
                          traderId={selectedTrader.trader_id}
                          traderName={selectedTrader.trader_name}
                          avatarUrl={selectedTrader.avatar_url}
                          avatarHdUrl={selectedTrader.avatar_hd_url}
                          size={44}
                          className="rounded-2xl border border-white/10"
                        />
                        <div className="absolute -right-1 -bottom-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-nofx-red text-white shadow-[0_10px_30px_rgba(246,70,93,0.35)]">
                          LIVE
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="text-base font-bold text-nofx-text-main truncate">
                        {selectedTrader.trader_name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${sseCls}`}>SSE:{sseStatus}</span>
                        {roomSseState?.last_event_ts_ms && (
                          <span className="text-[11px] font-mono text-nofx-text-muted opacity-80">
                            last {formatTime(roomSseState.last_event_ts_ms)}
                          </span>
                        )}
                        {streamPacket?.ts_ms && (
                          <span className="text-[11px] font-mono text-nofx-text-muted opacity-70">
                            pkt {formatTime(streamPacket.ts_ms)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-full border border-white/10 bg-black/25 p-1">
                      <button
                        type="button"
                        onClick={() => setChatMode('danmu')}
                        className={`px-3 py-1 rounded-full text-[11px] font-semibold ${chatMode === 'danmu' ? 'bg-nofx-gold text-black' : 'text-nofx-text-muted hover:text-nofx-text-main'}`}
                      >
                        Danmu
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatMode('window')}
                        className={`px-3 py-1 rounded-full text-[11px] font-semibold ${chatMode === 'window' ? 'bg-nofx-gold text-black' : 'text-nofx-text-muted hover:text-nofx-text-main'}`}
                      >
                        Chat
                      </button>
                    </div>
                  </div>
                </div>

                {/* Main content area */}
                <div className="relative p-4 sm:p-6">
                  {/* Decision hero */}
                  <div className="rounded-2xl border border-white/10 bg-black/35 p-5 sm:p-6 shadow-[0_30px_90px_rgba(0,0,0,0.35)]">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-nofx-text-muted">
                          {decision ? `cycle ${decision.cycle_number} | ${decision.timestamp}` : (language === 'zh' ? '等待下一轮决策…' : 'Waiting for next decision…')}
                        </div>
                        <div className="mt-3 flex items-center gap-3 flex-wrap">
                          <span className={`px-3 py-1 rounded-full border text-xs font-bold tracking-wide ${tone.cls}`}>{tone.label}</span>
                          <span className="text-2xl sm:text-3xl font-black text-nofx-text-main">
                            {String(head?.symbol || streamPacket?.room_context?.symbol_brief?.symbol || '--')}
                          </span>
                          {Number.isFinite(Number(head?.confidence)) && (
                            <span className="text-xs font-mono text-nofx-text-muted">
                              conf {Number(head?.confidence).toFixed(2)}
                            </span>
                          )}
                        </div>
                        <div className="mt-3 text-sm sm:text-base text-nofx-text-main leading-relaxed opacity-95">
                          {compactReasoning(decision) || (language === 'zh' ? '暂无解读。' : 'No reasoning yet.')}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="text-[11px] font-mono text-nofx-text-muted">
                          {language === 'zh' ? '燃料' : 'FUEL'}
                        </div>
                        <div
                          className={
                            'mt-1 inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold border '
                            + (fuel.level === 'ERROR'
                              ? 'bg-nofx-red/15 text-nofx-red border-nofx-red/25'
                              : fuel.level === 'WARN'
                                ? 'bg-nofx-gold/15 text-nofx-gold border-nofx-gold/25'
                                : 'bg-nofx-green/15 text-nofx-green border-nofx-green/25')
                          }
                          title={fuel.reasons.join(' / ')}
                        >
                          DATA:{fuel.level}
                        </div>
                      </div>
                    </div>

                    {/* Mini bet line */}
                    <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                        <div className="text-[10px] font-mono text-nofx-text-muted">equity</div>
                        <div className="text-sm font-bold text-nofx-text-main">
                          {account ? formatPrice(account.total_balance) : '--'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                        <div className="text-[10px] font-mono text-nofx-text-muted">unreal pnl</div>
                        <div className={`text-sm font-bold ${Number(account?.total_unrealized_profit || 0) >= 0 ? 'text-nofx-green' : 'text-nofx-red'}`}>
                          {account ? formatPrice(account.total_unrealized_profit) : '--'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                        <div className="text-[10px] font-mono text-nofx-text-muted">positions</div>
                        <div className="text-sm font-bold text-nofx-text-main">
                          {account ? String(account.position_count) : String(positions.length)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                        <div className="text-[10px] font-mono text-nofx-text-muted">margin</div>
                        <div className="text-sm font-bold text-nofx-text-main">
                          {account ? `${Math.round(Number(account.margin_used_pct || 0) * 100)}%` : '--'}
                        </div>
                      </div>
                    </div>

                    {featuredPos && (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] font-mono text-nofx-text-muted">
                              {language === 'zh' ? '当前下注 (最大波动)' : 'Featured bet (largest swing)'}
                            </div>
                            <div className="text-sm font-bold text-nofx-text-main truncate">
                              {featuredPos.symbol} · {String(featuredPos.side || '').toUpperCase()} · {formatQuantity(featuredPos.quantity)}
                            </div>
                          </div>
                          <div className={`text-sm font-bold ${Number(featuredPos.unrealized_pnl || 0) >= 0 ? 'text-nofx-green' : 'text-nofx-red'}`}>
                            {formatPrice(featuredPos.unrealized_pnl)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Danmu overlay */}
                  {chatMode === 'danmu' && <DanmuOverlay messages={publicMessages} />}

                  {/* Fuel cards */}
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                      <div className="text-[11px] font-mono text-nofx-text-muted">market overview</div>
                      <div className="mt-2 text-sm text-nofx-text-main leading-relaxed opacity-95">
                        {fuel.overviewBrief || (language === 'zh' ? '暂无概览。' : 'No overview yet.')}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                      <div className="text-[11px] font-mono text-nofx-text-muted">headlines</div>
                      {fuel.newsTitles.length ? (
                        <div className="mt-2 space-y-1 text-sm text-nofx-text-main">
                          {fuel.newsTitles.slice(0, 4).map((title: any, idx: number) => (
                            <div key={`${idx}-${String(title)}`} className="opacity-95">
                              · {String(title)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-nofx-text-muted opacity-70">
                          {language === 'zh' ? '暂无摘要。' : 'No digest.'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Window chat inside stage (optional) */}
                  {chatMode === 'window' && (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                        <div className="text-[11px] font-mono text-nofx-text-muted">public chat (read-only)</div>
                        <div className="text-[11px] text-nofx-text-muted">{publicMessages.length}</div>
                      </div>
                      <div className="max-h-[280px] overflow-y-auto px-4 py-3 space-y-2">
                        {publicMessages.slice(-30).map((m) => (
                          <div key={m.id} className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold text-nofx-text-main opacity-95">
                                {senderLabel(m)}
                              </div>
                              <div className="text-sm text-nofx-text-main break-words opacity-95">
                                {m.text}
                              </div>
                            </div>
                            <div className="shrink-0 text-[11px] font-mono text-nofx-text-muted opacity-70">
                              {formatTime(m.created_ts_ms)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Side rail (TikTok-ish chat list + quick stats) */}
            <div className="space-y-4">
              <div className="nofx-glass border border-white/10 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/5 bg-black/25">
                  <div className="text-sm font-bold text-nofx-text-main">Public Chat</div>
                  <div className="text-[11px] font-mono text-nofx-text-muted">read-only</div>
                </div>
                <div className="p-4 space-y-2 max-h-[520px] overflow-y-auto">
                  {publicMessages.slice(-40).map((m) => (
                    <div key={m.id} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className={`font-semibold ${m.sender_type === 'agent' ? 'text-nofx-gold' : 'text-nofx-text-main'}`}>{senderLabel(m)}</span>
                        <span className="font-mono text-nofx-text-muted opacity-70">{formatTime(m.created_ts_ms)}</span>
                      </div>
                      <div className="text-sm text-nofx-text-main mt-1 break-words opacity-95">{m.text}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="nofx-glass border border-white/10 rounded-2xl p-4">
                <div className="text-sm font-bold text-nofx-text-main">Streamer Notes</div>
                <div className="mt-2 text-xs text-nofx-text-muted leading-relaxed opacity-80">
                  {language === 'zh'
                    ? '此页面为只读“直播间”布局：头像（未来可替换为数字人）、最新交易决策与解读、弹幕/聊天、燃料信息。'
                    : 'Read-only streaming layout: avatar (future digital person), latest trade decision + reasoning, danmu/chat, fuel info.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
