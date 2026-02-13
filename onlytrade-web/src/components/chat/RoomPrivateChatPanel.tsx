import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { api } from '../../lib/api'
import type { ChatMessage } from '../../types'

interface RoomPrivateChatPanelProps {
  roomId: string
  userSessionId: string
  userNickname: string
}

function formatMessageTime(tsMs: number) {
  if (!Number.isFinite(Number(tsMs))) return '--:--:--'
  return new Date(tsMs).toLocaleTimeString()
}

function senderLabel(message: ChatMessage) {
  const fromPayload = String(message.sender_name || '').trim()
  if (fromPayload) return fromPayload
  return message.sender_type === 'agent' ? 'Agent' : 'You'
}

export function RoomPrivateChatPanel({ roomId, userSessionId, userNickname }: RoomPrivateChatPanelProps) {
  const [text, setText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { data, error, isLoading, mutate } = useSWR(
    roomId && userSessionId ? ['room-private-chat', roomId, userSessionId] : null,
    () => api.getRoomPrivateMessages(roomId, userSessionId, 50),
    {
      refreshInterval: 2500,
      revalidateOnFocus: false,
    }
  )

  const messages = useMemo(() => {
    if (!Array.isArray(data)) return []
    return [...data].sort((a, b) => Number(a.created_ts_ms) - Number(b.created_ts_ms))
  }, [data])

  async function submitPrivate() {
    const payloadText = text.trim()
    if (!payloadText || isSubmitting) return

    setIsSubmitting(true)
    try {
      await api.postRoomMessage(roomId, {
        user_session_id: userSessionId,
        user_nickname: userNickname,
        visibility: 'private',
        message_type: 'private_agent_dm',
        text: payloadText,
      })
      setText('')
      await mutate()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-nofx-text-muted">Private</span>
        <span className="text-[11px] text-nofx-text-muted">{messages.length} messages</span>
      </div>

      <div className="h-56 overflow-y-auto rounded border border-white/10 bg-black/30 p-3 space-y-2">
        {isLoading && <div className="text-xs text-nofx-text-muted">Loading private timeline...</div>}
        {error && <div className="text-xs text-nofx-red">Failed to load private timeline.</div>}
        {!isLoading && !error && messages.length === 0 && (
          <div className="text-xs text-nofx-text-muted">No private messages yet.</div>
        )}
        {messages.map((message) => (
          <div key={message.id} className="rounded border border-white/10 bg-black/40 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-nofx-text-main">{senderLabel(message)}</span>
              <span className="text-nofx-text-muted">{formatMessageTime(message.created_ts_ms)}</span>
            </div>
            <div className="text-xs text-nofx-text-main mt-1 break-words">{message.text}</div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Send a private message to room agent"
          className="w-full min-h-[76px] resize-y rounded bg-black/40 border border-white/10 px-3 py-2 text-sm text-nofx-text-main focus:outline-none focus:border-nofx-gold/50"
        />
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={submitPrivate}
            disabled={isSubmitting || !text.trim()}
            className="px-3 py-1.5 rounded text-xs font-semibold border border-nofx-gold/30 text-nofx-gold bg-nofx-gold/10 hover:bg-nofx-gold/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send Private
          </button>
        </div>
      </div>
    </div>
  )
}
