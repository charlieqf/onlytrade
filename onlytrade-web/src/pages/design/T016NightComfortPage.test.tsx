import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import T016NightComfortPage from './T016NightComfortPage'

const { getStreamThemeProfile, synthesizeRoomSpeech } = vi.hoisted(() => ({
  getStreamThemeProfile: vi.fn(),
  synthesizeRoomSpeech: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: {
    getStreamThemeProfile,
    synthesizeRoomSpeech,
  },
}))

vi.mock('../../hooks/useFullscreenLock', () => ({
  useFullscreenLock: vi.fn(),
}))

class FakeAudio {
  src = ''
  volume = 1
  loop = false
  preload = 'auto'
  pause = vi.fn()
  play = vi.fn(async () => undefined)
}

describe('T016NightComfortPage', () => {
  beforeEach(() => {
    getStreamThemeProfile.mockResolvedValue({ theme: 'hobit' })
    synthesizeRoomSpeech.mockResolvedValue(new Blob(['fake'], { type: 'audio/mpeg' }))
    vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          { text: '晚安。', rate: '0%' },
        ],
      })) as unknown as typeof fetch
    )
    window.history.pushState({}, '', '/stream/night-comfort?trader=t_021&theme=hobit')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('loads theme profile and narration assets for the selected trader id', async () => {
    render(
      <T016NightComfortPage
        selectedTrader={{ trader_id: 't_021' } as never}
        streamPacket={null as never}
        roomSseState={null as never}
        replayRuntimeStatus={null as never}
        language="zh"
      />
    )

    await waitFor(() => {
      expect(getStreamThemeProfile).toHaveBeenCalledWith('t_021')
    })

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/agents/t_021/assets/late_night_comfort.json'),
        expect.objectContaining({ method: 'GET', cache: 'no-store' })
      )
    })
  })

  it('uses static agent assets for the vibe-coding theme without narration fetch', async () => {
    window.history.pushState({}, '', '/stream/night-work?trader=t_021&theme=vibe-coding')

    const { container } = render(
      <T016NightComfortPage
        selectedTrader={{ trader_id: 't_021' } as never}
        streamPacket={null as never}
        roomSseState={null as never}
        replayRuntimeStatus={null as never}
        language="zh"
      />
    )

    await waitFor(() => {
      expect(getStreamThemeProfile).toHaveBeenCalledWith('t_021')
    })

    await waitFor(() => {
      expect(fetch).not.toHaveBeenCalled()
    })

    const videos = container.querySelectorAll('video')
    const audio = container.querySelector('audio')

    expect(videos[0]?.getAttribute('src')).toContain(
      '/api/agents/t_021/assets/7xb_shorts_first_20s_silent.mp4'
    )
    expect(audio?.getAttribute('src')).toContain(
      '/api/agents/t_021/assets/vibe_coding_mixed_final.mp3'
    )
  })
})
