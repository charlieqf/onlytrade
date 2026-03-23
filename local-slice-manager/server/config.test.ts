import type { Server } from 'node:http'
import { join } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { startSliceManagerServer } from './app'
import { sliceManagerConfig } from './config'

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
})

test('default local source directories point at onlytrade live content folders', () => {
  const liveRoot = join(sliceManagerConfig.repoRoot, 'data', 'live', 'onlytrade')

  expect(sliceManagerConfig.videoDir).toBe(join(liveRoot, 'content_videos'))
  expect(sliceManagerConfig.posterDir).toBe(join(liveRoot, 'content_posters'))
  expect(sliceManagerConfig.manifestDir).toBe(join(liveRoot, 'content_factory'))
  expect(sliceManagerConfig.topicPackageDir).toBe(join(liveRoot, 'topic_packages'))
  expect(sliceManagerConfig.roomId).toBe('t_022')
})

test('server boots with default local config on a development PC', async () => {
  const server = await startSliceManagerServer({ autoScan: false, port: 0 })
  servers.push(server)

  const address = server.address()

  expect(address).not.toBeNull()
  expect(typeof address).toBe('object')
  if (!address || typeof address === 'string') {
    throw new Error('Expected the slice manager server to listen on an ephemeral port')
  }

  expect(address.port).toBeGreaterThan(0)
})
