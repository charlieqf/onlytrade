import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import TopicCommentaryPage from './TopicCommentaryPage'

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

function buildLivePayload(programSlug: string, programTitle: string) {
  return {
    room_id: 't_019',
    live: {
      room_id: 't_019',
      program_slug: programSlug,
      program_title: programTitle,
      as_of: '2026-03-08T10:00:00Z',
      topic_count: 2,
      topics: [
        {
          id: 'topic_1',
          title: 'Xiaomi keeps attention high',
          screen_title: '小米这波热度，不只是车圈热度',
          summary_facts: 'Xiaomi kept receiving launch-related attention.',
          commentary_script: '最狠的不是参数，而是话题统治力。',
          screen_tags: ['SU7', 'Launch buzz', 'Traffic'],
          source: 'Example Source',
          published_at: '2026-03-08T09:20:00Z',
          image_api_url: '/api/topic-stream/images/t_019/xiaomi.jpg',
          audio_api_url: '/api/topic-stream/audio/t_019/xiaomi.mp3',
        },
        {
          id: 'topic_2',
          title: 'Huawei keeps ecosystem pressure on',
          screen_title: '华为这张牌，打的不是单点产品',
          summary_facts: 'Huawei kept ecosystem momentum in public discussion.',
          commentary_script: '它在打的是一整套生态牵引。',
          screen_tags: ['Harmony', 'Ecosystem', 'Pressure'],
          source: 'Example Source',
          published_at: '2026-03-08T09:25:00Z',
          image_api_url: '/api/topic-stream/images/t_019/huawei.jpg',
          audio_api_url: '/api/topic-stream/audio/t_019/huawei.mp3',
        },
      ],
    },
    status: {},
  }
}

describe('TopicCommentaryPage', () => {
  beforeEach(() => {
    FakeAudio.instances = []
    vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio)
    getTopicStreamLive.mockResolvedValue(buildLivePayload('china-bigtech', '国内大厂每日锐评'))
    window.history.pushState({}, '', '/stream/topic-commentary?trader=t_019&program=china-bigtech')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders the china-bigtech theme and only advances after audio end', async () => {
    render(
      <TopicCommentaryPage
        selectedTrader={{ trader_id: 't_019' } as never}
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

    expect(screen.getByText('国内大厂每日锐评')).toBeInTheDocument()
    expect(screen.getByText('小米这波热度，不只是车圈热度')).toBeInTheDocument()
    expect(screen.getByText('SU7')).toBeInTheDocument()

    await waitFor(() => {
      expect(FakeAudio.instances.length).toBeGreaterThan(0)
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('华为这张牌，打的不是单点产品')).not.toBeInTheDocument()

    await act(async () => {
      FakeAudio.instances[0].onended?.()
    })

    await new Promise((resolve) => setTimeout(resolve, 1300))

    expect(screen.getByText('华为这张牌，打的不是单点产品')).toBeInTheDocument()
  })
})
