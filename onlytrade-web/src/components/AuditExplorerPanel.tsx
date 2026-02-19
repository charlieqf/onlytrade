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
    return text.length > maxLen
      ? `${text.slice(0, maxLen)}\n... (truncated)`
      : text
  } catch {
    return ''
  }
}

function actionSemanticsText(rec: DecisionAuditRecord, language: Language) {
  const action = String(rec?.action || '').toLowerCase()
  if (action !== 'hold') return ''

  const semantics = String(rec?.hold_semantics || '')
  if (semantics === 'no_position_no_order') {
    return language === 'zh'
      ? '不买不卖（当前无仓位）'
      : 'no buy/sell (flat position)'
  }
  if (semantics === 'keep_existing_position') {
    return language === 'zh'
      ? '不下单（继续持有现有仓位）'
      : 'no new order (keep existing position)'
  }

  const shares = Number(rec?.position_shares_on_symbol || 0)
  if (shares > 0) {
    return language === 'zh'
      ? '不下单（继续持仓）'
      : 'no new order (keep position)'
  }
  return language === 'zh' ? '不买不卖（无新订单）' : 'no buy/sell (no new order)'
}

async function copyToClipboard(text: string) {
  const payload = String(text || '')
  if (!payload) return
  await navigator.clipboard.writeText(payload)
}

