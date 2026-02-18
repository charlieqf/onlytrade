import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import useSWR from 'swr'
import { api } from '../lib/api'
import { DeepVoidBackground } from '../components/DeepVoidBackground'
import { TraderAvatar } from '../components/TraderAvatar'
import { RoomClockBadge } from '../components/RoomClockBadge'
import { formatPrice, formatQuantity } from '../utils/format'
import type {
  ChatMessage,
  DecisionRecord,
  Position,
  ReplayRuntimeStatus,
  RoomStreamPacket,
  TraderInfo,
  ViewerBetCreditsPayload,
} from '../types'
import type { Language } from '../i18n/translations'

type ChatMode = 'window' | 'danmu'
type RoomSseStatus = 'connecting' | 'connected' | 'reconnecting' | 'error'
type RoomSseState = {
  status: RoomSseStatus
  last_open_ts_ms: number | null
  last_error_ts_ms: number | null
  last_event_ts_ms: number | null
}

type DigitalPersonRenderMode = 'canvas' | 'video' | 'placeholder'
type DigitalPersonStatus = 'offline' | 'idle' | 'speaking'
type DigitalPersonState = {
  render_mode: DigitalPersonRenderMode
  status: DigitalPersonStatus
  last_speaking_ts_ms: number | null
  last_source: 'agent_message' | 'manual' | null
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

function formatMinuteLabel(minuteValue: unknown) {
  const minute = Number(minuteValue)
  if (!Number.isFinite(minute) || minute < 0) return '--:--'
  const h = Math.floor(minute / 60)
  const m = Math.floor(minute % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function compactReasoning(decision: DecisionRecord | null) {
  if (!decision) return ''
  const head = decision.decisions?.[0]
  if (head?.reasoning) return String(head.reasoning).trim()
  const steps = Array.isArray(decision.reasoning_steps_cn)
    ? decision.reasoning_steps_cn
    : []
  const cleaned = steps.map((s) => String(s || '').trim()).filter(Boolean)
  return cleaned.slice(0, 3).join(' / ')
}

function actionTone(action?: string | null) {
  const a = String(action || '').toLowerCase()
  if (a === 'buy' || a === 'long')
    return {
      label: 'BUY',
      cls: 'bg-nofx-green/15 text-nofx-green border-nofx-green/25',
    }
  if (a === 'sell' || a === 'short')
    return {
      label: 'SELL',
      cls: 'bg-nofx-red/15 text-nofx-red border-nofx-red/25',
    }
  if (a === 'hold')
    return {
      label: 'HOLD',
      cls: 'bg-white/10 text-nofx-text-main border-white/15',
    }
  return {
    label: String(action || '—').toUpperCase(),
    cls: 'bg-white/10 text-nofx-text-main border-white/15',
  }
}

function topPosition(positions: Position[]) {
  const rows = Array.isArray(positions) ? positions : []
  if (rows.length === 0) return null
  const sorted = [...rows].sort(
    (a, b) =>
      Math.abs(Number(b?.unrealized_pnl || 0)) -
      Math.abs(Number(a?.unrealized_pnl || 0))
  )
  return sorted[0] || null
}

function senderLabel(message: ChatMessage) {
  const fromPayload = String(message.sender_name || '').trim()
  if (fromPayload) return fromPayload
  return message.sender_type === 'agent' ? 'Agent' : 'Viewer'
}

function hashString(value: string) {
  let h = 2166136261
  const s = String(value || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function colorForSender(sender: string) {
  const palette = [
    '#F0B90B', // gold
    '#0ECB81', // green
    '#60A5FA', // blue
    '#F97316', // orange
    '#A78BFA', // violet
    '#F472B6', // pink
  ]
  const idx = hashString(sender) % palette.length
  return palette[idx]
}

function safeText(value: unknown, maxLen = 160) {
  const text = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!text) return ''
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text
}

type StreamReaction = {
  id: string
  emoji: string
  left_pct: number
  size_px: number
  duration_ms: number
}

function freshnessBadge(stale: boolean | null | undefined) {
  if (stale == null) {
    return {
      label: 'n/a',
      cls: 'border-white/15 text-nofx-text-muted bg-black/20',
    }
  }
  if (stale === true) {
    return {
      label: 'stale',
      cls: 'border-nofx-red/35 text-nofx-red bg-nofx-red/10',
    }
  }
  return {
    label: 'fresh',
    cls: 'border-nofx-green/35 text-nofx-green bg-nofx-green/10',
  }
}

function parseStreamingParams() {
  const params = new URLSearchParams(window.location.search)
  const mode = String(params.get('dp') || '')
    .trim()
    .toLowerCase()
  const videoUrl = String(
    params.get('dp_video') || params.get('video') || ''
  ).trim()

  let renderMode: DigitalPersonRenderMode = 'canvas'
  if (mode === 'video') renderMode = 'video'
  if (mode === 'placeholder') renderMode = 'placeholder'

  return {
    renderMode,
    videoUrl,
  }
}

function DigitalPersonViewport({
  trader,
  state,
  videoUrl,
  language,
}: {
  trader: TraderInfo
  state: DigitalPersonState
  videoUrl: string
  language: Language
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const hiddenRef = useRef<boolean>(
    typeof document !== 'undefined' ? document.hidden : false
  )
  const lastTsRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const scheduleNextFrame = (draw: (ts: number) => void) => {
      if (hiddenRef.current) return
      if (state.status !== 'speaking') {
        if (timerRef.current != null) {
          window.clearTimeout(timerRef.current)
        }
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null
          rafRef.current = window.requestAnimationFrame(draw)
        }, 120)
        return
      }
      rafRef.current = window.requestAnimationFrame(draw)
    }

    const draw = (ts: number) => {
      if (hiddenRef.current) {
        return
      }

      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w <= 0 || h <= 0) {
        scheduleNextFrame(draw)
        return
      }

      if (
        canvas.width !== Math.floor(w * devicePixelRatio) ||
        canvas.height !== Math.floor(h * devicePixelRatio)
      ) {
        canvas.width = Math.floor(w * devicePixelRatio)
        canvas.height = Math.floor(h * devicePixelRatio)
      }

      lastTsRef.current = ts
      const t = ts / 1000

      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // Background gradient.
      const g = ctx.createLinearGradient(0, 0, w, h)
      g.addColorStop(0, 'rgba(240,185,11,0.14)')
      g.addColorStop(0.55, 'rgba(0,0,0,0.0)')
      g.addColorStop(1, 'rgba(14,203,129,0.10)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)

      // Subtle vignette.
      const vg = ctx.createRadialGradient(
        w * 0.5,
        h * 0.45,
        Math.min(w, h) * 0.08,
        w * 0.5,
        h * 0.45,
        Math.max(w, h) * 0.6
      )
      vg.addColorStop(0, 'rgba(0,0,0,0.0)')
      vg.addColorStop(1, 'rgba(0,0,0,0.55)')
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, w, h)

      // Avatar silhouette.
      const cx = w * 0.5
      const cy = h * 0.52
      const pulse =
        state.status === 'speaking' ? 1 + 0.03 * Math.sin(t * 10) : 1
      const headR = Math.min(w, h) * 0.13 * pulse
      const bodyR = Math.min(w, h) * 0.22

      ctx.save()
      ctx.globalAlpha = 0.9
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.beginPath()
      ctx.arc(cx, cy - headR * 1.15, headR, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(
        cx,
        cy + bodyR * 0.1,
        bodyR * 0.9,
        bodyR * 0.72,
        0,
        0,
        Math.PI * 2
      )
      ctx.fill()
      ctx.restore()

      // Speaking indicator wave.
      if (state.status === 'speaking') {
        ctx.save()
        ctx.globalAlpha = 0.9
        ctx.strokeStyle = 'rgba(240,185,11,0.85)'
        ctx.lineWidth = 2
        const y = cy + bodyR * 0.55
        ctx.beginPath()
        const amp = 6 + 3 * Math.sin(t * 8)
        for (let x = cx - 80; x <= cx + 80; x += 8) {
          const yy = y + Math.sin(x * 0.05 + t * 10) * amp
          if (x === cx - 80) ctx.moveTo(x, yy)
          else ctx.lineTo(x, yy)
        }
        ctx.stroke()
        ctx.restore()
      }

      // Frame again.
      scheduleNextFrame(draw)
    }

    const handleVisibilityChange = () => {
      hiddenRef.current = document.hidden
      if (hiddenRef.current) {
        if (rafRef.current != null) {
          window.cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        if (timerRef.current != null) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }
        return
      }
      if (rafRef.current == null && timerRef.current == null) {
        rafRef.current = window.requestAnimationFrame(draw)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    hiddenRef.current = document.hidden
    if (!hiddenRef.current) {
      rafRef.current = window.requestAnimationFrame(draw)
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [state.status])

  return (
    <div className="absolute inset-0">
      {/* Video render target (optional) */}
      {state.render_mode === 'video' ? (
        <video
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
          autoPlay
          loop
          src={videoUrl || undefined}
        />
      ) : null}

      {/* Canvas render target (default) */}
      {state.render_mode === 'canvas' ? (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      ) : null}

      {/* Placeholder render target */}
      {state.render_mode === 'placeholder' ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3">
            <div className="text-sm font-bold text-nofx-text-main">
              {trader.trader_name}
            </div>
            <div className="text-[11px] font-mono text-nofx-text-muted">
              {language === 'zh'
                ? '数字人占位（未启用）'
                : 'Digital person placeholder (disabled)'}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DecisionHero({
  decision,
  streamPacket,
  language,
}: {
  decision: DecisionRecord | null
  streamPacket?: RoomStreamPacket
  language: Language
}) {
  const head = decision?.decisions?.[0] || null
  const tone = actionTone(head?.action)

  const symbol = String(
    head?.symbol || streamPacket?.room_context?.symbol_brief?.symbol || '--'
  )
  const qty = Number.isFinite(Number(head?.quantity))
    ? Number(head?.quantity)
    : null
  const lev = Number.isFinite(Number(head?.leverage))
    ? Number(head?.leverage)
    : null
  const px = Number.isFinite(Number(head?.price)) ? Number(head?.price) : null
  const sl = Number.isFinite(Number(head?.stop_loss))
    ? Number(head?.stop_loss)
    : null
  const tp = Number.isFinite(Number(head?.take_profit))
    ? Number(head?.take_profit)
    : null
  const conf = Number.isFinite(Number(head?.confidence))
    ? Number(head?.confidence)
    : null

  const reasoningPrimary = safeText(head?.reasoning || '')
  const steps = Array.isArray(decision?.reasoning_steps_cn)
    ? decision!.reasoning_steps_cn.map((s) => safeText(s, 140)).filter(Boolean)
    : []
  const bullets = steps.length
    ? steps.slice(0, 3)
    : reasoningPrimary
      ? []
      : compactReasoning(decision)
          .split('/')
          .map((s) => safeText(s, 140))
          .filter(Boolean)
          .slice(0, 3)

  return (
    <div className="rounded-2xl border border-white/10 bg-black/35 p-5 sm:p-6 shadow-[0_30px_90px_rgba(0,0,0,0.35)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-mono text-nofx-text-muted">
            {decision
              ? `cycle ${decision.cycle_number} | ${decision.timestamp}`
              : language === 'zh'
                ? '等待下一轮决策…'
                : 'Waiting for next decision…'}
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <span
              className={`px-3 py-1 rounded-full border text-xs font-bold tracking-wide ${tone.cls}`}
            >
              {tone.label}
            </span>
            <span className="text-2xl sm:text-3xl font-black text-nofx-text-main">
              {symbol}
            </span>
            {conf != null && (
              <span className="text-xs font-mono text-nofx-text-muted">
                conf {conf.toFixed(2)}
              </span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <div className="text-[10px] font-mono text-nofx-text-muted">
                qty
              </div>
              <div className="text-sm font-bold text-nofx-text-main">
                {qty != null ? formatQuantity(qty) : '--'}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <div className="text-[10px] font-mono text-nofx-text-muted">
                leverage
              </div>
              <div className="text-sm font-bold text-nofx-text-main">
                {lev != null ? `${lev}x` : '--'}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <div className="text-[10px] font-mono text-nofx-text-muted">
                price
              </div>
              <div className="text-sm font-bold text-nofx-text-main">
                {px != null ? formatPrice(px) : '--'}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <div className="text-[10px] font-mono text-nofx-text-muted">
                risk
              </div>
              <div className="text-[11px] font-mono text-nofx-text-main">
                {sl != null ? `SL ${formatPrice(sl)}` : 'SL --'}
                <span className="opacity-50"> · </span>
                {tp != null ? `TP ${formatPrice(tp)}` : 'TP --'}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
            <div className="text-[10px] font-mono text-nofx-text-muted">
              AI reasoning
            </div>
            {reasoningPrimary ? (
              <div className="mt-1 text-sm text-nofx-text-main leading-relaxed opacity-95">
                {reasoningPrimary}
              </div>
            ) : null}
            {bullets.length ? (
              <div className="mt-2 space-y-1 text-sm text-nofx-text-main">
                {bullets.map((line, idx) => (
                  <div key={`${idx}-${line}`} className="opacity-95">
                    · {line}
                  </div>
                ))}
              </div>
            ) : !reasoningPrimary ? (
              <div className="mt-1 text-sm text-nofx-text-muted opacity-70">
                {language === 'zh' ? '暂无解读。' : 'No reasoning yet.'}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function ReactionLayer({
  reactions,
  onDone,
}: {
  reactions: StreamReaction[]
  onDone: (id: string) => void
}) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <AnimatePresence>
        {reactions.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 0, scale: 0.8 }}
            animate={{ opacity: 1, y: -190, scale: 1.08 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{
              duration: item.duration_ms / 1000,
              ease: 'easeOut',
            }}
            style={{
              left: `${item.left_pct}%`,
              bottom: 26,
              fontSize: `${item.size_px}px`,
              filter: 'drop-shadow(0 8px 20px rgba(0,0,0,0.35))',
            }}
            className="absolute select-none"
            onAnimationComplete={() => onDone(item.id)}
          >
            {item.emoji}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function LowerThirdTicker({
  decision,
  language,
}: {
  decision: DecisionRecord | null
  language: Language
}) {
  const head = decision?.decisions?.[0] || null
  const tone = actionTone(head?.action)
  const symbol = String(head?.symbol || '--')
  const conf = Number.isFinite(Number(head?.confidence))
    ? Number(head?.confidence)
    : null
  const reasoning = safeText(head?.reasoning || compactReasoning(decision), 110)
  const key = `${decision?.timestamp || '--'}:${decision?.cycle_number || 0}:${head?.action || '--'}:${symbol}`

  return (
    <div
      className="pointer-events-none absolute left-3 right-3 z-20"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          className="rounded-2xl border border-white/20 bg-black/60 backdrop-blur-sm px-3 py-2"
        >
          <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono">
            <span className={`px-2 py-0.5 rounded-full border ${tone.cls}`}>
              {tone.label}
            </span>
            <span className="text-nofx-text-main font-bold">{symbol}</span>
            {conf != null && (
              <span className="text-nofx-text-muted">{`conf ${conf.toFixed(2)}`}</span>
            )}
            <span className="text-nofx-text-muted opacity-70">
              {decision ? formatTime(new Date(decision.timestamp).getTime()) : '--'}
            </span>
          </div>
          <div className="mt-1 text-xs text-nofx-text-main opacity-95 truncate">
            {reasoning || (language === 'zh' ? '等待新解说...' : 'Waiting for next narration...')}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function DanmuOverlay({ messages }: { messages: ChatMessage[] }) {
  const MIN_DANMU_SPEED_MS = 11_000
  const MAX_DANMU_SPEED_MS = 18_000
  const BASE_DANMU_SPEED_MS = 12_500

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [items, setItems] = useState<
    Array<{
      id: string
      text: string
      topPx: number
      createdMs: number
      color: string
      speedMs: number
    }>
  >([])
  const seenSetRef = useRef<Set<string>>(new Set())
  const seenQueueRef = useRef<string[]>([])
  const laneNextFreeMsRef = useRef<number[]>([])
  const perSenderLastEmitRef = useRef<Map<string, number>>(new Map())
  const lastGlobalEmitRef = useRef<number>(0)

  const computeLaneTopPx = (laneIdx: number) => {
    const el = containerRef.current
    const height = el?.clientHeight || 320
    const safeTopPad = 14
    const safeBotPad = 18
    const usable = Math.max(120, height - safeTopPad - safeBotPad)
    const laneCount = Math.max(6, Math.min(12, Math.floor(usable / 28)))
    const laneH = usable / laneCount
    const idx = Math.max(0, Math.min(laneIdx, laneCount - 1))
    return safeTopPad + idx * laneH
  }

  const pickLane = (now: number) => {
    const el = containerRef.current
    const height = el?.clientHeight || 320
    const usable = Math.max(120, height - 14 - 18)
    const laneCount = Math.max(6, Math.min(12, Math.floor(usable / 28)))
    const nextFree = laneNextFreeMsRef.current
    while (nextFree.length < laneCount) nextFree.push(0)
    if (nextFree.length > laneCount) nextFree.splice(laneCount)

    let bestIdx = 0
    let bestAt = Number(nextFree[0] || 0)
    for (let i = 1; i < laneCount; i++) {
      const t = Number(nextFree[i] || 0)
      if (t <= now) return i
      if (t < bestAt) {
        bestAt = t
        bestIdx = i
      }
    }
    return bestIdx
  }

  useEffect(() => {
    const now = Date.now()
    const seenSet = seenSetRef.current
    const seenQueue = seenQueueRef.current
    const perSender = perSenderLastEmitRef.current
    const MAX_SEEN_IDS = 500

    const fresh: Array<{
      id: string
      text: string
      topPx: number
      createdMs: number
      color: string
      speedMs: number
    }> = []
    for (const msg of messages.slice(-20)) {
      if (fresh.length >= 2) break
      const id = String(msg?.id || '')
      if (!id || seenSet.has(id)) continue

      const sender = senderLabel(msg)
      const text = safeText(msg?.text || '', 120)
      if (!text) continue

      // Global and per-sender rate limits to keep danmu readable.
      const lastGlobal = Number(lastGlobalEmitRef.current || 0)
      if (now - lastGlobal < 420) continue
      const lastSender = Number(perSender.get(sender) || 0)
      if (now - lastSender < 1500) continue

      const laneIdx = pickLane(now)
      const topPx = computeLaneTopPx(laneIdx)

      const full = `${sender}: ${text}`
      const color =
        msg?.sender_type === 'agent' ? '#F0B90B' : colorForSender(sender)
      const speedMs = Math.min(
        MAX_DANMU_SPEED_MS,
        Math.max(MIN_DANMU_SPEED_MS, BASE_DANMU_SPEED_MS + full.length * 34)
      )

      // Reserve lane until the animation is done.
      const nextFree = laneNextFreeMsRef.current
      nextFree[laneIdx] = now + speedMs * 0.92

      seenSet.add(id)
      seenQueue.push(id)
      while (seenQueue.length > MAX_SEEN_IDS) {
        const removed = seenQueue.shift()
        if (removed) {
          seenSet.delete(removed)
        }
      }

      perSender.set(sender, now)
      lastGlobalEmitRef.current = now
      fresh.push({ id, text: full, topPx, createdMs: now, color, speedMs })
    }

    if (fresh.length) {
      setItems((prev) => [...prev, ...fresh].slice(-14))
    }
  }, [messages])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none overflow-hidden"
    >
      <AnimatePresence>
        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={{ x: '110%', opacity: 0 }}
            animate={{ x: '-120%', opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: item.speedMs / 1000, ease: 'linear' }}
            style={{
              top: item.topPx,
              color: item.color,
              borderColor: `${item.color}55`,
            }}
            className="absolute left-0 whitespace-nowrap rounded-full px-3 py-1 text-sm bg-black/50 border shadow-[0_12px_38px_rgba(0,0,0,0.40)]"
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

function DigitalPersonStage({
  trader,
  mode,
  messages,
  language,
  digitalPerson,
  videoUrl,
}: {
  trader: TraderInfo
  mode: ChatMode
  messages: ChatMessage[]
  language: Language
  digitalPerson: DigitalPersonState
  videoUrl: string
}) {
  return (
    <div className="relative mx-auto w-full max-w-[440px] rounded-[30px] border border-white/12 bg-black/35 overflow-hidden shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
      <div
        className="relative"
        aria-label={`${trader.trader_name} streaming stage`}
        style={{
          background:
            'radial-gradient(1200px 500px at 20% 10%, rgba(240,185,11,0.10) 0%, rgba(0,0,0,0) 55%),' +
            'radial-gradient(900px 420px at 85% 30%, rgba(14,203,129,0.08) 0%, rgba(0,0,0,0) 60%),' +
            'linear-gradient(180deg, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.62) 100%)',
        }}
      >
        <div className="aspect-[9/16]">
          <div className="absolute inset-0">
            <DigitalPersonViewport
              trader={trader}
              state={digitalPerson}
              videoUrl={videoUrl}
              language={language}
            />
            <div
              className="absolute inset-0 opacity-22"
              style={{
                backgroundImage:
                  'linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px),' +
                  'linear-gradient(180deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
                backgroundSize: '30px 30px',
              }}
            />
            <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/55 to-transparent" />
          </div>
          {mode === 'danmu' && <DanmuOverlay messages={messages} />}
        </div>
      </div>
    </div>
  )
}

export function StreamingRoomPage({
  selectedTrader,
  streamPacket,
  roomSseState,
  replayRuntimeStatus,
  language,
  immersive = false,
}: {
  selectedTrader: TraderInfo
  streamPacket?: RoomStreamPacket
  roomSseState?: RoomSseState
  replayRuntimeStatus?: ReplayRuntimeStatus
  language: Language
  immersive?: boolean
}) {
  const [chatMode, setChatMode] = useState<ChatMode>('danmu')
  const roomId = selectedTrader.trader_id
  const [reactions, setReactions] = useState<StreamReaction[]>([])
  const lastDecisionKeyRef = useRef<string>('')
  const lastMessageCountRef = useRef<number>(0)
  const [userSessionId, setUserSessionId] = useState<string>('')
  const [userNickname, setUserNickname] = useState<string>('')
  const [sessionLoading, setSessionLoading] = useState<boolean>(false)
  const [sessionError, setSessionError] = useState<string>('')
  const [betStakeInput, setBetStakeInput] = useState<string>('100')
  const [betTraderId, setBetTraderId] = useState<string>('')
  const [betSubmitting, setBetSubmitting] = useState<boolean>(false)
  const [betError, setBetError] = useState<string>('')
  const [betNotice, setBetNotice] = useState<string>('')
  const [giftSending, setGiftSending] = useState<boolean>(false)
  const [giftError, setGiftError] = useState<string>('')
  const [giftNotice, setGiftNotice] = useState<string>('')

  const streamingParams = useMemo(() => parseStreamingParams(), [])
  const [digitalPerson, setDigitalPerson] = useState<DigitalPersonState>(
    () => ({
      render_mode: streamingParams.renderMode,
      status: 'idle',
      last_speaking_ts_ms: null,
      last_source: null,
    })
  )
  const [pageVisible, setPageVisible] = useState<boolean>(
    typeof document === 'undefined' ? true : !document.hidden
  )
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(
    false
  )
  const [giftCoolingDown, setGiftCoolingDown] = useState<boolean>(false)
  const [betCoolingDown, setBetCoolingDown] = useState<boolean>(false)
  const giftCooldownTimerRef = useRef<number | null>(null)
  const betCooldownTimerRef = useRef<number | null>(null)
  const reactionWindowRef = useRef<number[]>([])

  useEffect(() => {
    const onVisibility = () => {
      setPageVisible(!document.hidden)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setPrefersReducedMotion(Boolean(mq.matches))
    update()
    mq.addEventListener('change', update)
    return () => {
      mq.removeEventListener('change', update)
    }
  }, [])

  const startGiftCooldown = () => {
    if (giftCooldownTimerRef.current != null) {
      window.clearTimeout(giftCooldownTimerRef.current)
    }
    setGiftCoolingDown(true)
    giftCooldownTimerRef.current = window.setTimeout(() => {
      setGiftCoolingDown(false)
      giftCooldownTimerRef.current = null
    }, 1600)
  }

  const startBetCooldown = () => {
    if (betCooldownTimerRef.current != null) {
      window.clearTimeout(betCooldownTimerRef.current)
    }
    setBetCoolingDown(true)
    betCooldownTimerRef.current = window.setTimeout(() => {
      setBetCoolingDown(false)
      betCooldownTimerRef.current = null
    }, 1800)
  }

  useEffect(() => {
    return () => {
      if (giftCooldownTimerRef.current != null) {
        window.clearTimeout(giftCooldownTimerRef.current)
      }
      if (betCooldownTimerRef.current != null) {
        window.clearTimeout(betCooldownTimerRef.current)
      }
    }
  }, [])

  const { data: chatData } = useSWR(
    roomId ? ['room-public-chat', roomId] : null,
    () => api.getRoomPublicMessages(roomId, 80),
    {
      refreshInterval: pageVisible ? 45000 : 90000,
      revalidateOnFocus: false,
    }
  )

  const publicMessages: ChatMessage[] = useMemo(() => {
    const rows = Array.isArray(chatData) ? chatData : []
    return [...rows]
      .sort(
        (a, b) => Number(a?.created_ts_ms || 0) - Number(b?.created_ts_ms || 0)
      )
      .slice(-80)
  }, [chatData])

  const {
    data: betMarket,
    error: betMarketError,
    isLoading: betMarketLoading,
    mutate: mutateBetMarket,
  } = useSWR(
    roomId && userSessionId
      ? ['stream-bets-market', roomId, userSessionId]
      : null,
    () =>
      api.getBetsMarket({
        traderId: roomId,
        userSessionId,
      }),
    {
      refreshInterval: pageVisible ? 12000 : 30000,
      revalidateOnFocus: false,
    }
  )

  useEffect(() => {
    if (userSessionId) return
    let cancelled = false
    setSessionLoading(true)
    setSessionError('')
    api
      .bootstrapChatSession()
      .then((session) => {
        if (cancelled) return
        setUserSessionId(String(session.user_session_id || '').trim())
        setUserNickname(String(session.user_nickname || '').trim())
      })
      .catch((error) => {
        if (cancelled) return
        setSessionError(String(error instanceof Error ? error.message : 'session_init_failed'))
      })
      .finally(() => {
        if (!cancelled) {
          setSessionLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [userSessionId])

  useEffect(() => {
    const candidateIds = Array.isArray(betMarket?.entries)
      ? betMarket.entries.map((row) => String(row.trader_id || '').trim()).filter(Boolean)
      : []
    if (!candidateIds.length) return
    const current = String(betTraderId || '').trim()
    if (!current || !candidateIds.includes(current)) {
      setBetTraderId(candidateIds.includes(roomId) ? roomId : candidateIds[0])
    }
  }, [betMarket?.entries, betTraderId, roomId])

  const { data: creditsData, error: creditsError } = useSWR<ViewerBetCreditsPayload>(
    roomId ? ['bets-credits-stream', roomId] : null,
    () => api.getBetsCredits({ limit: 8 }),
    {
      refreshInterval: pageVisible ? 20000 : 45000,
      revalidateOnFocus: false,
    }
  )

  const supporters = Array.isArray(creditsData?.leaderboard)
    ? creditsData.leaderboard.slice(0, 6)
    : []

  const spawnReactions = (
    count: number,
    source: 'chat' | 'decision' | 'gift'
  ) => {
    const now = Date.now()
    const inWindow = reactionWindowRef.current.filter((ts) => now - ts < 5000)
    const maxBurstWindow = prefersReducedMotion ? 7 : 14
    const remaining = Math.max(0, maxBurstWindow - inWindow.length)
    if (remaining <= 0) {
      reactionWindowRef.current = inWindow
      return
    }

    const sourceMax = source === 'chat' ? 2 : source === 'gift' ? 4 : 3
    const sizeBase = source === 'chat' ? 18 : 21
    const emojiPool =
      source === 'chat'
        ? ['❤️', '👏', '✨']
        : source === 'gift'
          ? ['🎁', '🚀', '💫', '🔥']
          : ['🚀', '🔥', '📈', '⚡']
    const safeCount = Math.max(
      1,
      Math.min(Math.floor(count), sourceMax, remaining)
    )
    const batch: StreamReaction[] = []
    for (let i = 0; i < safeCount; i++) {
      const emoji = emojiPool[Math.floor(Math.random() * emojiPool.length)]
      batch.push({
        id: `${now}-${source}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        emoji,
        left_pct: 58 + Math.random() * 35,
        size_px: sizeBase + Math.floor(Math.random() * 6),
        duration_ms:
          source === 'decision'
            ? 1600 + Math.floor(Math.random() * 700)
            : 1300 + Math.floor(Math.random() * 500),
      })
      inWindow.push(now)
    }

    reactionWindowRef.current = inWindow
    setReactions((prev) => [...prev, ...batch].slice(-16))
  }

  const placeBet = async () => {
    if (!userSessionId || !userNickname) {
      setBetError(language === 'zh' ? '会话未初始化。' : 'Session is not ready.')
      return
    }

    const traderId = String(betTraderId || roomId).trim()
    const stakeAmount = Number(betStakeInput)
    if (!traderId) {
      setBetError(language === 'zh' ? '请选择下注对象。' : 'Select a trader.')
      return
    }
    if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) {
      setBetError(language === 'zh' ? '请输入有效金额。' : 'Enter a valid stake.')
      return
    }

    setBetSubmitting(true)
    startBetCooldown()
    setBetError('')
    setBetNotice('')
    try {
      await api.placeViewerBet({
        user_session_id: userSessionId,
        user_nickname: userNickname,
        trader_id: traderId,
        stake_amount: Math.round(stakeAmount),
      })
      await mutateBetMarket()
      setBetNotice(
        language === 'zh'
          ? `下注成功：${Math.round(stakeAmount)} 积分。`
          : `Bet placed: ${Math.round(stakeAmount)} points.`
      )
      spawnReactions(2, 'gift')
    } catch (error) {
      setBetError(String(error instanceof Error ? error.message : 'bet_place_failed'))
    } finally {
      setBetSubmitting(false)
    }
  }

  const sendSupportGift = async (kind: 'gift' | 'rocket') => {
    if (!userSessionId || !userNickname) {
      setGiftError(language === 'zh' ? '会话未初始化。' : 'Session is not ready.')
      return
    }

    const text = kind === 'rocket'
      ? `🚀 ${userNickname} sent a rocket!`
      : `🎁 ${userNickname} sent a gift!`

    setGiftSending(true)
    startGiftCooldown()
    setGiftError('')
    setGiftNotice('')
    spawnReactions(kind === 'rocket' ? 3 : 2, 'gift')
    try {
      await api.postRoomMessage(roomId, {
        user_session_id: userSessionId,
        user_nickname: userNickname,
        visibility: 'public',
        message_type: 'public_plain',
        text,
      })
      setGiftNotice(kind === 'rocket'
        ? (language === 'zh' ? '火箭已发射。' : 'Rocket sent.')
        : (language === 'zh' ? '礼物已送达。' : 'Gift sent.'))
    } catch (error) {
      setGiftError(String(error instanceof Error ? error.message : 'gift_send_failed'))
    } finally {
      setGiftSending(false)
    }
  }

  // Auto speaking detection: if a fresh agent message arrives, mark speaking for a short window.
  useEffect(() => {
    const lastAgent = [...publicMessages]
      .reverse()
      .find((m) => m?.sender_type === 'agent' && String(m?.text || '').trim())
    const ts = Number(lastAgent?.created_ts_ms || 0)
    if (!Number.isFinite(ts) || ts <= 0) return

    setDigitalPerson((prev) => {
      if ((prev.last_speaking_ts_ms || 0) >= ts) return prev
      return {
        ...prev,
        status: 'speaking',
        last_speaking_ts_ms: ts,
        last_source: 'agent_message',
      }
    })

    const timer = window.setTimeout(() => {
      setDigitalPerson((prev) => {
        if (prev.status !== 'speaking') return prev
        return { ...prev, status: 'idle' }
      })
    }, 4200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [publicMessages])

  useEffect(() => {
    const currentCount = publicMessages.length
    const prev = lastMessageCountRef.current
    lastMessageCountRef.current = currentCount
    const delta = Math.max(0, currentCount - prev)
    if (delta <= 0) return
    const burst = delta >= 4 ? 3 : delta >= 2 ? 2 : 1
    spawnReactions(burst, 'chat')
  }, [publicMessages])

  useEffect(() => {
    const sseStatus = roomSseState?.status
    if (!sseStatus) return
    setDigitalPerson((prev) => {
      if (sseStatus === 'error') return { ...prev, status: 'offline' }
      if (
        prev.status === 'offline' &&
        (sseStatus === 'connected' ||
          sseStatus === 'reconnecting' ||
          sseStatus === 'connecting')
      ) {
        return { ...prev, status: 'idle' }
      }
      return prev
    })
  }, [roomSseState?.status])

  const decision: DecisionRecord | null = useMemo(() => {
    const fromPacket = streamPacket?.decision_latest || null
    if (fromPacket) return fromPacket
    const latest = Array.isArray(streamPacket?.decisions_latest)
      ? streamPacket.decisions_latest
      : []
    return latest[0] || null
  }, [streamPacket])

  const decisionKey = useMemo(() => {
    const head = decision?.decisions?.[0]
    return `${decision?.timestamp || ''}:${decision?.cycle_number || 0}:${head?.action || ''}:${head?.symbol || ''}`
  }, [decision])

  useEffect(() => {
    if (!decisionKey) return
    if (!lastDecisionKeyRef.current) {
      lastDecisionKeyRef.current = decisionKey
      return
    }
    if (lastDecisionKeyRef.current === decisionKey) return
    lastDecisionKeyRef.current = decisionKey
    spawnReactions(3, 'decision')
  }, [decisionKey])

  const fuel = useMemo(() => {
    const readiness =
      streamPacket?.room_context?.data_readiness ||
      streamPacket?.decision_meta?.data_readiness ||
      null
    const level = String(readiness?.level || '').toUpperCase() || 'OK'
    const reasons = Array.isArray(readiness?.reasons)
      ? readiness.reasons.map((r: unknown) => String(r || '')).filter(Boolean)
      : []
    const overviewBrief = String(
      streamPacket?.market_overview?.brief ||
        streamPacket?.room_context?.market_overview_brief ||
        ''
    ).trim()
    const newsTitles = Array.isArray(streamPacket?.news_digest?.titles)
      ? streamPacket.news_digest.titles
      : Array.isArray(streamPacket?.room_context?.news_digest_titles)
        ? streamPacket.room_context.news_digest_titles
        : []

    return {
      level,
      reasons,
      overviewBrief,
      newsTitles: Array.isArray(newsTitles)
        ? newsTitles.map((title) => String(title || ''))
        : [],
    }
  }, [streamPacket])

  const account = streamPacket?.account || null
  const positions: Position[] = Array.isArray(streamPacket?.positions)
    ? streamPacket.positions
    : []
  const featuredPos = useMemo(() => topPosition(positions), [positions])

  const sseStatus = roomSseState?.status || 'connecting'
  const sseCls =
    sseStatus === 'connected'
      ? 'bg-nofx-green/10 text-nofx-green border-nofx-green/25'
      : sseStatus === 'reconnecting'
        ? 'bg-nofx-gold/10 text-nofx-gold border-nofx-gold/25'
        : sseStatus === 'error'
          ? 'bg-nofx-red/10 text-nofx-red border-nofx-red/25'
          : 'bg-white/5 text-nofx-text-muted border-white/10'

  const replayMode = String((replayRuntimeStatus as any)?.data_mode || '')
    .trim()
    .toLowerCase()
  const modeChip = replayMode === 'live_file'
    ? {
      label: 'LIVE',
      cls: 'bg-nofx-red text-white shadow-[0_10px_30px_rgba(246,70,93,0.35)]',
    }
    : replayMode === 'replay'
      ? {
        label: 'REPLAY',
        cls: 'bg-nofx-gold text-black shadow-[0_10px_30px_rgba(240,185,11,0.30)]',
      }
      : {
        label: 'STREAM',
        cls: 'bg-white/80 text-black',
      }

  const barProgress = Number.isFinite(Number(replayRuntimeStatus?.day_bar_index))
    && Number.isFinite(Number(replayRuntimeStatus?.day_bar_count))
    ? `${Number(replayRuntimeStatus?.day_bar_index)}/${Number(replayRuntimeStatus?.day_bar_count)}`
    : '--/--'

  const overviewFreshness = freshnessBadge(
    typeof streamPacket?.market_overview?.status?.stale === 'boolean'
      ? streamPacket.market_overview.status.stale
      : null
  )
  const digestFreshness = freshnessBadge(
    typeof streamPacket?.news_digest?.status?.stale === 'boolean'
      ? streamPacket.news_digest.status.stale
      : null
  )

  const recentChatPerMinute = useMemo(() => {
    if (!publicMessages.length) return 0
    const latestTs = Math.max(
      ...publicMessages.map((m) => Number(m.created_ts_ms || 0)).filter((n) => Number.isFinite(n))
    )
    const floorTs = latestTs - 60_000
    return publicMessages.filter((m) => Number(m.created_ts_ms || 0) >= floorTs).length
  }, [publicMessages])

  const myCreditPoints = Math.max(
    0,
    Math.floor(
      Number(
        betMarket?.my_credits?.credit_points ?? creditsData?.my_credits?.credit_points ?? 0
      )
    )
  )
  const mySettledCount = Math.max(
    0,
    Math.floor(
      Number(
        betMarket?.my_credits?.settled_bets ??
          creditsData?.my_credits?.settled_bets ??
          0
      )
    )
  )
  const myWinCount = Math.max(
    0,
    Math.floor(
      Number(
        betMarket?.my_credits?.win_count ?? creditsData?.my_credits?.win_count ?? 0
      )
    )
  )
  const myBet = betMarket?.my_bet || null
  const betSettlement = betMarket?.settlement || null
  const betDisabled =
    !betMarket?.betting_open ||
    betSubmitting ||
    !userSessionId ||
    sessionLoading ||
    betCoolingDown
  const giftDisabled =
    giftSending || !userSessionId || sessionLoading || giftCoolingDown
  const decisionReasoning = safeText(
    decision?.decisions?.[0]?.reasoning || compactReasoning(decision),
    110
  )
  const myBetTraderName = String(
    (betMarket?.entries || []).find((entry) => entry.trader_id === myBet?.trader_id)
      ?.trader_name ||
      myBet?.trader_id ||
      '--'
  )
  const settlementWinnerNames =
    Array.isArray(betSettlement?.winning_trader_ids) && betSettlement.winning_trader_ids.length
      ? betSettlement.winning_trader_ids.map((id) => {
          const hit = (betMarket?.entries || []).find((entry) => entry.trader_id === id)
          return hit?.trader_name || id
        })
      : []

  return (
    <div
      className={`relative ${immersive ? 'min-h-screen' : 'min-h-[calc(100vh-64px)]'}`}
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)',
      }}
    >
      <DeepVoidBackground />

      <div className="relative z-10 px-3 sm:px-4">
        <div className="mx-auto max-w-[1700px]">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="nofx-glass border border-white/10 rounded-2xl overflow-hidden">
              <div className="relative px-2 pt-2 sm:px-4 sm:pt-4">
                <div className="relative">
                  <DigitalPersonStage
                    trader={selectedTrader}
                    mode={chatMode}
                    messages={publicMessages}
                    language={language}
                    digitalPerson={digitalPerson}
                    videoUrl={streamingParams.videoUrl}
                  />

                  <div className="pointer-events-none absolute left-3 right-3 top-3 z-20 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`px-2.5 py-1 text-[10px] font-black rounded-full ${modeChip.cls}`}
                      >
                        {modeChip.label}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${overviewFreshness.cls}`}
                      >
                        {language === 'zh' ? '概览' : 'overview'} {overviewFreshness.label}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${digestFreshness.cls}`}
                      >
                        {language === 'zh' ? '新闻' : 'news'} {digestFreshness.label}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-1 text-[10px] font-mono">
                      <span className={`px-2 py-0.5 rounded-full border ${sseCls}`}>
                        SSE {sseStatus}
                      </span>
                      <span className="px-2 py-0.5 rounded-full border border-white/10 bg-black/40 text-nofx-text-muted">
                        bar {barProgress}
                      </span>
                    </div>
                  </div>

                  <div className="absolute left-3 top-14 z-30">
                    <div className="inline-flex rounded-full border border-white/12 bg-black/35 p-1 backdrop-blur-sm">
                      <button
                        type="button"
                        onClick={() => setChatMode('danmu')}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${chatMode === 'danmu' ? 'bg-nofx-gold text-black' : 'text-nofx-text-muted hover:text-nofx-text-main'}`}
                      >
                        Danmu
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatMode('window')}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${chatMode === 'window' ? 'bg-nofx-gold text-black' : 'text-nofx-text-muted hover:text-nofx-text-main'}`}
                      >
                        Chat
                      </button>
                    </div>
                  </div>

                  <div className="absolute right-3 top-14 z-30">
                    <RoomClockBadge
                      replayRuntimeStatus={replayRuntimeStatus}
                      language={language}
                    />
                  </div>

                  <div
                    className="absolute right-3 z-30 flex flex-col gap-2 xl:hidden"
                    style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }}
                  >
                    <button
                      type="button"
                      onClick={() => sendSupportGift('gift')}
                      disabled={giftDisabled}
                      className="h-11 w-11 rounded-full border border-white/20 bg-black/45 text-base text-nofx-text-main disabled:opacity-45 disabled:cursor-not-allowed"
                      title={language === 'zh' ? '送礼' : 'Send gift'}
                    >
                      🎁
                    </button>
                    <button
                      type="button"
                      onClick={() => sendSupportGift('rocket')}
                      disabled={giftDisabled}
                      className="h-11 w-11 rounded-full border border-nofx-gold/45 bg-nofx-gold/18 text-base text-nofx-gold disabled:opacity-45 disabled:cursor-not-allowed"
                      title={language === 'zh' ? '发射火箭' : 'Send rocket'}
                    >
                      🚀
                    </button>
                  </div>

                  <ReactionLayer
                    reactions={reactions}
                    onDone={(id) => {
                      setReactions((prev) =>
                        prev.filter((item) => item.id !== id)
                      )
                    }}
                  />
                  <LowerThirdTicker decision={decision} language={language} />
                </div>
              </div>

              <div className="px-2 pb-3 pt-3 sm:px-4 sm:pb-4 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                    <div className="text-[10px] font-mono text-nofx-text-muted">
                      {language === 'zh' ? '净值' : 'equity'}
                    </div>
                    <div className="text-sm font-bold text-nofx-text-main">
                      {account ? formatPrice(account.total_equity) : '--'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                    <div className="text-[10px] font-mono text-nofx-text-muted">
                      {language === 'zh' ? '浮动盈亏' : 'unreal pnl'}
                    </div>
                    <div
                      className={`text-sm font-bold ${Number(account?.unrealized_profit || 0) >= 0 ? 'text-nofx-green' : 'text-nofx-red'}`}
                    >
                      {account ? formatPrice(account.unrealized_profit) : '--'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                    <div className="text-[10px] font-mono text-nofx-text-muted">
                      {language === 'zh' ? '持仓数' : 'positions'}
                    </div>
                    <div className="text-sm font-bold text-nofx-text-main">
                      {account ? String(account.position_count) : String(positions.length)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                    <div className="text-[10px] font-mono text-nofx-text-muted">
                      {language === 'zh' ? '保证金' : 'margin'}
                    </div>
                    <div className="text-sm font-bold text-nofx-text-main">
                      {account ? `${Number(account.margin_used_pct || 0).toFixed(1)}%` : '--'}
                    </div>
                  </div>
                </div>

                {featuredPos && (
                  <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[10px] font-mono text-nofx-text-muted">
                          {language === 'zh'
                            ? '重点仓位（波动最大）'
                            : 'Featured position (largest swing)'}
                        </div>
                        <div className="text-sm font-bold text-nofx-text-main truncate">
                          {featuredPos.symbol} · {String(featuredPos.side || '').toUpperCase()} ·{' '}
                          {formatQuantity(featuredPos.quantity)}
                        </div>
                      </div>
                      <div
                        className={`text-sm font-bold ${Number(featuredPos.unrealized_pnl || 0) >= 0 ? 'text-nofx-green' : 'text-nofx-red'}`}
                      >
                        {formatPrice(featuredPos.unrealized_pnl)}
                      </div>
                    </div>
                  </div>
                )}

                <div className="md:hidden rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="text-nofx-gold font-bold uppercase">
                      {decision?.decisions?.[0]?.action || '--'}
                    </span>
                    <span className="text-nofx-text-main font-semibold">
                      {decision?.decisions?.[0]?.symbol || '--'}
                    </span>
                    {decision?.decisions?.[0]?.confidence != null && (
                      <span className="text-nofx-text-muted">
                        conf {Number(decision.decisions[0].confidence).toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-nofx-text-main opacity-90">
                    {decisionReasoning ||
                      (language === 'zh'
                        ? '等待下一条决策说明...'
                        : 'Waiting for next decision narrative...')}
                  </div>
                </div>

                <div className="hidden md:block">
                  <DecisionHero
                    decision={decision}
                    streamPacket={streamPacket}
                    language={language}
                  />
                </div>

                <div className="hidden lg:grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-mono text-nofx-text-muted">
                        {language === 'zh' ? '市场概览' : 'market overview'}
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${overviewFreshness.cls}`}>
                        {overviewFreshness.label}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-nofx-text-main leading-relaxed opacity-95">
                      {fuel.overviewBrief ||
                        (language === 'zh' ? '暂无概览。' : 'No overview yet.')}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-mono text-nofx-text-muted">
                        {language === 'zh' ? '新闻摘要' : 'headlines'}
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${digestFreshness.cls}`}>
                        {digestFreshness.label}
                      </span>
                    </div>
                    {fuel.newsTitles.length ? (
                      <div className="mt-2 space-y-1 text-sm text-nofx-text-main">
                        {fuel.newsTitles.slice(0, 4).map((title, idx) => (
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

                {chatMode === 'window' && (
                  <div className="rounded-2xl border border-white/10 bg-black/25 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                      <div className="text-[11px] font-mono text-nofx-text-muted">
                        {language === 'zh'
                          ? '公开聊天（仅展示，文本输入关闭）'
                          : 'public chat (display only, text input disabled)'}
                      </div>
                      <div className="text-[11px] text-nofx-text-muted">
                        {publicMessages.length}
                      </div>
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

            <div className="space-y-3">
              <div className="nofx-glass border border-white/10 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/5 bg-black/25 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <TraderAvatar
                      traderId={selectedTrader.trader_id}
                      traderName={selectedTrader.trader_name}
                      avatarUrl={selectedTrader.avatar_url}
                      avatarHdUrl={selectedTrader.avatar_hd_url}
                      size={34}
                      className="rounded-xl border border-white/12"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-nofx-text-main truncate">
                        {language === 'zh' ? '互动支持' : 'Interactive Support'}
                      </div>
                      <div className="text-[11px] font-mono text-nofx-text-muted">
                        {userNickname
                          ? `${userNickname} · ${userSessionId.slice(0, 8)}`
                          : language === 'zh'
                            ? '会话初始化中'
                            : 'session bootstrapping'}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-mono text-nofx-text-muted">
                      {language === 'zh' ? '我的积分' : 'my points'}
                    </div>
                    <div className="text-sm font-bold text-nofx-gold">
                      {myCreditPoints} pts
                    </div>
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => sendSupportGift('gift')}
                      disabled={giftDisabled}
                      className="px-3 py-2 rounded-xl text-sm font-semibold border border-white/15 bg-black/30 text-nofx-text-main disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      {giftSending
                        ? language === 'zh'
                          ? '发送中...'
                          : 'Sending...'
                        : language === 'zh'
                          ? '送礼 🎁'
                          : 'Gift 🎁'}
                    </button>
                    <button
                      type="button"
                      onClick={() => sendSupportGift('rocket')}
                      disabled={giftDisabled}
                      className="px-3 py-2 rounded-xl text-sm font-semibold border border-nofx-gold/35 bg-nofx-gold/10 text-nofx-gold disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      {giftSending
                        ? language === 'zh'
                          ? '发送中...'
                          : 'Sending...'
                        : language === 'zh'
                          ? '火箭 🚀'
                          : 'Rocket 🚀'}
                    </button>
                  </div>

                  {giftCoolingDown && !giftSending && (
                    <div className="text-[11px] text-nofx-text-muted">
                      {language === 'zh'
                        ? '礼物按钮冷却中，防止重复提交。'
                        : 'Gift actions cooling down to prevent multi-submit.'}
                    </div>
                  )}
                  {giftNotice && <div className="text-xs text-nofx-green">{giftNotice}</div>}
                  {giftError && <div className="text-xs text-nofx-red">{giftError}</div>}

                  <div className="pt-2 border-t border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold text-nofx-text-main">
                        {language === 'zh' ? '直播内竞猜' : 'In-stream betting'}
                      </div>
                      <div
                        className={`text-[11px] px-2 py-0.5 rounded border font-mono ${betMarket?.betting_open ? 'border-nofx-green/35 text-nofx-green bg-nofx-green/10' : 'border-nofx-red/35 text-nofx-red bg-nofx-red/10'}`}
                      >
                        {betMarket?.betting_open
                          ? language === 'zh'
                            ? '开放'
                            : 'OPEN'
                          : language === 'zh'
                            ? '关闭'
                            : 'CLOSED'}
                      </div>
                    </div>

                    <div className="text-[11px] font-mono text-nofx-text-muted mb-2 flex flex-wrap gap-x-2 gap-y-1">
                      <span>{`day=${betMarket?.day_key || '--'}`}</span>
                      <span>{`cutoff=${formatMinuteLabel(betMarket?.cutoff_minute)}`}</span>
                      <span>{`pool=${formatPrice(Number(betMarket?.totals?.stake_amount || 0))}`}</span>
                      <span>{`my=${myCreditPoints} pts`}</span>
                    </div>

                    {sessionLoading && (
                      <div className="text-xs text-nofx-text-muted mb-2">
                        {language === 'zh' ? '初始化会话中...' : 'Initializing session...'}
                      </div>
                    )}
                    {!sessionLoading && !sessionError && userSessionId && (
                      <div className="text-xs text-nofx-green mb-2">
                        {language === 'zh' ? '会话已就绪。' : 'Session ready.'}
                      </div>
                    )}
                    {sessionError && (
                      <div className="text-xs text-nofx-red mb-2">{sessionError}</div>
                    )}
                    {betMarketLoading && (
                      <div className="text-xs text-nofx-text-muted mb-2">
                        {language === 'zh' ? '加载盘口中...' : 'Loading market...'}
                      </div>
                    )}
                    {(betMarketError || betError) && (
                      <div className="text-xs text-nofx-red mb-2">
                        {String(
                          betError ||
                            (betMarketError as { message?: string } | undefined)?.message ||
                            'bet_market_error'
                        )}
                      </div>
                    )}
                    {betNotice && <div className="text-xs text-nofx-green mb-2">{betNotice}</div>}

                    <div className="grid grid-cols-[1fr_92px] gap-2 mb-2">
                      <select
                        value={betTraderId}
                        onChange={(e) => setBetTraderId(String(e.target.value || ''))}
                        className="px-3 py-2 rounded bg-black/35 border border-white/10 text-sm text-nofx-text-main"
                      >
                        {(betMarket?.entries || []).map((entry) => (
                          <option key={entry.trader_id} value={entry.trader_id}>
                            {entry.trader_name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        max={100000}
                        step={1}
                        value={betStakeInput}
                        onChange={(e) => setBetStakeInput(String(e.target.value || ''))}
                        className="px-3 py-2 rounded bg-black/35 border border-white/10 text-sm text-nofx-text-main"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={placeBet}
                      disabled={betDisabled}
                      className="w-full px-3 py-2 rounded-xl text-sm font-semibold bg-nofx-gold text-black disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      {betSubmitting
                        ? language === 'zh'
                          ? '提交中...'
                          : 'Placing...'
                        : language === 'zh'
                          ? '下注'
                          : 'Place Bet'}
                    </button>

                    {betCoolingDown && !betSubmitting && (
                      <div className="mt-2 text-[11px] text-nofx-text-muted">
                        {language === 'zh'
                          ? '下注按钮冷却中，避免重复提交。'
                          : 'Bet action cooling down to avoid accidental multi-submit.'}
                      </div>
                    )}

                    {myBet && (
                      <div className="mt-2 text-[11px] text-nofx-text-muted">
                        {language === 'zh'
                          ? `当前下注：${myBetTraderName} · ${formatPrice(Number(myBet.stake_amount || 0))}`
                          : `Current bet: ${myBetTraderName} · ${formatPrice(Number(myBet.stake_amount || 0))}`}
                        {myBet.settlement_status === 'settled' && (
                          <span>
                            {myBet.settled_is_winner
                              ? language === 'zh'
                                ? ` · 已结算 +${Math.max(0, Math.floor(Number(myBet.settled_credit_points || 0)))} pts`
                                : ` · settled +${Math.max(0, Math.floor(Number(myBet.settled_credit_points || 0)))} pts`
                              : language === 'zh'
                                ? ' · 已结算 未中奖'
                                : ' · settled lost'}
                          </span>
                        )}
                      </div>
                    )}

                    {betSettlement?.settled_ts_ms && (
                      <div className="mt-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-nofx-text-muted">
                        <div className="font-semibold text-nofx-text-main">
                          {language === 'zh' ? '当日结算' : 'Day settlement'}
                        </div>
                        <div className="mt-1">
                          {language === 'zh'
                            ? `胜出交易员：${settlementWinnerNames.join(' / ') || '--'}`
                            : `Winners: ${settlementWinnerNames.join(' / ') || '--'}`}
                        </div>
                        {betSettlement.winning_return_pct != null && (
                          <div>
                            {language === 'zh'
                              ? `胜出收益率：${Number(betSettlement.winning_return_pct).toFixed(2)}%`
                              : `Winning return: ${Number(betSettlement.winning_return_pct).toFixed(2)}%`}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-nofx-text-muted">
                    {language === 'zh'
                      ? '当前页面已启用互动下注 + 礼物（礼物/火箭）；文本聊天输入关闭，仅显示消息。'
                      : 'Interactive betting + gifts (gift/rocket) are enabled; free-text public chat input is disabled (display only).'}
                  </div>
                </div>
              </div>

              <div className="nofx-glass border border-white/10 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/5 bg-black/25 flex items-center justify-between gap-2">
                  <div className="text-sm font-bold text-nofx-text-main">
                    {language === 'zh' ? 'Top Supporters（支持榜）' : 'Top Supporters'}
                  </div>
                  <div className="text-[11px] font-mono text-nofx-text-muted">
                    {`chat/min ${recentChatPerMinute}`}
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[11px] font-mono text-nofx-text-muted">
                    {language === 'zh'
                      ? `我：${myCreditPoints} pts · ${myWinCount} 胜 · ${mySettledCount} 已结算`
                      : `me: ${myCreditPoints} pts · ${myWinCount} wins · ${mySettledCount} settled`}
                  </div>
                  {creditsError ? (
                    <div className="text-xs text-nofx-red">
                      {language === 'zh' ? '积分榜暂不可用' : 'credits unavailable'}
                    </div>
                  ) : supporters.length === 0 ? (
                    <div className="text-xs text-nofx-text-muted opacity-80">
                      {language === 'zh'
                        ? '暂无支持积分数据'
                        : 'No supporter points yet'}
                    </div>
                  ) : (
                    supporters.map((row, idx) => (
                      <div
                        key={row.user_session_id}
                        className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-nofx-text-main truncate">
                            {`${idx + 1}. ${row.user_nickname || row.user_session_id}`}
                          </div>
                          <div className="text-[11px] font-mono text-nofx-text-muted">
                            {language === 'zh'
                              ? `${row.win_count} 胜 · ${row.settled_bets} 已结算`
                              : `${row.win_count} wins · ${row.settled_bets} settled`}
                          </div>
                        </div>
                        <div className="text-sm font-bold text-nofx-gold">
                          {`${Math.max(0, Math.floor(Number(row.credit_points || 0)))} pts`}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="nofx-glass border border-white/10 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/5 bg-black/25">
                  <div className="text-sm font-bold text-nofx-text-main">
                    {language === 'zh' ? '公开聊天（仅展示）' : 'Public Chat (Display only)'}
                  </div>
                  <div className="text-[11px] font-mono text-nofx-text-muted">
                    {language === 'zh'
                      ? '文本输入关闭'
                      : 'text input disabled'}
                  </div>
                </div>
                <div className="p-4 space-y-2 max-h-[520px] overflow-y-auto">
                  {publicMessages.slice(-40).map((m) => (
                    <div
                      key={m.id}
                      className="rounded-xl border border-white/10 bg-black/25 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span
                          className={`font-semibold ${m.sender_type === 'agent' ? 'text-nofx-gold' : 'text-nofx-text-main'}`}
                        >
                          {senderLabel(m)}
                        </span>
                        <span className="font-mono text-nofx-text-muted opacity-70">
                          {formatTime(m.created_ts_ms)}
                        </span>
                      </div>
                      <div className="text-sm text-nofx-text-main mt-1 break-words opacity-95">
                        {m.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
