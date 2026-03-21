import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const RUNTIME_API_DIR = path.resolve(__dirname, '..')

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(() => {
        if (typeof port === 'number') resolve(port)
        else reject(new Error('port_unavailable'))
      })
    })
  })
}

async function waitForServer(baseUrl, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`)
      if (res.ok) return
    } catch {
      // Keep polling until timeout.
    }
    await delay(250)
  }
  throw new Error('server_start_timeout')
}

async function stopChild(child, timeoutMs = 2000) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    once(child, 'exit'),
    delay(timeoutMs),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

test('content factory live, video, and poster routes serve room-scoped assets', { timeout: 60000 }, async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'onlytrade-content-factory-'))
  const feedDir = path.join(rootDir, 'content_factory_feed')
  const videoDir = path.join(rootDir, 'content_factory_videos', 't_022')
  const posterDir = path.join(rootDir, 'content_factory_posters', 't_022')
  await mkdir(feedDir, { recursive: true })
  await mkdir(videoDir, { recursive: true })
  await mkdir(posterDir, { recursive: true })

  await writeFile(path.join(videoDir, 'china-bigtech-001.mp4'), 'video-bytes', 'utf8')
  await writeFile(path.join(posterDir, 'china-bigtech-001.jpg'), 'poster-bytes', 'utf8')
  await writeFile(
    path.join(feedDir, 'china_bigtech_factory_live.json'),
    JSON.stringify({
      schema_version: 'content.factory.feed.v1',
      room_id: 't_022',
      program_slug: 'china-bigtech',
      program_title: 'China BigTech Content Factory',
      as_of: '2026-03-21T10:00:00Z',
      segment_count: 1,
      segments: [
        {
          id: 'cf_topic_001',
          topic_id: 'topic_001',
          title: 'China bigtech keeps momentum',
          video_file: 'china-bigtech-001.mp4',
          poster_file: 'china-bigtech-001.jpg',
        },
      ],
    }, null, 2),
    'utf8'
  )

  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: RUNTIME_API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_LLM_ENABLED: 'false',
      RUNTIME_DATA_MODE: 'replay',
      STRICT_LIVE_MODE: 'false',
      CONTENT_FACTORY_FEED_DIR: feedDir,
      CONTENT_FACTORY_VIDEO_DIR: path.join(rootDir, 'content_factory_videos'),
      CONTENT_FACTORY_POSTER_DIR: path.join(rootDir, 'content_factory_posters'),
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    await stopChild(child)
    await rm(rootDir, { recursive: true, force: true })
  })

  await waitForServer(baseUrl)

  const liveRes = await fetch(`${baseUrl}/api/content-factory/live?room_id=t_022`)
  const liveBody = await liveRes.json()
  assert.equal(liveRes.ok, true)
  assert.equal(liveBody.success, true)
  assert.equal(liveBody.data.room_id, 't_022')
  assert.equal(liveBody.data.live.program_slug, 'china-bigtech')
  assert.equal(liveBody.data.live.segment_count, 1)
  assert.equal(liveBody.data.live.segments[0].video_api_url, '/api/content-factory/videos/t_022/china-bigtech-001.mp4')
  assert.equal(liveBody.data.live.segments[0].poster_api_url, '/api/content-factory/posters/t_022/china-bigtech-001.jpg')

  const videoRes = await fetch(`${baseUrl}/api/content-factory/videos/t_022/china-bigtech-001.mp4`)
  assert.equal(videoRes.ok, true)
  assert.equal(await videoRes.text(), 'video-bytes')

  const posterRes = await fetch(`${baseUrl}/api/content-factory/posters/t_022/china-bigtech-001.jpg`)
  assert.equal(posterRes.ok, true)
  assert.equal(await posterRes.text(), 'poster-bytes')

  const invalidVideoRes = await fetch(`${baseUrl}/api/content-factory/videos/t_022/%2E%2E%2Fsecret.mp4`)
  assert.equal(invalidVideoRes.status, 400)

  const invalidPosterRes = await fetch(`${baseUrl}/api/content-factory/posters/t_022/%2E%2E%2Fsecret.jpg`)
  assert.equal(invalidPosterRes.status, 400)
})

test('content factory default asset directories match local publish layout', async () => {
  const source = await readFile(path.join(RUNTIME_API_DIR, 'server.mjs'), 'utf8')
  assert.match(source, /content_videos/)
  assert.match(source, /content_posters/)
  assert.doesNotMatch(source, /content_factory_videos/)
  assert.doesNotMatch(source, /content_factory_posters/)
})
