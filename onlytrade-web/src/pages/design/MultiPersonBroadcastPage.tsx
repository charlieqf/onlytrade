import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useFullscreenLock } from '../../hooks/useFullscreenLock'
import {
  type FormalStreamDesignPageProps,
  usePhoneStreamData,
} from './phoneStreamShared'

type SpeakerCategory = 'host' | 'guest' | 'listener' | 'unknown'

type MultiParticipant = {
  id: string
  name: string
  role: SpeakerCategory
  seat?: number
  avatar?: string
}

type MultiManifest = {
  title: string
  subtitle: string
  narration_file: string
  bgm_file: string
  duration_sec: number
  scenes: string[]
  participants: MultiParticipant[]
}

type ScriptSegment = {
  text: string
  speakerId: string
  speakerCategory: SpeakerCategory
}

type SubtitleCue = {
  startSec: number
  endSec: number
  text: string
  speakerId: string
  speakerCategory: SpeakerCategory
}

const DEFAULT_MULTI_MANIFEST: MultiManifest = {
  title: '多人直播厅',
  subtitle: 'multi-person / oral broadcast',
  narration_file: 'narration.mp3',
  bgm_file: 'bgm.mp3',
  duration_sec: 900,
  scenes: ['scene_0.png'],
  participants: [],
}

const SHOW_SLUG_BY_TRADER: Record<string, string> = {
  t_009: 'qingshan',
  t_010: 'ai_daily_20260226',
  t_011: 'citrini_ghost_20260226',
  t_012: 'ai_tribunal_20260226',
  t_013: 'mandela_effect',
  t_014: 'libai',
}

