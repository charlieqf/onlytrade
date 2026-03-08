import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useFullscreenLock } from '../../hooks/useFullscreenLock'
import { api } from '../../lib/api'
import type { FormalStreamDesignPageProps } from './phoneStreamShared'

type ThemeKey = 'hobit' | 'knight1' | 'knight2' | 'knight3' | 'knight4'

type ThemeAsset = {
  video: string
  audio: string
}

type ComfortSegment = {
  text: string
  speed: number
}

const AGENT_ID = 't_016'
const DEFAULT_THEME: ThemeKey = 'hobit'
const NARRATION_FILE = 'late_night_comfort.json'
const HOST_VIDEO_FILE = 'host.mp4'
const BGM_VOLUME = 0.25
const BGM_DUCKED_VOLUME = 0.1

const THEME_ASSETS: Record<ThemeKey, ThemeAsset> = {
  hobit: {
    video: 'hobit.mp4',
    audio: 'hobit.mp3',
  },
  knight1: {
    video: 'knight1.mp4',
    audio: 'knight.mp3',
  },
  knight2: {
    video: 'knight2.mp4',
    audio: 'knight.mp3',
  },
  knight3: {
    video: 'knight3.mp4',
    audio: 'knight.mp3',
  },
  knight4: {
    video: 'knight4.mp4',
    audio: 'knight.mp3',
  },
}

const ALLOWED_THEMES = Object.keys(THEME_ASSETS) as ThemeKey[]

function detectPathBase(): string {
  if (typeof window === 'undefined') return ''
  const pathname = String(window.location.pathname || '')
  if (pathname === '/onlytrade' || pathname.startsWith('/onlytrade/')) {
    return '/onlytrade'
  }
  return ''
}

function withAssetVersion(url: string, version: string): string {
  const base = String(url || '').trim()
  if (!base) return ''
  const v = String(version || '').trim()
  if (!v) return base
  const join = base.includes('?') ? '&' : '?'
  return `${base}${join}v=${encodeURIComponent(v)}`
}

function normalizeTheme(value: unknown): ThemeKey | null {
  const theme = String(value || '').trim().toLowerCase()
  if (!theme) return null
  return ALLOWED_THEMES.includes(theme as ThemeKey) ? (theme as ThemeKey) : null
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

function speedFromRate(rawRate: unknown): number {
  const text = String(rawRate || '').trim()
  if (!text) return 1
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*%/)
  if (!match) return 1
  const pct = Number(match[1])
  if (!Number.isFinite(pct)) return 1
  return clamp(1 + pct / 100, 0.5, 1.6)
}

