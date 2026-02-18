import { useEffect, useMemo, useRef, useState } from 'react'

import type { Language } from '../i18n/translations'
import type { ReplayRuntimeStatus } from '../types'

function formatShanghaiDateTime(tsMs: number) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(tsMs))
  } catch {
    return String(tsMs)
  }
}

type ReplayAnchor = {
  replayTsMs: number
  receivedAtMs: number
  speed: number
  running: boolean
}

export function RoomClockBadge({
  replayRuntimeStatus,
  language,
  className = '',
}: {
  replayRuntimeStatus?: ReplayRuntimeStatus | null
  language: Language
  className?: string
}) {
  const [tickMs, setTickMs] = useState<number>(Date.now())
  const anchorRef = useRef<ReplayAnchor | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTickMs(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const replayTsMs = Number(replayRuntimeStatus?.current_ts_ms)
    if (!Number.isFinite(replayTsMs) || replayTsMs <= 0) {
      anchorRef.current = null
      return
    }

    anchorRef.current = {
      replayTsMs,
      receivedAtMs: Date.now(),
      speed: Math.max(0.1, Number(replayRuntimeStatus?.speed || 1)),
      running: replayRuntimeStatus?.running === true,
    }
  }, [
    replayRuntimeStatus?.current_ts_ms,
    replayRuntimeStatus?.speed,
    replayRuntimeStatus?.running,
  ])

  const mode = String((replayRuntimeStatus as any)?.data_mode || '')
    .trim()
    .toLowerCase()
  const isReplayMode = mode === 'replay'

  const displayedTsMs = useMemo(() => {
    if (!isReplayMode) return tickMs

    const anchor = anchorRef.current
    if (!anchor) {
      const fallbackReplay = Number(replayRuntimeStatus?.current_ts_ms)
      return Number.isFinite(fallbackReplay) && fallbackReplay > 0
        ? fallbackReplay
        : tickMs
    }

    if (!anchor.running) return anchor.replayTsMs

    const elapsedMs = Math.max(0, tickMs - anchor.receivedAtMs)
    return anchor.replayTsMs + elapsedMs * anchor.speed
  }, [isReplayMode, replayRuntimeStatus?.current_ts_ms, tickMs])

  const label = isReplayMode
    ? language === 'zh'
      ? '回放时间'
      : 'Replay Time'
    : language === 'zh'
      ? '北京时间'
      : 'Beijing Time'

  const modePill = isReplayMode
    ? language === 'zh'
      ? 'REPLAY'
      : 'REPLAY'
    : language === 'zh'
      ? 'LIVE'
      : 'LIVE'

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/35 px-3 py-1.5 ${className}`.trim()}
    >
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono ${isReplayMode ? 'bg-nofx-gold/20 text-nofx-gold' : 'bg-nofx-green/20 text-nofx-green'}`}
      >
        {modePill}
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-mono text-nofx-text-muted">{label}</div>
        <div className="text-[12px] font-mono text-nofx-text-main whitespace-nowrap">
          {formatShanghaiDateTime(displayedTsMs)}
        </div>
      </div>
    </div>
  )
}
