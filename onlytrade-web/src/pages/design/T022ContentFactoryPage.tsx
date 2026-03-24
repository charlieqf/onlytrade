import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../lib/api'
import { useFullscreenLock } from '../../hooks/useFullscreenLock'
import type { FormalStreamDesignPageProps } from './phoneStreamShared'

type SegmentItem = {
  id: string
  title: string
  summary: string
  publishedAt: string
  videoApiUrl: string
  posterApiUrl: string
}

function detectPathBase(): string {
  if (typeof window === 'undefined') return ''
  const pathname = String(window.location.pathname || '')
  if (pathname === '/onlytrade' || pathname.startsWith('/onlytrade/')) return '/onlytrade'
  return ''
}

function cleanText(value: unknown, maxLen: number): string {
  const text = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!text) return ''
  return text.slice(0, Math.max(8, maxLen))
}

function buildAssetUrl(pathBase: string, apiPath: string): string {
  const safe = cleanText(apiPath, 400)
  if (!safe) return ''
  if (!safe.startsWith('/')) return safe
  return pathBase ? `${pathBase}${safe}` : safe
}

function isAutoplayBlockedError(error: unknown): boolean {
  const name = String((error as { name?: unknown } | null)?.name || '')
  const message = String(
    error instanceof Error
      ? error.message
      : (error as { message?: unknown } | null)?.message || ''
  )
  return /NotAllowedError/i.test(name) || /NotAllowedError|play\(\) failed|interact/i.test(message)
}

function normalizeSegment(raw: unknown): SegmentItem | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = cleanText(row.id, 96)
  const title = cleanText(row.title, 220)
  const videoApiUrl = cleanText(row.video_api_url, 320)
  if (!id || !title || !videoApiUrl) return null
  return {
    id,
    title,
    summary: cleanText(row.summary, 800),
    publishedAt: cleanText(row.published_at, 48),
    videoApiUrl,
    posterApiUrl: cleanText(row.poster_api_url, 320),
  }
}

