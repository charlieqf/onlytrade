function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function safeNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function safeLimit(limit) {
  const n = Number(limit)
  if (!Number.isFinite(n)) return 800
  return Math.max(1, Math.min(Math.floor(n), 2000))
}

function buildReplayState(replayBatch) {
  const frameList = Array.isArray(replayBatch?.frames) ? replayBatch.frames : []
  const timelineSet = new Set()
  const framesBySymbol = new Map()

  for (const frame of frameList) {
    const symbol = frame?.instrument?.symbol
    const startTs = safeNumber(frame?.window?.start_ts_ms, NaN)
    if (!symbol || !Number.isFinite(startTs) || frame?.interval !== '1m') continue

    timelineSet.add(startTs)
    if (!framesBySymbol.has(symbol)) {
      framesBySymbol.set(symbol, [])
    }
    framesBySymbol.get(symbol).push(frame)
  }

  const timeline = Array.from(timelineSet).sort((a, b) => a - b)
  const frameBySymbolAndTs = new Map()

  for (const [symbol, list] of framesBySymbol.entries()) {
    list.sort((a, b) => a.window.start_ts_ms - b.window.start_ts_ms)
    const tsMap = new Map()
    for (const frame of list) {
      tsMap.set(frame.window.start_ts_ms, frame)
    }
    frameBySymbolAndTs.set(symbol, tsMap)
  }

  return {
    timeline,
    framesBySymbol,
    frameBySymbolAndTs,
  }
}

function findUpperBoundIndex(sortedTs, targetTs) {
  let left = 0
  let right = sortedTs.length

  while (left < right) {
    const mid = Math.floor((left + right) / 2)
    if (sortedTs[mid] <= targetTs) {
      left = mid + 1
    } else {
      right = mid
    }
  }

  return left
}

export function createReplayEngine({
  replayBatch,
  initialSpeed = 60,
  initialRunning = true,
  warmupBars = 120,
  loop = true,
} = {}) {
  const state = buildReplayState(replayBatch)
  const timelineLength = state.timeline.length

  let running = !!initialRunning && timelineLength > 0
  let speed = clamp(safeNumber(initialSpeed, 60), 0.1, 1000)
  let accumulatorBars = 0
  let cursorIndex = timelineLength ? clamp(Math.floor(warmupBars) - 1, 0, timelineLength - 1) : -1

  function stepForward() {
    if (timelineLength === 0) return null

    if (cursorIndex < timelineLength - 1) {
      cursorIndex += 1
      return state.timeline[cursorIndex]
    }

    if (loop) {
      cursorIndex = 0
      return state.timeline[cursorIndex]
    }

    running = false
    return null
  }

  function tick(elapsedMs) {
    if (!running || timelineLength === 0) return []

    const safeElapsedMs = Math.max(0, safeNumber(elapsedMs, 0))
    accumulatorBars += (safeElapsedMs * speed) / 60_000

    const advanced = []
    while (accumulatorBars >= 1) {
      accumulatorBars -= 1
      const ts = stepForward()
      if (!Number.isFinite(ts)) break
      advanced.push(ts)
    }

    return advanced
  }

  function step(bars = 1) {
    if (timelineLength === 0) return []
    const count = Math.max(1, Math.min(Math.floor(safeNumber(bars, 1)), 120))
    const advanced = []

    for (let i = 0; i < count; i++) {
      const ts = stepForward()
      if (!Number.isFinite(ts)) break
      advanced.push(ts)
    }

    return advanced
  }

  function getCurrentTimestamp() {
    if (cursorIndex < 0 || cursorIndex >= timelineLength) return null
    return state.timeline[cursorIndex]
  }

  function getVisibleFrames(symbol, limit = 800) {
    const frames = state.framesBySymbol.get(symbol) || []
    if (!frames.length || cursorIndex < 0) return []

    const maxItems = safeLimit(limit)
    const currentTs = getCurrentTimestamp()
    if (!Number.isFinite(currentTs)) return []

    const upperBound = findUpperBoundIndex(
      frames.map((frame) => frame.window.start_ts_ms),
      currentTs
    )
    return frames.slice(Math.max(0, upperBound - maxItems), upperBound)
  }

  function getFramesAtTimestamps(symbol, timestamps) {
    const tsMap = state.frameBySymbolAndTs.get(symbol)
    if (!tsMap || !Array.isArray(timestamps) || !timestamps.length) return []

    const rows = []
    for (const ts of timestamps) {
      const frame = tsMap.get(ts)
      if (frame) rows.push(frame)
    }
    return rows
  }

  function getStatus() {
    return {
      running,
      speed,
      loop,
      warmup_bars: warmupBars,
      cursor_index: cursorIndex,
      timeline_length: timelineLength,
      current_ts_ms: getCurrentTimestamp(),
    }
  }

  function pause() {
    running = false
    return getStatus()
  }

  function resume() {
    if (timelineLength > 0) {
      running = true
    }
    return getStatus()
  }

  function setSpeed(nextSpeed) {
    speed = clamp(safeNumber(nextSpeed, speed), 0.1, 1000)
    return getStatus()
  }

  function setCursor(index) {
    if (!timelineLength) return getStatus()
    cursorIndex = clamp(Math.floor(safeNumber(index, cursorIndex)), 0, timelineLength - 1)
    accumulatorBars = 0
    return getStatus()
  }

  return {
    tick,
    step,
    pause,
    resume,
    setSpeed,
    setCursor,
    getStatus,
    getVisibleFrames,
    getFramesAtTimestamps,
  }
}
