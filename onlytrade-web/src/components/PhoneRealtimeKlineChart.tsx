import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'

type RawFrame = {
  symbol?: string
  instrument?: { symbol?: string }
  window?: { start_ts_ms?: number }
  bar?: {
    open?: number
    high?: number
    low?: number
    close?: number
    volume_shares?: number
  }
}

type CandlePoint = {
  time: UTCTimestamp
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function toNum(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function parseFrames(payload: unknown, targetSymbol: string): RawFrame[] {
  const root =
    payload && typeof payload === 'object' && 'data' in (payload as any)
      ? (payload as any).data
      : payload
  const frames = Array.isArray((root as any)?.frames) ? ((root as any).frames as RawFrame[]) : []
  if (!frames.length) return []

  const wanted = String(targetSymbol || '').toUpperCase()
  const filtered = frames.filter((frame) => {
    const symbol = String(frame.symbol || frame.instrument?.symbol || '').toUpperCase()
    return symbol === wanted
  })
  return filtered.length ? filtered : frames
}

function toCandles(frames: RawFrame[]): CandlePoint[] {
  const points = frames
    .map((frame) => ({
      time: Math.floor(toNum(frame.window?.start_ts_ms) / 1000) as UTCTimestamp,
      open: toNum(frame.bar?.open),
      high: toNum(frame.bar?.high),
      low: toNum(frame.bar?.low),
      close: toNum(frame.bar?.close),
      volume: toNum(frame.bar?.volume_shares),
    }))
    .filter((c) => Number(c.time) > 0 && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)

  points.sort((a, b) => Number(a.time) - Number(b.time))
  return points.filter((point, idx) => idx === 0 || point.time !== points[idx - 1].time)
}

export function PhoneRealtimeKlineChart({
  symbol,
  interval = '1m',
  limit = 240,
  height = '100%',
  refreshMs = 12000,
}: {
  symbol: string
  interval?: string
  limit?: number
  height?: string
  refreshMs?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { color: '#0B0E11' },
        textColor: '#B7BDC6',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(43,49,57,0.25)', visible: true },
        horzLines: { color: 'rgba(43,49,57,0.25)', visible: true },
      },
      rightPriceScale: {
        borderColor: '#2B3139',
        borderVisible: false,
        scaleMargins: { top: 0.06, bottom: 0.22 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: 5,
      },
      handleScale: false,
      handleScroll: false,
      crosshair: { mode: 0 },
    })
    chartRef.current = chart

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#FF4444',
      downColor: '#00B070',
      borderUpColor: '#FF4444',
      borderDownColor: '#00B070',
      wickUpColor: '#FF4444',
      wickDownColor: '#00B070',
    })

    volumeRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    })

    const ro = new ResizeObserver((entries) => {
      if (!entries[0]) return
      const { width, height: h } = entries[0].contentRect
      chart.applyOptions({ width, height: h })
    })
    ro.observe(container)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
    }
  }, [])

  const loadData = useCallback(async () => {
    const safeSymbol = String(symbol || '').trim()
    if (!safeSymbol) return

    const safeInterval = String(interval || '1m')
    const minLimit = safeInterval === '1d' ? 20 : 80
    const maxLimit = safeInterval === '1d' ? 365 : 800
    const fallbackLimit = safeInterval === '1d' ? 30 : 240
    const safeLimit = Math.max(minLimit, Math.min(Number(limit) || fallbackLimit, maxLimit))
    try {
      setStatus((prev) => (prev === 'ready' ? prev : 'loading'))

      const primaryRes = await fetch(
        `/api/market/frames?symbol=${encodeURIComponent(safeSymbol)}&interval=${encodeURIComponent(safeInterval)}&limit=${encodeURIComponent(String(safeLimit))}`
      )
      const primaryPayload = await primaryRes.json()
      let frames = parseFrames(primaryPayload, safeSymbol)

      if (!frames.length) {
        const replayRes = await fetch('/replay/cn-a/latest/frames.1m.json')
        const replayPayload = await replayRes.json()
        frames = parseFrames(replayPayload, safeSymbol)
      }

      const candles = toCandles(frames).slice(-safeLimit)
      if (!candles.length) throw new Error('no_candles')

      candleRef.current?.setData(candles)
      volumeRef.current?.setData(
        candles.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(255,68,68,0.35)' : 'rgba(0,176,112,0.35)',
        }))
      )
      chartRef.current?.timeScale().fitContent()
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [symbol, interval, limit])

  useEffect(() => {
    loadData()
    const timer = window.setInterval(loadData, Math.max(3000, refreshMs))
    return () => window.clearInterval(timer)
  }, [loadData, refreshMs])

  return (
    <div style={{ height, position: 'relative', background: '#0B0E11' }}>
      <div className="absolute left-2 top-1 z-10 inline-flex items-center gap-1 rounded border border-white/10 bg-black/40 px-1.5 py-0.5">
        <span className="text-[10px] font-mono text-nofx-text-main">{symbol}</span>
        <span className="text-[9px] font-mono text-nofx-text-muted">{interval}</span>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-nofx-text-muted">
          loading chart...
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-red-400">
          chart unavailable
        </div>
      )}
    </div>
  )
}
