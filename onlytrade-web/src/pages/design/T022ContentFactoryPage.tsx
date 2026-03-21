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

function getProgramSlugFromUrl(): string {
  if (typeof window === 'undefined') return 'china-bigtech'
  const params = new URLSearchParams(window.location.search)
  return cleanText(params.get('program') || 'china-bigtech', 64).toLowerCase() || 'china-bigtech'
}

export default function T022ContentFactoryPage(_: FormalStreamDesignPageProps) {
  useFullscreenLock()

  const roomId = 't_022'
  const pathBase = useMemo(() => detectPathBase(), [])
  const initialProgramSlug = useMemo(() => getProgramSlugFromUrl(), [])

  const [segments, setSegments] = useState<SegmentItem[]>([])
  const [segmentIndex, setSegmentIndex] = useState(0)
  const [programTitle, setProgramTitle] = useState('')
  const [asOfText, setAsOfText] = useState('')
  const [loading, setLoading] = useState(true)
  const [videoReady, setVideoReady] = useState(false)
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
      const nextProgramTitle = cleanText(live.program_title || initialProgramSlug, 80)
      const nextAsOf = cleanText(live.as_of, 40)
      const nextSegmentIdsKey = nextSegments.map((item) => item.id).join('|')

      setProgramTitle(nextProgramTitle)
      setAsOfText(nextAsOf)
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
  }, [initialProgramSlug, roomId, segmentIndex])

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
  }, [currentSegment?.id])

  const handleVideoReady = useCallback(() => {
    if (!currentSegment) return
    setVideoReady(true)
    setPlaybackExhausted(false)
    setFailedSegmentIds((prev) => prev.filter((id) => id !== currentSegment.id))
  }, [currentSegment])

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

  const title = currentSegment?.title || ''
  const summary = currentSegment?.summary || ''
  const publishedAt = currentSegment?.publishedAt || ''
  const posterUrl = currentSegment ? buildAssetUrl(pathBase, currentSegment.posterApiUrl) : ''
  const videoUrl = currentSegment ? buildAssetUrl(pathBase, currentSegment.videoApiUrl) : ''
  const metaLine = [publishedAt, asOfText].filter(Boolean).join(' · ')

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#05070d] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,122,89,0.20)_0%,rgba(37,65,118,0.16)_28%,rgba(5,7,13,1)_72%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,7,13,0.38)_0%,rgba(5,7,13,0.18)_30%,rgba(5,7,13,0.92)_100%)]" />

      <div className="absolute inset-x-4 top-4 z-20 flex items-start justify-between gap-3">
        <div className="rounded-full border border-[#ff7a59]/45 bg-[#221212]/75 px-3 py-2 text-[10px] uppercase tracking-[0.28em] text-[#ffd5c9] backdrop-blur-md">
          Content Factory
        </div>
      </div>

      <div className="absolute inset-x-3 top-[11vh] bottom-[26vh] z-10 overflow-hidden rounded-[34px] border border-white/12 bg-black/25 shadow-[0_24px_90px_rgba(0,0,0,0.42)] backdrop-blur-[4px]">
        {videoUrl && !playbackExhausted ? (
          <video
            key={currentSegment?.id || 'empty'}
            src={videoUrl}
            poster={posterUrl || undefined}
            autoPlay
            playsInline
            preload="auto"
            className="h-full w-full object-cover"
            onLoadedData={handleVideoReady}
            onCanPlay={handleVideoReady}
            onEnded={advanceSegment}
            onError={handleVideoError}
          />
        ) : null}

        {!videoReady && posterUrl ? (
          <img
            src={posterUrl}
            alt={`${title || '当前内容'} 海报`}
            className="absolute inset-0 h-full w-full object-cover"
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
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(28px,env(safe-area-inset-bottom))] pt-10">
        <div className="relative overflow-hidden rounded-[32px] border border-white/12 bg-[linear-gradient(180deg,rgba(34,16,18,0.76)_0%,rgba(11,12,16,0.92)_100%)] px-5 pb-5 pt-6 shadow-[0_25px_80px_rgba(0,0,0,0.38)] backdrop-blur-[14px]">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-[2px] w-9 bg-[#ff7a59]" />
            <div className="text-[11px] uppercase tracking-[0.34em] text-[#ff7a59]">
              {programTitle || '内容工厂·国内大厂'}
            </div>
          </div>
          <h1 className="max-w-[92%] text-[34px] leading-[0.94] font-black tracking-[-0.04em] text-white drop-shadow-[0_12px_28px_rgba(0,0,0,0.72)] sm:text-[42px]">
            {title || (loading ? 'Loading latest segment...' : 'Waiting for segment...')}
          </h1>
          {summary ? (
            <div className="mt-3 max-w-[92%] text-[13px] leading-[1.45] text-white/80">
              {summary}
            </div>
          ) : null}
          {metaLine ? (
            <div className="mt-3 max-w-[92%] text-[11px] leading-relaxed text-white/66">
              {metaLine}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
