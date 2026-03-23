import { describe, expect, it } from 'vitest'

import { resolveAppUrl, resolveDownloadUrl } from './appUrls'

describe('appUrls', () => {
  it('keeps root deployment URLs unchanged', () => {
    expect(resolveAppUrl('/media/video/seg-001', '/', 'http://example.com')).toBe('/media/video/seg-001')
  })

  it('prefixes URLs for subpath deployments', () => {
    expect(
      resolveAppUrl('/media/video/seg-001', '/onlytrade/slice-manager/', 'http://example.com'),
    ).toBe('/onlytrade/slice-manager/media/video/seg-001')
  })

  it('does not double-prefix URLs that already include the deployment base', () => {
    expect(
      resolveAppUrl(
        '/onlytrade/slice-manager/media/video/seg-001',
        '/onlytrade/slice-manager/',
        'http://example.com',
      ),
    ).toBe('/onlytrade/slice-manager/media/video/seg-001')
  })

  it('adds download query params without losing existing query strings', () => {
    expect(
      resolveDownloadUrl('/media/video/seg-001?foo=bar', '/onlytrade/slice-manager/', 'http://example.com'),
    ).toBe('/onlytrade/slice-manager/media/video/seg-001?foo=bar&download=1')
  })

  it('leaves absolute URLs absolute', () => {
    expect(resolveAppUrl('https://cdn.example.com/video.mp4', '/onlytrade/slice-manager/')).toBe(
      'https://cdn.example.com/video.mp4',
    )
  })
})
