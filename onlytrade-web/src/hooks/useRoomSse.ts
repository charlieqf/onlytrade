import { useEffect, useState } from 'react'

import type { ChatMessage, RoomStreamPacket } from '../types'

export type RoomSseStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export type RoomSseState = {
  status: RoomSseStatus
  last_open_ts_ms: number | null
  last_error_ts_ms: number | null
  last_event_ts_ms: number | null
}

type UseRoomSseOptions = {
  roomId?: string
  decisionsLimit?: number
  enabled?: boolean
  onStreamPacket?: (packet: RoomStreamPacket) => void
  onDecision?: () => void
  onChatPublicAppend?: (messages: ChatMessage[]) => void
}

const INITIAL_ROOM_SSE_STATE: RoomSseState = {
  status: 'connecting',
  last_open_ts_ms: null,
  last_error_ts_ms: null,
  last_event_ts_ms: null,
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function toChatMessage(value: unknown): ChatMessage | null {
  if (!isObjectRecord(value)) return null
  if (typeof value.id !== 'string') return null
  if (typeof value.room_id !== 'string') return null
  if (typeof value.user_session_id !== 'string') return null
  if (value.sender_type !== 'user' && value.sender_type !== 'agent') return null
  if (typeof value.sender_name !== 'string') return null
  if (value.visibility !== 'public' && value.visibility !== 'private')
    return null
  if (
    value.message_type !== 'public_plain' &&
    value.message_type !== 'public_mention_agent' &&
    value.message_type !== 'private_agent_dm'
  )
    return null

  const createdTsMs = Number(value.created_ts_ms)
  if (!Number.isFinite(createdTsMs)) return null

  return {
    id: value.id,
    room_id: value.room_id,
    user_session_id: value.user_session_id,
    sender_type: value.sender_type,
    sender_name: value.sender_name,
    visibility: value.visibility,
    message_type: value.message_type,
    agent_message_kind:
      value.agent_message_kind === 'reply' ||
      value.agent_message_kind === 'proactive' ||
      value.agent_message_kind === 'narration'
        ? value.agent_message_kind
        : undefined,
    text: String(value.text || ''),
    created_ts_ms: createdTsMs,
  }
}

function isRoomStreamPacket(value: unknown): value is RoomStreamPacket {
  if (!isObjectRecord(value)) return false
  return (
    typeof value.schema_version === 'string' &&
    typeof value.room_id === 'string' &&
    Number.isFinite(Number(value.ts_ms))
  )
}

export function useRoomSse({
  roomId,
  decisionsLimit = 5,
  enabled = true,
  onStreamPacket,
  onDecision,
  onChatPublicAppend,
}: UseRoomSseOptions): RoomSseState {
  const [roomSseState, setRoomSseState] = useState<RoomSseState>(
    INITIAL_ROOM_SSE_STATE
  )

  useEffect(() => {
    const safeRoomId = String(roomId || '').trim()
    if (!enabled || !safeRoomId) {
      setRoomSseState(INITIAL_ROOM_SSE_STATE)
      return
    }

    const limit = Math.max(1, Math.min(Number(decisionsLimit) || 5, 20))
    const url = `/api/rooms/${encodeURIComponent(safeRoomId)}/events?decision_limit=${encodeURIComponent(String(limit))}`

    setRoomSseState(INITIAL_ROOM_SSE_STATE)
    const es = new EventSource(url)

    const markEvent = () => {
      const now = Date.now()
      setRoomSseState((prev) => ({
        ...prev,
        last_event_ts_ms: now,
      }))
    }

    es.onopen = () => {
      const now = Date.now()
      setRoomSseState((prev) => ({
        ...prev,
        status: 'connected',
        last_open_ts_ms: now,
      }))
    }

    es.onerror = () => {
      const now = Date.now()
      setRoomSseState((prev) => {
        const nextStatus: RoomSseStatus =
          es.readyState === 2
            ? 'error'
            : prev.status === 'connecting'
              ? 'connecting'
              : 'reconnecting'
        return {
          ...prev,
          status: nextStatus,
          last_error_ts_ms: now,
        }
      })
    }

    const handleStreamPacket = (evt: MessageEvent) => {
      try {
        const packet = JSON.parse(String(evt.data || 'null'))
        if (!isRoomStreamPacket(packet)) return
        markEvent()
        onStreamPacket?.(packet)
      } catch {
        // ignore parse errors
      }
    }

    const handleDecision = () => {
      markEvent()
      onDecision?.()
    }

    const handleChatPublicAppend = (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(String(evt.data || 'null'))
        if (!isObjectRecord(payload)) return
        markEvent()

        const messages: ChatMessage[] = []
        const message = toChatMessage(payload.message)
        if (message) {
          messages.push(message)
        }
        const agentReply = toChatMessage(payload.agent_reply)
        if (agentReply) {
          messages.push(agentReply)
        }

        if (messages.length > 0) {
          onChatPublicAppend?.(messages)
        }
      } catch {
        // ignore parse errors
      }
    }

    es.addEventListener('stream_packet', handleStreamPacket as EventListener)
    es.addEventListener('decision', handleDecision as EventListener)
    es.addEventListener(
      'chat_public_append',
      handleChatPublicAppend as EventListener
    )

    return () => {
      es.removeEventListener(
        'stream_packet',
        handleStreamPacket as EventListener
      )
      es.removeEventListener('decision', handleDecision as EventListener)
      es.removeEventListener(
        'chat_public_append',
        handleChatPublicAppend as EventListener
      )
      es.close()
      setRoomSseState(INITIAL_ROOM_SSE_STATE)
    }
  }, [
    enabled,
    roomId,
    decisionsLimit,
    onStreamPacket,
    onDecision,
    onChatPublicAppend,
  ])

  return roomSseState
}
