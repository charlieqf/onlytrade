import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { api } from '../../lib/api'
import type { ChatMessage, ChatMessageType } from '../../types'

interface RoomPublicChatPanelProps {
  roomId: string
  roomAgentName: string
  userSessionId: string
  userNickname: string
  roomSseState?: {
    status: 'connecting' | 'connected' | 'reconnecting' | 'error'
    last_event_ts_ms: number | null
  }
}

function normalizeAgentHandle(agentName: string) {
  const normalized = String(agentName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'agent'
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findActiveMention(text: string, cursor: number) {
  const safeCursor = Math.max(0, Math.min(Number(cursor) || 0, text.length))
  const head = text.slice(0, safeCursor)
  const atIndex = head.lastIndexOf('@')
  if (atIndex < 0) return null

  const prev = atIndex > 0 ? head[atIndex - 1] : ''
  if (prev && !/\s/.test(prev)) return null

  const query = head.slice(atIndex + 1)
  if (/\s/.test(query)) return null
  return {
    start: atIndex,
    query,
    cursor: safeCursor,
  }
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

export function RoomPublicChatPanel({
  roomId,
  roomAgentName,
  userSessionId,
  userNickname,
  roomSseState,
}: RoomPublicChatPanelProps) {
  const [text, setText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [activeMention, setActiveMention] = useState<null | {
    start: number
    query: string
    cursor: number
  }>(null)

  const { data, error, isLoading, mutate } = useSWR(
    roomId ? ['room-public-chat', roomId] : null,
    () => api.getRoomPublicMessages(roomId, 50),
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
    }
  )

  const messages = useMemo(() => {
    if (!Array.isArray(data)) return []
    return [...data].sort(
      (a, b) => Number(a.created_ts_ms) - Number(b.created_ts_ms)
    )
  }, [data])

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    // Always follow latest messages (chat-app behavior).
    // Use scrollTop assignment for jsdom compatibility.
    el.scrollTop = el.scrollHeight
  }, [messages.length])

  const agentHandle = useMemo(
    () => normalizeAgentHandle(roomAgentName),
    [roomAgentName]
  )
  const mentionTokens = useMemo(() => {
    const tokens = ['agent', agentHandle].filter(Boolean)
    return Array.from(new Set(tokens))
  }, [agentHandle])
  const mentionRegex = useMemo(() => {
    const parts = mentionTokens.map((token) => escapeRegExp(token)).join('|')
    return new RegExp(`(^|\\s)@(${parts})(\\b|$)`, 'i')
  }, [mentionTokens])

  const mentionOptions = useMemo(() => {
    const options = [
      {
        token: 'agent',
        label: '@agent',
        hint: 'Generic mention (always supported)',
      },
      {
        token: agentHandle,
        label: `@${agentHandle}`,
        hint: roomAgentName
          ? `Agent handle for ${roomAgentName}`
          : 'Agent handle',
      },
    ].filter((item) => item.token)
    return Array.from(new Map(options.map((opt) => [opt.token, opt])).values())
  }, [agentHandle, roomAgentName])

  const filteredMentionOptions = useMemo(() => {
    if (!activeMention) return []
    const q = String(activeMention.query || '').toLowerCase()
    if (!q) return mentionOptions
    return mentionOptions.filter(
      (opt) =>
        opt.token.toLowerCase().startsWith(q) ||
        opt.label.toLowerCase().includes(q)
    )
  }, [activeMention, mentionOptions])

  function applyMention(token: string) {
    const el = textareaRef.current
    if (!el || !activeMention) return

    const insertion = `@${token} `
    const before = text.slice(0, activeMention.start)
    const after = text.slice(activeMention.cursor)
    const next = `${before}${insertion}${after}`
    setText(next)
    setActiveMention(null)
    requestAnimationFrame(() => {
      el.focus()
      const pos = (before + insertion).length
      el.setSelectionRange(pos, pos)
    })
  }

  async function submit(messageType: ChatMessageType) {
    let payloadText = text.trim()
    if (!payloadText || isSubmitting) return

    let effectiveType: ChatMessageType = messageType
    if (effectiveType === 'public_plain' && mentionRegex.test(payloadText)) {
      effectiveType = 'public_mention_agent'
    }
    if (
      effectiveType === 'public_mention_agent' &&
      !mentionRegex.test(payloadText)
    ) {
      payloadText = `@agent ${payloadText}`
    }

    setIsSubmitting(true)
    try {
      await api.postRoomMessage(roomId, {
        user_session_id: userSessionId,
        user_nickname: userNickname,
        visibility: 'public',
        message_type: effectiveType,
        text: payloadText,
      })
      setText('')
      setActiveMention(null)
      await mutate()
    } finally {
      setIsSubmitting(false)
    }
  }

  const sseStatus = roomSseState?.status || 'connecting'
  const sseClass =
    sseStatus === 'connected'
      ? 'text-[11px] font-mono text-nofx-green'
      : sseStatus === 'reconnecting'
        ? 'text-[11px] font-mono text-nofx-gold'
        : sseStatus === 'error'
          ? 'text-[11px] font-mono text-nofx-red'
          : 'text-[11px] font-mono text-nofx-text-muted'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-nofx-text-muted">
          Public
        </span>
        <div className="flex items-center gap-2">
          <span className={sseClass}>SSE: {sseStatus}</span>
          {roomSseState?.last_event_ts_ms && (
            <span className="text-[11px] font-mono text-nofx-text-muted">
              last {formatMessageTime(roomSseState.last_event_ts_ms)}
            </span>
          )}
          <span className="text-[11px] text-nofx-text-muted">
            {messages.length} messages
          </span>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className="h-56 overflow-y-auto rounded border border-white/10 bg-black/30 p-3 space-y-2"
      >
        {isLoading && (
          <div className="text-xs text-nofx-text-muted">
            Loading public timeline...
          </div>
        )}
        {error && (
          <div className="text-xs text-nofx-red">
            Failed to load public timeline.
          </div>
        )}
        {!isLoading && !error && messages.length === 0 && (
          <div className="text-xs text-nofx-text-muted">
            No public messages yet.
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className="rounded border border-white/10 bg-black/40 px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-nofx-text-main">
                {senderLabel(message)}
              </span>
              <span className="text-nofx-text-muted">
                {formatMessageTime(message.created_ts_ms)}
              </span>
            </div>
            <div className="text-xs text-nofx-text-main mt-1 break-words">
              {message.text}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => {
            const next = event.target.value
            setText(next)
            const cursor = event.target.selectionStart ?? next.length
            setActiveMention(findActiveMention(next, cursor))
          }}
          onBlur={() => {
            // allow click on mention menu without it disappearing mid-click
            setTimeout(() => setActiveMention(null), 120)
          }}
          placeholder="Send a public room message (tip: type @ to mention the agent)"
          className="w-full min-h-[76px] resize-y rounded bg-black/40 border border-white/10 px-3 py-2 text-sm text-nofx-text-main focus:outline-none focus:border-nofx-gold/50"
        />

        {activeMention && filteredMentionOptions.length > 0 && (
          <div className="rounded border border-white/10 bg-black/60 overflow-hidden">
            {filteredMentionOptions.map((opt) => (
              <button
                key={opt.token}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyMention(opt.token)}
                className="w-full text-left px-3 py-2 hover:bg-white/10 transition-colors"
              >
                <div className="text-xs font-semibold text-nofx-text-main">
                  {opt.label}
                </div>
                {opt.hint && (
                  <div className="text-[11px] text-nofx-text-muted mt-0.5">
                    {opt.hint}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={() => submit('public_plain')}
            disabled={isSubmitting || !text.trim()}
            className="px-3 py-1.5 rounded text-xs font-semibold border border-white/15 text-nofx-text-main hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
