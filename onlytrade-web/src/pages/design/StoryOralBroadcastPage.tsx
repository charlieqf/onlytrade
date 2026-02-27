import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useFullscreenLock } from '../../hooks/useFullscreenLock'
import {
  type FormalStreamDesignPageProps,
  usePhoneStreamData,
} from './phoneStreamShared'

type StoryManifest = {
  title: string
  subtitle: string
  narration_file: string
  bgm_file: string
  duration_sec: number
  scenes: string[]
}

type SpeakerRole = 'alpha' | 'xiaozhen' | 'listener' | 'unknown'

type ScriptSegment = {
  text: string
  speaker: SpeakerRole
}

type SubtitleCue = {
  startSec: number
  endSec: number
  text: string
  speaker: SpeakerRole
}

const DEFAULT_SCENES = Array.from({ length: 18 }, (_, idx) => `scene_${idx}.png`)

const DEFAULT_MANIFEST: StoryManifest = {
  title: '赵老哥：八年一万倍的股市传奇',
  subtitle: 'blog / 说书 / 口播',
  narration_file: 'narration.mp3',
  bgm_file: 'bgm.mp3',
  duration_sec: 1001,
  scenes: DEFAULT_SCENES,
}

const STORY_SLUG_BY_TRADER: Record<string, string> = {
  t_007: 'zhaolaoge',
  t_008: 'xuxiang',
  t_009: 'qingshan',
  t_010: 'ai_daily_20260226',
  t_011: 'citrini_ghost_20260226',
  t_012: 'ai_tribunal_20260226',
}

function resolveStorySlug(traderId: string): string {
  const fallback = STORY_SLUG_BY_TRADER[String(traderId || '').trim().toLowerCase()] || 'zhaolaoge'
  if (typeof window === 'undefined') return fallback
  try {
    const params = new URLSearchParams(window.location.search)
    const custom = String(params.get('story') || '').trim().toLowerCase()
    if (/^[a-z0-9_-]{2,32}$/.test(custom)) return custom
  } catch {
    // ignore malformed query
  }
  return fallback
}

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
  if (!base) return base
  const v = String(version || '').trim()
  if (!v) return base
  const join = base.includes('?') ? '&' : '?'
  return `${base}${join}v=${encodeURIComponent(v)}`
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseStoryManifest(payload: unknown): StoryManifest {
  if (!payload || typeof payload !== 'object') {
    return DEFAULT_MANIFEST
  }
  const row = payload as Record<string, unknown>
  const scenes = Array.isArray(row.scenes)
    ? row.scenes.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  return {
    title: String(row.title || DEFAULT_MANIFEST.title).trim() || DEFAULT_MANIFEST.title,
    subtitle: String(row.subtitle || DEFAULT_MANIFEST.subtitle).trim() || DEFAULT_MANIFEST.subtitle,
    narration_file:
      String(row.narration_file || DEFAULT_MANIFEST.narration_file).trim()
      || DEFAULT_MANIFEST.narration_file,
    bgm_file: String(row.bgm_file || DEFAULT_MANIFEST.bgm_file).trim() || DEFAULT_MANIFEST.bgm_file,
    duration_sec: Math.max(0, toSafeNumber(row.duration_sec, DEFAULT_MANIFEST.duration_sec)),
    scenes: scenes.length ? scenes : DEFAULT_MANIFEST.scenes,
  }
}

function normalizeSpeakerRole(raw: string): SpeakerRole {
  const token = String(raw || '').trim().toLowerCase()
  if (!token) return 'unknown'
  if (token === 'alpha' || token === 'host') return 'alpha'
  if (token === 'xiaozhen' || token === 'guest') return 'xiaozhen'
  if (
    token === 'listener'
    || token === 'caller'
    || token === 'audience'
    || token.startsWith('caller_')
  ) {
    return 'listener'
  }
  return 'unknown'
}

