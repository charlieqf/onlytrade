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

type SubtitleCue = {
  startSec: number
  endSec: number
  text: string
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

function detectPathBase(): string {
  if (typeof window === 'undefined') return ''
  const pathname = String(window.location.pathname || '')
  if (pathname === '/onlytrade' || pathname.startsWith('/onlytrade/')) {
    return '/onlytrade'
  }
  return ''
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

function splitScriptSentences(script: string): string[] {
  const compact = String(script || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('')
  if (!compact) return []

  const matched = compact.match(/[^。！？!?]+[。！？!?]?/g) || []
  return matched
    .map((item) => item.trim())
    .filter(Boolean)
}

function coalesceSentences(sentences: string[], targetCount: number): string[] {
  if (sentences.length <= targetCount) return sentences
  const chunkSize = Math.ceil(sentences.length / targetCount)
  const merged: string[] = []
  for (let i = 0; i < sentences.length; i += chunkSize) {
    merged.push(sentences.slice(i, i + chunkSize).join(''))
  }
  return merged
}

function buildSubtitleCues(script: string, durationSec: number): SubtitleCue[] {
  const rawSentences = splitScriptSentences(script)
  if (!rawSentences.length) return []

  const sentences = coalesceSentences(rawSentences, 220)
  const safeDuration = Math.max(10, Number(durationSec) || 1001)
  const minSec = 2.1
  const maxSec = 8.2

  const weights = sentences.map((line) => Math.max(8, line.replace(/\s+/g, '').length))
  const totalWeight = weights.reduce((sum, n) => sum + n, 0)

  const preliminary = sentences.map((text, idx) => {
    const raw = (safeDuration * weights[idx]) / Math.max(1, totalWeight)
    return {
      text,
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
    freshnessLabel,
    packetAgeLabel,
    decisionAgeLabel,
    transportLabel,
    isDegraded,
    sseStatus,
    language,
  } = usePhoneStreamData(props)

  const [manifest, setManifest] = useState<StoryManifest>(DEFAULT_MANIFEST)
  const [scriptText, setScriptText] = useState('')
  const [loadError, setLoadError] = useState('')
  const [mediaError, setMediaError] = useState('')

  const [narrationTimeSec, setNarrationTimeSec] = useState(0)
  const [narrationDurationSec, setNarrationDurationSec] = useState(0)
  const [narrationPlaying, setNarrationPlaying] = useState(false)

  const [bgmEnabled, setBgmEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const raw = window.localStorage.getItem('story_bgm_enabled')
    return raw == null ? true : raw !== 'false'
  })
  const [bgmVolume, setBgmVolume] = useState<number>(() => {
    if (typeof window === 'undefined') return 0.16
    const raw = Number(window.localStorage.getItem('story_bgm_volume') || '')
    if (!Number.isFinite(raw)) return 0.16
    return Math.max(0, Math.min(raw, 0.45))
  })

  const narrationAudioRef = useRef<HTMLAudioElement | null>(null)
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null)
  const narrationRetryCountRef = useRef(0)

  const pathBase = useMemo(() => detectPathBase(), [])
  const storyRoot = `${pathBase}/story/zhaolaoge`

  const narrationSrc = `${storyRoot}/${manifest.narration_file}`
  const bgmSrc = `${storyRoot}/${manifest.bgm_file}`

  const subtitleCues = useMemo(() => {
    const baseDuration = narrationDurationSec > 0
      ? narrationDurationSec
      : Math.max(1, manifest.duration_sec)
    return buildSubtitleCues(scriptText, baseDuration)
  }, [scriptText, narrationDurationSec, manifest.duration_sec])

  const activeCue = useMemo(() => {
    if (!subtitleCues.length) return ''
    const cue = subtitleCues.find(
      (row) => narrationTimeSec >= row.startSec && narrationTimeSec < row.endSec
    )
    return cue?.text || subtitleCues[subtitleCues.length - 1]?.text || ''
  }, [subtitleCues, narrationTimeSec])

  const sceneFiles = manifest.scenes.length ? manifest.scenes : DEFAULT_SCENES
  const progress = narrationDurationSec > 0
    ? Math.max(0, Math.min(narrationTimeSec / narrationDurationSec, 1))
    : 0
  const activeSceneIndex = Math.max(
    0,
    Math.min(sceneFiles.length - 1, Math.floor(progress * sceneFiles.length))
  )
  const activeSceneSrc = `${storyRoot}/${sceneFiles[activeSceneIndex] || sceneFiles[0]}`

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
    const narration = new Audio(narrationSrc)
    narration.preload = 'auto'
    narration.loop = true

    const bgm = new Audio(bgmSrc)
    bgm.preload = 'auto'
    bgm.loop = true

    narrationAudioRef.current = narration
    bgmAudioRef.current = bgm
    narrationRetryCountRef.current = 0
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
      if (narrationAudioRef.current === narration) narrationAudioRef.current = null
      if (bgmAudioRef.current === bgm) bgmAudioRef.current = null
    }
  }, [narrationSrc, bgmSrc, manifest.duration_sec])

  const tryStartNarration = useCallback(async () => {
    const narration = narrationAudioRef.current
    if (!narration || !narration.paused) return
    try {
      await narration.play()
    } catch (error) {
      const message = String(error instanceof Error ? error.message : 'narration_play_failed')
      if (/NotAllowedError|play\(\) failed|AbortError|interrupted/i.test(message)) {
        return
      }
      setMediaError(message)
    }
  }, [])

  useEffect(() => {
    void tryStartNarration()
  }, [tryStartNarration, narrationSrc])

  const toggleNarration = useCallback(async () => {
    const narration = narrationAudioRef.current
    if (!narration) return

    if (narration.paused) {
      try {
        await narration.play()
      } catch (error) {
        const message = String(error instanceof Error ? error.message : 'narration_play_failed')
        if (/NotAllowedError|play\(\) failed|AbortError|interrupted/i.test(message)) {
          return
        }
        setMediaError(message)
      }
      return
    }

    narration.pause()
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

            <div className="mt-2 flex flex-wrap items-center gap-1 text-[9px] font-mono text-white/85">
              <span className="rounded bg-black/55 px-1.5 py-0.5 text-cyan-300">{transportLabel}</span>
              <span className="rounded bg-black/55 px-1.5 py-0.5">{sseStatus}</span>
              <span className="rounded bg-black/55 px-1.5 py-0.5">{freshnessLabel}</span>
              <span className="rounded bg-black/55 px-1.5 py-0.5">pkt {packetAgeLabel}</span>
              <span className="rounded bg-black/55 px-1.5 py-0.5">dec {decisionAgeLabel}</span>
            </div>

            {(isDegraded || loadError || mediaError) && (
              <div className="mt-2 rounded border border-red-400/35 bg-red-500/15 px-2 py-1 text-[10px] text-red-100">
                {loadError || mediaError || (language === 'zh'
                  ? '数据降级：已启用轮询兜底。'
                  : 'Degraded stream: polling fallback active.')}
              </div>
            )}
          </div>

          <div className="relative shrink-0 border-b border-white/10" style={{ height: '52vh' }}>
            <img
              src={activeSceneSrc}
              alt={manifest.title}
              className="h-full w-full object-cover"
              loading="eager"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/55" />

            <div className="absolute inset-x-3 bottom-3 rounded border border-white/20 bg-black/55 p-2 backdrop-blur-sm">
              <div className="line-clamp-3 text-[13px] font-medium leading-relaxed text-white">
                {activeCue || (language === 'zh' ? '说书准备中...' : 'Story stream loading...')}
              </div>
              <div className="mt-1 text-[10px] font-mono text-white/65">
                scene {activeSceneIndex + 1}/{sceneFiles.length} · {formatClock(narrationTimeSec)} / {formatClock(narrationDurationSec || manifest.duration_sec)}
              </div>
            </div>
          </div>

          <div className="shrink-0 border-b border-white/10 bg-[#101010] px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="rounded border border-amber-300/40 bg-amber-500/20 px-2 py-1 text-[10px] font-bold text-amber-200">
                {language === 'zh' ? '旁白循环播放' : 'Narration loop'}
              </div>

              <button
                type="button"
                onClick={() => void toggleNarration()}
                className="rounded border border-amber-300/40 bg-black/45 px-2 py-1 text-[11px] font-bold text-amber-200"
              >
                {narrationPlaying ? (language === 'zh' ? '暂停' : 'Pause') : (language === 'zh' ? '继续' : 'Resume')}
              </button>

              <button
                type="button"
                onClick={() => setBgmEnabled((prev) => !prev)}
                className={`rounded px-2 py-1 text-[11px] font-bold ${bgmEnabled ? 'bg-cyan-500/70 text-black' : 'bg-black/45 text-white/85'}`}
              >
                {bgmEnabled ? 'BGM on' : 'BGM off'}
              </button>
              <input
                type="range"
                min={0}
                max={0.45}
                step={0.01}
                value={Math.max(0, Math.min(bgmVolume, 0.45))}
                onInput={(event) => {
                  const target = event.target as HTMLInputElement
                  setBgmVolume(Math.max(0, Math.min(Number(target.value), 0.45)))
                }}
                onChange={(event) => {
                  const target = event.target as HTMLInputElement
                  setBgmVolume(Math.max(0, Math.min(Number(target.value), 0.45)))
                }}
                className="h-4 w-20 accent-cyan-300"
                style={{ touchAction: 'pan-x' }}
                aria-label="BGM volume"
              />
              <div className="ml-auto text-[10px] font-mono text-white/70">
                {Math.round(Math.max(0, Math.min(bgmVolume, 0.45)) * 100)}%
              </div>
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
