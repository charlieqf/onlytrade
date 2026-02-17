import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import useSWR from 'swr'
import { api } from '../lib/api'
import { DeepVoidBackground } from '../components/DeepVoidBackground'
import { TraderAvatar } from '../components/TraderAvatar'
import { formatPrice, formatQuantity } from '../utils/format'
import type {
  ChatMessage,
  DecisionRecord,
  Position,
  RoomStreamPacket,
  TraderInfo,
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

function DanmuOverlay({ messages }: { messages: ChatMessage[] }) {
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
      if (fresh.length >= 3) break
      const id = String(msg?.id || '')
      if (!id || seenSet.has(id)) continue

      const sender = senderLabel(msg)
      const text = safeText(msg?.text || '', 120)
      if (!text) continue

      // Global and per-sender rate limits to keep danmu readable.
      const lastGlobal = Number(lastGlobalEmitRef.current || 0)
      if (now - lastGlobal < 260) continue
      const lastSender = Number(perSender.get(sender) || 0)
      if (now - lastSender < 1200) continue

      const laneIdx = pickLane(now)
      const topPx = computeLaneTopPx(laneIdx)

      const full = `${sender}: ${text}`
      const color =
        msg?.sender_type === 'agent' ? '#F0B90B' : colorForSender(sender)
      const base = 8200
      const speedMs = Math.min(12_000, Math.max(7200, base + full.length * 24))

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
      setItems((prev) => [...prev, ...fresh].slice(-22))
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
    <div className="relative rounded-2xl border border-white/10 bg-black/30 overflow-hidden">
      <div
        className="relative"
        style={{
          background:
            'radial-gradient(1200px 500px at 20% 10%, rgba(240,185,11,0.10) 0%, rgba(0,0,0,0) 55%),' +
            'radial-gradient(900px 420px at 85% 30%, rgba(14,203,129,0.08) 0%, rgba(0,0,0,0) 60%),' +
            'linear-gradient(180deg, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.55) 100%)',
        }}
      >
        <div className="aspect-[9/16] sm:aspect-[16/9]">
          <div className="absolute inset-0">
            <DigitalPersonViewport
              trader={trader}
              state={digitalPerson}
              videoUrl={videoUrl}
              language={language}
            />

            <div
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  'linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px),' +
                  'linear-gradient(180deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
                backgroundSize: '28px 28px',
              }}
            />

            <div className="absolute left-4 top-4 flex items-center gap-2">
              <div className="w-9 h-9 rounded-2xl border border-white/10 bg-black/35 flex items-center justify-center">
                <span className="text-xs font-bold text-nofx-gold">AI</span>
              </div>
              <div>
                <div className="text-sm font-bold text-nofx-text-main">
                  {trader.trader_name}
                </div>
                <div className="text-[11px] font-mono text-nofx-text-muted">
                  {language === 'zh'
                    ? '数字人位（占位）'
                    : 'Digital person slot (placeholder)'}
                </div>
              </div>
            </div>

            <div className="absolute right-4 top-4 flex flex-col gap-2">
              <div className="rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] font-mono text-nofx-text-muted">
                {language === 'zh' ? '摄像头: 关闭' : 'Camera: off'}
              </div>
              <div className="rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] font-mono text-nofx-text-muted">
                {language === 'zh' ? '数字人:' : 'Digital:'}{' '}
                {digitalPerson.status}
              </div>
            </div>

            <div className="absolute left-4 bottom-4 right-4">
              <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3">
                <div className="text-[11px] font-mono text-nofx-text-muted">
                  stage
                </div>
                <div className="mt-1 text-sm text-nofx-text-main opacity-95">
                  {language === 'zh'
                    ? '这里将展示数字人 / 视频画面；弹幕叠加在此区域。'
                    : 'Digital person / video renders here; danmu overlays this region.'}
                </div>
              </div>
            </div>
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
  language,
}: {
  selectedTrader: TraderInfo
  streamPacket?: RoomStreamPacket
  roomSseState?: RoomSseState
  language: Language
}) {
  const [chatMode, setChatMode] = useState<ChatMode>('danmu')
  const roomId = selectedTrader.trader_id

  const streamingParams = useMemo(() => parseStreamingParams(), [])
  const [digitalPerson, setDigitalPerson] = useState<DigitalPersonState>(
    () => ({
      render_mode: streamingParams.renderMode,
      status: 'idle',
      last_speaking_ts_ms: null,
      last_source: null,
    })
  )

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
    return [...rows]
      .sort(
        (a, b) => Number(a?.created_ts_ms || 0) - Number(b?.created_ts_ms || 0)
      )
      .slice(-80)
  }, [chatData])

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
                        <span
                          className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${sseCls}`}
                        >
                          SSE:{sseStatus}
                        </span>
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
                  {/* Digital person / video stage */}
                  <DigitalPersonStage
                    trader={selectedTrader}
                    mode={chatMode}
                    messages={publicMessages}
                    language={language}
                    digitalPerson={digitalPerson}
                    videoUrl={streamingParams.videoUrl}
                  />

                  {/* Decision hero */}
                  <div className="mt-4">
                    <DecisionHero
                      decision={decision}
                      streamPacket={streamPacket}
                      language={language}
                    />
                  </div>

                  {/* Bet summary */}
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                      <div className="text-[10px] font-mono text-nofx-text-muted">
                        equity
                      </div>
                      <div className="text-sm font-bold text-nofx-text-main">
                        {account ? formatPrice(account.total_equity) : '--'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                      <div className="text-[10px] font-mono text-nofx-text-muted">
                        unreal pnl
                      </div>
                      <div
                        className={`text-sm font-bold ${Number(account?.unrealized_profit || 0) >= 0 ? 'text-nofx-green' : 'text-nofx-red'}`}
                      >
                        {account
                          ? formatPrice(account.unrealized_profit)
                          : '--'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                      <div className="text-[10px] font-mono text-nofx-text-muted">
                        positions
                      </div>
                      <div className="text-sm font-bold text-nofx-text-main">
                        {account
                          ? String(account.position_count)
                          : String(positions.length)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                      <div className="text-[10px] font-mono text-nofx-text-muted">
                        margin
                      </div>
                      <div className="text-sm font-bold text-nofx-text-main">
                        {account
                          ? `${Number(account.margin_used_pct || 0).toFixed(1)}%`
                          : '--'}
                      </div>
                    </div>
                  </div>

                  {featuredPos && (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[10px] font-mono text-nofx-text-muted">
                            {language === 'zh'
                              ? '当前下注 (最大波动)'
                              : 'Featured bet (largest swing)'}
                          </div>
                          <div className="text-sm font-bold text-nofx-text-main truncate">
                            {featuredPos.symbol} ·{' '}
                            {String(featuredPos.side || '').toUpperCase()} ·{' '}
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

                  {/* Fuel cards */}
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                      <div className="text-[11px] font-mono text-nofx-text-muted">
                        market overview
                      </div>
                      <div className="mt-2 text-sm text-nofx-text-main leading-relaxed opacity-95">
                        {fuel.overviewBrief ||
                          (language === 'zh'
                            ? '暂无概览。'
                            : 'No overview yet.')}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                      <div className="text-[11px] font-mono text-nofx-text-muted">
                        headlines
                      </div>
                      {fuel.newsTitles.length ? (
                        <div className="mt-2 space-y-1 text-sm text-nofx-text-main">
                          {fuel.newsTitles.slice(0, 4).map((title, idx) => (
                            <div
                              key={`${idx}-${String(title)}`}
                              className="opacity-95"
                            >
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
                        <div className="text-[11px] font-mono text-nofx-text-muted">
                          public chat (read-only)
                        </div>
                        <div className="text-[11px] text-nofx-text-muted">
                          {publicMessages.length}
                        </div>
                      </div>
                      <div className="max-h-[280px] overflow-y-auto px-4 py-3 space-y-2">
                        {publicMessages.slice(-30).map((m) => (
                          <div
                            key={m.id}
                            className="flex items-start justify-between gap-3"
                          >
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
                  <div className="text-sm font-bold text-nofx-text-main">
                    Public Chat
                  </div>
                  <div className="text-[11px] font-mono text-nofx-text-muted">
                    read-only
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

              <div className="nofx-glass border border-white/10 rounded-2xl p-4">
                <div className="text-sm font-bold text-nofx-text-main">
                  Streamer Notes
                </div>
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
