import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RoomPublicChatPanel } from './RoomPublicChatPanel'
import { RoomPrivateChatPanel } from './RoomPrivateChatPanel'

vi.mock('../../lib/api', () => ({
  api: {
    getRoomPublicMessages: vi.fn(async () => []),
    getRoomPrivateMessages: vi.fn(async () => []),
    postRoomMessage: vi.fn(async () => ({ message: null, agent_reply: null })),
  },
}))

describe('room chat panels', () => {
  it('renders public and private channel labels', async () => {
    render(<RoomPublicChatPanel roomId="t_001" userSessionId="usr_sess_1" />)
    expect(screen.getByText(/^Public$/i)).toBeInTheDocument()
    await screen.findByText(/No public messages yet\./i)

    render(<RoomPrivateChatPanel roomId="t_001" userSessionId="usr_sess_1" />)
    expect(screen.getByText(/^Private$/i)).toBeInTheDocument()
    await screen.findByText(/No private messages yet\./i)
  })
})
