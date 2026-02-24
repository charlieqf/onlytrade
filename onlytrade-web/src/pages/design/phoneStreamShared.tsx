import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'

import { api } from '../../lib/api'
import { mergeChatMessages } from '../../lib/chat/mergeChatMessages'
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
  timestampMs: number
  action: string
  symbol: string
  confidence: number | null
  reasoning: string
}

export type MarketBreadthView = {
  advancers: number | null
  decliners: number | null
  unchanged: number | null
  total: number | null
  advancerRatio: number | null
  redBlueRatio: number | null
  summary: string
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

function normalizeTtsText(value: unknown, maxLen = 140): string {
  let text = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!text) return ''

  text = text
    .replace(/\b\d{6}\.(SZ|SH)\b/gi, '这只票')
    .replace(/-?\d+(?:\.\d+)?\s*[%％]/g, '')
    .replace(/\b\d+(?:\.\d+)?\b/g, '')
    .replace(/[,:：;；]{2,}/g, '，')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (!text) return ''
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}

function fallbackTtsText(kind: ChatMessage['agent_message_kind']): string {
  if (kind === 'reply') return ''
  return '我在持续跟踪盘面，等信号更清晰再提示你。'
}

function toneHash(value: string): number {
  let out = 0
  const text = String(value || '')
  for (let i = 0; i < text.length; i += 1) {
    out = ((out << 5) - out + text.charCodeAt(i)) | 0
  }
  return Math.abs(out)
}

function resolveMessageTtsTone(message: ChatMessage): 'calm' | 'focused' | 'energetic' | 'cautious' {
  const raw = String(message?.generation_tone || '').trim().toLowerCase()
  if (raw === 'calm' || raw === 'focused' || raw === 'energetic' || raw === 'cautious') {
    return raw
  }
  const seed = `${String(message?.id || '')}|${String(message?.agent_message_kind || '')}|${String(message?.created_ts_ms || '')}`
  const options: Array<'focused' | 'calm' | 'energetic' | 'cautious'> = ['focused', 'calm', 'energetic', 'cautious']
  return options[toneHash(seed) % options.length]
}

function pickLatestChatTsMs(messages: ChatMessage[]): number {
  if (!Array.isArray(messages) || messages.length === 0) return 0
  return messages.reduce((maxTs, msg) => {
    const ts = Number(msg?.created_ts_ms || 0)
    return ts > maxTs ? ts : maxTs
  }, 0)
}

function classifyFreshness(
  ageMs: number,
  freshThresholdMs: number,
  warmThresholdMs: number
): 'fresh' | 'warm' | 'stale' {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'stale'
  if (ageMs < freshThresholdMs) return 'fresh'
  if (ageMs < warmThresholdMs) return 'warm'
  return 'stale'
}

