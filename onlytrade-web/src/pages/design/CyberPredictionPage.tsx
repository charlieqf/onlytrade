import { useEffect, useRef, useState } from 'react'

import { useFullscreenLock } from '../../hooks/useFullscreenLock'
import { api } from '../../lib/api'
import {
    type FormalStreamDesignPageProps,
    usePhoneStreamData,
} from './phoneStreamShared'
import { motion, AnimatePresence } from 'framer-motion'

interface MarketState {
    market: {
        id: string
        title: string
        yes_outcome: string
        no_outcome: string
        initial_prob: number
        current_prob: number
        close_time: string
        volume: number
        liquidity: number
        source_topic?: string
        source_source?: string
        source_hot_score?: string
        news_summary?: string
        news_key_points?: string
    }
    balances: {
        [username: string]: number
    }
    logs: Array<{
        id: number
        sender: string
        type: string
        text: string
        time: number
    }>
    ai_pnl: number
    last_update: number
}

interface CommentaryItem {
    id: string
    event_type: string
    text: string
    speaker_id: string
    speaker_name: string
    voice_id: string
    source: string
    created_ts_ms: number
    market_id?: string | null
}

interface StreamLogItem {
    id: string | number
    sender: string
    type: string
    text: string
    time: number
}

interface CommentaryRequestPayload {
    eventType: string
    eventKey: string
    market: MarketState['market']
    recentLogs: MarketState['logs']
    triggerReason: string
    probDelta?: number
}

interface PrepareCommentaryOptions {
    requireSpeech?: boolean
    speechRetryCount?: number
}

interface PreparedCommentary {
    item: CommentaryItem
    speechBlob: Blob | null
}

interface AudioQueueItem {
    id: string
    url: string
    retries: number
}

interface PendingSwitchPacket {
    marketId: string
    nextState: MarketState
    payload: CommentaryRequestPayload
    prepared: PreparedCommentary | null
    preparing: boolean
    lastAttemptTsMs: number
    fallbackPrepared: PreparedCommentary | null
    fallbackPreparing: boolean
    fallbackAttemptTsMs: number
    pendingSinceTsMs: number
    prob: number | null
    lastLogId: number | null
    nowMs: number
}

const SWITCH_FALLBACK_GRACE_MS = 2200
const SWITCH_FALLBACK_FORCE_MS = 12000
const AUDIO_TEXT_DEDUPE_MS = 45000

function normalizeAudioDedupeText(value: unknown): string {
    const text = String(value || '').trim()
    if (!text) return ''
    return text
        .replace(/\s+/g, ' ')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[。！？!?]+$/g, '')
}

function normalizeProb(value: unknown): number | null {
    const n = Number(value)
    if (!Number.isFinite(n)) return null
    return Math.max(0, Math.min(1, n))
}

function normalizeCommentaryItem(raw: unknown): CommentaryItem | null {
    if (!raw || typeof raw !== 'object') return null
    const row = raw as Record<string, unknown>
    const id = String(row.id || '').trim()
    const text = String(row.text || '').trim()
    if (!id || !text) return null
    return {
        id,
        event_type: String(row.event_type || 'market_tick').trim().toLowerCase(),
        text,
        speaker_id: String(row.speaker_id || '').trim().toLowerCase() || 'host_a',
        speaker_name: String(row.speaker_name || '').trim() || '主播',
        voice_id: String(row.voice_id || '').trim(),
        source: String(row.source || '').trim(),
        created_ts_ms: Number(row.created_ts_ms) || Date.now(),
        market_id: row.market_id ? String(row.market_id) : null,
    }
}

// Format numbers like 25,000,000 -> 25M
function formatCompactAmount(num: number) {
    if (num >= 100000000) {
        return (num / 100000000).toFixed(1) + '亿'
    }
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + '万'
    }
    return Number(num || 0).toLocaleString('zh-CN')
}

function formatHHMMSS(ms: number) {
    const d = new Date(ms)
    return [
        d.getHours().toString().padStart(2, '0'),
        d.getMinutes().toString().padStart(2, '0'),
        d.getSeconds().toString().padStart(2, '0')
    ].join(':')
}

function localizeOutcomeLabel(label: string, fallback: string) {
    const text = String(label || '').trim()
    if (!text) return fallback
    const normalized = text.toLowerCase()
    if (['yes', 'true', 'up'].includes(normalized)) return '支持'
    if (['no', 'false', 'down'].includes(normalized)) return '不支持'
    return text
}

function isSafeIdleMarketId(value: unknown) {
    const id = String(value || '').trim().toLowerCase()
    return id.startsWith('safe_idle')
}

