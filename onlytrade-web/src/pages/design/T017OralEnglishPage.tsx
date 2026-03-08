import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../lib/api'
import { useFullscreenLock } from '../../hooks/useFullscreenLock'
import type { FormalStreamDesignPageProps } from './phoneStreamShared'

type LessonHeadline = {
  id: string
  title: string
  summary: string
  source: string
  categoryLabel: string
  imageApiUrl: string
  audioApiUrl: string
  publishedAt: string
  screenTitle: string
  teachingMaterial: string
  screenVocabulary: string[]
}

const TOPIC_ADVANCE_AFTER_AUDIO_MS = 1200
const TOPIC_ADVANCE_NO_AUDIO_MS = 8000

type TtsSpec = {
  messageId: string
  script: string
  audioApiUrl: string
}

type TtsPrefetchEntry = {
  spec: TtsSpec
  promise?: Promise<string>
  audioUrl?: string
  revoke?: boolean
  error?: string
}

function detectPathBase(): string {
  if (typeof window === 'undefined') return ''
  const pathname = String(window.location.pathname || '')
  if (pathname === '/onlytrade' || pathname.startsWith('/onlytrade/')) {
    return '/onlytrade'
  }
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

function normalizeHeadline(raw: unknown): LessonHeadline | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = cleanText(row.id, 64)
  const title = cleanText(row.title, 220)
  if (!id || !title) return null
  return {
    id,
    title,
    summary: cleanText(row.summary, 320),
    source: cleanText(row.source, 80),
    categoryLabel: cleanText(row.category_label || row.category, 24) || 'General',
    imageApiUrl: cleanText(row.image_api_url, 280),
    audioApiUrl: cleanText(row.audio_api_url, 280),
    publishedAt: cleanText(row.published_at, 48),
    screenTitle: cleanText(row.screen_title, 180),
    teachingMaterial: cleanText(row.teaching_material, 2200),
    screenVocabulary: Array.isArray(row.screen_vocabulary)
      ? row.screen_vocabulary.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 6)
      : [],
  }
}

function buildAssetUrl(pathBase: string, apiPath: string): string {
  const safe = cleanText(apiPath, 400)
  if (!safe) return ''
  if (!safe.startsWith('/')) return safe
  if (!pathBase) return safe
  return `${pathBase}${safe}`
}

