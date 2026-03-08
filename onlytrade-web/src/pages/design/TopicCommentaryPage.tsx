import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../lib/api'
import { useFullscreenLock } from '../../hooks/useFullscreenLock'
import type { FormalStreamDesignPageProps } from './phoneStreamShared'

type TopicItem = {
  id: string
  title: string
  screenTitle: string
  summaryFacts: string
  commentaryScript: string
  screenTags: string[]
  source: string
  publishedAt: string
  imageApiUrl: string
  audioApiUrl: string
}

type ThemeSpec = {
  label: string
  eyebrow: string
  accent: string
  badge: string
  overlay: string
  panel: string
}

const TOPIC_ADVANCE_AFTER_AUDIO_MS = 1200
const TOPIC_ADVANCE_ON_ERROR_MS = 1500

const PROGRAM_THEMES: Record<string, ThemeSpec> = {
  'five-league': {
    label: '五大联赛每日评书',
    eyebrow: 'Match Night Bulletin',
    accent: '#f5d77b',
    badge: 'bg-[#10281d]/78 text-[#f7e6a6] border-[#d7b85f]/60',
    overlay: 'bg-[radial-gradient(circle_at_20%_16%,rgba(245,215,123,0.20),transparent_26%),radial-gradient(circle_at_84%_18%,rgba(112,214,163,0.16),transparent_24%),linear-gradient(180deg,rgba(1,13,8,0.32)_0%,rgba(1,13,8,0.12)_34%,rgba(1,13,8,0.82)_100%)]',
    panel: 'bg-[linear-gradient(180deg,rgba(20,44,29,0.74)_0%,rgba(6,16,10,0.88)_100%)]',
  },
  'china-bigtech': {
    label: '国内大厂每日锐评',
    eyebrow: 'Hot Topic Radar',
    accent: '#ff7a59',
    badge: 'bg-[#281314]/80 text-[#ffd5c9] border-[#ff7a59]/55',
    overlay: 'bg-[radial-gradient(circle_at_18%_14%,rgba(255,122,89,0.22),transparent_24%),radial-gradient(circle_at_82%_18%,rgba(53,140,255,0.18),transparent_22%),linear-gradient(180deg,rgba(11,12,16,0.26)_0%,rgba(11,12,16,0.12)_30%,rgba(11,12,16,0.84)_100%)]',
    panel: 'bg-[linear-gradient(180deg,rgba(34,16,18,0.76)_0%,rgba(11,12,16,0.90)_100%)]',
  },
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

function normalizeTopic(raw: unknown): TopicItem | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = cleanText(row.id, 96)
  const title = cleanText(row.title, 220)
  const audioApiUrl = cleanText(row.audio_api_url, 320)
  const imageApiUrl = cleanText(row.image_api_url, 320)
  if (!id || !title || !audioApiUrl || !imageApiUrl) return null
  return {
    id,
    title,
    screenTitle: cleanText(row.screen_title || row.title, 180),
    summaryFacts: cleanText(row.summary_facts || row.summary, 600),
    commentaryScript: cleanText(row.commentary_script || row.script, 2200),
    screenTags: Array.isArray(row.screen_tags)
      ? row.screen_tags.map((item) => cleanText(item, 64)).filter(Boolean).slice(0, 5)
      : [],
    source: cleanText(row.source, 80),
    publishedAt: cleanText(row.published_at, 48),
    imageApiUrl,
    audioApiUrl,
  }
}

function getProgramSlugFromUrl(): string {
  if (typeof window === 'undefined') return 'china-bigtech'
  const params = new URLSearchParams(window.location.search)
  return cleanText(params.get('program') || 'china-bigtech', 64).toLowerCase() || 'china-bigtech'
}