export default function CyberPredictionPage(props: FormalStreamDesignPageProps) {
    useFullscreenLock()
    const pageLanguage = 'zh'
    const {
        selectedTrader,
    } = usePhoneStreamData({
        ...props,
        language: pageLanguage,
    })

    const [state, setState] = useState<MarketState | null>(null)
    const [errorCount, setErrorCount] = useState(0)
    const [commentaryItems, setCommentaryItems] = useState<CommentaryItem[]>([])
    const [speakingCommentaryId, setSpeakingCommentaryId] = useState<string | null>(null)
    const [viewerLogItems, setViewerLogItems] = useState<StreamLogItem[]>([])

    const snapshotRef = useRef<{
        marketId: string
        prob: number | null
        lastLogId: number | null
        lastCommentaryTs: number
    }>({
        marketId: '',
        prob: null,
        lastLogId: null,
        lastCommentaryTs: 0,
    })
    const inFlightRef = useRef(false)
    const audioQueueRef = useRef<AudioQueueItem[]>([])
    const audioPlayingRef = useRef(false)
    const activeAudioRef = useRef<HTMLAudioElement | null>(null)
    const fetchInFlightRef = useRef(false)
    const marketSwitchInFlightRef = useRef(false)
    const pendingSwitchRef = useRef<PendingSwitchPacket | null>(null)
    const triggerMarketPollRef = useRef<(() => void) | null>(null)
    const lastAudioFinishedTsRef = useRef(0)
    const spokenCommentaryIdsRef = useRef<Set<string>>(new Set())
    const recentSpokenTextTsRef = useRef<Map<string, number>>(new Map())
    const knownCommentaryIdsRef = useRef<Set<string>>(new Set())
    const knownViewerMessageIdsRef = useRef<Set<string>>(new Set())
    const currentMarketIdRef = useRef('')

    const clearAudioPlaybackQueue = () => {
        if (activeAudioRef.current) {
            activeAudioRef.current.pause()
            activeAudioRef.current = null
        }
        for (const item of audioQueueRef.current) {
            URL.revokeObjectURL(item.url)
        }
        audioQueueRef.current = []
        audioPlayingRef.current = false
        setSpeakingCommentaryId(null)
    }

    const isCommentaryAlignedWithCurrentMarket = (marketId: string | null | undefined) => {
        const liveMarketId = String(currentMarketIdRef.current || '').trim()
        if (!liveMarketId) return true
        const itemMarketId = String(marketId || '').trim()
        if (!itemMarketId) return true
        return itemMarketId === liveMarketId
    }

    const appendCommentary = (item: CommentaryItem) => {
        if (knownCommentaryIdsRef.current.has(item.id)) return
        knownCommentaryIdsRef.current.add(item.id)
        setCommentaryItems((prev) => {
            const next = [...prev, item]
            if (next.length > 40) next.splice(0, next.length - 40)
            return next
        })
    }

    const playNextCommentaryAudio = () => {
        if (audioPlayingRef.current) return
        const next = audioQueueRef.current.shift()
        if (!next) {
            setSpeakingCommentaryId(null)
            return
        }

        const audio = new Audio(next.url)
        activeAudioRef.current = audio
        audioPlayingRef.current = true
        setSpeakingCommentaryId(next.id)

        let settled = false

        const finalizeSuccess = () => {
            if (settled) return
            settled = true
            audioPlayingRef.current = false
            setSpeakingCommentaryId(null)
            URL.revokeObjectURL(next.url)
            activeAudioRef.current = null
            lastAudioFinishedTsRef.current = Date.now()
            playNextCommentaryAudio()
            const triggerPoll = triggerMarketPollRef.current
            if (triggerPoll) triggerPoll()
        }

        const finalizeError = () => {
            if (settled) return
            settled = true
            audioPlayingRef.current = false
            setSpeakingCommentaryId(null)
            activeAudioRef.current = null
            if (next.retries < 1) {
                audioQueueRef.current.unshift({
                    ...next,
                    retries: next.retries + 1,
                })
                setTimeout(() => {
                    playNextCommentaryAudio()
                }, 250)
                return
            }
            URL.revokeObjectURL(next.url)
            lastAudioFinishedTsRef.current = Date.now()
            playNextCommentaryAudio()
            const triggerPoll = triggerMarketPollRef.current
            if (triggerPoll) triggerPoll()
        }

        audio.onended = finalizeSuccess
        audio.onerror = finalizeError
        void audio.play().catch(() => {
            finalizeError()
        })
    }

    const enqueueCommentaryAudio = (id: string, blob: Blob, text: string = '') => {
        if (!(blob instanceof Blob) || blob.size <= 0) return
        const safeId = String(id || '').trim()
        if (safeId && spokenCommentaryIdsRef.current.has(safeId)) {
            return
        }

        const nowMs = Date.now()
        const textKey = normalizeAudioDedupeText(text)
        if (textKey) {
            for (const [k, ts] of recentSpokenTextTsRef.current.entries()) {
                if (nowMs - Number(ts || 0) > AUDIO_TEXT_DEDUPE_MS * 4) {
                    recentSpokenTextTsRef.current.delete(k)
                }
            }
            const lastTs = Number(recentSpokenTextTsRef.current.get(textKey) || 0)
            if (lastTs > 0 && nowMs - lastTs < AUDIO_TEXT_DEDUPE_MS) {
                if (safeId) {
                    spokenCommentaryIdsRef.current.add(safeId)
                }
                return
            }
            recentSpokenTextTsRef.current.set(textKey, nowMs)
        }

        if (safeId) {
            spokenCommentaryIdsRef.current.add(safeId)
        }
        const url = URL.createObjectURL(blob)
        audioQueueRef.current.push({ id: safeId || id, url, retries: 0 })
        playNextCommentaryAudio()
    }

    const appendViewerLog = (raw: unknown) => {
        if (!raw || typeof raw !== 'object') return
        const row = raw as Record<string, unknown>
        const senderType = String(row.sender_type || '').toLowerCase()
        if (senderType !== 'user') return
        const id = String(row.id || '').trim()
        const text = String(row.text || '').trim()
        if (!id || !text) return
        if (knownViewerMessageIdsRef.current.has(id)) return
        knownViewerMessageIdsRef.current.add(id)
        const item: StreamLogItem = {
            id: `chat:${id}`,
            sender: String(row.sender_name || '观众').trim() || '观众',
            type: 'user',
            text,
            time: Number(row.created_ts_ms) || Date.now(),
        }
        setViewerLogItems((prev) => {
            const next = [...prev, item]
            if (next.length > 120) next.splice(0, next.length - 120)
            return next
        })
    }

    const synthesizeSpeechWithRetry = async (item: CommentaryItem, attempts: number): Promise<Blob | null> => {
        const maxAttempts = Math.max(1, Math.min(5, Number(attempts) || 1))
        for (let idx = 0; idx < maxAttempts; idx += 1) {
            try {
                return await api.synthesizeRoomSpeech({
                    room_id: selectedTrader.trader_id,
                    text: item.text,
                    message_id: item.id,
                    tone: 'energetic',
                    speaker_id: item.speaker_id,
                })
            } catch {
                if (idx >= maxAttempts - 1) break
                await new Promise((resolve) => setTimeout(resolve, 250 * (idx + 1)))
            }
        }
        return null
    }

    const prepareCommentaryForEvent = async (
        payload: CommentaryRequestPayload,
        options: PrepareCommentaryOptions = {}
    ): Promise<PreparedCommentary | null> => {
        try {
            const generated = await api.generatePolymarketCommentary({
                room_id: selectedTrader.trader_id,
                event_type: payload.eventType,
                event_key: payload.eventKey,
                market: payload.market,
                recent_logs: payload.recentLogs.slice(-6),
                trigger: {
                    reason: payload.triggerReason,
                    delta_prob: payload.probDelta,
                },
            })
            const parsed = normalizeCommentaryItem(generated.commentary)
            if (!parsed) return null
            const fallbackMarketId = String(payload.market?.id || '').trim()
            const item: CommentaryItem = {
                ...parsed,
                market_id: parsed.market_id || fallbackMarketId || null,
            }

            const speechBlob = await synthesizeSpeechWithRetry(
                item,
                Number(options.speechRetryCount) || 1
            )
            if (options.requireSpeech && !speechBlob) return null

            return {
                item,
                speechBlob,
            }
        } catch {
            // generation failures should not break render loop
            return null
        }
    }

    const requestCommentaryForEvent = async (
        payload: CommentaryRequestPayload,
        options: { ignoreSwitchLock?: boolean } = {}
    ) => {
        if (inFlightRef.current) return
        if (marketSwitchInFlightRef.current && !options.ignoreSwitchLock) return
        inFlightRef.current = true
        try {
            const prepared = await prepareCommentaryForEvent(payload, {
                speechRetryCount: 2,
            })
            if (!prepared) return
            if (!isCommentaryAlignedWithCurrentMarket(prepared.item.market_id)) return
            appendCommentary(prepared.item)
            if (prepared.speechBlob) {
                enqueueCommentaryAudio(prepared.item.id, prepared.speechBlob, prepared.item.text)
            }
        } finally {
            inFlightRef.current = false
        }
    }

    const startPendingSwitchPreparation = (packet: PendingSwitchPacket) => {
        if (packet.preparing) return
        packet.preparing = true
        packet.lastAttemptTsMs = Date.now()
        void (async () => {
            const prepared = await prepareCommentaryForEvent(packet.payload, {
                requireSpeech: true,
                speechRetryCount: 4,
            })
            const latest = pendingSwitchRef.current
            if (!latest || latest.marketId !== packet.marketId) return
            latest.prepared = prepared
            latest.preparing = false
            latest.lastAttemptTsMs = Date.now()
            const triggerPoll = triggerMarketPollRef.current
            if (triggerPoll) triggerPoll()
        })()
    }

    const buildFastSwitchCommentaryItem = (payload: CommentaryRequestPayload): CommentaryItem => {
        const marketId = String(payload.market?.id || '').trim()
        const marketTitleRaw = String(payload.market?.title || '').trim()
        const marketTitle = marketTitleRaw.length <= 28
            ? marketTitleRaw
            : ''
        const prompts = marketTitle
            ? [
                `下一条焦点：${marketTitle}。先给你一句快报，详细解读马上补上。`,
                `焦点已切到：${marketTitle}。先报关键信号，完整分析紧跟。`,
                `我们切到新话题：${marketTitle}。先听一句摘要，稍后上完整版本。`,
            ]
            : [
                '下一条焦点已切换。先给你一句快报，详细解读马上补上。',
                '新话题已到位。先报关键信号，完整分析紧跟。',
                '我们切到新话题。先听一句摘要，稍后上完整版本。',
            ]
        const text = prompts[Math.floor(Math.random() * prompts.length)]
        const nowMs = Date.now()
        return {
            id: `polyc_fast_${marketId || 'next'}_${nowMs}`,
            event_type: 'market_switch_fast',
            text,
            speaker_id: 'host_a',
            speaker_name: '小真',
            voice_id: '',
            source: 'switch_fallback',
            created_ts_ms: nowMs,
            market_id: marketId || null,
        }
    }

    const startPendingSwitchFallbackPreparation = (packet: PendingSwitchPacket) => {
        if (packet.fallbackPreparing || packet.fallbackPrepared?.speechBlob) return
        packet.fallbackPreparing = true
        packet.fallbackAttemptTsMs = Date.now()
        const fallbackItem = buildFastSwitchCommentaryItem(packet.payload)
        void (async () => {
            const blob = await synthesizeSpeechWithRetry(fallbackItem, 3)
            const latest = pendingSwitchRef.current
            if (!latest || latest.marketId !== packet.marketId) return
            latest.fallbackPrepared = blob
                ? { item: fallbackItem, speechBlob: blob }
                : null
            latest.fallbackPreparing = false
            latest.fallbackAttemptTsMs = Date.now()
            const triggerPoll = triggerMarketPollRef.current
            if (triggerPoll) triggerPoll()
        })()
    }

    // Poll the static JSON file
    useEffect(() => {
        let active = true

        const fetchData = async () => {
            if (fetchInFlightRef.current) return
            fetchInFlightRef.current = true
            try {
                // Add timestamp to foil caching
                const res = await fetch(`/cyber_market_live.json?t=${Date.now()}`)
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`)
                const data = await res.json()
                const nextState = data as MarketState
                const nowMs = Date.now()
                const prev = snapshotRef.current
                const marketId = String(nextState?.market?.id || '').trim()
                const safeIdleMarket = isSafeIdleMarketId(marketId)
                const marketChanged = !!prev.marketId && !!marketId && marketId !== prev.marketId
                const prob = normalizeProb(nextState?.market?.current_prob)
                const logs = Array.isArray(nextState?.logs) ? nextState.logs : []
                const lastLog = logs.length ? logs[logs.length - 1] : null
                const lastLogId = Number.isFinite(Number(lastLog?.id)) ? Number(lastLog?.id) : null

                let pendingEvent: {
                    eventType: string
                    eventKey: string
                    triggerReason: string
                    probDelta?: number
                } | null = null

                const elapsedSinceCommentary = nowMs - Number(prev.lastCommentaryTs || 0)
                if (!prev.marketId && marketId) {
                    pendingEvent = {
                        eventType: 'initial_snapshot',
                        eventKey: `${marketId}|init`,
                        triggerReason: 'initial_market_snapshot',
                    }
                } else if (prev.marketId && marketId && marketId !== prev.marketId) {
                    pendingEvent = {
                        eventType: 'market_switch',
                        eventKey: `${marketId}|switch`,
                        triggerReason: 'market_switched',
                    }
                } else if (
                    prob != null
                    && prev.prob != null
                    && elapsedSinceCommentary >= 3500
                ) {
                    const delta = prob - prev.prob
                    if (Math.abs(delta) >= 0.012) {
                        const sign = delta > 0 ? 'up' : 'down'
                        pendingEvent = {
                            eventType: delta > 0 ? 'prob_spike_up' : 'prob_spike_down',
                            eventKey: `${marketId}|prob|${sign}|${Math.round(prob * 1000)}`,
                            triggerReason: `probability_${sign}_${(Math.abs(delta) * 100).toFixed(2)}pct`,
                            probDelta: delta,
                        }
                    }
                }

                if (!pendingEvent && lastLogId != null && lastLogId !== prev.lastLogId && elapsedSinceCommentary >= 3500) {
                    const logType = String(lastLog?.type || '').trim().toLowerCase()
                    if (logType === 'info') {
                        pendingEvent = {
                            eventType: 'headline_change',
                            eventKey: `${marketId}|info|${lastLogId}`,
                            triggerReason: 'system_info_log_changed',
                        }
                    } else if (logType === 'agent' && elapsedSinceCommentary >= 4500) {
                        pendingEvent = {
                            eventType: 'agent_execution',
                            eventKey: `${marketId}|agent|${lastLogId}`,
                            triggerReason: 'agent_trade_log_changed',
                        }
                    }
                }
                if (safeIdleMarket) {
                    pendingEvent = null
                }

                if (active) {
                    const isSwitchEvent = marketChanged && pendingEvent?.eventType === 'market_switch'
                    const switchPayload = isSwitchEvent && pendingEvent
                        ? {
                            ...pendingEvent,
                            market: nextState.market,
                            recentLogs: logs,
                        }
                        : null

                    const applySwitchPacket = (packet: PendingSwitchPacket, prepared: PreparedCommentary | null) => {
                        const applyMarketId = String(packet.marketId || '').trim()
                        if (!prepared || !prepared.speechBlob) return
                        if (String(prepared.item.market_id || '').trim() !== applyMarketId) return
                        const usedFallback = String(prepared.item.source || '').trim() === 'switch_fallback'
                        currentMarketIdRef.current = applyMarketId
                        clearAudioPlaybackQueue()
                        setCommentaryItems((prevItems) => prevItems.filter((item) => String(item.market_id || '').trim() === applyMarketId))
                        setState(packet.nextState)
                        setErrorCount(0)
                        appendCommentary(prepared.item)
                        enqueueCommentaryAudio(prepared.item.id, prepared.speechBlob, prepared.item.text)

                        snapshotRef.current = {
                            marketId: applyMarketId,
                            prob: packet.prob,
                            lastLogId: packet.lastLogId,
                            lastCommentaryTs: packet.nowMs,
                        }
                        pendingSwitchRef.current = null
                        marketSwitchInFlightRef.current = false
                        if (usedFallback) {
                            setTimeout(() => {
                                void requestCommentaryForEvent(packet.payload, { ignoreSwitchLock: true })
                            }, 120)
                        }
                    }

                    if (isSwitchEvent && switchPayload) {
                        const hasActivePlayback = (
                            audioPlayingRef.current
                            || audioQueueRef.current.length > 0
                            || inFlightRef.current
                        )
                        if (hasActivePlayback) {
                            const existingPending = pendingSwitchRef.current
                            if (!existingPending || existingPending.marketId !== marketId) {
                                const packet: PendingSwitchPacket = {
                                    marketId,
                                    nextState,
                                    payload: switchPayload,
                                    prepared: null,
                                    preparing: false,
                                    lastAttemptTsMs: 0,
                                    fallbackPrepared: null,
                                    fallbackPreparing: false,
                                    fallbackAttemptTsMs: 0,
                                    pendingSinceTsMs: nowMs,
                                    prob,
                                    lastLogId,
                                    nowMs,
                                }
                                pendingSwitchRef.current = packet
                                marketSwitchInFlightRef.current = true
                                startPendingSwitchPreparation(packet)
                                startPendingSwitchFallbackPreparation(packet)
                            } else {
                                existingPending.nextState = nextState
                                existingPending.payload = switchPayload
                                existingPending.prob = prob
                                existingPending.lastLogId = lastLogId
                                existingPending.nowMs = nowMs
                                if (
                                    !existingPending.preparing
                                    && nowMs - Number(existingPending.lastAttemptTsMs || 0) >= 1500
                                ) {
                                    startPendingSwitchPreparation(existingPending)
                                }
                                if (
                                    !existingPending.fallbackPreparing
                                    && !existingPending.fallbackPrepared?.speechBlob
                                    && nowMs - Number(existingPending.fallbackAttemptTsMs || 0) >= 1500
                                ) {
                                    startPendingSwitchFallbackPreparation(existingPending)
                                }
                            }
                            return
                        }

                        const existingPending = pendingSwitchRef.current
                        if (existingPending && existingPending.marketId === marketId) {
                            existingPending.nextState = nextState
                            existingPending.payload = switchPayload
                            existingPending.prob = prob
                            existingPending.lastLogId = lastLogId
                            existingPending.nowMs = nowMs
                            const audioIdleMs = lastAudioFinishedTsRef.current > 0
                                ? nowMs - lastAudioFinishedTsRef.current
                                : 0
                            const pendingAgeMs = nowMs - Number(existingPending.pendingSinceTsMs || nowMs)
                            const allowFallbackNow = (
                                audioIdleMs >= SWITCH_FALLBACK_GRACE_MS
                                || pendingAgeMs >= SWITCH_FALLBACK_FORCE_MS
                            )
                            const readyPrepared = existingPending.prepared?.speechBlob
                                ? existingPending.prepared
                                : (allowFallbackNow && existingPending.fallbackPrepared?.speechBlob
                                    ? existingPending.fallbackPrepared
                                    : null)
                            if (readyPrepared) {
                                applySwitchPacket(existingPending, readyPrepared)
                                return
                            }
                            if (
                                !existingPending.preparing
                                && nowMs - Number(existingPending.lastAttemptTsMs || 0) >= 1500
                            ) {
                                startPendingSwitchPreparation(existingPending)
                            }
                            if (
                                !existingPending.fallbackPreparing
                                && !existingPending.fallbackPrepared?.speechBlob
                                && nowMs - Number(existingPending.fallbackAttemptTsMs || 0) >= 1500
                            ) {
                                startPendingSwitchFallbackPreparation(existingPending)
                            }
                            return
                        }

                        const packet: PendingSwitchPacket = {
                            marketId,
                            nextState,
                            payload: switchPayload,
                            prepared: null,
                            preparing: false,
                            lastAttemptTsMs: 0,
                            fallbackPrepared: null,
                            fallbackPreparing: false,
                            fallbackAttemptTsMs: 0,
                            pendingSinceTsMs: nowMs,
                            prob,
                            lastLogId,
                            nowMs,
                        }
                        pendingSwitchRef.current = packet
                        marketSwitchInFlightRef.current = true
                        startPendingSwitchPreparation(packet)
                        startPendingSwitchFallbackPreparation(packet)
                        return
                    }

                    currentMarketIdRef.current = marketId
                    if (marketChanged) {
                        clearAudioPlaybackQueue()
                        setCommentaryItems((prevItems) => prevItems.filter((item) => String(item.market_id || '').trim() === marketId))
                    }
                    setState(nextState)
                    setErrorCount(0)
                    if (pendingEvent) {
                        void requestCommentaryForEvent({
                            ...pendingEvent,
                            market: nextState.market,
                            recentLogs: logs,
                        })
                    }
                    snapshotRef.current = {
                        marketId,
                        prob,
                        lastLogId,
                        lastCommentaryTs: pendingEvent ? nowMs : prev.lastCommentaryTs,
                    }
                }
            } catch (err) {
                console.warn('Failed to fetch market data:', err)
                if (active) setErrorCount((c) => c + 1)
            } finally {
                fetchInFlightRef.current = false
                if (!pendingSwitchRef.current) {
                    marketSwitchInFlightRef.current = false
                }
            }
        }

        triggerMarketPollRef.current = () => {
            void fetchData()
        }

        fetchData() // initial fetch
        const timer = setInterval(fetchData, 1500) // Poll every 1.5s

        return () => {
            active = false
            triggerMarketPollRef.current = null
            pendingSwitchRef.current = null
            clearInterval(timer)
        }
    }, [selectedTrader.trader_id])

    useEffect(() => {
        spokenCommentaryIdsRef.current.clear()
        recentSpokenTextTsRef.current.clear()
    }, [selectedTrader.trader_id])

    useEffect(() => {
        return () => {
            clearAudioPlaybackQueue()
        }
    }, [])

    useEffect(() => {
        let active = true
        let afterTsMs = Date.now() - 4000

        setViewerLogItems([])
        knownViewerMessageIdsRef.current.clear()

        const pullFeed = async () => {
            try {
                const rows = await api.getPolymarketCommentaryFeed({
                    room_id: selectedTrader.trader_id,
                    after_ts_ms: afterTsMs,
                    limit: 20,
                })
                if (!active || !rows.length) return

                for (const raw of rows) {
                    const item = normalizeCommentaryItem(raw)
                    if (!item) continue
                    afterTsMs = Math.max(afterTsMs, Number(item.created_ts_ms) || 0)
                    if (!isCommentaryAlignedWithCurrentMarket(item.market_id)) continue
                    const alreadyKnown = knownCommentaryIdsRef.current.has(item.id)
                    appendCommentary(item)
                    if (alreadyKnown) continue
                    try {
                        const speechBlob = await api.synthesizeRoomSpeech({
                            room_id: selectedTrader.trader_id,
                            text: item.text,
                            message_id: item.id,
                            tone: 'energetic',
                            speaker_id: item.speaker_id,
                        })
                        enqueueCommentaryAudio(item.id, speechBlob, item.text)
                    } catch {
                        // keep text-only feed if speech fails
                    }
                }
            } catch {
                // ignore feed polling errors
            }
        }

        void pullFeed()
        const timer = setInterval(() => {
            void pullFeed()
        }, 2500)

        return () => {
            active = false
            clearInterval(timer)
        }
    }, [selectedTrader.trader_id])

    useEffect(() => {
        let active = true
        let afterTsMs = Date.now() - 3000

        const pullAgentMessages = async () => {
            try {
                const rows = await api.getRoomPublicMessages(selectedTrader.trader_id, 60)
                if (!active || !rows.length) return

                const ordered = [...rows]
                    .filter((row) => Number((row as { created_ts_ms?: unknown }).created_ts_ms) > afterTsMs)
                    .sort((a, b) => Number((a as { created_ts_ms?: unknown }).created_ts_ms) - Number((b as { created_ts_ms?: unknown }).created_ts_ms))

                for (const row of ordered) {
                    const senderType = String((row as { sender_type?: unknown }).sender_type || '').toLowerCase()
                    if (senderType === 'user') {
                        appendViewerLog(row)
                    }
                    const ts = Number((row as { created_ts_ms?: unknown }).created_ts_ms) || Date.now()
                    afterTsMs = Math.max(afterTsMs, ts)
                }
            } catch {
                // ignore polling errors
            }
        }

        void pullAgentMessages()
        const timer = setInterval(() => {
            void pullAgentMessages()
        }, 2500)

        return () => {
            active = false
            clearInterval(timer)
        }
    }, [selectedTrader.trader_id])

    if (!state && errorCount > 5) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-black text-red-500 font-mono tracking-widest text-xl">
                [!!] 数据连接中断 [!!]
            </div>
        )
    }

    if (!state) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-black text-cyan-500 font-mono tracking-widest text-xl animate-pulse">
                [ 正在初始化预测解说流... ]
            </div>
        )
    }

    const { market, logs, ai_pnl } = state
    const safeIdleState = isSafeIdleMarketId(market.id)
    const yesProbStr = (market.current_prob * 100).toFixed(1)
    const noProbStr = ((1 - market.current_prob) * 100).toFixed(1)
    const yesOutcomeLabel = localizeOutcomeLabel(market.yes_outcome, '支持')
    const noOutcomeLabel = localizeOutcomeLabel(market.no_outcome, '不支持')

    // Format log reversed so newest is at the bottom (or top depending on preference, here we render top-down)
    const baseLogs: StreamLogItem[] = Array.isArray(logs) ? logs.map((item) => ({
        id: item.id,
        sender: item.sender,
        type: item.type,
        text: item.text,
        time: item.time,
    })) : []
    const mergedLogs = [...baseLogs, ...viewerLogItems]
        .sort((a, b) => Number(b.time) - Number(a.time))
        .slice(0, 24)
    const displayLogs = mergedLogs
    const displayCommentary = [...commentaryItems].slice(-4).reverse()

    return (
        <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#020509] text-white font-sans max-w-lg mx-auto border-x border-white/5 shadow-2xl relative">

            {/* --- TOP BRANDING HEADER --- */}
            <header className="flex h-12 shrink-0 border-b border-[#00f5a0]/30 bg-black/80 px-4 shadow-[0_4px_30px_rgba(0,245,160,0.15)] relative">
                <div className="absolute top-0 left-0 h-[1px] w-full bg-gradient-to-r from-[#00f5a0] via-[#00d9ff] to-transparent"></div>
                <div className="flex w-full items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="text-[#00f5a0] text-xl animate-pulse">❖</div>
                        <div>
                            <h1 className="text-[10px] font-black tracking-widest text-[#00f5a0] drop-shadow-[0_0_8px_rgba(0,245,160,0.6)] font-mono uppercase">
                                预测解说台 // 直播中
                            </h1>
                            <div className="text-[8px] text-white/50 tracking-widest font-mono">
                                节点: {selectedTrader.trader_id}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 font-mono">
                        <div className="flex flex-col items-end">
                            <span className="text-[8px] text-white/50">趋势分</span>
                            <span className={`text-xs font-bold tracking-tighter ${ai_pnl >= 0 ? 'text-[#00f5a0]' : 'text-red-500'}`}>
                                {ai_pnl >= 0 ? '+' : ''}{ai_pnl.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[8px] text-white/50">热度</span>
                            <span className="text-xs font-bold text-white/90">{formatCompactAmount(market.volume)}</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* --- MAIN VERTICAL LAYOUT --- */}
            <main className="flex min-h-0 flex-1 flex-col relative overflow-hidden">

                {/* Background grid accent */}
                <div className="absolute inset-0 pointer-events-none" style={{
                    backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
                    backgroundSize: '40px 40px'
                }}></div>

                {/* TOP SECTION: Market Title and Odds */}
                <section className="flex flex-col flex-none p-5 relative z-10 w-full shrink-0">

                    {/* Guest Avatar / Video Slot (Future-Proofed) - Approx 1/16 of screen area */}
                    <div className="absolute top-4 right-4 w-28 h-28 rounded-xl border border-white/20 shadow-[0_0_15px_rgba(0,0,0,0.5)] overflow-hidden bg-black/60 z-50">
                        {/* Dynamic video loop replacing static image */}
                        <video
                            src="/avatar.mp4"
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="w-full h-full object-cover opacity-90"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                        <div className="absolute bottom-1 right-2 text-[8px] font-mono text-white/50 bg-black/40 px-1 rounded">
                            机位_01
                        </div>
                    </div>

                    {/* Market Question */}
                    <div className="mb-6 w-full mt-2 pr-32">
                        <div className="inline-block px-2 py-0.5 mb-3 rounded border border-[#00d9ff]/30 bg-[#00d9ff]/10 text-[#00d9ff] text-[10px] tracking-wider font-mono">
                            截止时间: {market.close_time}
                        </div>
                        <AnimatePresence mode="wait">
                            <motion.h2
                                key={market.id}
                                initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
                                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                                exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)', transition: { duration: 0.2 } }}
                                transition={{ duration: 0.8, ease: "easeOut" }}
                                className="text-2xl font-bold leading-tight tracking-tight text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]"
                            >
                                {market.title}
                            </motion.h2>
                        </AnimatePresence>
                        {safeIdleState && (
                            <div className="mt-3 rounded border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[10px] text-amber-200/90 font-mono tracking-wide">
                                安全过滤中：当前暂无可播事件，系统会自动切换到下一条安全话题。
                            </div>
                        )}
                    </div>

                    {/* The Binary Odds Arena */}
                    <div className="flex flex-col w-full mt-1">
                        {/* Visual Bar */}
                        <div className="relative h-12 w-full rounded-xl flex overflow-hidden border border-white/10 shadow-xl bg-[#0B1015]">
                            {/* YES fill */}
                            <div
                                className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-[1200ms] ease-out flex items-center shadow-[inset_0_0_15px_rgba(255,255,255,0.2)]"
                                style={{ width: `${market.current_prob * 100}%` }}
                            >
                                <div className="pl-3 text-lg font-black text-white/90 drop-shadow-md tracking-wider font-mono whitespace-nowrap overflow-hidden">
                                    {yesOutcomeLabel}
                                </div>
                            </div>
                            {/* NO fill */}
                            <div className="h-full flex-1 bg-gradient-to-l from-rose-600 to-rose-400 flex items-center justify-end shadow-[inset_0_0_15px_rgba(255,255,255,0.2)]">
                                <div className="pr-3 text-lg font-black text-white/90 drop-shadow-md tracking-wider font-mono whitespace-nowrap overflow-hidden">
                                    {noOutcomeLabel}
                                </div>
                            </div>
                        </div>

                        {/* Numbers below the bar */}
                        <div className="flex justify-between items-start mt-2 px-1">
                            <div className="flex flex-col">
                                <span className="text-3xl font-black text-emerald-400 font-mono tracking-tighter drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]">
                                    {yesProbStr}%
                                </span>
                                <span className="text-[9px] font-bold text-emerald-400/60 tracking-widest mt-0.5">当前概率: {(market.current_prob * 100).toFixed(2)}%</span>
                            </div>
                            <div className="flex flex-col items-end">
                                <span className="text-3xl font-black text-rose-400 font-mono tracking-tighter drop-shadow-[0_0_8px_rgba(251,113,133,0.4)]">
                                    {noProbStr}%
                                </span>
                                <span className="text-[9px] font-bold text-rose-400/60 tracking-widest mt-0.5">当前概率: {((1 - market.current_prob) * 100).toFixed(2)}%</span>
                            </div>
                        </div>
                    </div>

                </section>

                {/* BOTTOM SECTION: The Public Square Feed (Scrollable) */}
                <section className="flex-1 min-h-0 border-t border-white/10 bg-[#050914]/80 backdrop-blur-xl flex flex-col relative z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
                    <div className="h-8 border-b border-white/5 flex items-center justify-between px-4 shrink-0 bg-[#0A101C]">
                        <h3 className="text-[10px] font-bold text-white/60 tracking-[0.2em] font-mono">实时观察流</h3>
                        <span className="flex h-1.5 w-1.5 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                        </span>
                    </div>

                    <div className="shrink-0 border-b border-white/5 bg-[#070d18]/70 px-3 py-2">
                        <div className="mb-1 flex items-center justify-between text-[9px] font-mono uppercase tracking-widest text-cyan-300/80">
                            <span>实时解说</span>
                            {safeIdleState
                                ? <span className="text-amber-200/90">安全筛选中</span>
                                : speakingCommentaryId
                                ? <span className="text-emerald-300">播报中</span>
                                : (displayCommentary.length > 0
                                    ? <span className="text-cyan-200/80">待播</span>
                                    : <span className="text-white/50">准备中</span>)}
                        </div>
                        {displayCommentary.length === 0 ? (
                            <div className="text-[10px] text-white/50 font-mono">
                                {safeIdleState ? '安全过滤中，等待下一条可播事件...' : '解说准备中...'}
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {displayCommentary.map((item) => {
                                    const speaking = speakingCommentaryId === item.id
                                    return (
                                        <div
                                            key={item.id}
                                            className={`rounded border px-2 py-1.5 font-mono ${speaking
                                                ? 'border-emerald-400/60 bg-emerald-400/10'
                                                : 'border-cyan-400/20 bg-cyan-500/5'}`}
                                        >
                                            <div className="mb-0.5 flex items-center justify-between text-[9px] text-white/60">
                                                <span className="text-cyan-200/90">{item.speaker_name}</span>
                                                <span>{formatHHMMSS(item.created_ts_ms)}</span>
                                            </div>
                                            <div className="text-[11px] leading-snug text-white/90">{item.text}</div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-[11px]">
                        {displayLogs.length === 0 && (
                            <div className="text-white/30 text-center py-10 tracking-widest text-xs">
                                {safeIdleState ? '安全过滤中...' : '等待新信号...'}
                            </div>
                        )}
                        {displayLogs.map(log => {
                            const isAgent = log.type === 'agent'
                            const isSystem = log.type === 'info'
                            return (
                                <div key={log.id} className={`flex flex-col pt-1 pb-2 border-b border-white/[0.03] animate-in fade-in slide-in-from-bottom-2 duration-500 ${isSystem ? 'opacity-50' : ''}`}>
                                    <div className="flex items-center justify-between mb-1 opacity-60">
                                        <span className={isAgent ? 'text-amber-400 font-bold tracking-widest text-[10px]' : isSystem ? 'text-white/40 text-[10px]' : 'text-cyan-400 tracking-widest text-[10px]'}>
                                            {log.sender}
                                        </span>
                                        <span className="text-[9px] text-white/30">{formatHHMMSS(log.time)}</span>
                                    </div>
                                    <div className={`leading-snug ${isAgent ? 'text-amber-50 shadow-sm' : isSystem ? 'text-white/40 italic' : 'text-white/80'}`}>
                                        {isAgent && <span className="mr-1.5 text-amber-500">&gt;_</span>}
                                        {log.text}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                    {/* Bottom gradient fade for text */}
                    <div className="h-16 bg-gradient-to-t from-[#020509] to-transparent absolute bottom-0 left-0 w-full pointer-events-none"></div>
                </section>
            </main>
        </div>
    )
}
