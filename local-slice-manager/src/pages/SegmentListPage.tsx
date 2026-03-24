import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { toAppUrl } from '../appUrls'
import { listSegments } from '../api'
import { formatDuration, formatTimestamp, getStatusMeta } from '../presentation'
import type { SegmentSummary } from '../types'

type Filters = {
  room: string
  program: string
  status: string
  keyword: string
  from: string
  to: string
}

type SegmentListPageProps = {
  onOpenSegment?: (segmentId: string) => void
}

const initialFilters: Filters = {
  room: '',
  program: '',
  status: '',
  keyword: '',
  from: '',
  to: '',
}

export function SegmentListPage({ onOpenSegment }: SegmentListPageProps) {
  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [segments, setSegments] = useState<SegmentSummary[]>([])
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rescanState, setRescanState] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [rescanMessage, setRescanMessage] = useState<string | null>(null)

  const loadSegments = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await listSegments({ page: 1, pageSize: 500 })
      setSegments(response.rows)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载切片列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)

        const response = await listSegments({ page: 1, pageSize: 500 })
        if (cancelled) {
          return
        }

        setSegments(response.rows)
      } catch (loadError) {
        if (cancelled) {
          return
        }

        setError(loadError instanceof Error ? loadError.message : '加载切片列表失败')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [loadSegments])

  async function handleRescan() {
    setRescanState('running')
    setRescanMessage(null)

    try {
      const response = await fetch(toAppUrl('/api/segments/rescan'), {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`重新扫描失败：${response.status}`)
      }

      const payload = (await response.json()) as { indexed?: number }
      await loadSegments()
      setRescanState('success')
      setRescanMessage(`重新扫描完成，新增/更新 ${payload.indexed ?? 0} 条切片。`)
    } catch (rescanError) {
      setRescanState('error')
      setRescanMessage(
        rescanError instanceof Error ? rescanError.message : '重新扫描失败',
      )
    }
  }

  const roomOptions = useMemo(() => uniqueValues(segments.map((segment) => segment.roomId)), [segments])
  const programOptions = useMemo(
    () => uniqueValues(segments.map((segment) => segment.programSlug)),
    [segments],
  )
  const statusOptions = useMemo(
    () => uniqueValues(segments.map((segment) => segment.status)),
    [segments],
  )

  const visibleSegments = useMemo(() => {
    return segments.filter((segment) => {
      if (filters.room && segment.roomId !== filters.room) {
        return false
      }

      if (filters.program && segment.programSlug !== filters.program) {
        return false
      }

      if (filters.status && segment.status !== filters.status) {
        return false
      }

      if (filters.keyword) {
        const keyword = filters.keyword.toLowerCase()
        const haystack = [segment.title, segment.roomId, segment.programSlug, segment.topicId]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(keyword)) {
          return false
        }
      }

      if (filters.from || filters.to) {
        if (!segment.createdAt) {
          return false
        }

        const day = segment.createdAt.slice(0, 10)
        if (filters.from && day < filters.from) {
          return false
        }
        if (filters.to && day > filters.to) {
          return false
        }
      }

      return true
    })
  }, [filters, segments])

  const metrics = useMemo(() => {
    const pendingCount = segments.filter((segment) => segment.status === 'pending_review').length
    const publishedCount = segments.filter((segment) => segment.status === 'published').length
    return [
      { label: '已索引切片', value: String(segments.length) },
      { label: '当前筛选结果', value: String(visibleSegments.length) },
      { label: '活跃房间', value: String(roomOptions.length || 1) },
      { label: '待审核', value: String(pendingCount) },
      { label: '已发布', value: String(publishedCount) },
    ]
  }, [roomOptions.length, segments, visibleSegments.length])

  return (
    <div className="slice-shell">
      <header className="slice-header">
        <div className="slice-header__top">
          <div>
            <span className="slice-header__eyebrow">OnlyTrade Slice Ops</span>
            <h1 className="slice-header__title">切片资产台</h1>
            <p className="slice-header__description">
              面向内容运营与发布审核的素材后台。统一浏览各房间产出的短视频切片、检查状态，并快速定位需要复核、预览或下载的素材。
            </p>
          </div>

          <div className="slice-header__actions">
            <button
              type="button"
              onClick={() => {
                void handleRescan()
              }}
              disabled={rescanState === 'running'}
              className="slice-button"
            >
              {rescanState === 'running' ? '重新扫描中…' : '重新扫描素材'}
            </button>
            <button
              type="button"
              className="slice-button-secondary"
              onClick={() => setFilters(initialFilters)}
            >
              清空筛选
            </button>
            {!onOpenSegment && selectedSegmentId ? (
              <span className="slice-inline-note">当前选中：{selectedSegmentId}</span>
            ) : null}
          </div>
        </div>

        <section className="slice-metrics" aria-label="切片统计概览">
          {metrics.map((metric) => (
            <article key={metric.label} className="slice-metric">
              <p className="slice-metric__label">{metric.label}</p>
              <p className="slice-metric__value">{metric.value}</p>
            </article>
          ))}
        </section>
      </header>

      {rescanMessage ? (
        <div className="slice-banner" data-tone={rescanState === 'error' ? 'error' : 'success'}>
          <span>{rescanMessage}</span>
          {selectedSegmentId ? <span className="slice-inline-note">当前选中：{selectedSegmentId}</span> : null}
        </div>
      ) : null}

      <section className="slice-filter-panel">
        <div className="slice-panel__header">
          <div>
            <h2 className="slice-panel__title">筛选与检索</h2>
              <p className="slice-panel__description">
                用关键词、房间、节目、状态与日期范围快速缩小素材范围。当前优先展示最新已同步切片。
              </p>
          </div>
        </div>

        <div className="slice-filter-grid">
          <FilterInput
            label="关键词"
            placeholder="输入标题、topic_id 或实体名…"
            value={filters.keyword}
            onChange={(value) => setFilters((current) => ({ ...current, keyword: value }))}
          />
          <FilterSelect
            label="房间"
            value={filters.room}
            options={roomOptions}
            onChange={(value) => setFilters((current) => ({ ...current, room: value }))}
          />
          <FilterSelect
            label="节目"
            value={filters.program}
            options={programOptions}
            onChange={(value) => setFilters((current) => ({ ...current, program: value }))}
          />
          <FilterSelect
            label="状态"
            value={filters.status}
            options={statusOptions}
            formatOption={(value) => getStatusMeta(value).label}
            onChange={(value) => setFilters((current) => ({ ...current, status: value }))}
          />
          <FilterInput
            label="开始日期"
            type="date"
            value={filters.from}
            onChange={(value) => setFilters((current) => ({ ...current, from: value }))}
          />
          <FilterInput
            label="结束日期"
            type="date"
            value={filters.to}
            onChange={(value) => setFilters((current) => ({ ...current, to: value }))}
          />
        </div>
      </section>

      <section className="slice-list-panel">
        <div className="slice-panel__header">
          <div>
            <h2 className="slice-panel__title">切片列表</h2>
            <p className="slice-panel__description">
              预览封面、查看核心元信息，并直接进入详情页完成审核与备注编辑。
            </p>
          </div>
          <span className="slice-inline-note">共 {visibleSegments.length} 条结果</span>
        </div>

        {loading ? <div className="slice-empty">正在加载切片列表…</div> : null}
        {error ? (
          <div className="slice-banner" data-tone="error" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        {!loading && !error ? (
          <div className="slice-list">
            {visibleSegments.map((segment) => {
              const statusMeta = getStatusMeta(segment.status)
              return (
                <button
                  key={segment.id}
                  type="button"
                  aria-label={`查看 ${segment.title}`}
                  className="slice-card"
                  onClick={() => {
                    if (onOpenSegment) {
                      onOpenSegment(segment.id)
                      return
                    }

                    setSelectedSegmentId(segment.id)
                  }}
                >
                  {segment.posterUrl ? (
                    <img
                      src={segment.posterUrl}
                      alt={`${segment.title} poster`}
                      className="slice-card__poster"
                    />
                  ) : (
                    <div className="slice-card__poster-placeholder">暂无封面</div>
                  )}

                  <div className="slice-card__main">
                    <h3 className="slice-card__title">{segment.title}</h3>
                    <div className="slice-card__meta">
                      <span className="slice-chip">{segment.roomId}</span>
                      <span className="slice-chip">{segment.programSlug}</span>
                      <span className="slice-chip" data-tone={statusMeta.tone}>
                        {statusMeta.label}
                      </span>
                    </div>
                    <div className="slice-card__footer">
                      <span className="slice-chip">时长 {formatDuration(segment.durationSeconds)}</span>
                      <span className="slice-chip">同步 {formatTimestamp(segment.createdAt)}</span>
                    </div>
                    <div className="slice-card__topic">{segment.topicId}</div>
                  </div>

                  <div className="slice-card__side">
                    <span className="slice-card__timestamp">查看详情</span>
                  </div>
                </button>
              )
            })}

            {visibleSegments.length === 0 ? (
              <div className="slice-empty">当前筛选条件下没有匹配的切片。</div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}

function FilterInput(props: {
  label: string
  type?: 'text' | 'date'
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  const id = `filter-${props.label}`

  return (
    <label htmlFor={id} className="slice-field">
      <span className="slice-field__label">{props.label}</span>
      <input
        id={id}
        aria-label={props.label}
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  )
}

function FilterSelect(props: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  formatOption?: (value: string) => string
}) {
  const id = `filter-${props.label}`

  return (
    <label htmlFor={id} className="slice-field">
      <span className="slice-field__label">{props.label}</span>
      <select
        id={id}
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        <option value="">全部</option>
        {props.options.map((option) => (
          <option key={option} value={option}>
            {props.formatOption ? props.formatOption(option) : option}
          </option>
        ))}
      </select>
    </label>
  )
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right))
}

export default SegmentListPage
