// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import App from '../App'
import type { SegmentListResponse, SegmentSummary } from '../types'

const listSegments = vi.fn<(params?: Record<string, string>) => Promise<SegmentListResponse>>()
const getSegmentDetail = vi.fn<(id: string) => Promise<{
  id: string
  roomId: string
  programSlug: string
  topicId: string
  title: string
  summary: string | null
  sourceUrl: string | null
  status: string
  notes: string | null
  durationSeconds: number | null
  media: {
    posterUrl: string | null
    videoUrl: string
  }
}>>()
const updateSegmentStatus = vi.fn<(id: string, status: string) => Promise<void>>()
const updateSegmentNotes = vi.fn<(id: string, notes: string) => Promise<void>>()

vi.mock('../api', () => ({
  listSegments: (params?: Record<string, string>) => listSegments(params),
  getSegmentDetail: (id: string) => getSegmentDetail(id),
  updateSegmentStatus: (id: string, status: string) => updateSegmentStatus(id, status),
  updateSegmentNotes: (id: string, notes: string) => updateSegmentNotes(id, notes),
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
]

describe('SegmentDetailPage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    listSegments.mockReset()
    getSegmentDetail.mockReset()
    updateSegmentStatus.mockReset()
    updateSegmentNotes.mockReset()

    listSegments.mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: rows.length,
      rows,
    })

    getSegmentDetail.mockResolvedValue({
      id: 'seg-001',
      roomId: 'room-a',
      programSlug: 'market-open',
      topicId: 'topic-1',
      title: 'Morning breakout recap',
      summary: 'Summary for the selected segment.',
      sourceUrl: 'https://example.com/source/seg-001',
      status: 'draft',
      notes: 'Initial review note',
      durationSeconds: 95,
      media: {
        posterUrl: '/media/poster/seg-001',
        videoUrl: '/media/video/seg-001',
      },
    })

    updateSegmentStatus.mockResolvedValue()
    updateSegmentNotes.mockResolvedValue()
  })

  it('fetches segment detail and renders poster and HTML5 video playback', async () => {
    const { container } = render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /查看 Morning breakout recap/i }))

    await waitFor(() => {
      expect(getSegmentDetail).toHaveBeenCalledWith('seg-001')
    })

    expect(await screen.findByText('Summary for the selected segment.')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Morning breakout recap detail poster' })).toBeTruthy()

    const video = container.querySelector('video')
    expect(video).toBeTruthy()
    expect(video?.getAttribute('src')).toBe('/media/video/seg-001')
    expect(video?.getAttribute('controls')).not.toBeNull()
    expect(screen.getByRole('link', { name: '打开 MP4' }).getAttribute('href')).toBe('/media/video/seg-001')
    expect(screen.getByRole('link', { name: '下载 MP4' }).getAttribute('href')).toBe(
      '/media/video/seg-001?download=1',
    )
  })

  it('saves status changes and notes edits through the segment detail actions', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /查看 Morning breakout recap/i }))
    await screen.findByText('Summary for the selected segment.')

    fireEvent.change(screen.getByLabelText('状态'), {
      target: { value: 'approved' },
    })

    await waitFor(() => {
      expect(updateSegmentStatus).toHaveBeenCalledWith('seg-001', 'approved')
    })

    fireEvent.change(screen.getByLabelText('备注'), {
      target: { value: 'Updated notes for publishing.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存备注' }))

    await waitFor(() => {
      expect(updateSegmentNotes).toHaveBeenCalledWith('seg-001', 'Updated notes for publishing.')
    })
  })
})
