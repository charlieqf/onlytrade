/**
 * DemoKlineChart — lightweight-charts candlestick chart for design demos.
 * Loads real 1-min OHLCV data from /replay/cn-a/latest/frames.1m.json.
 * Renders with A-share color convention: red = up, green = down.
 */
import { useEffect, useRef, useState } from 'react'
import {
    createChart,
    type IChartApi,
    type UTCTimestamp,
    CandlestickSeries,
    HistogramSeries,
} from 'lightweight-charts'

interface DemoKlineChartProps {
    /** CSS height string, e.g. "200px" or "30vh" */
    height?: string
}

interface CandleData {
    time: UTCTimestamp
    open: number
    high: number
    low: number
    close: number
    volume: number
}

export function DemoKlineChart({ height = '200px' }: DemoKlineChartProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<IChartApi | null>(null)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

    useEffect(() => {
        if (!containerRef.current) return

        // Create chart
        const chart = createChart(containerRef.current, {
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
            layout: {
                background: { color: '#0B0E11' },
                textColor: '#B7BDC6',
                fontSize: 10,
            },
            grid: {
                vertLines: { color: 'rgba(43,49,57,0.2)', visible: true },
                horzLines: { color: 'rgba(43,49,57,0.2)', visible: true },
            },
            rightPriceScale: {
                borderColor: '#2B3139',
                scaleMargins: { top: 0.05, bottom: 0.2 },
                borderVisible: false,
            },
            timeScale: {
                borderColor: '#2B3139',
                timeVisible: true,
                secondsVisible: false,
                borderVisible: false,
                rightOffset: 3,
                barSpacing: 6,
            },
            crosshair: { mode: 0 },
            handleScroll: false,
            handleScale: false,
        })
        chartRef.current = chart

        // A-share colors: red = up, green = down
        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#FF4444',
            downColor: '#00B070',
            borderUpColor: '#FF4444',
            borderDownColor: '#00B070',
            wickUpColor: '#FF4444',
            wickDownColor: '#00B070',
        })

        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: '',
            lastValueVisible: false,
            priceLineVisible: false,
        })

        // Resize observer
        const ro = new ResizeObserver((entries) => {
            if (entries[0]) {
                const { width, height } = entries[0].contentRect
                chart.applyOptions({ width, height })
            }
        })
        ro.observe(containerRef.current)

        // Fetch data
        fetch('/replay/cn-a/latest/frames.1m.json')
            .then(r => r.json())
            .then(json => {
                const frames = json.frames || []
                const candles: CandleData[] = frames.map((f: any) => ({
                    time: Math.floor(f.window.start_ts_ms / 1000) as UTCTimestamp,
                    open: f.bar.open,
                    high: f.bar.high,
                    low: f.bar.low,
                    close: f.bar.close,
                    volume: f.bar.volume_shares,
                }))

                // Sort + dedup
                candles.sort((a, b) => (a.time as number) - (b.time as number))
                const deduped = candles.filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time)

                candleSeries.setData(deduped)
                volumeSeries.setData(
                    deduped.map(c => ({
                        time: c.time,
                        value: c.volume,
                        color: c.close >= c.open
                            ? 'rgba(255,68,68,0.4)'
                            : 'rgba(0,176,112,0.4)',
                    }))
                )

                chart.timeScale().fitContent()
                setStatus('ready')
            })
            .catch(() => setStatus('error'))

        return () => {
            ro.disconnect()
            chart.remove()
        }
    }, [])

    return (
        <div style={{ height, position: 'relative', background: '#0B0E11' }}>
            {/* HUD overlay */}
            <div style={{
                position: 'absolute', top: 4, left: 8, zIndex: 10,
                display: 'flex', gap: 6, alignItems: 'center',
            }}>
                <span style={{ fontSize: 10, color: '#B7BDC6', fontFamily: 'monospace', fontWeight: 700 }}>
                    002050.SZ
                </span>
                <span style={{ fontSize: 9, color: '#ffffff50', fontFamily: 'monospace' }}>
                    1分钟
                </span>
            </div>
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
            {status === 'loading' && (
                <div style={{
                    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#ffffff40', fontSize: 11, fontFamily: 'monospace',
                }}>
                    加载K线数据…
                </div>
            )}
            {status === 'error' && (
                <div style={{
                    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#FF4444', fontSize: 11, fontFamily: 'monospace',
                }}>
                    数据加载失败
                </div>
            )}
        </div>
    )
}
