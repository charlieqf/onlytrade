import { toAppUrl } from './appUrls'
import type { SegmentListQuery, SegmentListResponse } from './types'

export type SegmentDetail = {
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
}

export async function listSegments(query: SegmentListQuery = {}): Promise<SegmentListResponse> {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value)
    }
  }

  const queryString = search.toString()
  const response = await fetch(toAppUrl(queryString ? `/api/segments?${queryString}` : '/api/segments'))

  if (!response.ok) {
    throw new Error(`Failed to load segments: ${response.status}`)
  }

  const payload = (await response.json()) as {
    page: number
    pageSize: number
    total: number
    rows: Array<{
      id: string
      roomId: string
      programSlug: string
      topicId: string
      title: string
      status: string
      durationSeconds: number | null
      hasPoster?: boolean
      posterUrl?: string | null
      createdAt?: string | null
    }>
  }

  return {
    page: payload.page,
    pageSize: payload.pageSize,
    total: payload.total,
    rows: payload.rows.map((row) => ({
      id: row.id,
      roomId: row.roomId,
      programSlug: row.programSlug,
      topicId: row.topicId,
      title: row.title,
      status: row.status,
      durationSeconds: row.durationSeconds,
      posterUrl: row.posterUrl ?? (row.hasPoster ? toAppUrl(`/media/poster/${row.id}`) : null),
      createdAt: row.createdAt ?? null,
    })),
  }
}

export async function getSegmentDetail(id: string): Promise<SegmentDetail> {
  const response = await fetch(toAppUrl(`/api/segments/${id}`))

  if (!response.ok) {
    throw new Error(`Failed to load segment detail: ${response.status}`)
  }

  const payload = (await response.json()) as {
    id: string
    roomId: string
    programSlug: string
    topicId: string
    title: string
    summary?: string | null
    sourceUrl?: string | null
    status: string
    notes?: string | null
    durationSeconds: number | null
    media: {
      posterUrl?: string | null
      videoUrl: string
    }
  }

  return {
    id: payload.id,
    roomId: payload.roomId,
    programSlug: payload.programSlug,
    topicId: payload.topicId,
    title: payload.title,
    summary: payload.summary ?? null,
    sourceUrl: payload.sourceUrl ?? null,
    status: payload.status,
    notes: payload.notes ?? null,
    durationSeconds: payload.durationSeconds,
    media: {
      posterUrl: payload.media.posterUrl ? toAppUrl(payload.media.posterUrl) : null,
      videoUrl: toAppUrl(payload.media.videoUrl),
    },
  }
}

export async function updateSegmentStatus(id: string, status: string): Promise<void> {
  const response = await fetch(toAppUrl(`/api/segments/${id}/status`), {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ status }),
  })

  if (!response.ok) {
    throw new Error(`Failed to update segment status: ${response.status}`)
  }
}

export async function updateSegmentNotes(id: string, notes: string): Promise<void> {
  const response = await fetch(toAppUrl(`/api/segments/${id}/notes`), {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ notes }),
  })

  if (!response.ok) {
    throw new Error(`Failed to update segment notes: ${response.status}`)
  }
}
