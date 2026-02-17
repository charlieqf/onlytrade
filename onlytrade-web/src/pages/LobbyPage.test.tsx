import { render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { describe, expect, it, vi } from 'vitest'

import { LobbyPage } from './LobbyPage'
import { LanguageProvider } from '../contexts/LanguageContext'

vi.mock('../lib/api', () => ({
  api: {
    getCompetition: vi.fn(async () => ({
      count: 2,
      traders: [
        {
          trader_id: 't_001',
          trader_name: 'HS300 Momentum',
          ai_model: 'qwen',
          avatar_url: '/api/agents/t_001/assets/avatar.jpg',
          avatar_hd_url: '/api/agents/t_001/assets/avatar-hd.jpg',
          exchange: 'sim',
          total_equity: 102345.12,
          total_pnl: 2345.12,
          total_pnl_pct: 2.35,
          position_count: 3,
          margin_used_pct: 0,
          is_running: true,
        },
        {
          trader_id: 't_002',
          trader_name: 'Value Rebound',
          ai_model: 'deepseek',
          exchange: 'sim',
          total_equity: 100845.88,
          total_pnl: 845.88,
          total_pnl_pct: 0.85,
          position_count: 2,
          margin_used_pct: 0,
          is_running: false,
        },
      ],
    })),
  },
}))

describe('LobbyPage', () => {
  it('renders running and stopped status badges from competition payload', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <LanguageProvider>
          <LobbyPage />
        </LanguageProvider>
      </SWRConfig>
    )

    expect(await screen.findByText('Running')).toBeInTheDocument()
    expect(await screen.findByText('Stopped')).toBeInTheDocument()

    const avatar = await screen.findByAltText('HS300 Momentum avatar')
    expect(avatar).toHaveAttribute(
      'src',
      expect.stringContaining('/api/agents/t_001/assets/avatar.jpg')
    )
  })
})
