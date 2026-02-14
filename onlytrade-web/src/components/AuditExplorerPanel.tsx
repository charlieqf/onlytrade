import { useMemo, useState } from 'react'
import useSWR from 'swr'

import { api } from '../lib/api'
import { t, type Language } from '../i18n/translations'
import type { DecisionAuditListPayload, DecisionAuditRecord } from '../types'

function formatTime(value: any) {
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) {
    try {
      return new Date(n).toLocaleTimeString()
    } catch {
      return String(n)
    }
  }
  const s = String(value || '').trim()
  if (!s) return '--'
  const ms = Date.parse(s)
  if (Number.isFinite(ms)) {
    return new Date(ms).toLocaleTimeString()
  }
  return s
}

function safeJson(value: any, maxLen: number = 2400) {
  try {
    const text = JSON.stringify(value, null, 2)
    if (!text) return ''
    return text.length > maxLen ? `${text.slice(0, maxLen)}\n... (truncated)` : text
  } catch {
    return ''
  }
}

async function copyToClipboard(text: string) {
  const payload = String(text || '')
  if (!payload) return
  await navigator.clipboard.writeText(payload)
}

export function AuditExplorerPanel({ roomId, language }: { roomId: string; language: Language }) {
  const [expandedKey, setExpandedKey] = useState<string>('')
  const [limit, setLimit] = useState<number>(50)
  const [copiedKey, setCopiedKey] = useState<string>('')

  const swrKey = roomId ? `audit-latest-${roomId}-${limit}` : null
  const { data, error, isLoading, mutate } = useSWR<DecisionAuditListPayload>(
    swrKey,
    () => api.getDecisionAuditLatest(roomId, limit),
    {
      refreshInterval: 15000,
      revalidateOnFocus: false,
      dedupingInterval: 2000,
    }
  )

  const records: DecisionAuditRecord[] = useMemo(() => {
    return Array.isArray(data?.records) ? data!.records : []
  }, [data])

  const copyWithToast = async (text: string, key: string) => {
    try {
      await copyToClipboard(text)
      setCopiedKey(key)
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? '' : prev))
      }, 1200)
    } catch (err) {
      console.error('copy failed', err)
    }
  }

  return (
    <div className="nofx-glass p-5 border border-white/5 rounded-lg">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="text-lg font-bold text-nofx-text-main">
            {language === 'zh' ? '审计浏览器' : 'Audit Explorer'}
          </div>
          <div className="text-xs text-nofx-text-muted mt-1">
            {language === 'zh'
              ? '读取 data/audit/decision_audit JSONL（只读）。'
              : 'Reads data/audit/decision_audit JSONL (read-only).'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="px-2 py-1 rounded text-xs font-mono bg-black/40 text-nofx-text-main border border-white/10 hover:border-white/20 focus:outline-none"
            title={language === 'zh' ? '条数' : 'Limit'}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <button
            type="button"
            onClick={() => mutate()}
            className="text-[11px] px-2 py-1 rounded border border-white/10 bg-black/30 text-nofx-text-muted hover:text-nofx-text-main"
          >
            {language === 'zh' ? '刷新' : 'Refresh'}
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="text-xs text-nofx-text-muted">
          {language === 'zh' ? '加载中...' : 'Loading...'}
        </div>
      )}

      {!isLoading && error && (
        <div className="text-xs text-nofx-red">
          {language === 'zh' ? '审计读取失败。' : 'Failed to load audit.'}
        </div>
      )}

      {!isLoading && !error && records.length === 0 && (
        <div className="text-xs text-nofx-text-muted opacity-70">
          {language === 'zh' ? '暂无审计记录。' : 'No audit records yet.'}
        </div>
      )}

      {records.length > 0 && (
        <div className="space-y-2">
          {records.map((rec, idx) => {
            const key = `${rec.saved_ts_ms || rec.timestamp || idx}`
            const readiness = rec.data_readiness
            const readinessLevel = String(readiness?.level || '').toUpperCase() || '--'
            const forced = rec.forced_hold ? 'FORCED' : ''
            const action = String(rec.action || '').toUpperCase() || '--'
            const symbol = String(rec.symbol || '') || '--'
            const time = formatTime(rec.saved_ts_ms || rec.timestamp)

            return (
              <div key={key} className="rounded border border-white/10 bg-black/20">
                <button
                  type="button"
                  onClick={() => setExpandedKey((prev) => (prev === key ? '' : key))}
                  className="w-full text-left px-3 py-2 flex items-center justify-between gap-3 hover:bg-white/5"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-nofx-text-muted">
                      {time} | cycle {String(rec.cycle_number ?? '--')} | {forced}
                    </div>
                    <div className="text-sm text-nofx-text-main truncate">
                      {symbol} {action} | readiness {readinessLevel}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-nofx-text-muted">
                      {expandedKey === key ? t('collapse', language) : t('expand', language)}
                    </span>
                  </div>
                </button>

                {expandedKey === key && (
                  <div className="px-3 pb-3">
                    <div className="flex items-center justify-between gap-3 mt-1">
                      <div className="text-[11px] font-mono text-nofx-text-muted">record.json</div>
                      <button
                        type="button"
                        onClick={() => copyWithToast(JSON.stringify(rec, null, 2), `audit.${key}`)}
                        className="text-[11px] px-2 py-1 rounded border border-white/10 bg-black/30 text-nofx-text-muted hover:text-nofx-text-main"
                      >
                        {copiedKey === `audit.${key}`
                          ? (language === 'zh' ? '已复制' : 'Copied')
                          : (language === 'zh' ? '复制' : 'Copy')}
                      </button>
                    </div>
                    <div
                      className="mt-2 rounded-lg p-3 text-[11px] font-mono whitespace-pre-wrap"
                      style={{ background: '#0B0E11', border: '1px solid #2B3139', color: '#EAECEF' }}
                    >
                      {safeJson(rec)}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
