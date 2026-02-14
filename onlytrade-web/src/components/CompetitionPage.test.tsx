import { render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { describe, expect, it, vi } from 'vitest'

import { CompetitionPage } from './CompetitionPage'
import { LanguageProvider } from '../contexts/LanguageContext'

vi.mock('../lib/api', () => ({
  api: {
    getCompetition: vi.fn(async () => ({
      count: 2,
      traders: [
        {
          trader_id: 't_001',
          trader_name: 'Alpha',
          ai_model: 'qwen',
          exchange: 'sim',
          total_equity: 100000,
          total_pnl: 0,
          total_pnl_pct: Number.NaN,
          position_count: 0,
          margin_used_pct: 0,
          is_running: true,
          avatar_url: '/api/agents/t_001/assets/avatar.jpg',
          avatar_hd_url: '/api/agents/t_001/assets/avatar-hd.jpg',
        },
        {
          trader_id: 't_002',
          trader_name: 'Beta',
          ai_model: 'deepseek',
          exchange: 'sim',
          total_equity: 100000,
          total_pnl: 0,
          total_pnl_pct: Number.POSITIVE_INFINITY,
          position_count: 0,
          margin_used_pct: 0,
          is_running: true,
          avatar_url: '/api/agents/t_002/assets/avatar.jpg',
          avatar_hd_url: '/api/agents/t_002/assets/avatar-hd.jpg',
        },
      ],
      replay: {
        trading_day: null,
        day_index: 0,
        day_count: 0,
        day_bar_index: 0,
        day_bar_count: 0,
      },
    })),
  },
}))

vi.mock('./ComparisonChart', () => ({
  ComparisonChart: () => <div data-testid="comparison-chart" />,
}))

describe('CompetitionPage', () => {
  it('renders dash instead of NaN/Infinity for percent display', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <LanguageProvider>
          <CompetitionPage />
        </LanguageProvider>
      </SWRConfig>
    )

    expect(await screen.findByTestId('page-leaderboard')).toBeInTheDocument()
    expect(screen.getByTestId('competition-leader-pnl-pct')).toHaveTextContent('—')
    expect(screen.queryByText(/NaN%/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Infinity%/i)).not.toBeInTheDocument()
  })
})
