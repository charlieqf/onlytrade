import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { afterEach, expect, test } from 'vitest'

import { createSliceManagerApp } from './app'
import { openSliceManagerDb, upsertSegment } from './db'

const tempDirs: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0, servers.length).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error)
              return
            }

            resolve()
          })
        }),
    ),
  )

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('local slice manager routes list, detail, status, and media by segment id', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'slice-manager-routes-'))
  tempDirs.push(repoRoot)

  const videoDir = join(repoRoot, 'data', 'live', 'onlytrade', 'content_videos', 't_022')
  const posterDir = join(repoRoot, 'data', 'live', 'onlytrade', 'content_posters', 't_022')
  const outsideDir = join(repoRoot, 'outside')
  const dbPath = join(repoRoot, 'data', 'local_slice_manager', 'slice_manager.db')

  mkdirSync(videoDir, { recursive: true })
  mkdirSync(posterDir, { recursive: true })
  mkdirSync(outsideDir, { recursive: true })

  const videoPath = join(videoDir, 'segment-a.mp4')
  const posterPath = join(posterDir, 'segment-a.jpg')
  writeFileSync(videoPath, 'video-a')
  writeFileSync(posterPath, 'poster-a')
  writeFileSync(join(outsideDir, 'escape.mp4'), 'outside-video')

  const db = await openSliceManagerDb(dbPath)
  upsertSegment(db, {
    id: 'segment-a',
    roomId: 't_022',
    programSlug: 'china-bigtech',
    topicId: 'topic-a',
    title: 'Segment A',
    summary: 'Detailed summary',
    videoPath,
    posterPath,
    durationSeconds: 32,
  })
  upsertSegment(db, {
    id: 'segment-b',
    roomId: 't_022',
    programSlug: 'china-bigtech',
    topicId: 'topic-b',
    title: 'Segment B',
    summary: null,
    videoPath,
    posterPath: null,
    durationSeconds: 18,
  })
  db.close()

  const app = createSliceManagerApp({ dbPath, repoRoot })
  const server = app.listen(0)
  servers.push(server)
  await new Promise<void>((resolve) => server.once('listening', resolve))

  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('Expected server to listen on an ephemeral port')
  }

  const baseUrl = `http://127.0.0.1:${address.port}`

  const listResponse = await fetch(`${baseUrl}/api/segments?page=1&pageSize=1`)
  expect(listResponse.status).toBe(200)
  await expect(listResponse.json()).resolves.toEqual({
    page: 1,
    pageSize: 1,
    total: 2,
      rows: [
        {
          id: 'segment-b',
        roomId: 't_022',
        programSlug: 'china-bigtech',
        topicId: 'topic-b',
        title: 'Segment B',
          status: 'pending_review',
          durationSeconds: 18,
          hasPoster: false,
          createdAt: expect.any(String),
        },
      ],
  })

  const detailResponse = await fetch(`${baseUrl}/api/segments/segment-a`)
  expect(detailResponse.status).toBe(200)
  await expect(detailResponse.json()).resolves.toEqual({
    id: 'segment-a',
    roomId: 't_022',
    programSlug: 'china-bigtech',
    topicId: 'topic-a',
      title: 'Segment A',
      summary: 'Detailed summary',
      status: 'pending_review',
      notes: null,
      durationSeconds: 32,
      media: {
        posterUrl: '/media/poster/segment-a',
      videoUrl: '/media/video/segment-a',
    },
  })

  const patchResponse = await fetch(`${baseUrl}/api/segments/segment-a/status`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ status: 'approved' }),
  })
  expect(patchResponse.status).toBe(200)
  await expect(patchResponse.json()).resolves.toEqual({
    id: 'segment-a',
    status: 'approved',
  })

  const updatedDetailResponse = await fetch(`${baseUrl}/api/segments/segment-a`)
  await expect(updatedDetailResponse.json()).resolves.toMatchObject({
    id: 'segment-a',
    status: 'approved',
  })

  const notesResponse = await fetch(`${baseUrl}/api/segments/segment-a/notes`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ notes: 'Ready to publish' }),
  })
  expect(notesResponse.status).toBe(200)
  await expect(notesResponse.json()).resolves.toEqual({
    id: 'segment-a',
    notes: 'Ready to publish',
  })

  const notedDetailResponse = await fetch(`${baseUrl}/api/segments/segment-a`)
  await expect(notedDetailResponse.json()).resolves.toMatchObject({
    id: 'segment-a',
    notes: 'Ready to publish',
  })

  const videoResponse = await fetch(`${baseUrl}/media/video/segment-a`)
  expect(videoResponse.status).toBe(200)
  expect(videoResponse.headers.get('content-type')).toBe('video/mp4')
  await expect(videoResponse.text()).resolves.toBe('video-a')

  const downloadResponse = await fetch(`${baseUrl}/media/video/segment-a?download=1`)
  expect(downloadResponse.status).toBe(200)
  expect(downloadResponse.headers.get('content-disposition')).toContain('attachment;')
  await expect(downloadResponse.text()).resolves.toBe('video-a')

  const posterResponse = await fetch(`${baseUrl}/media/poster/segment-a`)
  expect(posterResponse.status).toBe(200)
  expect(posterResponse.headers.get('content-type')).toBe('image/jpeg')
  await expect(posterResponse.text()).resolves.toBe('poster-a')

  const traversalResponse = await fetch(`${baseUrl}/media/video/..%2F..%2Foutside%2Fescape.mp4`)
  expect(traversalResponse.status).toBe(404)
})

test('media routes reject DB rows whose file paths escape approved media roots', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'slice-manager-routes-'))
  tempDirs.push(repoRoot)

  const videoDir = join(repoRoot, 'data', 'live', 'onlytrade', 'content_videos', 't_022')
  const outsideDir = join(repoRoot, 'outside')
  const dbPath = join(repoRoot, 'data', 'local_slice_manager', 'slice_manager.db')

  mkdirSync(videoDir, { recursive: true })
  mkdirSync(outsideDir, { recursive: true })

  const outsideVideoPath = join(outsideDir, 'escape.mp4')
  writeFileSync(outsideVideoPath, 'outside-video')

  const db = await openSliceManagerDb(dbPath)
  upsertSegment(db, {
    id: 'segment-escape-db',
    roomId: 't_022',
    programSlug: 'china-bigtech',
    topicId: 'topic-escape-db',
    title: 'Escaped db path',
    summary: null,
    videoPath: outsideVideoPath,
    posterPath: null,
    durationSeconds: 12,
  })
  db.close()

  const app = createSliceManagerApp({ dbPath, repoRoot })
  const server = app.listen(0)
  servers.push(server)
  await new Promise<void>((resolve) => server.once('listening', resolve))

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected server to listen on an ephemeral port')
  }

  const baseUrl = `http://127.0.0.1:${address.port}`
  const response = await fetch(`${baseUrl}/media/video/segment-escape-db`)
  expect(response.status).toBe(404)
})

test('serves the local frontend shell from the same express port', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'slice-manager-routes-'))
  tempDirs.push(repoRoot)

  const dbPath = join(repoRoot, 'data', 'local_slice_manager', 'slice_manager.db')
  const app = createSliceManagerApp({ dbPath, repoRoot })
  const server = app.listen(0)
  servers.push(server)
  await new Promise<void>((resolve) => server.once('listening', resolve))

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected server to listen on an ephemeral port')
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/`)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/html')
  await expect(response.text()).resolves.toContain('Local Slice Manager')
})
