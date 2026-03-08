import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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

test('topic stream live and asset routes serve room-scoped topic feed', { timeout: 60000 }, async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'onlytrade-topic-stream-'))
  const topicStreamDir = path.join(rootDir, 'topic_stream')
  const topicImageDir = path.join(rootDir, 'topic_images', 't_019')
  const topicAudioDir = path.join(rootDir, 'topic_audio', 't_019')
  await mkdir(topicStreamDir, { recursive: true })
  await mkdir(topicImageDir, { recursive: true })
  await mkdir(topicAudioDir, { recursive: true })

  await writeFile(path.join(topicImageDir, 'xiaomi-su7.jpg'), 'image-bytes', 'utf8')
  await writeFile(path.join(topicAudioDir, 'xiaomi-su7.mp3'), 'audio-bytes', 'utf8')
  await writeFile(
    path.join(topicStreamDir, 'china_bigtech_live.json'),
    JSON.stringify({
      schema_version: 'topic.stream.feed.v1',
      room_id: 't_019',
      program_slug: 'china-bigtech',
      program_title: '国内大厂每日锐评',
      as_of: '2026-03-08T10:00:00Z',
      topics: [
        {
          id: 'topic_xiaomi_su7',
          entity_key: 'xiaomi',
          entity_label: 'Xiaomi',
          category: 'tech',
          title: 'Xiaomi keeps the SU7 story hot',
          screen_title: '小米这波热度，不只是车圈热度',
          summary_facts: 'Xiaomi kept receiving attention around SU7 and related launch momentum.',
          commentary_script: '这条线最狠的不是参数，而是话题统治力。',
          screen_tags: ['SU7', 'Launch buzz', 'Traffic'],
          source: 'Example Source',
          source_url: 'https://example.com/xiaomi-su7',
          published_at: '2026-03-08T09:20:00Z',
          image_file: 'xiaomi-su7.jpg',
          audio_file: 'xiaomi-su7.mp3',
          script_estimated_seconds: 68,
          priority_score: 0.95,
          topic_reason: 'high attention momentum'
        },
        {
          id: '',
          entity_key: 'broken',
          entity_label: 'Broken',
          category: 'tech',
          title: 'Broken row should be dropped',
          image_file: 'broken.jpg',
          audio_file: 'broken.mp3'
        }
      ]
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
      TOPIC_STREAM_FEED_DIR: topicStreamDir,
      TOPIC_STREAM_IMAGE_DIR: path.join(rootDir, 'topic_images'),
      TOPIC_STREAM_AUDIO_DIR: path.join(rootDir, 'topic_audio'),
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    await stopChild(child)
    await rm(rootDir, { recursive: true, force: true })
  })

  await waitForServer(baseUrl)

  const liveRes = await fetch(`${baseUrl}/api/topic-stream/live?room_id=t_019`)
  const liveBody = await liveRes.json()
  assert.equal(liveRes.ok, true)
  assert.equal(liveBody.success, true)
  assert.equal(liveBody.data.room_id, 't_019')
  assert.equal(liveBody.data.live.program_slug, 'china-bigtech')
  assert.equal(liveBody.data.live.topic_count, 1)
  assert.equal(liveBody.data.live.topics[0].image_api_url, '/api/topic-stream/images/t_019/xiaomi-su7.jpg')
  assert.equal(liveBody.data.live.topics[0].audio_api_url, '/api/topic-stream/audio/t_019/xiaomi-su7.mp3')

  const imageRes = await fetch(`${baseUrl}/api/topic-stream/images/t_019/xiaomi-su7.jpg`)
  assert.equal(imageRes.ok, true)
  assert.equal(await imageRes.text(), 'image-bytes')

  const audioRes = await fetch(`${baseUrl}/api/topic-stream/audio/t_019/xiaomi-su7.mp3`)
  assert.equal(audioRes.ok, true)
  assert.equal(await audioRes.text(), 'audio-bytes')

  const invalidImageRes = await fetch(`${baseUrl}/api/topic-stream/images/t_019/%2E%2E%2Fsecret.txt`)
  assert.equal(invalidImageRes.status, 400)

  const missingRoomRes = await fetch(`${baseUrl}/api/topic-stream/live`)
  assert.equal(missingRoomRes.status, 400)
})
