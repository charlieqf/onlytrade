import type { HTMLAttributes, ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import AppWithProviders from '../../App'
import T022ContentFactoryPage from './T022ContentFactoryPage'

const { getContentFactoryLive, mutateCache } = vi.hoisted(() => ({
  getContentFactoryLive: vi.fn(),
  mutateCache: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: {
    getContentFactoryLive,
    getPublicTraders: vi.fn().mockResolvedValue([]),
    getAgentRuntimeStatus: vi.fn().mockResolvedValue(null),
    getReplayRuntimeStatus: vi.fn().mockResolvedValue(null),
    controlAgentRuntime: vi.fn().mockResolvedValue(null),
    controlReplayRuntime: vi.fn().mockResolvedValue(null),
    factoryResetRuntime: vi.fn().mockResolvedValue(null),
    setAgentKillSwitch: vi.fn().mockResolvedValue(null),
  },
}))

vi.mock('../../hooks/useFullscreenLock', () => ({
  useFullscreenLock: vi.fn(),
}))

vi.mock('swr', () => ({
  default: vi.fn((key: unknown) => ({
    data: key === 'public-traders' ? [] : null,
    error: null,
    mutate: vi.fn(),
  })),
  useSWRConfig: () => ({
    mutate: mutateCache,
  }),
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}))

vi.mock('../../contexts/LanguageContext', () => ({
  LanguageProvider: ({ children }: { children: ReactNode }) => children,
  useLanguage: () => ({
    language: 'zh',
    setLanguage: vi.fn(),
  }),
}))

vi.mock('../../contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    user: null,
    logout: vi.fn(),
    isLoading: false,
  }),
}))

vi.mock('../../components/ConfirmDialog', () => ({
  ConfirmDialogProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('../../hooks/useSystemConfig', () => ({
  useSystemConfig: () => ({ loading: false }),
}))

vi.mock('../../hooks/useRoomSse', () => ({
  useRoomSse: () => null,
}))

vi.mock('../../demo/staticDemo', () => ({
  isStaticDemoMode: () => false,
}))

function buildLivePayload() {
  return {
    room_id: 't_022',
    live: {
      room_id: 't_022',
      program_slug: 'china-bigtech',
      program_title: '内容工厂·国内大厂',
      as_of: '2026-03-21T10:00:00Z',
      segment_count: 2,
      segments: [
        {
          id: 'cf_xiaomi_1',
          topic_id: 'topic_xiaomi',
          title: '小米又把牌桌掀了？',
          summary: '发布节奏、价格策略、后续观察点。',
          published_at: '2026-03-21T09:40:00Z',
          duration_sec: 58.4,
          video_api_url: '/api/content-factory/videos/t_022/cf_xiaomi_1.mp4',
          poster_api_url: '/api/content-factory/posters/t_022/cf_xiaomi_1.jpg',
        },
        {
          id: 'cf_huawei_2',
          topic_id: 'topic_huawei',
          title: '华为这次不只是发新品',
          summary: '生态推进、渠道反馈、后续预期。',
          published_at: '2026-03-21T09:50:00Z',
          duration_sec: 61.2,
          video_api_url: '/api/content-factory/videos/t_022/cf_huawei_2.mp4',
          poster_api_url: '/api/content-factory/posters/t_022/cf_huawei_2.jpg',
        },
      ],
    },
    status: {},
  }
}

describe('T022ContentFactoryPage', () => {
  beforeEach(() => {
    getContentFactoryLive.mockResolvedValue(buildLivePayload())
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    window.history.pushState({}, '', '/stream/content-factory?trader=t_022&program=china-bigtech')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('renders the content factory page on direct route visits without trader resolution', async () => {
    window.history.pushState({}, '', '/stream/content-factory')

    render(<AppWithProviders />)

    expect(await screen.findByText('Content Factory')).toBeInTheDocument()
    expect(screen.queryByText('未选择交易员。请在 URL 中添加 ?trader=t_022')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(getContentFactoryLive).toHaveBeenCalledWith({ room_id: 't_022' })
    })
  })

  it('always requests the dedicated t_022 room feed even if selectedTrader differs', async () => {
    render(
      <T022ContentFactoryPage
        selectedTrader={{ trader_id: 't_001' } as never}
        streamPacket={null as never}
        roomSseState={null as never}
        replayRuntimeStatus={null as never}
        language="zh"
      />
    )

    await waitFor(() => {
      expect(getContentFactoryLive).toHaveBeenCalledWith({ room_id: 't_022' })
    })
  })

  it('renders the current segment title and poster state', async () => {
    render(
      <T022ContentFactoryPage
        selectedTrader={{ trader_id: 't_022' } as never}
        streamPacket={null as never}
        roomSseState={null as never}
        replayRuntimeStatus={null as never}
        language="zh"
      />
    )

    expect(await screen.findByText('内容工厂·国内大厂')).toBeInTheDocument()
    expect(screen.getByText('小米又把牌桌掀了？')).toBeInTheDocument()

    const poster = screen.getByAltText('小米又把牌桌掀了？ 海报') as HTMLImageElement
    expect(poster.src).toContain('/api/content-factory/posters/t_022/cf_xiaomi_1.jpg')
  })

  it('only advances after video ended', async () => {
    render(
      <T022ContentFactoryPage
        selectedTrader={{ trader_id: 't_022' } as never}
        streamPacket={null as never}
        roomSseState={null as never}
        replayRuntimeStatus={null as never}
        language="zh"
      />
    )

    expect(await screen.findByText('小米又把牌桌掀了？')).toBeInTheDocument()

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText('华为这次不只是发新品')).not.toBeInTheDocument()

    const video = document.querySelector('video')
    expect(video).not.toBeNull()

    await act(async () => {
      fireEvent.ended(video!)
    })

    expect(await screen.findByText('华为这次不只是发新品')).toBeInTheDocument()
  })

  it('falls back to a stable state after all current segments fail playback', async () => {
    render(
      <T022ContentFactoryPage
        selectedTrader={{ trader_id: 't_022' } as never}
        streamPacket={null as never}
        roomSseState={null as never}
        replayRuntimeStatus={null as never}
        language="zh"
      />
    )

    expect(await screen.findByText('小米又把牌桌掀了？')).toBeInTheDocument()

    await act(async () => {
      fireEvent.error(document.querySelector('video')!)
    })

    expect(await screen.findByText('华为这次不只是发新品')).toBeInTheDocument()

    await act(async () => {
      fireEvent.error(document.querySelector('video')!)
    })

    expect(await screen.findByTestId('content-factory-playback-fallback')).toBeInTheDocument()
    expect(document.querySelector('video')).toBeNull()
  })
})
