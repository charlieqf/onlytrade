import { useEffect, useState } from 'react'
import { api } from '../lib/api'

const USER_SESSION_STORAGE_KEY = 'user_session_id'

type UseUserSessionIdState = {
  userSessionId: string | null
  isLoading: boolean
  error: Error | null
}

export function useUserSessionId(): UseUserSessionIdState {
  const [userSessionId, setUserSessionId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let mounted = true

    async function resolveSession() {
      try {
        const stored = localStorage.getItem(USER_SESSION_STORAGE_KEY)
        if (stored && stored.trim()) {
          if (!mounted) return
          setUserSessionId(stored.trim())
          setIsLoading(false)
          return
        }

        const payload = await api.bootstrapChatSession()
        const next = String(payload.user_session_id || '').trim()
        if (!next) {
          throw new Error('invalid_user_session_id')
        }

        localStorage.setItem(USER_SESSION_STORAGE_KEY, next)

        if (!mounted) return
        setUserSessionId(next)
        setIsLoading(false)
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err : new Error('chat_session_init_failed'))
        setIsLoading(false)
      }
    }

    resolveSession()

    return () => {
      mounted = false
    }
  }, [])

  return {
    userSessionId,
    isLoading,
    error,
  }
}
