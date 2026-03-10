import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import T020MarketRadarLabPage from './T020MarketRadarLabPage'

const { getTopicStreamLive } = vi.hoisted(() => ({
  getTopicStreamLive: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: {
    getTopicStreamLive,
    synthesizeRoomSpeech: vi.fn(),
  },
}))

vi.mock('../../hooks/useFullscreenLock', () => ({
  useFullscreenLock: vi.fn(),
}))

class FakeAudio {
  static instances: FakeAudio[] = []
  src: string
  volume = 1
  preload = 'auto'
  onended: null | (() => void) = null
  onerror: null | (() => void) = null
  pause = vi.fn()
  play = vi.fn(async () => undefined)

  constructor(src: string) {
    this.src = src
    FakeAudio.instances.push(this)
  }
}

function buildLivePayload() {
  return {
    room_id: 't_020',
    live: {
      room_id: 't_020',
      program_slug: 'market-radar-lab',
      program_title: '市场快评实验室',
      as_of: '2026-03-09T10:00:00Z',
      topic_count: 2,
      topics: [
        {
          id: 'topic_1',
          title: 'NVIDIA keeps AI heat high',
          screen_title: '英伟达这条线，还在带市场情绪',
          summary_facts: 'NVIDIA remains at the center of AI market attention.',
          commentary_script: '现在真正要看的，不是热度本身，而是热度还能不能继续变成资金追逐。',
          screen_tags: ['英伟达', 'AI', '情绪'],
          source: 'Example Source',
          published_at: '2026-03-09T09:20:00Z',
          image_api_url: '/api/topic-stream/images/t_020/nvidia.jpg',
          audio_api_url: '/api/topic-stream/audio/t_020/nvidia.mp3',
        },
        {
          id: 'topic_2',
          title: 'Gold catches another risk-off bid',
          screen_title: '黄金这波，是避险还是顺势？',
          summary_facts: 'Gold keeps attracting attention during risk-off moments.',
          commentary_script: '如果黄金继续走强，后面就要看美元和利率预期有没有继续配合。',
          screen_tags: ['黄金', '避险', '美元'],
          source: 'Example Source',
          published_at: '2026-03-09T09:25:00Z',
          image_api_url: '/api/topic-stream/images/t_020/gold.jpg',
          audio_api_url: '/api/topic-stream/audio/t_020/gold.mp3',
        },
      ],
    },
    status: {},
  }
}

describe('T020MarketRadarLabPage', () => {
  beforeEach(() => {
    FakeAudio.instances = []
    vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio)
    getTopicStreamLive.mockResolvedValue(buildLivePayload())
    window.history.pushState({}, '', '/stream/market-radar-lab?trader=t_020&program=market-radar-lab')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders the market-radar-lab theme and only advances after audio end', async () => {
    render(
      <T020MarketRadarLabPage
        selectedTrader={{ trader_id: 't_020' } as never}
        streamPacket={null as never}
        roomSseState={null as never}
        replayRuntimeStatus={null as never}
        language="zh"
      />
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('市场快评实验室')).toBeInTheDocument()
    expect(screen.getByText('英伟达这条线，还在带市场情绪')).toBeInTheDocument()
    expect(screen.getByText('英伟达')).toBeInTheDocument()

    await waitFor(() => {
      expect(FakeAudio.instances.length).toBeGreaterThan(0)
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('黄金这波，是避险还是顺势？')).not.toBeInTheDocument()

    await act(async () => {
      FakeAudio.instances[0].onended?.()
    })

    await new Promise((resolve) => setTimeout(resolve, 1300))

    expect(screen.getByText('黄金这波，是避险还是顺势？')).toBeInTheDocument()
  })

  it('always requests the dedicated t_020 room feed even if selectedTrader differs', async () => {
    render(
      <T020MarketRadarLabPage
        selectedTrader={{ trader_id: 't_001' } as never}
        streamPacket={null as never}
        roomSseState={null as never}
        replayRuntimeStatus={null as never}
        language="zh"
      />
    )

    await waitFor(() => {
      expect(getTopicStreamLive).toHaveBeenCalledWith({ room_id: 't_020' })
    })
  })
})