const SPEAKER_NAME_MAP: Record<string, string> = {
  alpha: 'alpha',
  xiaozhen: 'xiaozhen',
  caller_1: '老王',
  caller_2: '小李',
  caller_3: '阿杰',
  listener: '连线听众',
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

function sanitizeShowSlug(raw: string): string {
  const value = String(raw || '').trim().toLowerCase()
  if (!/^[a-z0-9_-]{2,48}$/.test(value)) return ''
  return value
}

function isVideoAsset(pathLike: string): boolean {
  const raw = String(pathLike || '').trim().toLowerCase()
  if (!raw) return false
  const clean = raw.split('?')[0].split('#')[0]
  return clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.mov') || clean.endsWith('.m4v')
}

function resolveShowSlug(traderId: string): string {
  const fallback = SHOW_SLUG_BY_TRADER[String(traderId || '').trim().toLowerCase()] || 'ai_tribunal_20260226'
  if (typeof window === 'undefined') return fallback
  try {
    const params = new URLSearchParams(window.location.search)
    const show = sanitizeShowSlug(params.get('show') || '')
    if (show) return show
    const story = sanitizeShowSlug(params.get('story') || '')
    if (story) return story
  } catch {
    // ignore malformed query
  }
  return fallback
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeSpeakerId(raw: string): string {
  const token = String(raw || '').trim().toLowerCase()
  if (!token) return 'unknown'
  if (token === 'host') return 'alpha'
  if (token === 'guest') return 'xiaozhen'
  if (token === 'audience' || token === 'listener') return 'listener'
  return token
}

function speakerCategoryFromId(id: string): SpeakerCategory {
  if (id === 'alpha' || id === 'host') return 'host'
  if (id === 'xiaozhen' || id === 'guest') return 'guest'
  if (id.startsWith('caller_') || id === 'listener') return 'listener'
  return 'unknown'
}

function parseScriptSegments(script: string): ScriptSegment[] {
  const lines = String(script || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const out: ScriptSegment[] = []
  for (const line of lines) {
    let speakerId = 'unknown'
    let text = line

    const bracketTagged = line.match(/^\[([^\]]+)\]\s*(.+)$/)
    if (bracketTagged) {
      speakerId = normalizeSpeakerId(bracketTagged[1])
      text = bracketTagged[2]
    } else {
      const colonTagged = line.match(/^([a-zA-Z0-9_\u4e00-\u9fa5]+)\s*[：:]\s*(.+)$/)
      if (colonTagged) {
        speakerId = normalizeSpeakerId(colonTagged[1])
        text = colonTagged[2]
      }
    }

    const compactText = String(text || '')
      .replace(/<break\s+time="\d+ms"\s*\/?>/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!compactText) continue
    if (/^sys_inject_(ad|song)$/i.test(compactText)) continue

    out.push({
      text: compactText,
      speakerId,
      speakerCategory: speakerCategoryFromId(speakerId),
    })
  }

  return out
}

function buildSubtitleCues(script: string, durationSec: number): SubtitleCue[] {
  const segments = parseScriptSegments(script)
  if (!segments.length) return []

  const safeDuration = Math.max(30, Number(durationSec) || 600)
  const minSec = 1.8
  const maxSec = 7.2
  const weights = segments.map((segment) => Math.max(8, segment.text.replace(/\s+/g, '').length))
  const totalWeight = weights.reduce((sum, n) => sum + n, 0)

  const preliminary = segments.map((segment, idx) => {
    const raw = (safeDuration * weights[idx]) / Math.max(1, totalWeight)
    return {
      ...segment,
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
      speakerId: row.speakerId,
      speakerCategory: row.speakerCategory,
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

function toParticipantName(id: string): string {
  if (SPEAKER_NAME_MAP[id]) return SPEAKER_NAME_MAP[id]
  if (id.startsWith('caller_')) {
    const n = Number(id.slice('caller_'.length))
    if (Number.isFinite(n) && n > 0) return `听众${n}`
    return '连线听众'
  }
  if (!id || id === 'unknown') return '待连线'
  return id
}

function parseManifest(payload: unknown): MultiManifest {
  if (!payload || typeof payload !== 'object') return DEFAULT_MULTI_MANIFEST
  const row = payload as Record<string, unknown>
  const scenes = Array.isArray(row.scenes)
    ? row.scenes.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  const participants = Array.isArray(row.participants)
    ? row.participants
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const source = item as Record<string, unknown>
        const id = normalizeSpeakerId(String(source.id || source.role || '').trim())
        if (!id || id === 'unknown') return null
        return {
          id,
          name: String(source.name || toParticipantName(id)).trim() || toParticipantName(id),
          role: speakerCategoryFromId(id),
          seat: Number.isFinite(Number(source.seat)) ? Number(source.seat) : undefined,
          avatar: String(source.avatar || source.avatar_file || source.video || '').trim() || undefined,
        } as MultiParticipant
      })
      .filter(Boolean) as MultiParticipant[]
    : []

  return {
    title: String(row.title || DEFAULT_MULTI_MANIFEST.title).trim() || DEFAULT_MULTI_MANIFEST.title,
    subtitle: String(row.subtitle || DEFAULT_MULTI_MANIFEST.subtitle).trim() || DEFAULT_MULTI_MANIFEST.subtitle,
    narration_file: String(row.narration_file || DEFAULT_MULTI_MANIFEST.narration_file).trim() || DEFAULT_MULTI_MANIFEST.narration_file,
    bgm_file: String(row.bgm_file || DEFAULT_MULTI_MANIFEST.bgm_file).trim() || DEFAULT_MULTI_MANIFEST.bgm_file,
    duration_sec: Math.max(30, toSafeNumber(row.duration_sec, DEFAULT_MULTI_MANIFEST.duration_sec)),
    scenes: scenes.length ? scenes : DEFAULT_MULTI_MANIFEST.scenes,
    participants,
  }
}

function inferParticipants(cues: SubtitleCue[], manifest: MultiManifest): MultiParticipant[] {
  const fromManifest = Array.isArray(manifest.participants) ? manifest.participants.slice(0, 4) : []
  if (fromManifest.length > 0) return fromManifest

  const seen = new Set<string>()
  const inferred: MultiParticipant[] = []
  for (const cue of cues) {
    if (seen.has(cue.speakerId) || cue.speakerId === 'unknown') continue
    seen.add(cue.speakerId)
    inferred.push({
      id: cue.speakerId,
      name: toParticipantName(cue.speakerId),
      role: cue.speakerCategory,
    })
    if (inferred.length >= 4) break
  }

  if (!inferred.length) {
    inferred.push(
      { id: 'alpha', name: 'alpha', role: 'host' },
      { id: 'xiaozhen', name: 'xiaozhen', role: 'guest' },
    )
  }
  return inferred
}

export default function MultiPersonBroadcastPage(props: FormalStreamDesignPageProps) {
  useFullscreenLock()
  const {
    selectedTrader,
    modeLabel,
    isDegraded,
    language,
  } = usePhoneStreamData(props)

  const [manifest, setManifest] = useState<MultiManifest>(DEFAULT_MULTI_MANIFEST)
  const [scriptText, setScriptText] = useState('')
  const [loadError, setLoadError] = useState('')
  const [mediaError, setMediaError] = useState('')
  const [assetVersion, setAssetVersion] = useState<string>(() => String(Date.now()))

  const [narrationTimeSec, setNarrationTimeSec] = useState(0)
  const [narrationDurationSec, setNarrationDurationSec] = useState(0)
  const [narrationPlaying, setNarrationPlaying] = useState(false)
  const [videoFallbackByKey, setVideoFallbackByKey] = useState<Record<string, boolean>>({})

  const narrationAudioRef = useRef<HTMLAudioElement | null>(null)
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null)
  const pendingUnmuteRef = useRef(false)
  const manualPauseRef = useRef(false)

  const phoneNoiseContextRef = useRef<AudioContext | null>(null)
  const phoneNoiseSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const phoneNoiseGainRef = useRef<GainNode | null>(null)
  const phoneNoiseBufferRef = useRef<AudioBuffer | null>(null)

  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const waveContextRef = useRef<AudioContext | null>(null)
  const waveAnalyserRef = useRef<AnalyserNode | null>(null)
  const waveSourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const waveSourceElementRef = useRef<HTMLAudioElement | null>(null)

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
  const showSlug = useMemo(() => resolveShowSlug(selectedTrader.trader_id), [selectedTrader.trader_id])
  const storyRoot = `${pathBase}/story/${showSlug}`

  const narrationSrc = useMemo(
    () => withAssetVersion(`${storyRoot}/${manifest.narration_file}`, assetVersion),
    [storyRoot, manifest.narration_file, assetVersion]
  )
  const bgmSrc = useMemo(
    () => withAssetVersion(`${storyRoot}/${manifest.bgm_file}`, assetVersion),
    [storyRoot, manifest.bgm_file, assetVersion]
  )

  const subtitleCues = useMemo(() => {
    const baseDuration = narrationDurationSec > 0 ? narrationDurationSec : Math.max(1, manifest.duration_sec)
    return buildSubtitleCues(scriptText, baseDuration)
  }, [scriptText, narrationDurationSec, manifest.duration_sec])

  const activeCue = useMemo<SubtitleCue | null>(() => {
    if (!subtitleCues.length) return null
    const cue = subtitleCues.find((row) => narrationTimeSec >= row.startSec && narrationTimeSec < row.endSec)
    return cue || subtitleCues[subtitleCues.length - 1] || null
  }, [subtitleCues, narrationTimeSec])

  const participants = useMemo(
    () => inferParticipants(subtitleCues, manifest),
    [subtitleCues, manifest]
  )

  const sceneFiles = manifest.scenes.length ? manifest.scenes : ['scene_0.png']

  const seatItems = useMemo(() => {
    const seatArray: Array<MultiParticipant | null> = [null, null, null, null]
    const taken = new Set<number>()
    for (const person of participants.slice(0, 4)) {
      const requestedSeat = Number(person.seat)
      const validRequested = Number.isFinite(requestedSeat) && requestedSeat >= 0 && requestedSeat < 4
      if (validRequested && !taken.has(requestedSeat)) {
        seatArray[requestedSeat] = person
        taken.add(requestedSeat)
        continue
      }
      const fallbackIdx = seatArray.findIndex((row) => row == null)
      if (fallbackIdx >= 0) {
        seatArray[fallbackIdx] = person
        taken.add(fallbackIdx)
      }
    }
    return seatArray
  }, [participants])

  const activeSpeakerId = activeCue?.speakerId || 'unknown'
  const activeSpeakerCategory = activeCue?.speakerCategory || 'unknown'
  const activeCueText = activeCue?.text || ''

  const activeSeatIndex = useMemo(() => {
    const direct = seatItems.findIndex((item) => item?.id === activeSpeakerId)
    if (direct >= 0) return direct
    if (activeSpeakerCategory !== 'unknown') {
      return seatItems.findIndex((item) => item?.role === activeSpeakerCategory)
    }
    return -1
  }, [seatItems, activeSpeakerId, activeSpeakerCategory])

  const resolveParticipantVisual = useCallback((item: MultiParticipant | null, seatIndex: number): string => {
    const custom = String(item?.avatar || '').trim()
    if (custom) {
      if (/^(https?:)?\/\//i.test(custom) || custom.startsWith('/')) {
        return withAssetVersion(custom, assetVersion)
      }
      return withAssetVersion(`${storyRoot}/${custom}`, assetVersion)
    }
    const fallbackScene = sceneFiles[seatIndex % Math.max(1, sceneFiles.length)] || sceneFiles[0]
    return withAssetVersion(`${storyRoot}/${fallbackScene}`, assetVersion)
  }, [assetVersion, sceneFiles, storyRoot])

  useEffect(() => {
    setVideoFallbackByKey({})
  }, [showSlug])

  useEffect(() => {
    let cancelled = false

    async function loadAssets() {
      try {
        const [manifestResp, scriptResp] = await Promise.all([
          fetch(`${storyRoot}/manifest.json`, { cache: 'no-store' }),
          fetch(`${storyRoot}/script.txt`, { cache: 'no-store' }),
        ])
        const manifestPayload = manifestResp.ok ? await manifestResp.json().catch(() => null) : null
        const scriptPayload = scriptResp.ok ? await scriptResp.text().catch(() => '') : ''
        if (cancelled) return

        setManifest(manifestPayload ? parseManifest(manifestPayload) : DEFAULT_MULTI_MANIFEST)
        setScriptText(String(scriptPayload || '').trim())
        const version = String(
          manifestResp.headers.get('etag')
          || manifestResp.headers.get('last-modified')
          || Date.now()
        ).trim()
        setAssetVersion(version || String(Date.now()))
        setLoadError('')
      } catch (error) {
        if (cancelled) return
        setLoadError(String(error instanceof Error ? error.message : 'multi_asset_load_failed'))
      }
    }

    void loadAssets()
    return () => {
      cancelled = true
    }
  }, [storyRoot])

  const ensureWaveAnalyser = useCallback((narration: HTMLAudioElement) => {
    if (typeof window === 'undefined') return
    const AudioCtor = (
      window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    )
    if (!AudioCtor) return

    if (!waveContextRef.current) {
      waveContextRef.current = new AudioCtor()
    }
    const ctx = waveContextRef.current
    if (!ctx) return

    if (waveSourceElementRef.current !== narration || !waveSourceRef.current || !waveAnalyserRef.current) {
      try {
        waveSourceRef.current?.disconnect()
      } catch {
        // ignore
      }
      try {
        waveAnalyserRef.current?.disconnect()
      } catch {
        // ignore
      }

      const source = ctx.createMediaElementSource(narration)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.82

      source.connect(analyser)
      analyser.connect(ctx.destination)

      waveSourceRef.current = source
      waveAnalyserRef.current = analyser
      waveSourceElementRef.current = narration
    }
  }, [])

  useEffect(() => {
    const globalKey = '__onlytrade_multi_story_audio__'
    const audioKeys = ['__onlytrade_story_audio__', '__onlytrade_multi_story_audio__']
    const globalStore = window as unknown as Record<string, unknown>

    for (const key of audioKeys) {
      const previous = globalStore[key] as
        | { narration?: HTMLAudioElement | null, bgm?: HTMLAudioElement | null }
        | undefined
      if (!previous) continue

      if (previous.narration) {
        previous.narration.pause()
        previous.narration.muted = true
        previous.narration.src = ''
        previous.narration.load()
      }
      if (previous.bgm) {
        previous.bgm.pause()
        previous.bgm.muted = true
        previous.bgm.src = ''
        previous.bgm.load()
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
    bgm.volume = 0.14

    narrationAudioRef.current = narration
    bgmAudioRef.current = bgm
    manualPauseRef.current = false
    pendingUnmuteRef.current = false
    setNarrationPlaying(false)
    setNarrationTimeSec(0)
    setNarrationDurationSec(Math.max(0, manifest.duration_sec || 0))
    setMediaError('')

    ensureWaveAnalyser(narration)

    const onLoadedMetadata = () => {
      const duration = Number(narration.duration)
      if (Number.isFinite(duration) && duration > 0) {
        setNarrationDurationSec(duration)
      }
    }
    const onTimeUpdate = () => {
      setNarrationTimeSec(Number.isFinite(narration.currentTime) ? narration.currentTime : 0)
    }
    const onPlay = () => setNarrationPlaying(true)
    const onPause = () => setNarrationPlaying(false)
    const onNarrationError = () => setMediaError('narration_load_failed')
    const onBgmError = () => setMediaError((prev) => prev || 'bgm_load_failed')

    narration.addEventListener('loadedmetadata', onLoadedMetadata)
    narration.addEventListener('timeupdate', onTimeUpdate)
    narration.addEventListener('play', onPlay)
    narration.addEventListener('pause', onPause)
    narration.addEventListener('error', onNarrationError)
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
  }, [bgmSrc, ensureWaveAnalyser, manifest.duration_sec, narrationSrc])

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
      if (/NotAllowedError|play\(\) failed|AbortError|interrupted/i.test(message)) {
        try {
          narration.muted = true
          await narration.play()
          pendingUnmuteRef.current = true
          setNarrationPlaying(true)
          return
        } catch {
          setNarrationPlaying(false)
          return
        }
      }
      setMediaError(message)
    }
  }, [])

  useEffect(() => {
    void tryStartNarration()
  }, [tryStartNarration, narrationSrc])

  useEffect(() => {
    const bgm = bgmAudioRef.current
    if (!bgm) return
    if (!narrationPlaying) {
      bgm.pause()
      return
    }
    bgm.play().catch(() => { })
  }, [narrationPlaying])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const onUnlock = () => {
      const narration = narrationAudioRef.current
      if (narration && pendingUnmuteRef.current) {
        narration.muted = false
        narration.play().then(() => {
          pendingUnmuteRef.current = false
          setNarrationPlaying(true)
        }).catch(() => {
          narration.muted = true
        })
      }
      waveContextRef.current?.resume().catch(() => { })
      phoneNoiseContextRef.current?.resume().catch(() => { })
    }

    window.addEventListener('pointerdown', onUnlock)
    window.addEventListener('touchstart', onUnlock)
    window.addEventListener('keydown', onUnlock)
    return () => {
      window.removeEventListener('pointerdown', onUnlock)
      window.removeEventListener('touchstart', onUnlock)
      window.removeEventListener('keydown', onUnlock)
    }
  }, [])

  useEffect(() => {
    const shouldEnableNoise = narrationPlaying && activeSpeakerCategory === 'listener'
    if (!shouldEnableNoise) {
      const source = phoneNoiseSourceRef.current
      if (source) {
        try {
          source.stop()
        } catch {
          // ignore
        }
        phoneNoiseSourceRef.current = null
      }
      return
    }

    if (typeof window === 'undefined') return
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
      gain.gain.value = 0.014
      gain.connect(ctx.destination)
      phoneNoiseGainRef.current = gain
    }

    if (!phoneNoiseBufferRef.current) {
      const frameCount = Math.floor(ctx.sampleRate * 1.2)
      const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate)
      const channel = buffer.getChannelData(0)
      for (let i = 0; i < frameCount; i += 1) {
        channel[i] = (Math.random() * 2 - 1) * 0.4
      }
      phoneNoiseBufferRef.current = buffer
    }

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { })
    }

    if (!phoneNoiseSourceRef.current && phoneNoiseGainRef.current && phoneNoiseBufferRef.current) {
      const source = ctx.createBufferSource()
      source.buffer = phoneNoiseBufferRef.current
      source.loop = true

      const highpass = ctx.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 430

      const lowpass = ctx.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 3450

      source.connect(highpass)
      highpass.connect(lowpass)
      lowpass.connect(phoneNoiseGainRef.current)

      source.onended = () => {
        if (phoneNoiseSourceRef.current === source) {
          phoneNoiseSourceRef.current = null
        }
      }
      source.start()
      phoneNoiseSourceRef.current = source
    }
  }, [activeSpeakerCategory, narrationPlaying])

  useEffect(() => {
    let raf = 0
    const canvas = waveCanvasRef.current
    if (!canvas) return () => { }
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return () => { }

    const freqData = new Uint8Array(128)

    const draw = () => {
      const el = waveCanvasRef.current
      if (!el) return
      const c = el.getContext('2d')
      if (!c) return

      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
      const width = Math.floor(el.clientWidth * dpr)
      const height = Math.floor(el.clientHeight * dpr)
      if (el.width !== width || el.height !== height) {
        el.width = width
        el.height = height
      }

      c.clearRect(0, 0, width, height)
      c.fillStyle = 'rgba(4, 12, 22, 0.75)'
      c.fillRect(0, 0, width, height)

      const analyser = waveAnalyserRef.current
      const centerY = Math.floor(height * 0.55)
      const now = Date.now()

      let bars: number[] = []
      if (analyser && narrationPlaying) {
        const len = Math.min(analyser.frequencyBinCount, freqData.length)
        analyser.getByteFrequencyData(freqData)
        bars = Array.from({ length: len }, (_, idx) => freqData[idx] / 255)
      } else {
        bars = Array.from({ length: 72 }, (_, idx) => {
          const phase = (now / 1000) * 2.4 + idx * 0.31
          return 0.18 + ((Math.sin(phase) + 1) / 2) * 0.42
        })
      }

      const count = bars.length
      const barGap = Math.max(1, Math.floor(width / Math.max(80, count * 2)))
      const barWidth = Math.max(2, Math.floor((width - barGap * (count + 1)) / count))
      const gradient = c.createLinearGradient(0, 0, width, 0)
      gradient.addColorStop(0, 'rgba(56, 189, 248, 0.95)')
      gradient.addColorStop(0.5, 'rgba(16, 185, 129, 0.95)')
      gradient.addColorStop(1, 'rgba(251, 191, 36, 0.95)')
      c.fillStyle = gradient

      let x = barGap
      for (let i = 0; i < count; i += 1) {
        const intensity = bars[i]
        const h = Math.max(4, Math.floor(intensity * height * 0.7))
        c.fillRect(x, centerY - h / 2, barWidth, h)
        x += barWidth + barGap
      }

      c.strokeStyle = 'rgba(255,255,255,0.6)'
      c.lineWidth = Math.max(1, dpr)
      c.beginPath()
      for (let i = 0; i < count; i += 1) {
        const intensity = bars[i]
        const px = barGap + i * (barWidth + barGap) + barWidth / 2
        const py = centerY - Math.sin((i / Math.max(1, count - 1)) * Math.PI * 2 + now / 380) * intensity * height * 0.16
        if (i === 0) c.moveTo(px, py)
        else c.lineTo(px, py)
      }
      c.stroke()

      raf = window.requestAnimationFrame(draw)
    }

    raf = window.requestAnimationFrame(draw)
    return () => {
      window.cancelAnimationFrame(raf)
    }
  }, [narrationPlaying])

  useEffect(() => {
    return () => {
      try {
        waveSourceRef.current?.disconnect()
      } catch {
        // ignore
      }
      try {
        waveAnalyserRef.current?.disconnect()
      } catch {
        // ignore
      }
      if (waveContextRef.current) {
        waveContextRef.current.close().catch(() => { })
        waveContextRef.current = null
      }

      const source = phoneNoiseSourceRef.current
      if (source) {
        try {
          source.stop()
        } catch {
          // ignore
        }
      }
      if (phoneNoiseContextRef.current) {
        phoneNoiseContextRef.current.close().catch(() => { })
        phoneNoiseContextRef.current = null
      }
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

    manualPauseRef.current = false
    try {
      narration.muted = false
      await narration.play()
      setNarrationPlaying(true)
    } catch {
      setNarrationPlaying(false)
    }
  }, [])

  const seekNarration = useCallback((nextSec: number) => {
    const narration = narrationAudioRef.current
    if (!narration) return
    const upper = narrationDurationSec > 0 ? narrationDurationSec : Math.max(0, manifest.duration_sec)
    const safe = Math.max(0, Math.min(nextSec, upper))
    narration.currentTime = safe
    setNarrationTimeSec(safe)
  }, [narrationDurationSec, manifest.duration_sec])

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#06080d] text-white">
      <div className="relative mx-auto h-full w-full max-w-[480px] overflow-hidden border-x border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(circle_at_82%_82%,rgba(251,191,36,0.15),transparent_40%)]" />

        <div className="relative z-10 flex h-full flex-col">
          <div className="shrink-0 border-b border-white/10 bg-black/45 px-3 pb-2 pt-[max(10px,env(safe-area-inset-top,0px))] backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-black tracking-wide text-cyan-200">{manifest.title}</div>
                <div className="text-[10px] font-mono text-cyan-100/80">{manifest.subtitle} · host {selectedTrader.trader_name}</div>
              </div>
              <div className="rounded-full border border-emerald-300/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-mono text-emerald-200">
                {modeLabel}
              </div>
            </div>

            {(isDegraded || loadError || mediaError) && (
              <div className="mt-2 rounded border border-red-400/35 bg-red-500/15 px-2 py-1 text-[10px] text-red-100">
                {loadError || mediaError || (language === 'zh'
                  ? '数据降级：已启用轮询兜底。'
                  : 'Degraded stream: polling fallback active.')}
              </div>
            )}
          </div>

          <div className="grid shrink-0 grid-cols-2 grid-rows-2 auto-rows-fr gap-2 border-b border-white/10 bg-black/50 p-2" style={{ height: '50vh' }}>
            {seatItems.map((item, idx) => {
              const hasParticipant = Boolean(item)
              const speaking = hasParticipant && idx === activeSeatIndex
              const visual = hasParticipant ? resolveParticipantVisual(item, idx) : ''
              const visualIsVideo = isVideoAsset(visual)
              const mediaKey = `${showSlug}:${idx}:${visual}`
              const fallbackScene = sceneFiles[idx % Math.max(1, sceneFiles.length)] || sceneFiles[0]
              const fallbackVisual = withAssetVersion(`${storyRoot}/${fallbackScene}`, assetVersion)
              const useVideo = visualIsVideo && !videoFallbackByKey[mediaKey]

              return (
                <div
                  key={item?.id || `seat-${idx}`}
                  className={`relative h-full min-h-0 overflow-hidden rounded-xl border ${speaking ? 'border-emerald-300/70 shadow-[0_0_18px_rgba(16,185,129,0.45)]' : 'border-white/15'}`}
                >
                  {hasParticipant ? (
                    <>
                      {useVideo ? (
                        <video
                          src={visual}
                          className="h-full w-full object-cover bg-black"
                          muted
                          autoPlay
                          loop
                          playsInline
                          preload="auto"
                          poster={fallbackVisual}
                          disablePictureInPicture
                          onError={() => {
                            setVideoFallbackByKey((prev) => ({ ...prev, [mediaKey]: true }))
                          }}
                        />
                      ) : (
                        <img
                          src={visualIsVideo ? fallbackVisual : visual}
                          alt={item?.name || `seat-${idx + 1}`}
                          className="h-full w-full object-cover"
                          loading="eager"
                        />
                      )}
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/35" />

                      <div className="absolute left-2 top-2 rounded-full border border-white/20 bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white/90">
                        {item?.role === 'host' ? 'Host' : item?.role === 'guest' ? 'Guest' : item?.role === 'listener' ? 'Caller' : 'Seat'}
                      </div>

                      <div className="absolute bottom-2 left-2 right-2">
                        <div className="rounded bg-black/55 px-2 py-1 text-[11px] font-semibold text-white">
                          {item?.name}
                        </div>
                        {speaking && (
                          <div className="mt-1 inline-flex rounded bg-emerald-400/25 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                            在发言
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.10),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(148,163,184,0.08),transparent_45%)]">
                      <div className="rounded border border-white/15 bg-black/40 px-3 py-1 text-[11px] font-semibold text-white/70">
                        待连线席位 {idx + 1}
                      </div>
                    </div>
                  )}

                  {speaking && (
                    <div className="pointer-events-none absolute inset-0 animate-pulse rounded-xl border border-emerald-300/70" />
                  )}
                </div>
              )
            })}
          </div>

          <div className="shrink-0 border-b border-white/10 bg-[#090d12] px-3 py-2">
            <div className="relative h-24 overflow-hidden rounded-lg border border-cyan-300/20 bg-black/60">
              <canvas ref={waveCanvasRef} className="h-full w-full" />
              <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-2 py-0.5 text-[10px] font-mono text-cyan-200">
                {activeCue ? `${toParticipantName(activeCue.speakerId)} 正在发言` : '等待音频'}
              </div>
            </div>

            <div className="mt-2 min-h-[60px] rounded border border-white/10 bg-black/45 p-2">
              <div className="line-clamp-3 text-[13px] leading-relaxed text-white/95">
                {activeCueText || (language === 'zh' ? '节目准备中...' : 'Preparing stream...')}
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void toggleNarration()}
                className="rounded border border-cyan-300/45 bg-black/45 px-2 py-1 text-[11px] font-bold text-cyan-200"
              >
                {narrationPlaying ? (language === 'zh' ? '暂停' : 'Pause') : (language === 'zh' ? '继续' : 'Resume')}
              </button>

              <input
                type="range"
                min={0}
                max={Math.max(1, narrationDurationSec || manifest.duration_sec)}
                step={0.1}
                value={Math.min(narrationTimeSec, Math.max(1, narrationDurationSec || manifest.duration_sec))}
                onInput={(event) => seekNarration(Number((event.target as HTMLInputElement).value))}
                onChange={(event) => seekNarration(Number((event.target as HTMLInputElement).value))}
                className="h-4 w-full accent-cyan-300"
                style={{ touchAction: 'pan-x' }}
                aria-label="Narration progress"
              />

              <div className="text-[10px] font-mono text-white/70">
                {formatClock(narrationTimeSec)} / {formatClock(narrationDurationSec || manifest.duration_sec)}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 bg-[#05070a]" />
        </div>
      </div>
    </div>
  )
}