export default function TopicCommentaryPage({ selectedTrader }: FormalStreamDesignPageProps) {
  useFullscreenLock()

  const roomId = String(selectedTrader?.trader_id || 't_019').trim().toLowerCase() || 't_019'
  const pathBase = useMemo(() => detectPathBase(), [])
  const initialProgramSlug = useMemo(() => getProgramSlugFromUrl(), [])

  const [topics, setTopics] = useState<TopicItem[]>([])
  const [topicIndex, setTopicIndex] = useState(0)
  const [programSlug, setProgramSlug] = useState(initialProgramSlug)
  const [programTitle, setProgramTitle] = useState('')
  const [asOfText, setAsOfText] = useState('')
  const [loading, setLoading] = useState(true)
  const [audioUnlockRequired, setAudioUnlockRequired] = useState(false)
  const [audioRetryNonce, setAudioRetryNonce] = useState(0)
  const [speechError, setSpeechError] = useState('')

  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null)
  const advanceTimerRef = useRef<number | null>(null)
  const unmountedRef = useRef(false)

  const currentTopic = topics[topicIndex] || null
  const nextTopic = topics.length > 1 ? topics[(topicIndex + 1) % topics.length] || null : null
  const theme = PROGRAM_THEMES[programSlug] || PROGRAM_THEMES['china-bigtech']

  const clearAdvanceTimer = useCallback(() => {
    if (advanceTimerRef.current != null) {
      window.clearTimeout(advanceTimerRef.current)
      advanceTimerRef.current = null
    }
  }, [])

  const releaseAudioPlayback = useCallback((target?: HTMLAudioElement | null) => {
    const current = audioPlaybackRef.current
    if (!current) return
    if (target && current !== target) return
    current.onended = null
    current.onerror = null
    current.pause()
    audioPlaybackRef.current = null
  }, [])

  const queueNextTopic = useCallback((delayMs: number) => {
    clearAdvanceTimer()
    if (topics.length <= 1) return
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null
      setTopicIndex((prev) => ((prev + 1) % topics.length))
    }, Math.max(0, delayMs))
  }, [clearAdvanceTimer, topics.length])

  const fetchLive = useCallback(async () => {
    try {
      const payload = await api.getTopicStreamLive({ room_id: roomId })
      const live = payload?.live && typeof payload.live === 'object'
        ? payload.live as Record<string, unknown>
        : {}
      const nextTopics = Array.isArray(live.topics)
        ? live.topics.map((item) => normalizeTopic(item)).filter(Boolean) as TopicItem[]
        : []
      const nextProgramSlug = cleanText(live.program_slug || initialProgramSlug, 64).toLowerCase() || initialProgramSlug
      const nextProgramTitle = cleanText(live.program_title || PROGRAM_THEMES[nextProgramSlug]?.label || '', 80)
      const nextAsOf = cleanText(live.as_of, 40)

      setProgramSlug(nextProgramSlug)
      setProgramTitle(nextProgramTitle)
      setAsOfText(nextAsOf)
      if (nextTopics.length > 0) {
        setTopics((prev) => {
          const currentId = prev[topicIndex]?.id || ''
          const nextIndex = nextTopics.findIndex((item) => item.id === currentId)
          setTopicIndex(nextIndex >= 0 ? nextIndex : 0)
          return nextTopics
        })
      } else {
        setTopics([])
        setTopicIndex(0)
      }
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }, [initialProgramSlug, roomId, topicIndex])

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
    clearAdvanceTimer()
    releaseAudioPlayback()
    if (!currentTopic) return

    const currentAudioUrl = buildAssetUrl(pathBase, currentTopic.audioApiUrl)
    const nextAudioUrl = nextTopic ? buildAssetUrl(pathBase, nextTopic.audioApiUrl) : ''
    if (!currentAudioUrl) {
      queueNextTopic(TOPIC_ADVANCE_ON_ERROR_MS)
      return
    }

    let cancelled = false
    const audio = new Audio(currentAudioUrl)
    audio.volume = 1
    audio.preload = 'auto'
    audio.onended = () => {
      if (cancelled || unmountedRef.current) return
      releaseAudioPlayback(audio)
      queueNextTopic(TOPIC_ADVANCE_AFTER_AUDIO_MS)
    }
    audio.onerror = () => {
      if (cancelled || unmountedRef.current) return
      releaseAudioPlayback(audio)
      setSpeechError('topic_audio_playback_failed')
      queueNextTopic(TOPIC_ADVANCE_ON_ERROR_MS)
    }
    audioPlaybackRef.current = audio

    if (nextAudioUrl) {
      const preloadAudio = new Audio(nextAudioUrl)
      preloadAudio.preload = 'auto'
    }

    void audio.play().then(() => {
      if (cancelled || unmountedRef.current) {
        releaseAudioPlayback(audio)
        return
      }
      setAudioUnlockRequired(false)
      setSpeechError('')
    }).catch((error) => {
      if (cancelled || unmountedRef.current) return
      const message = String(error instanceof Error ? error.message : 'topic_audio_play_failed')
      if (/NotAllowedError|play\(\) failed|interact/i.test(message)) {
        setAudioUnlockRequired(true)
        setSpeechError('')
        return
      }
      setSpeechError(message)
      queueNextTopic(TOPIC_ADVANCE_ON_ERROR_MS)
    })

    return () => {
      cancelled = true
    }
  }, [audioRetryNonce, clearAdvanceTimer, currentTopic?.id, nextTopic?.id, pathBase, queueNextTopic, releaseAudioPlayback])

  useEffect(() => {
    return () => {
      unmountedRef.current = true
      clearAdvanceTimer()
      releaseAudioPlayback()
    }
  }, [clearAdvanceTimer, releaseAudioPlayback])

  useEffect(() => {
    if (!audioUnlockRequired) return
    const unlock = () => {
      setAudioUnlockRequired(false)
      setAudioRetryNonce((prev) => prev + 1)
      setSpeechError('')
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('touchstart', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchstart', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [audioUnlockRequired])

  const backgroundImageUrl = currentTopic ? buildAssetUrl(pathBase, currentTopic.imageApiUrl) : ''
  const screenTitle = currentTopic?.screenTitle || currentTopic?.title || ''
  const metaLine = [currentTopic?.source || '', currentTopic?.publishedAt || '', asOfText || ''].filter(Boolean).join(' · ')
  const tags = currentTopic?.screenTags?.length ? currentTopic.screenTags : []

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#090b11] text-white">
      {backgroundImageUrl ? (
        <div className="absolute inset-0 bg-black">
          <img
            src={backgroundImageUrl}
            alt={currentTopic?.title || 'topic background'}
            className="h-full w-full scale-[1.06] object-cover blur-[14px] brightness-[0.44] saturate-[1.06]"
            loading="eager"
          />
        </div>
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#3a1220_0%,#11131a_34%,#05070d_100%)]" />
      )}

      <div className={`absolute inset-0 ${theme.overlay}`} />
      <div className="absolute inset-x-0 top-0 h-[24vh] bg-gradient-to-b from-black/52 via-black/10 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[48vh] bg-gradient-to-t from-black/88 via-black/34 to-transparent" />

      {backgroundImageUrl ? (
        <div className="pointer-events-none absolute inset-x-3 top-[11vh] bottom-[24vh] z-10 flex items-center justify-center">
          <div className="relative h-full w-full overflow-hidden rounded-[34px] border border-white/12 bg-black/12 shadow-[0_22px_80px_rgba(0,0,0,0.42)] backdrop-blur-[4px]">
            <img
              src={backgroundImageUrl}
              alt=""
              aria-hidden="true"
              className="h-full w-full object-contain object-center"
              loading="eager"
            />
          </div>
        </div>
      ) : null}

      {audioUnlockRequired ? (
        <button
          type="button"
          onClick={() => {
            setAudioUnlockRequired(false)
            setAudioRetryNonce((prev) => prev + 1)
            setSpeechError('')
          }}
          className="absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 rounded border border-white/35 bg-black/65 px-4 py-2 text-[13px] font-medium text-white"
        >
          Tap to enable audio
        </button>
      ) : null}

      {speechError ? (
        <div className="absolute inset-x-4 top-[108px] z-30 rounded-[20px] border border-red-300/45 bg-black/55 px-4 py-3 text-[11px] text-red-100 backdrop-blur-md">
          {speechError}
        </div>
      ) : null}

      <div className="absolute inset-x-4 top-4 z-30 flex items-start justify-between gap-3">
        <div className={`rounded-full border px-3 py-2 text-[10px] uppercase tracking-[0.28em] backdrop-blur-md ${theme.badge}`}>
          {theme.eyebrow}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(28px,env(safe-area-inset-bottom))] pt-10">
        <div className={`relative overflow-hidden rounded-[32px] border border-white/12 px-5 pb-5 pt-6 shadow-[0_25px_80px_rgba(0,0,0,0.38)] backdrop-blur-[14px] ${theme.panel}`}>
          <div className="mb-3 flex items-center gap-2">
            <div className="h-[2px] w-9" style={{ background: theme.accent }} />
            <div className="text-[11px] uppercase tracking-[0.34em]" style={{ color: theme.accent }}>
              {programTitle || theme.label}
            </div>
          </div>
          <h1 className="relative z-10 max-w-[92%] text-[34px] leading-[0.94] font-black tracking-[-0.04em] text-white drop-shadow-[0_12px_28px_rgba(0,0,0,0.72)] sm:text-[42px]">
            {screenTitle || (loading ? 'Loading latest topic...' : 'Waiting for topic...')}
          </h1>
          {currentTopic?.summaryFacts ? (
            <div className="mt-3 max-w-[92%] text-[13px] leading-[1.45] text-white/80">
              {currentTopic.summaryFacts}
            </div>
          ) : null}
          {metaLine ? (
            <div className="mt-3 max-w-[92%] text-[11px] leading-relaxed text-white/66">
              {metaLine}
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2.5">
            {tags.map((tag) => (
              <div
                key={tag}
                className="rounded-[18px] border border-white/16 bg-black/30 px-3 py-2 text-[13px] font-black text-white shadow-[0_10px_24px_rgba(0,0,0,0.34)] backdrop-blur-md"
              >
                {tag}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
