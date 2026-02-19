import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'

import { api } from '../../lib/api'
import { TraderAvatar } from '../../components/TraderAvatar'
import type { Language } from '../../i18n/translations'
import type { RoomSseState } from '../../hooks/useRoomSse'
import type {
  ChatMessage,
  DecisionRecord,
  DecisionAuditRecord,
  Position,
  ReplayRuntimeStatus,
  RoomStreamPacket,
  TraderInfo,
} from '../../types'

export type FormalStreamDesignPageProps = {
  selectedTrader: TraderInfo
  streamPacket?: RoomStreamPacket
  roomSseState?: RoomSseState
  replayRuntimeStatus?: ReplayRuntimeStatus
  language: Language
}

export type DecisionViewItem = {
  id: string
  timestamp: string
  action: string
  symbol: string
  confidence: number | null
  reasoning: string
}

function toNum(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalizeAction(raw: string): string {
  const value = String(raw || '').toLowerCase()
  if (value.includes('open_long') || value === 'buy') return 'BUY'
  if (value.includes('close_long') || value === 'sell') return 'SELL'
  if (value.includes('open_short')) return 'SHORT'
  return value ? value.toUpperCase() : 'HOLD'
}

function formatTimeLabel(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toLocaleTimeString('en-GB', { hour12: false })
}

function clipText(value: string, maxLen: number): string {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen)}...`
}

function decisionToViewItem(row: DecisionRecord, index: number): DecisionViewItem {
  const first = row.decisions?.[0]
  const rawAction = String(first?.action || '')
  const rawSymbol = String(first?.symbol || '')
  const confidenceRaw = first?.confidence
  const confidenceNum = Number(confidenceRaw)
  const confidence = Number.isFinite(confidenceNum)
    ? confidenceNum > 1
      ? Math.max(0, Math.min(confidenceNum / 100, 1))
      : Math.max(0, Math.min(confidenceNum, 1))
    : null
  const reasoning = clipText(
    String(first?.reasoning || row.execution_log?.[0] || row.input_prompt || ''),
    84
  )

  return {
    id: `${row.timestamp || 'ts'}-${row.cycle_number || index}`,
    timestamp: formatTimeLabel(String(row.timestamp || '')),
    action: normalizeAction(rawAction),
    symbol: rawSymbol || '--',
    confidence,
    reasoning,
  }
}

function auditToViewItem(row: DecisionAuditRecord, index: number): DecisionViewItem {
  const rawAction = String(row.action || 'hold')
  const rawSymbol = String(row.symbol || '--')
  const confidenceRaw = (row as any)?.confidence
  const confidenceNum = Number(confidenceRaw)
  const confidence = Number.isFinite(confidenceNum)
    ? confidenceNum > 1
      ? Math.max(0, Math.min(confidenceNum / 100, 1))
      : Math.max(0, Math.min(confidenceNum, 1))
    : null

  const reasoning = clipText(
    String((row as any)?.reasoning || (row as any)?.summary || (row as any)?.decision_source || ''),
    84
  )

  return {
    id: `${String(row.timestamp || 'audit-ts')}-${Number(row.cycle_number || index)}`,
    timestamp: formatTimeLabel(String(row.timestamp || '')),
    action: normalizeAction(rawAction),
    symbol: rawSymbol,
    confidence,
    reasoning,
  }
}

function pickPositionSymbol(positions: Position[]): string | undefined {
  if (!positions.length) return undefined
  const ranked = [...positions].sort(
    (a, b) =>
      Math.abs(toNum(b.quantity) * toNum(b.mark_price)) -
      Math.abs(toNum(a.quantity) * toNum(a.mark_price))
  )
  return String(ranked[0]?.symbol || '').trim() || undefined
}

function pickThinkingSymbol(packet?: RoomStreamPacket): string | undefined {
  const fromMeta = String((packet as any)?.decision_meta?.thinking_symbol || '').trim()
  if (fromMeta) return fromMeta

  const symbolBrief = (packet?.room_context as any)?.symbol_brief
  if (symbolBrief && typeof symbolBrief === 'object') {
    const fromBrief = String(symbolBrief.symbol || symbolBrief.focus_symbol || '').trim()
    if (fromBrief) return fromBrief
  }

  return undefined
}

export function usePhoneStreamData({
  selectedTrader,
  streamPacket,
  roomSseState,
  replayRuntimeStatus,
  language,
}: FormalStreamDesignPageProps) {
  const roomId = selectedTrader.trader_id

  const { data: publicMessages = [] } = useSWR<ChatMessage[]>(
    roomId ? ['room-public-chat', roomId] : null,
    () => api.getRoomPublicMessages(roomId, 100),
    {
      refreshInterval: roomSseState?.status === 'connected' ? 25000 : 12000,
      revalidateOnFocus: false,
      dedupingInterval: 1200,
    }
  )

  const decisions = Array.isArray(streamPacket?.decisions_latest)
    ? streamPacket.decisions_latest
    : []
  const auditFallback = Array.isArray((streamPacket as any)?.decision_audit_preview?.records)
    ? ((streamPacket as any).decision_audit_preview.records as DecisionAuditRecord[])
    : []

  const positions = useMemo(
    () =>
      [...(streamPacket?.positions || [])].sort(
        (a, b) => Math.abs(toNum(b.unrealized_pnl)) - Math.abs(toNum(a.unrealized_pnl))
      ),
    [streamPacket?.positions]
  )

  const decisionItems = useMemo(() => {
    if (decisions.length > 0) {
      return decisions.slice(0, 8).map((row, idx) => decisionToViewItem(row, idx))
    }
    return auditFallback.slice(0, 8).map((row, idx) => auditToViewItem(row, idx))
  }, [decisions, auditFallback])

  const latestDecisionSymbol = String(
    decisions[0]?.decisions?.[0]?.symbol || decisionItems[0]?.symbol || ''
  ).trim()
  const latestDecisionTs = String(
    decisions[0]?.timestamp || streamPacket?.decision_latest?.timestamp || ''
  )
  const latestDecisionAgeMs = latestDecisionTs
    ? Date.now() - new Date(latestDecisionTs).getTime()
    : Number.POSITIVE_INFINITY
  const thinkingSymbol = pickThinkingSymbol(streamPacket)
  const positionSymbol = pickPositionSymbol(positions)

  const focusedSymbol =
    (latestDecisionSymbol && latestDecisionAgeMs <= 2 * 60_000
      ? latestDecisionSymbol
      : '') ||
    thinkingSymbol ||
    positionSymbol ||
    latestDecisionSymbol ||
    '600519.SH'

  const modeLabel = replayRuntimeStatus?.running ? 'REPLAY' : 'LIVE'
  const packetTs = Number(streamPacket?.ts_ms || 0)
  const packetFreshMs = packetTs > 0 ? Date.now() - packetTs : Number.POSITIVE_INFINITY
  const freshnessLabel =
    packetFreshMs < 15_000
      ? 'fresh'
      : packetFreshMs < 60_000
        ? 'warm'
        : 'stale'

  return {
    selectedTrader,
    language,
    roomId,
    positions,
    decisionItems,
    publicMessages: publicMessages.slice(-80),
    focusedSymbol,
    modeLabel,
    freshnessLabel,
    sseStatus: roomSseState?.status || 'connecting',
    packetTs,
  }
}

export function useAutoScrollFeed(itemCount: number) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [unseenCount, setUnseenCount] = useState(0)
  const prevCountRef = useRef(0)

  useEffect(() => {
    const added = Math.max(0, itemCount - prevCountRef.current)
    prevCountRef.current = itemCount
    if (!added) return

    const el = containerRef.current
    if (!el) return
    if (autoScroll) {
      el.scrollTop = el.scrollHeight
      setUnseenCount(0)
      return
    }
    setUnseenCount((prev) => prev + added)
  }, [itemCount, autoScroll])

  const onScroll = () => {
    const el = containerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 36
    setAutoScroll(nearBottom)
    if (nearBottom) setUnseenCount(0)
  }

  const jumpToLatest = () => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setAutoScroll(true)
    setUnseenCount(0)
  }

  return {
    containerRef,
    autoScroll,
    unseenCount,
    onScroll,
    jumpToLatest,
  }
}

function getDefaultAvatarSize(): number {
  if (typeof window === 'undefined') return 160
  const area = window.innerWidth * window.innerHeight
  const target = Math.sqrt(area / 8)
  return Math.max(120, Math.min(Math.round(target), 220))
}

export function useAvatarSize(storageKey: string) {
  const [sizePx, setSizePx] = useState<number>(() => {
    if (typeof window === 'undefined') return 160
    const saved = Number(window.localStorage.getItem(storageKey) || '')
    if (Number.isFinite(saved) && saved >= 96) {
      return Math.min(saved, 240)
    }
    return getDefaultAvatarSize()
  })

  useEffect(() => {
    window.localStorage.setItem(storageKey, String(sizePx))
  }, [sizePx, storageKey])

  const decrease = () => setSizePx((prev) => Math.max(96, prev - 12))
  const increase = () => setSizePx((prev) => Math.min(240, prev + 12))

  return {
    sizePx,
    decrease,
    increase,
  }
}

export function PhoneAvatarSlot({
  trader,
  sizePx,
  language,
  className = '',
  onDecrease,
  onIncrease,
}: {
  trader: TraderInfo
  sizePx: number
  language: Language
  className?: string
  onDecrease: () => void
  onIncrease: () => void
}) {
  return (
    <div
      className={`absolute z-40 select-none ${className}`.trim()}
      style={{
        left: 'calc(env(safe-area-inset-left, 0px) + 10px)',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
      }}
    >
      <div className="relative rounded-2xl border border-white/20 bg-black/45 p-1.5 backdrop-blur-sm">
        <TraderAvatar
          traderId={trader.trader_id}
          traderName={trader.trader_name}
          avatarUrl={trader.avatar_url}
          avatarHdUrl={trader.avatar_hd_url}
          size={sizePx}
          className="rounded-xl border border-white/15"
        />
        <div className="mt-1 text-[10px] font-mono text-nofx-text-muted text-center">
          {language === 'zh' ? '数字人占位 / TTS 预留' : 'Digital human slot / TTS ready'}
        </div>

        <div className="absolute -top-2 -right-2 flex gap-1">
          <button
            type="button"
            onClick={onDecrease}
            className="h-6 w-6 rounded-full border border-white/25 bg-black/70 text-xs text-white"
            aria-label={language === 'zh' ? '缩小头像' : 'Decrease avatar size'}
          >
            -
          </button>
          <button
            type="button"
            onClick={onIncrease}
            className="h-6 w-6 rounded-full border border-white/25 bg-black/70 text-xs text-white"
            aria-label={language === 'zh' ? '放大头像' : 'Increase avatar size'}
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}

export function formatSignedPct(value: number): string {
  const n = Number(value || 0)
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

export function formatSignedMoney(value: number): string {
  const n = Number(value || 0)
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}