export default function T022ContentFactoryPage(_: FormalStreamDesignPageProps) {
  useFullscreenLock()

  const roomId = 't_022'
  const pathBase = useMemo(() => detectPathBase(), [])
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const [segments, setSegments] = useState<SegmentItem[]>([])
  const [segmentIndex, setSegmentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [videoReady, setVideoReady] = useState(false)
  const [audioUnlockRequired, setAudioUnlockRequired] = useState(false)
  const [, setFailedSegmentIds] = useState<string[]>([])
  const [playbackExhausted, setPlaybackExhausted] = useState(false)
  const segmentIdsKeyRef = useRef('')
  const currentSegment = segments[segmentIndex] || null

  const advanceSegment = useCallback(() => {
    setSegmentIndex((prev) => {
      if (segments.length <= 1) return prev
      return (prev + 1) % segments.length
    })
  }, [segments.length])

  const fetchLive = useCallback(async () => {
    try {
      const payload = await api.getContentFactoryLive({ room_id: roomId })
      const live = payload?.live && typeof payload.live === 'object'
        ? payload.live as Record<string, unknown>
        : {}
      const nextSegments = Array.isArray(live.segments)
        ? live.segments.map((item) => normalizeSegment(item)).filter(Boolean) as SegmentItem[]
        : []
      const nextSegmentIdsKey = nextSegments.map((item) => item.id).join('|')

      if (segmentIdsKeyRef.current !== nextSegmentIdsKey) {
        segmentIdsKeyRef.current = nextSegmentIdsKey
        setFailedSegmentIds([])
        setPlaybackExhausted(false)
      }
      if (nextSegments.length > 0) {
        setSegments((prev) => {
          const currentId = prev[segmentIndex]?.id || ''
          const nextIndex = nextSegments.findIndex((item) => item.id === currentId)
          setSegmentIndex(nextIndex >= 0 ? nextIndex : 0)
          return nextSegments
        })
      } else {
        setSegments([])
        setSegmentIndex(0)
      }
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }, [roomId, segmentIndex])

  useEffect(() => {
    let active = true
    const run = async () => {
      if (!active) return
      await fetchLive()
    }
    void run()
    const timer = window.setInterval(() => {
      void run()
    }, 15000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [fetchLive])

  useEffect(() => {
    setVideoReady(false)
    setAudioUnlockRequired(false)
  }, [currentSegment?.id])

  const tryStartPlayback = useCallback(async () => {
    const video = videoRef.current
    if (!video) return
    try {
      await video.play()
      setAudioUnlockRequired(false)
    } catch (error) {
      if (isAutoplayBlockedError(error)) {
        setAudioUnlockRequired(true)
      }
    }
  }, [])

  const handleVideoReady = useCallback(() => {
    if (!currentSegment) return
    setVideoReady(true)
    setPlaybackExhausted(false)
    setFailedSegmentIds((prev) => prev.filter((id) => id !== currentSegment.id))
    void tryStartPlayback()
  }, [currentSegment, tryStartPlayback])

  const handleVideoError = useCallback(() => {
    if (!currentSegment) return

    setVideoReady(false)
    setFailedSegmentIds((prev) => {
      const nextFailed = prev.includes(currentSegment.id)
        ? prev
        : [...prev, currentSegment.id]
      const nextPlayableIndex = segments.findIndex(
        (segment) => !nextFailed.includes(segment.id)
      )

      if (nextPlayableIndex === -1) {
        setPlaybackExhausted(true)
        return nextFailed
      }

      setPlaybackExhausted(false)
      setSegmentIndex(nextPlayableIndex)
      return nextFailed
    })
  }, [currentSegment, segments])

  const posterUrl = currentSegment ? buildAssetUrl(pathBase, currentSegment.posterApiUrl) : ''
  const videoUrl = currentSegment ? buildAssetUrl(pathBase, currentSegment.videoApiUrl) : ''

  useEffect(() => {
    if (!audioUnlockRequired) return

    const unlock = () => {
      void tryStartPlayback()
    }

    window.addEventListener('pointerdown', unlock)
    window.addEventListener('touchstart', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchstart', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [audioUnlockRequired, tryStartPlayback])

  useEffect(() => {
    if (!videoUrl || playbackExhausted) return
    const timer = window.setTimeout(() => {
      void tryStartPlayback()
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [videoUrl, playbackExhausted, tryStartPlayback])

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-black text-white">
      <div className="absolute inset-0 overflow-hidden bg-black">
        {videoUrl && !playbackExhausted ? (
          <video
            ref={videoRef}
            key={currentSegment?.id || 'empty'}
            src={videoUrl}
            poster={posterUrl || undefined}
            autoPlay
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full bg-black object-contain"
            onLoadedData={handleVideoReady}
            onCanPlay={handleVideoReady}
            onEnded={advanceSegment}
            onError={handleVideoError}
          />
        ) : null}

        {!videoReady && posterUrl ? (
          <img
            src={posterUrl}
            alt={`${currentSegment?.title || '当前内容'} 海报`}
            className="absolute inset-0 h-full w-full bg-black object-contain"
            loading="eager"
          />
        ) : null}

        {!currentSegment && !loading ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/70">
            Waiting for rendered segments...
          </div>
        ) : null}

        {currentSegment && playbackExhausted ? (
          <div
            className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/78"
            data-testid="content-factory-playback-fallback"
          >
            Playback is unavailable for the current segment batch. Waiting for fresh renders...
          </div>
        ) : null}

        {currentSegment && audioUnlockRequired && !playbackExhausted ? (
          <div
            className="absolute inset-x-6 bottom-10 rounded-3xl border border-white/12 bg-black/55 px-5 py-4 text-center text-sm font-medium text-white/92 backdrop-blur"
            data-testid="content-factory-audio-unlock"
          >
            点击页面以开启声音播放
          </div>
        ) : null}
      </div>
    </div>
  )
}