export default function T017OralEnglishPage({ selectedTrader }: FormalStreamDesignPageProps) {
  useFullscreenLock()

  const roomId = String(selectedTrader?.trader_id || 't_017').trim().toLowerCase() || 't_017'
  const pathBase = useMemo(() => detectPathBase(), [])

  const [headlines, setHeadlines] = useState<LessonHeadline[]>([])
  const [headlineIndex, setHeadlineIndex] = useState(0)
  const [asOfText, setAsOfText] = useState('')
  const [loading, setLoading] = useState(true)
  const [audioUnlockRequired, setAudioUnlockRequired] = useState(false)
  const [audioRetryNonce, setAudioRetryNonce] = useState(0)
  const [speechError, setSpeechError] = useState('')

  const audioPlaybackRef = useRef<{ element: HTMLAudioElement, url: string, revoke: boolean } | null>(null)
  const advanceTimerRef = useRef<number | null>(null)
  const ttsPrefetchRef = useRef<Map<string, TtsPrefetchEntry>>(new Map())
  const unmountedRef = useRef(false)

  const currentHeadline = headlines[headlineIndex] || null
  const nextHeadline = headlines.length > 1
    ? headlines[(headlineIndex + 1) % headlines.length] || null
    : null

  const clearAdvanceTimer = useCallback(() => {
    if (advanceTimerRef.current != null) {
      window.clearTimeout(advanceTimerRef.current)
      advanceTimerRef.current = null
    }
  }, [])

  const releaseAudioPlayback = useCallback((target?: HTMLAudioElement | null) => {
    const current = audioPlaybackRef.current
    if (!current) return
    if (target && current.element !== target) return
    current.element.onended = null
    current.element.onerror = null
    current.element.pause()
    if (current.revoke) {
      URL.revokeObjectURL(current.url)
    }
    audioPlaybackRef.current = null
  }, [])

  const queueNextHeadline = useCallback((delayMs: number) => {
    clearAdvanceTimer()
    if (headlines.length <= 1) return
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null
      setHeadlineIndex((prev) => {
        if (headlines.length <= 1) return 0
        return (prev + 1) % headlines.length
      })
    }, Math.max(0, delayMs))
  }, [clearAdvanceTimer, headlines.length])

  const buildTtsSpec = useCallback((headline: LessonHeadline | null): TtsSpec | null => {
    if (!headline) return null
    const script = cleanText(headline.teachingMaterial, 2400)
      || cleanText(headline.summary, 900)
      || cleanText(headline.title, 220)
    const audioApiUrl = buildAssetUrl(pathBase, headline.audioApiUrl)
    if (audioApiUrl) {
      return {
        messageId: cleanText(`audio_${headline.id}`, 120),
        script,
        audioApiUrl,
      }
    }
    if (!script) return null
    const messageId = cleanText(`t017_${headline.id}_${script.slice(0, 48)}`, 120)
    if (!messageId) return null
    return { messageId, script, audioApiUrl: '' }
  }, [pathBase])

  const pruneTtsPrefetchCache = useCallback((allowedSpecs: TtsSpec[]) => {
    const keep = new Set(allowedSpecs.map((item) => item.messageId))
    for (const [messageId, entry] of ttsPrefetchRef.current.entries()) {
      if (keep.has(messageId)) continue
      if (entry.audioUrl && entry.revoke) {
        URL.revokeObjectURL(entry.audioUrl)
      }
      ttsPrefetchRef.current.delete(messageId)
    }
  }, [])

  const ensureTtsPrefetch = useCallback((spec: TtsSpec | null): Promise<string> => {
    if (!spec) return Promise.reject(new Error('tts_spec_missing'))
    const existing = ttsPrefetchRef.current.get(spec.messageId)
    if (existing?.audioUrl) {
      return Promise.resolve(existing.audioUrl)
    }
    if (existing?.promise) {
      return existing.promise
    }

    const entry: TtsPrefetchEntry = existing || { spec }
    if (spec.audioApiUrl) {
      entry.audioUrl = spec.audioApiUrl
      entry.revoke = false
      entry.promise = undefined
      entry.error = ''
      ttsPrefetchRef.current.set(spec.messageId, entry)
      return Promise.resolve(spec.audioApiUrl)
    }
    const promise = api.synthesizeRoomSpeech({
      room_id: roomId,
      text: spec.script,
      message_id: spec.messageId,
      tone: 'energetic',
      speaker_id: 'coach_a',
    }).then((blob) => {
      const audioUrl = URL.createObjectURL(blob)
      const current = ttsPrefetchRef.current.get(spec.messageId)
      if (current) {
        current.audioUrl = audioUrl
        current.revoke = true
        current.promise = undefined
        current.error = ''
      } else {
        ttsPrefetchRef.current.set(spec.messageId, { spec, audioUrl, revoke: true })
      }
      return audioUrl
    }).catch((error) => {
      const message = String(error instanceof Error ? error.message : 'tts_prefetch_failed')
      const current = ttsPrefetchRef.current.get(spec.messageId)
      if (current) {
        current.promise = undefined
        current.error = message
      } else {
        ttsPrefetchRef.current.set(spec.messageId, { spec, error: message })
      }
      throw error
    })

    entry.promise = promise
    entry.error = ''
    ttsPrefetchRef.current.set(spec.messageId, entry)
    return promise
  }, [roomId])

  const fetchLive = useCallback(async () => {
    try {
      const payload = await api.getEnglishClassroomLive({ room_id: roomId })
      const live = payload?.live && typeof payload.live === 'object'
        ? payload.live as Record<string, unknown>
        : {}
      const rows = Array.isArray(live.headlines)
        ? live.headlines.map((item) => normalizeHeadline(item)).filter(Boolean) as LessonHeadline[]
        : []
      const asOf = cleanText(live.as_of, 40)
      if (rows.length > 0) {
        setHeadlines((prev) => {
          const prevCurrentId = prev[headlineIndex]?.id || ''
          const nextIndex = rows.findIndex((item) => item.id === prevCurrentId)
          setHeadlineIndex(nextIndex >= 0 ? nextIndex : 0)
          return rows
        })
      }
      setAsOfText(asOf)
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }, [headlineIndex, roomId])

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
    if (!currentHeadline) return
    clearAdvanceTimer()
    const currentSpec = buildTtsSpec(currentHeadline)
    const nextSpec = buildTtsSpec(nextHeadline)
    pruneTtsPrefetchCache(
      [currentSpec, nextSpec].filter(Boolean) as TtsSpec[]
    )
    if (currentSpec) {
      void ensureTtsPrefetch(currentSpec).catch(() => {})
    }
    if (nextSpec) {
      void ensureTtsPrefetch(nextSpec).catch(() => {})
    }
    if (!currentSpec) {
      queueNextHeadline(TOPIC_ADVANCE_NO_AUDIO_MS)
      return
    }
    let cancelled = false
    const run = async () => {
      try {
        const audioUrl = await ensureTtsPrefetch(currentSpec)
        if (cancelled || unmountedRef.current) return
        releaseAudioPlayback()
        const audio = new Audio(audioUrl)
        audio.volume = 1
        audio.preload = 'auto'
        audio.onended = () => {
          if (cancelled || unmountedRef.current) return
          releaseAudioPlayback(audio)
          queueNextHeadline(TOPIC_ADVANCE_AFTER_AUDIO_MS)
        }
        audio.onerror = () => {
          if (cancelled || unmountedRef.current) return
          releaseAudioPlayback(audio)
          if (currentSpec.audioApiUrl && currentSpec.script) {
            ttsPrefetchRef.current.delete(currentSpec.messageId)
            void ensureTtsPrefetch({
              ...currentSpec,
              messageId: cleanText(`fallback_${currentSpec.messageId}`, 120),
              audioApiUrl: '',
            }).then((fallbackUrl) => {
              if (cancelled || unmountedRef.current) return
              const fallbackAudio = new Audio(fallbackUrl)
              fallbackAudio.volume = 1
              fallbackAudio.preload = 'auto'
              fallbackAudio.onended = () => {
                if (cancelled || unmountedRef.current) return
                releaseAudioPlayback(fallbackAudio)
                queueNextHeadline(TOPIC_ADVANCE_AFTER_AUDIO_MS)
              }
              fallbackAudio.onerror = () => {
                if (cancelled || unmountedRef.current) return
                releaseAudioPlayback(fallbackAudio)
                setSpeechError('tts_playback_failed')
                queueNextHeadline(TOPIC_ADVANCE_NO_AUDIO_MS)
              }
              audioPlaybackRef.current = {
                element: fallbackAudio,
                url: fallbackUrl,
                revoke: true,
              }
              void fallbackAudio.play().then(() => {
                setAudioUnlockRequired(false)
                setSpeechError('')
              }).catch((error) => {
                const message = String(error instanceof Error ? error.message : 'tts_play_failed')
                if (/NotAllowedError|play\(\) failed|interact/i.test(message)) {
                  setAudioUnlockRequired(true)
                  setSpeechError('')
                  return
                }
                setSpeechError(message)
                queueNextHeadline(TOPIC_ADVANCE_NO_AUDIO_MS)
              })
            }).catch(() => {
              setSpeechError('tts_playback_failed')
              queueNextHeadline(TOPIC_ADVANCE_NO_AUDIO_MS)
            })
            return
          }
          setSpeechError('tts_playback_failed')
          queueNextHeadline(TOPIC_ADVANCE_NO_AUDIO_MS)
        }
        const currentEntry = ttsPrefetchRef.current.get(currentSpec.messageId)
        audioPlaybackRef.current = {
          element: audio,
          url: audioUrl,
          revoke: !!currentEntry?.revoke,
        }
        await audio.play()
        if (cancelled || unmountedRef.current) {
          releaseAudioPlayback(audio)
          return
        }
        setAudioUnlockRequired(false)
        setSpeechError('')
      } catch (error) {
        if (cancelled || unmountedRef.current) return
        const message = String(error instanceof Error ? error.message : 'tts_play_failed')
        if (/NotAllowedError|play\(\) failed|interact/i.test(message)) {
          setAudioUnlockRequired(true)
          setSpeechError('')
          return
        }
        setSpeechError(message)
        queueNextHeadline(TOPIC_ADVANCE_NO_AUDIO_MS)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [
    audioRetryNonce,
    buildTtsSpec,
    clearAdvanceTimer,
    currentHeadline?.id,
    ensureTtsPrefetch,
    nextHeadline?.id,
    pruneTtsPrefetchCache,
    queueNextHeadline,
    releaseAudioPlayback,
  ])

  useEffect(() => {
    return () => {
      unmountedRef.current = true
      clearAdvanceTimer()
      releaseAudioPlayback()
      for (const entry of ttsPrefetchRef.current.values()) {
        if (entry.audioUrl && entry.revoke) {
          URL.revokeObjectURL(entry.audioUrl)
        }
      }
      ttsPrefetchRef.current.clear()
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

  const backgroundImageUrl = currentHeadline
    ? buildAssetUrl(pathBase, currentHeadline.imageApiUrl)
    : ''

  const screenTitle = currentHeadline?.screenTitle || currentHeadline?.title || ''
  const metaLine = [
    currentHeadline?.source || '',
    currentHeadline?.publishedAt || '',
    asOfText || '',
  ].filter(Boolean).join(' · ')
  const keyPhrases = currentHeadline?.screenVocabulary?.length
    ? currentHeadline.screenVocabulary
    : [
      'Codename: 代号',
      'Lead in performance: 性能领先',
      'Price tag: 价格',
      'Global tariffs: 全球关税',
      'Supply issues: 供应问题',
    ]
  const posterTags = keyPhrases.slice(0, 5)
  const posterTagClasses = [
    'rotate-[-4deg] bg-black/58 text-white border-[#ffe082]/65',
    'rotate-[3deg] bg-black/56 text-white border-[#9ae6b4]/60',
    'rotate-[-2deg] bg-black/60 text-white border-[#7dd3fc]/62',
    'rotate-[5deg] bg-black/54 text-white border-[#f9a8d4]/62',
    'rotate-[-5deg] bg-black/58 text-white border-white/48',
  ]

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#03050b] text-white">
      {backgroundImageUrl ? (
        <div className="absolute inset-0 bg-black">
          <img
            src={backgroundImageUrl}
            alt={currentHeadline?.title || 'news background'}
            className="h-full w-full scale-[1.08] object-cover blur-[12px] brightness-[0.56] saturate-[1.08]"
            loading="eager"
          />
        </div>
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#28456f_0%,#101d34_34%,#05070d_100%)]" />
      )}

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(253,230,138,0.16),transparent_28%),radial-gradient(circle_at_80%_22%,rgba(125,211,252,0.18),transparent_24%),linear-gradient(180deg,rgba(1,3,8,0.40)_0%,rgba(1,3,8,0.10)_28%,rgba(1,3,8,0.28)_54%,rgba(1,3,8,0.82)_100%)]" />
      <div className="absolute inset-x-0 top-0 h-[26vh] bg-gradient-to-b from-black/55 via-black/12 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[46vh] bg-gradient-to-t from-black/88 via-black/42 to-transparent" />
      <div className="absolute inset-x-[8%] top-[18%] h-[28vh] rounded-full bg-white/8 blur-[90px]" />

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

      {backgroundImageUrl ? (
        <div className="pointer-events-none absolute inset-x-3 top-[10.5vh] bottom-[24vh] z-10 flex items-center justify-center">
          <div className="relative h-full w-full overflow-hidden rounded-[34px] border border-white/14 bg-black/12 shadow-[0_22px_80px_rgba(0,0,0,0.40)] backdrop-blur-[4px]">
            <img
              src={backgroundImageUrl}
              alt=""
              aria-hidden="true"
              className="h-full w-full object-contain object-center"
              loading="eager"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,11,0.08)_0%,rgba(3,5,11,0)_42%,rgba(3,5,11,0.18)_100%)]" />
          </div>
        </div>
      ) : null}

      <div className="absolute inset-x-4 top-4 z-30 flex items-start justify-between gap-3">
        <div className="max-w-[70%] rounded-full border border-white/25 bg-black/30 px-3 py-2 text-[10px] uppercase tracking-[0.28em] text-white/88 backdrop-blur-md">
          Oral English Live
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(28px,env(safe-area-inset-bottom))] pt-10">
        <div className="relative overflow-hidden rounded-[32px] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.02)_100%)] px-5 pb-5 pt-6 shadow-[0_25px_80px_rgba(0,0,0,0.38)] backdrop-blur-[14px]">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-[2px] w-9 bg-[#f6d365]" />
            <div className="text-[11px] uppercase tracking-[0.34em] text-[#ffe7a5]">Topic Focus</div>
          </div>
          <h1 className="relative z-10 max-w-[88%] text-[34px] leading-[0.94] font-black tracking-[-0.04em] text-white drop-shadow-[0_12px_28px_rgba(0,0,0,0.72)] sm:text-[42px]">
            {screenTitle || (loading ? 'Loading latest topic...' : 'Waiting for topic...')}
          </h1>
          {metaLine ? (
            <div className="mt-3 max-w-[88%] text-[11px] leading-relaxed text-white/72">
              {metaLine}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2.5">
            {posterTags.map((phrase, index) => (
              <div
                key={phrase}
                className={`max-w-[82%] rounded-[18px] border px-3 py-2 text-[14px] leading-[1.08] font-black shadow-[0_10px_24px_rgba(0,0,0,0.38)] drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)] backdrop-blur-md ${posterTagClasses[index % posterTagClasses.length]}`}
              >
                {phrase}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