function parseScriptSegments(script: string): ScriptSegment[] {
  const lines = String(script || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (!lines.length) return []

  const parsed: ScriptSegment[] = []
  for (const line of lines) {
    let speaker: SpeakerRole = 'unknown'
    let text = line

    const bracketTagged = line.match(/^\[([^\]]+)\]\s*(.+)$/)
    if (bracketTagged) {
      speaker = normalizeSpeakerRole(bracketTagged[1])
      text = bracketTagged[2]
    } else {
      const colonTagged = line.match(/^([a-zA-Z0-9_\u4e00-\u9fa5]+)\s*[：:]\s*(.+)$/)
      if (colonTagged) {
        speaker = normalizeSpeakerRole(colonTagged[1])
        text = colonTagged[2]
      }
    }

    const compactText = String(text || '')
      .replace(/<break\s+time="\d+ms"\s*\/?>/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!compactText) continue
    if (/^sys_inject_(ad|song)$/i.test(compactText)) continue
    parsed.push({ text: compactText, speaker })
  }

  return parsed
}

function buildSubtitleCues(script: string, durationSec: number): SubtitleCue[] {
  const segments = parseScriptSegments(script)
  if (!segments.length) return []

  const safeDuration = Math.max(10, Number(durationSec) || 1001)
  const minSec = 2.1
  const maxSec = 8.2

  const weights = segments.map((segment) => Math.max(8, segment.text.replace(/\s+/g, '').length))
  const totalWeight = weights.reduce((sum, n) => sum + n, 0)

  const preliminary = segments.map((segment, idx) => {
    const raw = (safeDuration * weights[idx]) / Math.max(1, totalWeight)
    return {
      text: segment.text,
      speaker: segment.speaker,
      sec: Math.max(minSec, Math.min(maxSec, raw)),
    }
  })

  const prelimTotal = preliminary.reduce((sum, row) => sum + row.sec, 0)
  const scale = safeDuration / Math.max(1, prelimTotal)

  let cursor = 0
  return preliminary.map((row, idx) => {
    const scaled = row.sec * scale
    const startSec = cursor
    const endSec = idx === preliminary.length - 1
      ? safeDuration
      : Math.min(safeDuration, cursor + scaled)
    cursor = endSec
    return {
      startSec,
      endSec,
      text: row.text,
      speaker: row.speaker,
    }
  })
}

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function StoryOralBroadcastPage(props: FormalStreamDesignPageProps) {
  useFullscreenLock()
  const {
    selectedTrader,
    modeLabel,
    isDegraded,
    language,
  } = usePhoneStreamData(props)

  const [manifest, setManifest] = useState<StoryManifest>(DEFAULT_MANIFEST)
  const [scriptText, setScriptText] = useState('')
  const [loadError, setLoadError] = useState('')
  const [mediaError, setMediaError] = useState('')
  const [assetVersion, setAssetVersion] = useState<string>(() => String(Date.now()))

  const [narrationTimeSec, setNarrationTimeSec] = useState(0)
  const [narrationDurationSec, setNarrationDurationSec] = useState(0)
  const [narrationPlaying, setNarrationPlaying] = useState(false)

  const [bgmEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const raw = window.localStorage.getItem('story_bgm_enabled')
    return raw == null ? true : raw !== 'false'
  })
  const [bgmVolume] = useState<number>(() => {
    if (typeof window === 'undefined') return 0.16
    const raw = Number(window.localStorage.getItem('story_bgm_volume') || '')
    if (!Number.isFinite(raw)) return 0.16
    return Math.max(0, Math.min(raw, 0.45))
  })

  const narrationAudioRef = useRef<HTMLAudioElement | null>(null)
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null)
  const phoneNoiseContextRef = useRef<AudioContext | null>(null)
  const phoneNoiseSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const phoneNoiseGainRef = useRef<GainNode | null>(null)
  const phoneNoiseBufferRef = useRef<AudioBuffer | null>(null)
  const narrationRetryCountRef = useRef(0)
  const manualPauseRef = useRef(false)
  const pendingUnmuteRef = useRef(false)

  useEffect(() => {
    const mediaNodes = Array.from(document.querySelectorAll<HTMLMediaElement>('audio, video'))
    mediaNodes.forEach((node) => {
      try {
        node.pause()
      } catch {
        // ignore
      }
    })
  }, [])

  const pathBase = useMemo(() => detectPathBase(), [])
  const storySlug = useMemo(() => resolveStorySlug(selectedTrader.trader_id), [selectedTrader.trader_id])
  const storyRoot = `${pathBase}/story/${storySlug}`

  const narrationSrc = useMemo(
    () => withAssetVersion(`${storyRoot}/${manifest.narration_file}`, assetVersion),
    [storyRoot, manifest.narration_file, assetVersion]
  )
  const bgmSrc = useMemo(
    () => withAssetVersion(`${storyRoot}/${manifest.bgm_file}`, assetVersion),
    [storyRoot, manifest.bgm_file, assetVersion]
  )

  const subtitleCues = useMemo(() => {
    const baseDuration = narrationDurationSec > 0
      ? narrationDurationSec
      : Math.max(1, manifest.duration_sec)
    return buildSubtitleCues(scriptText, baseDuration)
  }, [scriptText, narrationDurationSec, manifest.duration_sec])

  const activeCue = useMemo<SubtitleCue | null>(() => {
    if (!subtitleCues.length) return null
    const cue = subtitleCues.find(
      (row) => narrationTimeSec >= row.startSec && narrationTimeSec < row.endSec
    )
    return cue || subtitleCues[subtitleCues.length - 1] || null
  }, [subtitleCues, narrationTimeSec])

  const activeCueText = activeCue?.text || ''
  const activeSpeaker = activeCue?.speaker || 'unknown'
  const hostSpeaking = activeSpeaker === 'alpha'
  const guestSpeaking = activeSpeaker === 'xiaozhen'
  const listenerSpeaking = activeSpeaker === 'listener'
  const showDualSpeakerIndicator = useMemo(
    () => subtitleCues.some((row) => row.speaker === 'alpha' || row.speaker === 'xiaozhen'),
    [subtitleCues]
  )

  const sceneFiles = manifest.scenes.length ? manifest.scenes : DEFAULT_SCENES
  const singleSceneMode = sceneFiles.length <= 1
  const progress = narrationDurationSec > 0
    ? Math.max(0, Math.min(narrationTimeSec / narrationDurationSec, 1))
    : 0
  const activeSceneIndex = Math.max(
    0,
    Math.min(sceneFiles.length - 1, Math.floor(progress * sceneFiles.length))
  )
  const activeSceneSrc = withAssetVersion(
    `${storyRoot}/${sceneFiles[activeSceneIndex] || sceneFiles[0]}`,
    assetVersion
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('story_bgm_enabled', String(bgmEnabled))
  }, [bgmEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('story_bgm_volume', String(Math.max(0, Math.min(bgmVolume, 0.45))))
  }, [bgmVolume])

  useEffect(() => {
    let cancelled = false

    async function loadStoryAssets() {
      try {
        const [manifestResp, scriptResp] = await Promise.all([
          fetch(`${storyRoot}/manifest.json`, { cache: 'no-store' }),
          fetch(`${storyRoot}/script.txt`, { cache: 'no-store' }),
        ])

        const manifestPayload = manifestResp.ok
          ? await manifestResp.json().catch(() => null)
          : null
        const scriptPayload = scriptResp.ok
          ? await scriptResp.text().catch(() => '')
          : ''

        if (cancelled) return

        if (manifestPayload) {
          setManifest(parseStoryManifest(manifestPayload))
        } else {
          setManifest(DEFAULT_MANIFEST)
        }
        const versionFromHeaders = String(
          manifestResp.headers.get('etag')
          || manifestResp.headers.get('last-modified')
          || Date.now()
        ).trim()
        setAssetVersion(versionFromHeaders || String(Date.now()))
        setScriptText(String(scriptPayload || '').trim())
        setLoadError('')
      } catch (error) {
        if (cancelled) return
        setLoadError(String(error instanceof Error ? error.message : 'story_asset_load_failed'))
      }
    }

    void loadStoryAssets()
    return () => {
      cancelled = true
    }
  }, [storyRoot])

  useEffect(() => {
    const globalKey = '__onlytrade_story_audio__'
    const audioKeys = ['__onlytrade_story_audio__', '__onlytrade_multi_story_audio__']
    const globalStore = window as unknown as Record<string, unknown>

    for (const key of audioKeys) {
      const previous = globalStore[key] as
        | { narration?: HTMLAudioElement | null, bgm?: HTMLAudioElement | null }
        | undefined
      if (!previous) continue
      if (previous.narration) {
        previous.narration.pause()
        previous.narration.src = ''
      }
      if (previous.bgm) {
        previous.bgm.pause()
        previous.bgm.src = ''
      }
      delete globalStore[key]
    }

    const narration = new Audio(narrationSrc)
    narration.preload = 'auto'
    narration.loop = true
    narration.autoplay = true
    narration.volume = 1

    const bgm = new Audio(bgmSrc)
    bgm.preload = 'auto'
    bgm.loop = true

    narrationAudioRef.current = narration
    bgmAudioRef.current = bgm
    narrationRetryCountRef.current = 0
    manualPauseRef.current = false
    pendingUnmuteRef.current = false
    setNarrationTimeSec(0)
    setNarrationDurationSec(Math.max(0, manifest.duration_sec || 0))
    setNarrationPlaying(false)
    setMediaError('')

    const onLoadedMetadata = () => {
      const duration = Number(narration.duration)
      if (Number.isFinite(duration) && duration > 0) {
        setNarrationDurationSec(duration)
      }
    }
    const onTimeUpdate = () => {
      setNarrationTimeSec(Number.isFinite(narration.currentTime) ? narration.currentTime : 0)
    }
    const onPlay = () => {
      setNarrationPlaying(true)
    }
    const onPause = () => {
      setNarrationPlaying(false)
    }
    const onNarrationError = () => {
      if (narrationRetryCountRef.current >= 2) {
        setMediaError('narration_load_failed')
        return
      }

      narrationRetryCountRef.current += 1
      const retry = narrationRetryCountRef.current
      const join = narrationSrc.includes('?') ? '&' : '?'
      narration.src = `${narrationSrc}${join}retry=${Date.now()}-${retry}`
      narration.load()
    }
    const onNarrationCanPlay = () => {
      setMediaError((prev) => (prev === 'narration_load_failed' ? '' : prev))
      if (!manualPauseRef.current && narration.paused) {
        void tryStartNarration()
      }
    }
    const onBgmError = () => {
      setMediaError((prev) => prev || 'bgm_load_failed')
    }

    narration.addEventListener('loadedmetadata', onLoadedMetadata)
    narration.addEventListener('timeupdate', onTimeUpdate)
    narration.addEventListener('play', onPlay)
    narration.addEventListener('pause', onPause)
    narration.addEventListener('error', onNarrationError)
    narration.addEventListener('canplay', onNarrationCanPlay)
    bgm.addEventListener('error', onBgmError)

    globalStore[globalKey] = { narration, bgm }

    narration.load()
    bgm.load()

    return () => {
      narration.removeEventListener('loadedmetadata', onLoadedMetadata)
      narration.removeEventListener('timeupdate', onTimeUpdate)
      narration.removeEventListener('play', onPlay)
      narration.removeEventListener('pause', onPause)
      narration.removeEventListener('error', onNarrationError)
      narration.removeEventListener('canplay', onNarrationCanPlay)
      bgm.removeEventListener('error', onBgmError)
      narration.pause()
      bgm.pause()
      narration.src = ''
      bgm.src = ''
      const current = globalStore[globalKey] as
        | { narration?: HTMLAudioElement | null, bgm?: HTMLAudioElement | null }
        | undefined
      if (current?.narration === narration && current?.bgm === bgm) {
        delete globalStore[globalKey]
      }
      if (narrationAudioRef.current === narration) narrationAudioRef.current = null
      if (bgmAudioRef.current === bgm) bgmAudioRef.current = null
    }
  }, [narrationSrc, bgmSrc, manifest.duration_sec])

  const tryStartNarration = useCallback(async () => {
    const narration = narrationAudioRef.current
    if (!narration) return
    if (!narration.paused) {
      setNarrationPlaying(true)
      return
    }

    try {
      narration.muted = false
      await narration.play()
      pendingUnmuteRef.current = false
      setNarrationPlaying(true)
    } catch (error) {
      const message = String(error instanceof Error ? error.message : 'narration_play_failed')
      if (/AbortError|interrupted/i.test(message)) {
        setTimeout(() => {
          const current = narrationAudioRef.current
          if (!current || !current.paused) return
          current.play().catch(() => {})
        }, 250)
        return
      }
      if (/NotAllowedError|play\(\) failed|AbortError|interrupted/i.test(message)) {
        try {
          narration.muted = true
          await narration.play()
          pendingUnmuteRef.current = true
          setNarrationPlaying(true)
          setMediaError('')
          return
        } catch {
          // Autoplay still blocked on this webview/browser.
        }
        setNarrationPlaying(false)
        return
      }
      setMediaError(message)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const tryUnmuteAfterInteraction = () => {
      const phoneNoiseContext = phoneNoiseContextRef.current
      if (phoneNoiseContext && phoneNoiseContext.state === 'suspended') {
        phoneNoiseContext.resume().catch(() => {})
      }

      if (!pendingUnmuteRef.current) return
      const narration = narrationAudioRef.current
      if (!narration) return
      narration.muted = false
      narration
        .play()
        .then(() => {
          pendingUnmuteRef.current = false
          setNarrationPlaying(true)
        })
        .catch(() => {
          narration.muted = true
        })
    }

    window.addEventListener('pointerdown', tryUnmuteAfterInteraction)
    window.addEventListener('touchstart', tryUnmuteAfterInteraction)
    window.addEventListener('keydown', tryUnmuteAfterInteraction)

    return () => {
      window.removeEventListener('pointerdown', tryUnmuteAfterInteraction)
      window.removeEventListener('touchstart', tryUnmuteAfterInteraction)
      window.removeEventListener('keydown', tryUnmuteAfterInteraction)
    }
  }, [])

  useEffect(() => {
    void tryStartNarration()
  }, [tryStartNarration, narrationSrc])

  useEffect(() => {
    const narration = narrationAudioRef.current
    if (!narration) return
    if (!narration.paused || manualPauseRef.current) return
    const timer = window.setTimeout(() => {
      if (!manualPauseRef.current) {
        void tryStartNarration()
      }
    }, 450)
    return () => {
      window.clearTimeout(timer)
    }
  }, [tryStartNarration, narrationSrc])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const shouldEnableNoise = narrationPlaying && listenerSpeaking
    if (!shouldEnableNoise) {
      const existing = phoneNoiseSourceRef.current
      if (existing) {
        try {
          existing.stop()
        } catch {
          // ignore
        }
        phoneNoiseSourceRef.current = null
      }
      return
    }

    const AudioCtor = (
      window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    )
    if (!AudioCtor) return

    if (!phoneNoiseContextRef.current) {
      phoneNoiseContextRef.current = new AudioCtor()
    }
    const ctx = phoneNoiseContextRef.current
    if (!ctx) return

    if (!phoneNoiseGainRef.current) {
      const gain = ctx.createGain()
      gain.gain.value = 0.016
      gain.connect(ctx.destination)
      phoneNoiseGainRef.current = gain
    }

    if (!phoneNoiseBufferRef.current) {
      const frameCount = Math.floor(ctx.sampleRate * 1.5)
      const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate)
      const channel = buffer.getChannelData(0)
      for (let i = 0; i < frameCount; i += 1) {
        channel[i] = (Math.random() * 2 - 1) * 0.42
      }
      phoneNoiseBufferRef.current = buffer
    }

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }

    if (!phoneNoiseSourceRef.current && phoneNoiseGainRef.current && phoneNoiseBufferRef.current) {
      const source = ctx.createBufferSource()
      source.buffer = phoneNoiseBufferRef.current
      source.loop = true

      const highpass = ctx.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 420

      const lowpass = ctx.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 3400

      const bandpass = ctx.createBiquadFilter()
      bandpass.type = 'bandpass'
      bandpass.frequency.value = 1650
      bandpass.Q.value = 0.75

      source.connect(highpass)
      highpass.connect(lowpass)
      lowpass.connect(bandpass)
      bandpass.connect(phoneNoiseGainRef.current)

      source.onended = () => {
        if (phoneNoiseSourceRef.current === source) {
          phoneNoiseSourceRef.current = null
        }
      }

      try {
        source.start()
        phoneNoiseSourceRef.current = source
      } catch {
        // ignore duplicate start or autoplay restrictions
      }
    }
  }, [listenerSpeaking, narrationPlaying])

  useEffect(() => {
    return () => {
      const source = phoneNoiseSourceRef.current
      if (source) {
        try {
          source.stop()
        } catch {
          // ignore
        }
        phoneNoiseSourceRef.current = null
      }
      const ctx = phoneNoiseContextRef.current
      if (ctx) {
        ctx.close().catch(() => {})
        phoneNoiseContextRef.current = null
      }
      phoneNoiseGainRef.current = null
      phoneNoiseBufferRef.current = null
    }
  }, [])

  const toggleNarration = useCallback(async () => {
    const narration = narrationAudioRef.current
    if (!narration) return

    if (!narration.paused) {
      manualPauseRef.current = true
      pendingUnmuteRef.current = false
      narration.pause()
      setNarrationPlaying(false)
      return
    }

    if (narration.paused) {
      manualPauseRef.current = false
      try {
        narration.muted = false
        await narration.play()
        pendingUnmuteRef.current = false
        setNarrationPlaying(true)
      } catch (error) {
        const message = String(error instanceof Error ? error.message : 'narration_play_failed')
        if (/NotAllowedError|play\(\) failed|AbortError|interrupted/i.test(message)) {
          setNarrationPlaying(false)
          return
        }
        setMediaError(message)
      }
    }
  }, [])

  useEffect(() => {
    const bgm = bgmAudioRef.current
    if (!bgm) return

    const volume = Math.max(0, Math.min(bgmVolume, 0.45))
    const duckFactor = narrationPlaying ? 0.24 : 1
    bgm.volume = Math.max(0, Math.min(volume * duckFactor, 1))

    if (!bgmEnabled || !narrationPlaying) {
      bgm.pause()
      return
    }
    bgm.play().catch(() => {})
  }, [bgmEnabled, bgmVolume, narrationPlaying])

  const seekNarration = useCallback((nextSec: number) => {
    const narration = narrationAudioRef.current
    if (!narration) return
    const upper = narrationDurationSec > 0 ? narrationDurationSec : Math.max(0, manifest.duration_sec)
    const safe = Math.max(0, Math.min(nextSec, upper))
    narration.currentTime = safe
    setNarrationTimeSec(safe)
  }, [narrationDurationSec, manifest.duration_sec])

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#090909] text-white">
      <div className="relative mx-auto h-full w-full max-w-[480px] overflow-hidden border-x border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(220,38,38,0.18),transparent_45%),radial-gradient(circle_at_80%_75%,rgba(234,179,8,0.14),transparent_45%)]" />

        <div className="relative z-10 flex h-full flex-col">
          <div className="shrink-0 border-b border-white/15 bg-black/45 px-3 pb-2 pt-[max(10px,env(safe-area-inset-top,0px))] backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-black tracking-wide text-amber-200">{manifest.title}</div>
                <div className="text-[10px] font-mono text-amber-300/85">{manifest.subtitle} · host {selectedTrader.trader_name}</div>
              </div>
              <div className="rounded-full border border-white/20 bg-black/55 px-2 py-0.5 text-[10px] font-mono text-white/90">
                {modeLabel}
              </div>
            </div>

            {showDualSpeakerIndicator && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-white/90">
                <div className="flex items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-2 py-1">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/75 text-[9px] font-black text-black">
                    A
                  </span>
                  <span className="font-semibold">alpha</span>
                  {hostSpeaking && <span className="rounded bg-emerald-400/25 px-1.5 py-0.5 text-[9px] text-emerald-200">在发言</span>}
                </div>

                <div className="flex items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-2 py-1">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-pink-400/75 text-[9px] font-black text-black">
                    真
                  </span>
                  <span className="font-semibold">xiaozhen</span>
                  {guestSpeaking && <span className="rounded bg-emerald-400/25 px-1.5 py-0.5 text-[9px] text-emerald-200">在发言</span>}
                </div>

                {listenerSpeaking && (
                  <span className="rounded-full border border-amber-300/40 bg-amber-500/20 px-2 py-1 text-[9px] font-semibold text-amber-200">
                    连线听众在发言 · 已叠加电话噪音
                  </span>
                )}
              </div>
            )}

            {(isDegraded || loadError || mediaError) && (
              <div className="mt-2 rounded border border-red-400/35 bg-red-500/15 px-2 py-1 text-[10px] text-red-100">
                {loadError || mediaError || (language === 'zh'
                  ? '数据降级：已启用轮询兜底。'
                  : 'Degraded stream: polling fallback active.')}
              </div>
            )}
          </div>

          <div className="relative shrink-0 border-b border-white/10 bg-black/70" style={{ height: '48vh' }}>
            <img
              src={activeSceneSrc}
              alt={manifest.title}
              className={`h-full w-full ${singleSceneMode ? 'object-contain object-center' : 'object-cover'}`}
              loading="eager"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/40" />
          </div>

          <div className="shrink-0 border-b border-white/10 bg-[#121212] px-3 py-2">
            <div className="min-h-[96px] rounded border border-white/15 bg-black/45 p-2">
              <div className="line-clamp-4 text-[13px] font-medium leading-relaxed text-white">
                {activeCueText || (language === 'zh' ? '说书准备中...' : 'Story stream loading...')}
              </div>
              <div className="mt-1 text-[10px] font-mono text-white/65">
                scene {activeSceneIndex + 1}/{sceneFiles.length}
              </div>
            </div>
          </div>

          <div className="shrink-0 border-b border-white/10 bg-[#101010] px-3 py-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void toggleNarration()}
                className="rounded border border-amber-300/40 bg-black/45 px-2 py-1 text-[11px] font-bold text-amber-200"
              >
                {narrationPlaying ? (language === 'zh' ? '暂停' : 'Pause') : (language === 'zh' ? '继续' : 'Resume')}
              </button>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={Math.max(1, narrationDurationSec || manifest.duration_sec)}
                step={0.1}
                value={Math.min(narrationTimeSec, Math.max(1, narrationDurationSec || manifest.duration_sec))}
                onInput={(event) => {
                  const target = event.target as HTMLInputElement
                  seekNarration(Number(target.value))
                }}
                onChange={(event) => {
                  const target = event.target as HTMLInputElement
                  seekNarration(Number(target.value))
                }}
                className="h-4 w-full accent-amber-300"
                style={{ touchAction: 'pan-x' }}
                aria-label="Narration progress"
              />
            </div>
            <div className="mt-2 text-right text-[10px] font-mono text-white/65">
              {formatClock(narrationTimeSec)} / {formatClock(narrationDurationSec || manifest.duration_sec)}
            </div>
          </div>

          <div className="min-h-0 flex-1 bg-[#0d0d0d]" />
        </div>
      </div>
    </div>
  )
}
