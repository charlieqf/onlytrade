const STATUS_META: Record<string, { label: string; tone: string }> = {
  pending_review: { label: '待审核', tone: 'pending' },
  draft: { label: '草稿', tone: 'draft' },
  approved: { label: '已初审', tone: 'approved' },
  ready: { label: '待发布', tone: 'ready' },
  published: { label: '已发布', tone: 'published' },
  rejected: { label: '已驳回', tone: 'rejected' },
}

const timestampFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function getStatusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, tone: 'neutral' }
}

export function formatDuration(durationSeconds: number | null): string {
  if (durationSeconds == null) {
    return '--:--'
  }

  const minutes = Math.floor(durationSeconds / 60)
  const seconds = durationSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatTimestamp(timestamp: string | null | undefined): string {
  if (!timestamp) {
    return '未记录'
  }

  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) {
    return timestamp
  }

  return timestampFormatter.format(parsed)
}

export function summarizeSource(url: string | null | undefined): string {
  if (!url) {
    return '未提供'
  }

  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
