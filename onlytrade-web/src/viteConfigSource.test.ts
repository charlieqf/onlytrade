import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('vite config source', () => {
  it('uses onlytrade base path for production builds and root for dev', () => {
    const source = readFileSync('vite.config.ts', 'utf8')

    expect(source).toContain("command === 'build' ? '/onlytrade/' : '/'")
  })
})
