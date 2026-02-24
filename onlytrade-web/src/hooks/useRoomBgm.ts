import { useEffect, useMemo, useRef, useState } from 'react'

export type BgmTrack = {
  id: string
  title: string
  src: string
}

const UNIVERSAL_ROOM_BGM: BgmTrack = {
  id: 'room-loop-track',
  title: '情深深雨濛濛',
  src: '/audio/bgm/room_loop.mp3',
}

const DEFAULT_BGM_VOLUME = 0.14
const DEFAULT_BGM_VOLUME_WECOM = 0.1
const DUCKING_FACTOR_DEFAULT = 0.35
const DUCKING_FACTOR_WECOM = 0.08
const BGM_GAIN_MULTIPLIER_WECOM = 0.55

function detectPathBase(): string {
  if (typeof window === 'undefined') return ''
  const pathname = String(window.location.pathname || '')
  if (pathname === '/onlytrade' || pathname.startsWith('/onlytrade/')) {
    return '/onlytrade'
  }
  return ''
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(value, 1))
}

function isWeComLikeWebView(): boolean {
  if (typeof window === 'undefined') return false
  const ua = String(window.navigator?.userAgent || '').toLowerCase()
  if (!ua) return false
  return ua.includes('wxwork') || ua.includes('wxworklocal') || ua.includes('micromessenger')
}

function resolveBgmPlaybackVolume({
  bgmVolume,
  ducking,
  isWeCom,
}: {
  bgmVolume: number
  ducking: boolean
  isWeCom: boolean
}): number {
  const baseVolume = clamp01(bgmVolume)
  const platformAdjusted = isWeCom
    ? baseVolume * BGM_GAIN_MULTIPLIER_WECOM
    : baseVolume
  const duckingFactor = isWeCom ? DUCKING_FACTOR_WECOM : DUCKING_FACTOR_DEFAULT
  return clamp01((ducking ? duckingFactor : 1) * platformAdjusted)
}

function resolveRoomBgmTracks(roomId: string): BgmTrack[] {
  const key = String(roomId || '').trim().toLowerCase()
  if (!key) return []
  const pathBase = detectPathBase()
  return [
    {
      ...UNIVERSAL_ROOM_BGM,
      src: `${pathBase}${UNIVERSAL_ROOM_BGM.src}`,
    },
  ]
}

export function useRoomBgm({ roomId, ducking = false }: { roomId: string; ducking?: boolean }) {
  const tracks = useMemo(() => resolveRoomBgmTracks(roomId), [roomId])
  const isWeComClient = useMemo(() => isWeComLikeWebView(), [])

  const [bgmEnabled, setBgmEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const raw = window.localStorage.getItem('stream_bgm_enabled')
    if (raw == null) return true
    return raw !== 'false'
  })
  const [bgmVolume, setBgmVolume] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_BGM_VOLUME
    const raw = Number(window.localStorage.getItem('stream_bgm_volume') || '')
    if (!Number.isFinite(raw)) {
      return isWeComLikeWebView() ? DEFAULT_BGM_VOLUME_WECOM : DEFAULT_BGM_VOLUME
    }
    return clamp01(raw)
  })
  const [bgmError, setBgmError] = useState<string>('')
  const [bgmTrackTitle, setBgmTrackTitle] = useState<string>('')

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const indexRef = useRef<number>(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('stream_bgm_enabled', String(bgmEnabled))
  }, [bgmEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('stream_bgm_volume', String(clamp01(bgmVolume)))
  }, [bgmVolume])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const targetVolume = resolveBgmPlaybackVolume({
      bgmVolume,
      ducking,
      isWeCom: isWeComClient,
    })
    audio.volume = targetVolume
  }, [bgmVolume, ducking, isWeComClient])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!bgmEnabled || tracks.length === 0) return

    const tryResume = () => {
      const audio = audioRef.current
      if (!audio) return
      if (!audio.src) return
      if (!audio.paused) return

      audio
        .play()
        .then(() => {
          setBgmError('')
          window.removeEventListener('pointerdown', tryResume)
          window.removeEventListener('keydown', tryResume)
          window.removeEventListener('touchstart', tryResume)
        })
        .catch((error) => {
          const message = String(error instanceof Error ? error.message : 'bgm_resume_failed')
          if (/NotAllowedError|play\(\) failed|AbortError|interrupted/i.test(message)) {
            return
          }
          setBgmError(message)
        })
    }

    window.addEventListener('pointerdown', tryResume)
    window.addEventListener('keydown', tryResume)
    window.addEventListener('touchstart', tryResume)

    return () => {
      window.removeEventListener('pointerdown', tryResume)
      window.removeEventListener('keydown', tryResume)
      window.removeEventListener('touchstart', tryResume)
    }
  }, [bgmEnabled, tracks])

  useEffect(() => {
    if (tracks.length === 0) {
      setBgmTrackTitle('')
      setBgmError('')
      return
    }

    const audio = audioRef.current || new Audio()
    audioRef.current = audio
    audio.preload = 'auto'

    const playTrack = async (idx: number) => {
      if (!bgmEnabled || tracks.length === 0) return
      const safeIdx = Math.max(0, Math.min(idx, tracks.length - 1))
      const track = tracks[safeIdx]
      indexRef.current = safeIdx
      setBgmTrackTitle(track.title)
      audio.src = track.src
      audio.loop = false
      audio.volume = resolveBgmPlaybackVolume({
        bgmVolume,
        ducking,
        isWeCom: isWeComClient,
      })
      try {
        await audio.play()
        setBgmError('')
      } catch (error) {
        const message = String(error instanceof Error ? error.message : 'bgm_play_failed')
        if (/NotAllowedError|play\(\) failed|AbortError|interrupted/i.test(message)) {
          setBgmError('')
          return
        }
        setBgmError(message)
      }
    }

    const onEnded = () => {
      if (!bgmEnabled || tracks.length === 0) return
      let next = indexRef.current + 1
      if (next >= tracks.length) next = 0
      void playTrack(next)
    }

    const onError = () => {
      if (!bgmEnabled) {
        setBgmError('')
        return
      }
      if (audio.networkState === audio.NETWORK_NO_SOURCE) {
        setBgmError('bgm_file_missing_or_blocked')
      }
    }

    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    if (bgmEnabled) {
      void playTrack(0)
    } else {
      audio.pause()
    }

    return () => {
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audio.pause()
      audio.currentTime = 0
    }
  }, [roomId, tracks, bgmEnabled, bgmVolume, ducking, isWeComClient])

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
        audioRef.current = null
      }
    }
  }, [])

  return {
    bgmAvailable: tracks.length > 0,
    bgmEnabled,
    setBgmEnabled,
    bgmVolume,
    setBgmVolume,
    bgmTrackTitle,
    bgmError,
  }
}
