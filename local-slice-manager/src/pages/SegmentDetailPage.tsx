import React, { useEffect, useState } from 'react'

import { toDownloadUrl } from '../appUrls'
import {
  getSegmentDetail,
  type SegmentDetail,
  updateSegmentNotes,
  updateSegmentStatus,
} from '../api'
import { formatDuration, getStatusMeta, summarizeSource } from '../presentation'

const statusOptions = ['pending_review', 'draft', 'approved', 'ready', 'published', 'rejected']

type SegmentDetailPageProps = {
  segmentId: string
  onBack: () => void
}

export function SegmentDetailPage({ segmentId, onBack }: SegmentDetailPageProps) {
  const [segment, setSegment] = useState<SegmentDetail | null>(null)
  const [status, setStatus] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingStatus, setSavingStatus] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const detail = await getSegmentDetail(segmentId)

        if (!cancelled) {
          setSegment(detail)
          setStatus(detail.status)
          setNotes(detail.notes ?? '')
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '加载切片详情失败')
        }
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
  }, [segmentId])

  async function handleStatusChange(nextStatus: string) {
    setStatus(nextStatus)
    setSavingStatus(true)
    setError(null)

    try {
      await updateSegmentStatus(segmentId, nextStatus)
      setSegment((current) => (current ? { ...current, status: nextStatus } : current))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '更新状态失败')
      setStatus(segment?.status ?? '')
    } finally {
      setSavingStatus(false)
    }
  }

  async function handleSaveNotes() {
    setSavingNotes(true)
    setError(null)

    try {
      await updateSegmentNotes(segmentId, notes)
      setSegment((current) => (current ? { ...current, notes } : current))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存备注失败')
    } finally {
      setSavingNotes(false)
    }
  }

  const statusMeta = getStatusMeta(status || segment?.status || '')

  return (
    <div className="slice-shell">
      <header className="slice-header">
        <div className="slice-header__top">
          <div>
            <span className="slice-header__eyebrow">Segment Review</span>
            <h1 className="slice-header__title">切片详情</h1>
            <p className="slice-header__description">
              在这个页面完成视频预览、摘要复核、状态推进与备注记录，为后续发布动作留出清晰的审核轨迹。
            </p>
          </div>

          <div className="slice-header__actions">
            <button type="button" onClick={onBack} className="slice-button-secondary">
              返回列表
            </button>
          </div>
        </div>
      </header>

      {loading ? <div className="slice-empty">正在加载切片详情…</div> : null}
      {error ? (
        <div className="slice-banner" data-tone="error" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      {!loading && !error && segment ? (
        <div className="slice-detail-grid">
          <section className="slice-preview-panel">
            <div className="slice-preview__header">
              <div>
                <span className="slice-field__label">播放预览</span>
                <h2 className="slice-panel__title">视频与封面</h2>
              </div>
              <span className="slice-chip" data-tone={statusMeta.tone}>
                {statusMeta.label}
              </span>
            </div>

            <div className="slice-preview__stack">
              <video src={segment.media.videoUrl} controls className="slice-preview__video" />

              <div className="slice-detail-actions">
                <a
                  href={segment.media.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="slice-button-secondary"
                >
                  打开 MP4
                </a>
                <a
                  href={toDownloadUrl(segment.media.videoUrl)}
                  className="slice-button"
                  download
                >
                  下载 MP4
                </a>
              </div>

              <div className="slice-preview__poster-card">
                <span className="slice-detail__meta-label">封面素材</span>
                {segment.media.posterUrl ? (
                  <img
                    src={segment.media.posterUrl}
                    alt={`${segment.title} detail poster`}
                    className="slice-preview__poster"
                  />
                ) : (
                  <div className="slice-preview__poster-placeholder">暂无封面</div>
                )}
              </div>
            </div>
          </section>

          <section className="slice-detail-panel">
            <div>
              <div className="slice-detail__headline-meta">
                <span className="slice-chip">房间 {segment.roomId}</span>
                <span className="slice-chip">节目 {segment.programSlug}</span>
                <span className="slice-chip">时长 {formatDuration(segment.durationSeconds)}</span>
              </div>
              <h2 className="slice-detail__title">{segment.title}</h2>
            </div>

            <article className="slice-detail__summary-card">
              <p className="slice-detail__summary-label">摘要</p>
              <p className="slice-detail__summary">{segment.summary ?? '暂无摘要'}</p>
            </article>

            <section className="slice-meta-panel">
              <div className="slice-panel__header">
                <div>
                  <h3 className="slice-panel-heading">元信息</h3>
                  <p className="slice-panel-copy">用于定位原始 topic、核对来源与排查生成链问题。</p>
                </div>
              </div>

              <div className="slice-meta-grid">
                <MetaItem label="主题 ID" value={segment.topicId} />
                <MetaItem label="内容来源" value={summarizeSource(segment.sourceUrl)} />
                <MetaItem label="房间" value={segment.roomId} />
                <MetaItem label="节目" value={segment.programSlug} />
                <MetaItem
                  label="源链接"
                  value={segment.sourceUrl ? (
                    <a href={segment.sourceUrl} target="_blank" rel="noreferrer">
                      打开原文
                    </a>
                  ) : (
                    '未提供'
                  )}
                />
              </div>
            </section>

            <section className="slice-workflow-panel">
              <div className="slice-panel__header">
                <div>
                  <h3 className="slice-panel-heading">审核与备注</h3>
                  <p className="slice-panel-copy">把状态推进到“待发布”前，先记录清楚编辑判断与需要跟进的问题。</p>
                </div>
              </div>

              <label className="slice-field">
                <span className="slice-field__label">状态</span>
                <select
                  aria-label="状态"
                  value={status}
                  onChange={(event) => void handleStatusChange(event.target.value)}
                  disabled={savingStatus}
                >
                  {statusOptions.map((option) => {
                    const optionMeta = getStatusMeta(option)
                    return (
                      <option key={option} value={option}>
                        {optionMeta.label}
                      </option>
                    )
                  })}
                </select>
              </label>

              <label className="slice-field">
                <span className="slice-field__label">备注</span>
                <textarea
                  aria-label="备注"
                  value={notes}
                  placeholder="记录是否需要重做、是否适合分发、以及后续要跟进的动作…"
                  onChange={(event) => setNotes(event.target.value)}
                  rows={8}
                />
              </label>

              <div className="slice-detail-actions">
                <button
                  type="button"
                  onClick={() => void handleSaveNotes()}
                  disabled={savingNotes}
                  className="slice-button"
                >
                  {savingNotes ? '保存中…' : '保存备注'}
                </button>
                <span className="slice-inline-note">状态会立即保存；备注用于后续发布排期与复盘。</span>
              </div>
            </section>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function MetaItem(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="slice-meta-item">
      <span className="slice-detail__meta-label">{props.label}</span>
      <div className="slice-meta-item__value">{props.value}</div>
    </div>
  )
}

export default SegmentDetailPage
