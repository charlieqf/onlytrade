import { describe, it, expect, vi, beforeEach } from 'vitest'

// NOTE: Vitest hoists vi.mock() calls; use var to avoid TDZ issues.
var lastRequestInterceptor: ((cfg: any) => any) | null = null
var lastResponseErrorInterceptor: ((err: any) => any) | null = null

vi.mock('axios', () => {
  const create = vi.fn(() => {
    lastRequestInterceptor = null
    lastResponseErrorInterceptor = null

    return {
      interceptors: {
        request: {
          use: (fn: any) => {
            lastRequestInterceptor = fn
            return 0
          },
        },
        response: {
          use: (_onOk: any, onErr: any) => {
            lastResponseErrorInterceptor = onErr
            return 0
          },
        },
      },
      request: vi.fn(),
    }
  })

  return {
    default: { create },
    create,
  }
})

import { HttpClient } from './httpClient'

describe('HttpClient', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('adds Authorization header when auth_token exists', () => {
    localStorage.setItem('auth_token', 'tok_123')
    new HttpClient({ loginRequired: false })

    expect(lastRequestInterceptor).toBeTypeOf('function')

    const cfg = { headers: {} as Record<string, string> }
    const out = lastRequestInterceptor!(cfg)

    expect(out.headers.Authorization).toBe('Bearer tok_123')
  })

  it('does not add Authorization header when token missing', () => {
    new HttpClient({ loginRequired: false })

    const cfg = { headers: {} as Record<string, string> }
    const out = lastRequestInterceptor!(cfg)

    expect(out.headers.Authorization).toBeUndefined()
  })

  it('on 401 with loginRequired=true: clears auth, stores returnUrl, dispatches unauthorized, redirects', async () => {
    localStorage.setItem('auth_token', 'tok_123')
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 'u1', email: 'e@example.com' })
    )

    const unauthorizedSpy = vi.fn()
    window.addEventListener('unauthorized', unauthorizedSpy)

    const pushStateSpy = vi.spyOn(window.history, 'pushState')
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    // Ensure current location is a non-login page.
    window.history.pushState({}, '', '/room?trader=x')

    new HttpClient({ loginRequired: true })

    const err = {
      response: {
        status: 401,
        data: { error: 'Unauthorized' },
      },
    }

    // Do not await: handler returns a never-resolving promise on redirect.
    void lastResponseErrorInterceptor!(err)

    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(localStorage.getItem('auth_user')).toBeNull()
    expect(sessionStorage.getItem('from401')).toBe('true')
    expect(sessionStorage.getItem('returnUrl')).toBe('/room?trader=x')
    expect(unauthorizedSpy).toHaveBeenCalled()
    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/login')
    expect(dispatchSpy).toHaveBeenCalled()

    window.removeEventListener('unauthorized', unauthorizedSpy)
    pushStateSpy.mockRestore()
    dispatchSpy.mockRestore()
  })

  it('on 401 with loginRequired=false: throws and does not redirect', async () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState')

    new HttpClient({ loginRequired: false })

    const err = {
      response: {
        status: 401,
        data: { error: 'No auth required' },
      },
    }

    await expect(lastResponseErrorInterceptor!(err)).rejects.toThrow(
      'No auth required'
    )
    expect(pushStateSpy).not.toHaveBeenCalled()

    pushStateSpy.mockRestore()
  })
})