function formatAgeCompact(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return '--'
  const secs = Math.floor(ageMs / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  return `${hours}h`
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

  const rawTs = String(row.timestamp || '')
  const tsMs = new Date(rawTs).getTime()
  return {
    id: `${row.timestamp || 'ts'}-${row.cycle_number || index}`,
    timestamp: formatTimeLabel(rawTs),
    timestampMs: Number.isFinite(tsMs) ? tsMs : 0,
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

  const rawTs = String(row.timestamp || '')
  const tsMs = new Date(rawTs).getTime()
  return {
    id: `${String(row.timestamp || 'audit-ts')}-${Number(row.cycle_number || index)}`,
    timestamp: formatTimeLabel(rawTs),
    timestampMs: Number.isFinite(tsMs) ? tsMs : 0,
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
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const [lastPacketRxMs, setLastPacketRxMs] = useState<number>(0)

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!streamPacket) return
    setLastPacketRxMs(Date.now())
  }, [streamPacket])

  const { data: apiPublicMessages = [] } = useSWR<ChatMessage[]>(
    roomId ? ['room-public-chat', roomId] : null,
    () => api.getRoomPublicMessages(roomId, 100),
    {
      refreshInterval: roomSseState?.status === 'connected' ? 25000 : 12000,
      revalidateOnFocus: false,
      dedupingInterval: 1200,
    }
  )

  const packetPublicMessages = useMemo(() => {
    const fromPacket = (streamPacket as any)?.public_chat_preview?.messages
    return Array.isArray(fromPacket) ? fromPacket : []
  }, [(streamPacket as any)?.public_chat_preview?.messages])

  const mergedPublicMessages = useMemo(
    () => mergeChatMessages(apiPublicMessages, packetPublicMessages),
    [apiPublicMessages, packetPublicMessages]
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
    ? nowMs - new Date(latestDecisionTs).getTime()
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
  const packetEventTs = Number(roomSseState?.last_event_ts_ms || 0)
  const packetFreshMs = packetEventTs > 0
    ? nowMs - packetEventTs
    : lastPacketRxMs > 0
      ? nowMs - lastPacketRxMs
      : Number.POSITIVE_INFINITY
  const freshnessLabel = classifyFreshness(packetFreshMs, 15_000, 60_000)

  const apiLatestChatTsMs = pickLatestChatTsMs(apiPublicMessages)
  const packetLatestChatTsMs = pickLatestChatTsMs(packetPublicMessages)
  const mergedLatestChatTsMs = pickLatestChatTsMs(mergedPublicMessages)
  const chatAgeMs =
    mergedLatestChatTsMs > 0 ? nowMs - mergedLatestChatTsMs : Number.POSITIVE_INFINITY
  const decisionFreshnessLabel = classifyFreshness(latestDecisionAgeMs, 60_000, 180_000)
  const chatFreshnessLabel = classifyFreshness(chatAgeMs, 30_000, 120_000)

  let chatSyncState = 'empty'
  if (apiLatestChatTsMs > 0 && packetLatestChatTsMs > 0) {
    const deltaMs = apiLatestChatTsMs - packetLatestChatTsMs
    chatSyncState = Math.abs(deltaMs) <= 5_000
      ? 'synced'
      : deltaMs > 0
        ? 'api-ahead'
        : 'packet-ahead'
  } else if (apiLatestChatTsMs > 0) {
    chatSyncState = 'api-only'
  } else if (packetLatestChatTsMs > 0) {
    chatSyncState = 'packet-only'
  }

  const lastSseEventAgeMs = roomSseState?.last_event_ts_ms
    ? nowMs - roomSseState.last_event_ts_ms
    : Number.POSITIVE_INFINITY
  const hasRecentSseEvent = Number.isFinite(lastSseEventAgeMs) && lastSseEventAgeMs <= 30_000
  const sseHealthy = hasRecentSseEvent && roomSseState?.status !== 'error'
  const transportLabel = sseHealthy ? 'SSE' : 'POLL'

  const staleFlags = {
    transport:
      roomSseState?.status === 'error'
      && lastSseEventAgeMs > 45_000,
    packet: freshnessLabel === 'stale',
    decision: decisionFreshnessLabel === 'stale',
    chat: mergedPublicMessages.length > 0 && chatFreshnessLabel === 'stale',
  }
  const isDegradedRaw = staleFlags.transport || staleFlags.packet
  const suppressDegradedBanner =
    typeof window !== 'undefined'
    && (window.location.pathname === '/onlytrade'
      || window.location.pathname.startsWith('/onlytrade/'))
  const isDegraded = suppressDegradedBanner ? false : isDegradedRaw

  const breadthRaw = (streamPacket as any)?.market_breadth?.breadth
    || (streamPacket as any)?.room_context?.market_breadth
    || null
  const breadthSummary = String(
    (streamPacket as any)?.market_breadth?.summary
    || (streamPacket as any)?.room_context?.market_breadth_summary
    || ''
  ).trim()
  const marketBreadth: MarketBreadthView = {
    advancers: Number.isFinite(Number(breadthRaw?.advancers)) ? Number(breadthRaw.advancers) : null,
    decliners: Number.isFinite(Number(breadthRaw?.decliners)) ? Number(breadthRaw.decliners) : null,
    unchanged: Number.isFinite(Number(breadthRaw?.unchanged)) ? Number(breadthRaw.unchanged) : null,
    total: Number.isFinite(Number(breadthRaw?.total)) ? Number(breadthRaw.total) : null,
    advancerRatio: Number.isFinite(Number(breadthRaw?.advancer_ratio)) ? Number(breadthRaw.advancer_ratio) : null,
    redBlueRatio: Number.isFinite(Number(breadthRaw?.red_blue_ratio)) ? Number(breadthRaw.red_blue_ratio) : null,
    summary: breadthSummary,
  }

  return {
    selectedTrader,
    language,
    roomId,
    positions,
    decisionItems,
    publicMessages: mergedPublicMessages.slice(-80),
    focusedSymbol,
    modeLabel,
    freshnessLabel,
    packetAgeLabel: formatAgeCompact(packetFreshMs),
    decisionAgeLabel: formatAgeCompact(latestDecisionAgeMs),
    chatAgeLabel: formatAgeCompact(chatAgeMs),
    decisionFreshnessLabel,
    chatFreshnessLabel,
    transportLabel,
    chatSyncState,
    staleFlags,
    isDegraded,
    marketBreadth,
    sseStatus: roomSseState?.status || 'connecting',
    packetTs,
  }
}

export function useAgentTtsAutoplay({
  roomId,
  publicMessages,
}: {
  roomId: string
  publicMessages: ChatMessage[]
}) {
  const [ttsAutoPlay, setTtsAutoPlay] = useState<boolean>(true)
  const [ttsError, setTtsError] = useState<string>('')
  const [ttsSpeaking, setTtsSpeaking] = useState<boolean>(false)

  const { data: chatTtsConfig } = useSWR(
    ['chat-tts-config'],
    () => api.getChatTtsConfig(),
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
    }
  )

  const ttsAvailable = chatTtsConfig?.enabled === true
  const roomVoice = String(chatTtsConfig?.voice_map?.[roomId] || '').trim()

  const ttsSeenMessageIdsRef = useRef<Set<string>>(new Set())
  const ttsQueueRef = useRef<ChatMessage[]>([])
  const ttsPlayingRef = useRef<boolean>(false)
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null)
  const ttsObjectUrlRef = useRef<string | null>(null)

  const speakWithBrowserTts = useCallback(async (text: string) => {
    if (
      typeof window === 'undefined'
      || !('speechSynthesis' in window)
      || typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      throw new Error('browser_tts_unavailable')
    }

    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'
      utterance.rate = 1
      utterance.pitch = 1
      utterance.onend = () => resolve()
      utterance.onerror = () => reject(new Error('browser_tts_failed'))
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
    })
  }, [])

  const playQueuedTts = useCallback(async () => {
    if (!ttsAutoPlay || !ttsAvailable) return
    if (ttsPlayingRef.current) return
    const next = ttsQueueRef.current.shift()
    if (!next) return

    const normalized = normalizeTtsText(next.text, 140)
    const text = normalized || fallbackTtsText(next.agent_message_kind)
    if (!text) return

    ttsPlayingRef.current = true
    setTtsSpeaking(true)
    try {
      const blob = await api.synthesizeRoomSpeech({
        room_id: roomId,
        text,
        tone: resolveMessageTtsTone(next),
        message_id: String(next.id || ''),
      })
      if (!blob || blob.size <= 0) {
        throw new Error('tts_empty_audio')
      }

      if (ttsObjectUrlRef.current) {
        URL.revokeObjectURL(ttsObjectUrlRef.current)
      }
      const objectUrl = URL.createObjectURL(blob)
      ttsObjectUrlRef.current = objectUrl

      const audio = new Audio(objectUrl)
      audio.preload = 'auto'
      ttsAudioRef.current = audio

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve()
        audio.onerror = () => reject(new Error('tts_audio_playback_failed'))
        audio.play().then(() => {}).catch((error) => reject(error))
      })

      setTtsError('')
    } catch (error) {
      const message = String(error instanceof Error ? error.message : 'tts_play_failed')

      if (
        /openai_tts_http_429|chat_tts_unavailable|chat_tts_disabled|openai_tts_http_5\d\d/i
          .test(message)
      ) {
        try {
          await speakWithBrowserTts(text)
          setTtsError('')
          return
        } catch {
          // fall through and keep original backend error message
        }
      }

      setTtsError(message)
      if (/NotAllowedError|play\(\) failed/i.test(message)) {
        setTtsAutoPlay(false)
      }
    } finally {
      ttsPlayingRef.current = false
      setTtsSpeaking(false)
      if (ttsQueueRef.current.length > 0) {
        void playQueuedTts()
      }
    }
  }, [roomId, ttsAutoPlay, ttsAvailable, speakWithBrowserTts])

  useEffect(() => {
    ttsSeenMessageIdsRef.current.clear()
    ttsQueueRef.current = []
    ttsPlayingRef.current = false
    setTtsSpeaking(false)
    setTtsError('')
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause()
      ttsAudioRef.current = null
      setTtsSpeaking(false)
    }
    if (ttsObjectUrlRef.current) {
      URL.revokeObjectURL(ttsObjectUrlRef.current)
      ttsObjectUrlRef.current = null
    }
  }, [roomId])

  useEffect(() => {
    return () => {
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause()
        ttsAudioRef.current = null
      }
      if (ttsObjectUrlRef.current) {
        URL.revokeObjectURL(ttsObjectUrlRef.current)
        ttsObjectUrlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!ttsAutoPlay || !ttsAvailable) return

    const seen = ttsSeenMessageIdsRef.current
    const queue = ttsQueueRef.current
    let appended = 0

    for (const row of publicMessages.slice(-30)) {
      if (row.sender_type !== 'agent') continue
      if (
        !(
          row.agent_message_kind === 'reply' ||
          row.agent_message_kind === 'proactive' ||
          row.agent_message_kind === 'narration'
        )
      ) {
        continue
      }
      const id = String(row.id || '').trim()
      if (!id || seen.has(id)) continue
      const text = String(row.text || '').trim()
      if (!text) continue
      seen.add(id)
      queue.push(row)
      appended += 1
    }

    if (appended > 0) {
      void playQueuedTts()
    }
  }, [publicMessages, ttsAutoPlay, ttsAvailable, playQueuedTts])

  return {
    ttsAvailable,
    ttsAutoPlay,
    setTtsAutoPlay,
    ttsError,
    ttsSpeaking,
    roomVoice,
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
  showPlaceholderLabel = true,
  showTraderName = false,
  onDecrease,
  onIncrease,
}: {
  trader: TraderInfo
  sizePx: number
  language: Language
  className?: string
  showPlaceholderLabel?: boolean
  showTraderName?: boolean
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
        {showTraderName && (
          <div className="mt-1 text-center text-[10px] font-semibold text-white/90">
            {trader.trader_name}
          </div>
        )}
        {showPlaceholderLabel && (
          <div className="mt-1 text-[10px] font-mono text-nofx-text-muted text-center">
            {language === 'zh' ? '数字人占位 / TTS 预留' : 'Digital human slot / TTS ready'}
          </div>
        )}

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
