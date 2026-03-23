export type SegmentSummary = {
  id: string
  roomId: string
  programSlug: string
  topicId: string
  title: string
  status: string
  durationSeconds: number | null
  posterUrl: string | null
  createdAt?: string | null
}

export type SegmentListResponse = {
  page: number
  pageSize: number
  total: number
  rows: SegmentSummary[]
}

export type SegmentListQuery = {
  page?: number
  pageSize?: number
  room?: string
  program?: string
  status?: string
  keyword?: string
  from?: string
  to?: string
}
