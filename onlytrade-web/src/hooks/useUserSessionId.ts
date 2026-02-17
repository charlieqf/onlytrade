import { useEffect, useState } from 'react'
import { api } from '../lib/api'

const USER_SESSION_STORAGE_KEY = 'user_session_id'
const USER_NICKNAME_STORAGE_KEY = 'user_nickname'

function fallbackNicknameFromSessionId(userSessionId: string) {
  const token = String(userSessionId || '').replace(/[^a-zA-Z0-9]/g, '')
  const tail = token.slice(-4).toUpperCase()
  return tail ? `User-${tail}` : 'User'
}

type UseUserSessionIdState = {
  userSessionId: string | null
  userNickname: string | null
  isLoading: boolean
  error: Error | null
}

export function useUserSessionId(): UseUserSessionIdState {
  const [userSessionId, setUserSessionId] = useState<string | null>(null)
  const [userNickname, setUserNickname] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let mounted = true

    async function resolveSession() {
      try {
        const stored = localStorage.getItem(USER_SESSION_STORAGE_KEY)
        if (stored && stored.trim()) {
          const safeStoredSessionId = stored.trim()
          const storedNickname = localStorage.getItem(USER_NICKNAME_STORAGE_KEY)
          const safeNickname =
            storedNickname && storedNickname.trim()
              ? storedNickname.trim()
              : fallbackNicknameFromSessionId(safeStoredSessionId)
          localStorage.setItem(USER_NICKNAME_STORAGE_KEY, safeNickname)

          if (!mounted) return
          setUserSessionId(safeStoredSessionId)
          setUserNickname(safeNickname)
          setIsLoading(false)
          return
        }

        const payload = await api.bootstrapChatSession()
        const next = String(payload.user_session_id || '').trim()
        const nickname = String(payload.user_nickname || '').trim()
        if (!next) {
          throw new Error('invalid_user_session_id')
        }
        if (!nickname) {
          throw new Error('invalid_user_nickname')
        }

        localStorage.setItem(USER_SESSION_STORAGE_KEY, next)
        localStorage.setItem(USER_NICKNAME_STORAGE_KEY, nickname)

        if (!mounted) return
        setUserSessionId(next)
        setUserNickname(nickname)
        setIsLoading(false)
      } catch (err) {
        if (!mounted) return
        setError(
          err instanceof Error ? err : new Error('chat_session_init_failed')
        )
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
    userNickname,
    isLoading,
    error,
  }
}
