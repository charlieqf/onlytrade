// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import type { SegmentListResponse, SegmentSummary } from '../types'
import { SegmentListPage } from './SegmentListPage'

const listSegments = vi.fn<(params?: Record<string, string>) => Promise<SegmentListResponse>>()

vi.mock('../api', () => ({
  listSegments: (params?: Record<string, string>) => listSegments(params),
}))

const rows: SegmentSummary[] = [
  {
    id: 'seg-001',
    roomId: 'room-a',
    programSlug: 'market-open',
    topicId: 'topic-1',
    title: 'Morning breakout recap',
    status: 'draft',
    durationSeconds: 95,
    posterUrl: '/media/poster/seg-001',
    createdAt: '2026-03-21T09:30:00Z',
  },
  {
    id: 'seg-002',
    roomId: 'room-b',
    programSlug: 'midday-wrap',
    topicId: 'topic-2',
    title: 'Midday momentum watch',
    status: 'ready',
    durationSeconds: 125,
    posterUrl: null,
  },
]

describe('SegmentListPage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    listSegments.mockReset()
    listSegments.mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: rows.length,
      rows,
    })
  })

  it('renders poster, title, room, status, and duration for each row', async () => {
    render(<SegmentListPage />)

    const firstRow = await screen.findByRole('button', { name: /查看 Morning breakout recap/i })
    expect(within(firstRow).getByText('Morning breakout recap')).toBeTruthy()
    expect(within(firstRow).getByText('room-a')).toBeTruthy()
    expect(within(firstRow).getByText('草稿')).toBeTruthy()
    expect(within(firstRow).getByText('时长 1:35')).toBeTruthy()
    expect(
      screen.getByRole('img', { name: 'Morning breakout recap poster' }).getAttribute('src'),
    ).toBe('/media/poster/seg-001')

    const secondRow = screen.getByRole('button', { name: /查看 Midday momentum watch/i })
    expect(within(secondRow).getByText('Midday momentum watch')).toBeTruthy()
    expect(within(secondRow).getByText('room-b')).toBeTruthy()
    expect(within(secondRow).getByText('待发布')).toBeTruthy()
    expect(within(secondRow).getByText('时长 2:05')).toBeTruthy()
    expect(within(secondRow).getByText('暂无封面')).toBeTruthy()
  })

  it('updates the keyword filter in the query and filtered view', async () => {
    render(<SegmentListPage />)

    await screen.findByText('Morning breakout recap')

    expect(listSegments).toHaveBeenCalledWith({ page: 1, pageSize: 500 })

    fireEvent.change(screen.getByLabelText('关键词'), {
      target: { value: 'midday' },
    })

    await waitFor(() => {
      expect(screen.getByText('Midday momentum watch')).toBeTruthy()
      expect(screen.queryByText('Morning breakout recap')).toBeNull()
    })
  })

  it('opens selection state when a row is clicked', async () => {
    render(<SegmentListPage />)

    const row = await screen.findByRole('button', { name: /查看 Morning breakout recap/i })
    fireEvent.click(row)

    expect(screen.getByText('当前选中：seg-001')).toBeTruthy()
  })

  it('hides rows without createdAt when date filters are active', async () => {
    render(<SegmentListPage />)

    await screen.findByText('Morning breakout recap')

    fireEvent.change(screen.getByLabelText('开始日期'), {
      target: { value: '2026-03-21' },
    })

    await waitFor(() => {
      expect(screen.getByText('Morning breakout recap')).toBeTruthy()
      expect(screen.queryByText('Midday momentum watch')).toBeNull()
    })
  })
})