export function AuditExplorerPanel({
  roomId,
  language,
}: {
  roomId: string
  language: Language
}) {
  const [mode, setMode] = useState<'latest' | 'day'>('latest')
  const [expandedKey, setExpandedKey] = useState<string>('')
  const [dayKey, setDayKey] = useState<string>(() => {
    try {
      return new Date().toISOString().slice(0, 10)
    } catch {
      return ''
    }
  })
  const [limit, setLimit] = useState<number>(10)
  const [copiedKey, setCopiedKey] = useState<string>('')
  const [symbolQuery, setSymbolQuery] = useState<string>('')
  const [readinessLevel, setReadinessLevel] = useState<string>('ALL')
  const [forcedHoldOnly, setForcedHoldOnly] = useState<boolean>(false)

  const swrKey = roomId
    ? `audit-${mode}-${roomId}-${mode === 'day' ? dayKey : 'latest'}-${limit}`
    : null
  const { data, error, isLoading, mutate } = useSWR<DecisionAuditListPayload>(
    swrKey,
    () =>
      mode === 'day'
        ? api.getDecisionAuditDay(roomId, dayKey, limit)
        : api.getDecisionAuditLatest(roomId, limit),
    {
      refreshInterval: mode === 'latest' ? 15000 : 0,
      revalidateOnFocus: false,
      dedupingInterval: 2000,
    }
  )

  const records: DecisionAuditRecord[] = useMemo(() => {
    return Array.isArray(data?.records) ? data!.records : []
  }, [data])

  const filteredRecords: DecisionAuditRecord[] = useMemo(() => {
    const q = String(symbolQuery || '')
      .trim()
      .toLowerCase()
    const level = String(readinessLevel || 'ALL').toUpperCase()

    return records.filter((rec) => {
      if (forcedHoldOnly && rec?.forced_hold !== true) return false

      if (level !== 'ALL') {
        const recLevel = String(rec?.data_readiness?.level || '').toUpperCase()
        if (recLevel !== level) return false
      }

      if (q) {
        const sym = String(rec?.symbol || '').toLowerCase()
        if (!sym.includes(q)) return false
      }

      return true
    })
  }, [records, symbolQuery, readinessLevel, forcedHoldOnly])

  function downloadJsonl(items: DecisionAuditRecord[]) {
    const rows = Array.isArray(items) ? items : []
    const content = rows
      .map((rec) => {
        try {
          return JSON.stringify(rec)
        } catch {
          return ''
        }
      })
      .filter(Boolean)
      .join('\n')
    if (!content) return

    const filename = `decision-audit-${roomId}-${mode === 'day' ? dayKey || 'day' : 'latest'}.jsonl`
    const blob = new Blob([`${content}\n`], {
      type: 'application/x-ndjson;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function jumpToDecision(rec: DecisionAuditRecord) {
    try {
      const cycle = Number(rec?.cycle_number || 0)
      const ts = String(rec?.timestamp || '').trim()
      window.dispatchEvent(
        new CustomEvent('jump-to-decision', {
          detail: { cycle_number: cycle, timestamp: ts },
        })
      )
    } catch {
      // ignore
    }
  }

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
          <div className="flex items-center rounded border border-white/10 bg-black/30 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setMode('latest')
                setExpandedKey('')
                if (limit > 500) setLimit(10)
              }}
              className={`text-[11px] px-2 py-1 ${mode === 'latest' ? 'text-nofx-text-main bg-white/10' : 'text-nofx-text-muted hover:text-nofx-text-main'}`}
            >
              {language === 'zh' ? '最新' : 'Latest'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('day')
                setExpandedKey('')
                if (limit < 2000) setLimit(2000)
              }}
              className={`text-[11px] px-2 py-1 ${mode === 'day' ? 'text-nofx-text-main bg-white/10' : 'text-nofx-text-muted hover:text-nofx-text-main'}`}
            >
              {language === 'zh' ? '按日' : 'Day'}
            </button>
          </div>

          {mode === 'day' && (
            <input
              type="date"
              value={dayKey}
              onChange={(e) => {
                setDayKey(String(e.target.value || '').trim())
                setExpandedKey('')
              }}
              className="px-2 py-1 rounded text-xs font-mono bg-black/40 text-nofx-text-main border border-white/10 hover:border-white/20 focus:outline-none"
              title={language === 'zh' ? '日期' : 'Day key'}
            />
          )}

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
            <option value={200}>200</option>
            <option value={500}>500</option>
            <option value={2000}>2000</option>
          </select>

          <button
            type="button"
            onClick={() => downloadJsonl(filteredRecords)}
            className="text-[11px] px-2 py-1 rounded border border-white/10 bg-black/30 text-nofx-text-muted hover:text-nofx-text-main"
            title={language === 'zh' ? '下载 JSONL' : 'Download JSONL'}
          >
            {language === 'zh' ? '下载' : 'Download'}
          </button>

          <button
            type="button"
            onClick={() => mutate()}
            className="text-[11px] px-2 py-1 rounded border border-white/10 bg-black/30 text-nofx-text-muted hover:text-nofx-text-main"
          >
            {language === 'zh' ? '刷新' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={symbolQuery}
          onChange={(e) => setSymbolQuery(String(e.target.value || ''))}
          placeholder={
            language === 'zh' ? 'symbol 包含...' : 'symbol contains...'
          }
          className="px-2 py-1 rounded text-xs font-mono bg-black/40 text-nofx-text-main border border-white/10 hover:border-white/20 focus:outline-none"
        />
        <select
          value={readinessLevel}
          onChange={(e) => setReadinessLevel(String(e.target.value || 'ALL'))}
          className="px-2 py-1 rounded text-xs font-mono bg-black/40 text-nofx-text-main border border-white/10 hover:border-white/20 focus:outline-none"
          title={language === 'zh' ? '就绪级别' : 'Readiness'}
        >
          <option value="ALL">
            {language === 'zh' ? '就绪: 全部' : 'Readiness: ALL'}
          </option>
          <option value="OK">OK</option>
          <option value="WARN">WARN</option>
          <option value="ERROR">ERROR</option>
        </select>
        <label className="flex items-center gap-1 text-[11px] text-nofx-text-muted select-none">
          <input
            type="checkbox"
            checked={forcedHoldOnly}
            onChange={(e) => setForcedHoldOnly(!!e.target.checked)}
          />
          {language === 'zh' ? '仅 forced_hold' : 'forced_hold only'}
        </label>
        <div className="text-[11px] text-nofx-text-muted opacity-70">
          {filteredRecords.length}/{records.length}
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

      {!isLoading &&
        !error &&
        records.length > 0 &&
        filteredRecords.length === 0 && (
          <div className="text-xs text-nofx-text-muted opacity-70">
            {language === 'zh' ? '无匹配结果。' : 'No matches.'}
          </div>
        )}

      {filteredRecords.length > 0 && (
        <div className="space-y-2">
          {filteredRecords.map((rec, idx) => {
            const key = `${rec.saved_ts_ms || rec.timestamp || idx}`
            const readiness = rec.data_readiness
            const readinessLevel =
              String(readiness?.level || '').toUpperCase() || '--'
            const forced = rec.forced_hold ? 'FORCED' : ''
            const action = String(rec.action || '').toUpperCase() || '--'
            const symbol = String(rec.symbol || '') || '--'
            const time = formatTime(rec.saved_ts_ms || rec.timestamp)
            const actionHint = actionSemanticsText(rec, language)

            return (
              <div
                key={key}
                className="rounded border border-white/10 bg-black/20"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedKey((prev) => (prev === key ? '' : key))
                  }
                  className="w-full text-left px-3 py-2 flex items-center justify-between gap-3 hover:bg-white/5"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-nofx-text-muted">
                      {time} | cycle {String(rec.cycle_number ?? '--')} |{' '}
                      {forced}
                    </div>
                    <div className="text-sm text-nofx-text-main truncate">
                      {symbol} {action} | readiness {readinessLevel}
                    </div>
                    {!!actionHint && (
                      <div className="text-[11px] text-nofx-text-muted truncate">
                        {actionHint}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        jumpToDecision(rec)
                      }}
                      className="text-[11px] px-2 py-1 rounded border border-white/10 bg-black/30 text-nofx-text-muted hover:text-nofx-text-main"
                      title={
                        language === 'zh'
                          ? '跳转到对应决策卡片'
                          : 'Jump to decision card'
                      }
                    >
                      {language === 'zh' ? '跳转' : 'Jump'}
                    </button>
                    <span className="text-[11px] text-nofx-text-muted">
                      {expandedKey === key
                        ? t('collapse', language)
                        : t('expand', language)}
                    </span>
                  </div>
                </button>

                {expandedKey === key && (
                  <div className="px-3 pb-3">
                    <div className="flex items-center justify-between gap-3 mt-1">
                      <div className="text-[11px] font-mono text-nofx-text-muted">
                        record.json
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          copyWithToast(
                            JSON.stringify(rec, null, 2),
                            `audit.${key}`
                          )
                        }
                        className="text-[11px] px-2 py-1 rounded border border-white/10 bg-black/30 text-nofx-text-muted hover:text-nofx-text-main"
                      >
                        {copiedKey === `audit.${key}`
                          ? language === 'zh'
                            ? '已复制'
                            : 'Copied'
                          : language === 'zh'
                            ? '复制'
                            : 'Copy'}
                      </button>
                    </div>
                    <div
                      className="mt-2 rounded-lg p-3 text-[11px] font-mono whitespace-pre-wrap max-h-72 overflow-y-auto custom-scrollbar"
                      style={{
                        background: '#0B0E11',
                        border: '1px solid #2B3139',
                        color: '#EAECEF',
                      }}
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