function parseComfortSegments(payload: unknown): ComfortSegment[] {
  if (!Array.isArray(payload)) return []
  const rows: ComfortSegment[] = []
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue
    const text = String((item as Record<string, unknown>).text || '').trim()
    if (!text) continue
    rows.push({
      text,
      speed: speedFromRate((item as Record<string, unknown>).rate),
    })
  }
  return rows
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export default function T016NightComfortPage({ selectedTrader }: FormalStreamDesignPageProps) {
  useFullscreenLock()

  const pathBase = useMemo(() => detectPathBase(), [])
  const assetVersion = useMemo(() => String(Date.now()), [])
  const roomId = String(selectedTrader?.trader_id || AGENT_ID).trim().toLowerCase() || AGENT_ID

  const [searchText, setSearchText] = useState(() => String(window.location.search || ''))
  const [backendTheme, setBackendTheme] = useState<ThemeKey | null>(null)
  const [segments, setSegments] = useState<ComfortSegment[]>([])
  const [isNarrating, setIsNarrating] = useState(false)
  const [audioUnlockRequired, setAudioUnlockRequired] = useState(false)
  const [narrationError, setNarrationError] = useState('')

  const bgmAudioRef = useRef<HTMLAudioElement | null>(null)
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null)
  const narrationRunnerRef = useRef(0)

  const urlTheme = useMemo(() => {
    try {
      const params = new URLSearchParams(searchText)
      return normalizeTheme(params.get('theme'))
    } catch {
      return null
    }
  }, [searchText])

  const effectiveTheme: ThemeKey = urlTheme || backendTheme || DEFAULT_THEME
  const themeAsset = THEME_ASSETS[effectiveTheme]

  const mediaBase = `${pathBase}/theme-loop/${AGENT_ID}`
  const videoSrc = withAssetVersion(`${mediaBase}/${themeAsset.video}`, assetVersion)
  const bgmSrc = withAssetVersion(`${mediaBase}/${themeAsset.audio}`, assetVersion)
  const hostSrc = withAssetVersion(
    `${pathBase}/api/agents/${AGENT_ID}/assets/${HOST_VIDEO_FILE}`,
    assetVersion
  )

  useEffect(() => {
    const handleRouteChange = () => {
      setSearchText(String(window.location.search || ''))
    }
    window.addEventListener('popstate', handleRouteChange)
    return () => {
      window.removeEventListener('popstate', handleRouteChange)
    }
  }, [])

  const refreshBackendTheme = useCallback(async () => {
    try {
      const payload = await api.getStreamThemeProfile(roomId)
      const parsed = normalizeTheme(payload?.theme)
      if (parsed) {
        setBackendTheme(parsed)
      }
    } catch {
      // ignore profile fetch errors for uninterrupted playback
    }
  }, [roomId])

  useEffect(() => {
    void refreshBackendTheme()
    const timer = window.setInterval(() => {
      void refreshBackendTheme()
    }, 6000)
    return () => {
      window.clearInterval(timer)
    }
  }, [refreshBackendTheme])

  useEffect(() => {
    let cancelled = false
    const loadSegments = async () => {
      try {
        const url = withAssetVersion(
          `${pathBase}/api/agents/${AGENT_ID}/assets/${NARRATION_FILE}`,
          assetVersion
        )
        const res = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
        })
        if (!res.ok) return
        const payload = await res.json()
        if (cancelled) return
        const nextSegments = parseComfortSegments(payload)
        if (nextSegments.length > 0) {
          setSegments(nextSegments)
        }
      } catch {
        // ignore narration script read errors
      }
    }
    void loadSegments()
    return () => {
      cancelled = true
    }
  }, [pathBase, assetVersion])

  useEffect(() => {
    const bgm = bgmAudioRef.current
    if (!bgm) return
    bgm.volume = isNarrating ? BGM_DUCKED_VOLUME : BGM_VOLUME
  }, [effectiveTheme, isNarrating])

  const tryStartBgm = useCallback(async () => {
    const bgm = bgmAudioRef.current
    if (!bgm) return
    try {
      await bgm.play()
      setAudioUnlockRequired(false)
    } catch (error) {
      const message = String(error instanceof Error ? error.message : 'bgm_play_failed')
      if (/NotAllowedError|play\(\) failed|interact/i.test(message)) {
        setAudioUnlockRequired(true)
      }
    }
  }, [])

  useEffect(() => {
    const bgm = bgmAudioRef.current
    if (!bgm) return
    bgm.volume = isNarrating ? BGM_DUCKED_VOLUME : BGM_VOLUME
    void tryStartBgm()
  }, [bgmSrc, isNarrating, tryStartBgm])

  useEffect(() => {
    if (!audioUnlockRequired) return
    const unlock = () => {
      setAudioUnlockRequired(false)
      const bgm = bgmAudioRef.current
      if (bgm) {
        void bgm.play().catch(() => {
          // keep user-trigger retry path
        })
      }
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

  const playNarrationBlob = useCallback(async (blob: Blob) => {
    const objectUrl = URL.createObjectURL(blob)
    try {
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(objectUrl)
        narrationAudioRef.current = audio
        audio.preload = 'auto'
        audio.volume = 1
        audio.onended = () => {
          narrationAudioRef.current = null
          resolve()
        }
        audio.onerror = () => {
          narrationAudioRef.current = null
          reject(new Error('narration_audio_playback_failed'))
        }
        void audio.play().catch((error) => {
          narrationAudioRef.current = null
          reject(error)
        })
      })
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }, [])

  useEffect(() => {
    if (!segments.length) return
    narrationRunnerRef.current += 1
    const runId = narrationRunnerRef.current
    let stopped = false
    let segmentCursor = 0

    const runLoop = async () => {
      while (!stopped && runId === narrationRunnerRef.current) {
        if (audioUnlockRequired) {
          await sleep(700)
          continue
        }
        const segment = segments[segmentCursor % segments.length]
        segmentCursor += 1

        try {
          setIsNarrating(true)
          const blob = await api.synthesizeRoomSpeech({
            room_id: roomId,
            text: segment.text,
            tone: 'calm',
            message_id: `late_night_comfort_${segmentCursor}_${Date.now()}`,
            speed: segment.speed,
          })
          if (stopped || runId !== narrationRunnerRef.current) break
          await playNarrationBlob(blob)
          setNarrationError('')
        } catch (error) {
          const message = String(error instanceof Error ? error.message : 'narration_play_failed')
          setNarrationError(message)
          if (/NotAllowedError|play\(\) failed/i.test(message)) {
            setAudioUnlockRequired(true)
          }
          await sleep(1200)
        } finally {
          if (!stopped) setIsNarrating(false)
        }
      }
    }

    void runLoop()

    return () => {
      stopped = true
      narrationRunnerRef.current += 1
      if (narrationAudioRef.current) {
        narrationAudioRef.current.pause()
        narrationAudioRef.current = null
      }
    }
  }, [segments, roomId, audioUnlockRequired, playNarrationBlob])

  useEffect(() => {
    return () => {
      if (bgmAudioRef.current) {
        bgmAudioRef.current.pause()
        bgmAudioRef.current = null
      }
      if (narrationAudioRef.current) {
        narrationAudioRef.current.pause()
        narrationAudioRef.current = null
      }
    }
  }, [])

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <video
        key={videoSrc}
        src={videoSrc}
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />

      <audio
        key={bgmSrc}
        ref={bgmAudioRef}
        src={bgmSrc}
        loop
        preload="auto"
      />

      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/30" />

      <div className="absolute right-3 top-3 z-30 w-[32vw] min-w-[120px] max-w-[300px] overflow-hidden rounded border border-white/35 bg-black/35 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
        <video
          key={hostSrc}
          src={hostSrc}
          className="aspect-video h-auto w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      </div>

      <div className="absolute left-3 top-3 z-30 rounded border border-white/20 bg-black/45 px-2 py-1 text-[11px] font-medium tracking-wide text-white/85">
        {`theme: ${effectiveTheme}`}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[30vh]" data-overlay-slot="t016-text-overlay" />

      {audioUnlockRequired ? (
        <button
          type="button"
          onClick={() => setAudioUnlockRequired(false)}
          className="absolute bottom-5 left-1/2 z-40 -translate-x-1/2 rounded border border-white/30 bg-black/60 px-3 py-1.5 text-xs text-white"
        >
          Tap to enable audio
        </button>
      ) : null}

      {narrationError ? (
        <div className="absolute right-3 top-3 z-30 max-w-[72vw] rounded border border-red-400/35 bg-black/55 px-2 py-1 text-[11px] text-red-200">
          {narrationError}
        </div>
      ) : null}
    </main>
  )
}
