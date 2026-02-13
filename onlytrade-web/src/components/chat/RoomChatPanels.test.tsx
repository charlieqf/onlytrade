import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RoomPublicChatPanel } from './RoomPublicChatPanel'
import { RoomPrivateChatPanel } from './RoomPrivateChatPanel'

vi.mock('../../lib/api', () => ({
  api: {
    getRoomPublicMessages: vi.fn(async () => [
      {
        id: 'm_pub_1',
        room_id: 't_001',
        user_session_id: 'usr_sess_1',
        sender_type: 'user',
        sender_name: 'TraderFox',
        visibility: 'public',
        message_type: 'public_plain',
        text: 'hello room',
        created_ts_ms: 1700000000000,
      },
    ]),
    getRoomPrivateMessages: vi.fn(async () => [
      {
        id: 'm_priv_1',
        room_id: 't_001',
        user_session_id: 'usr_sess_1',
        sender_type: 'agent',
        sender_name: 'HS300 Momentum',
        visibility: 'private',
        message_type: 'private_agent_dm',
        text: 'private reply',
        created_ts_ms: 1700000001000,
      },
    ]),
    postRoomMessage: vi.fn(async () => ({ message: null, agent_reply: null })),
  },
}))

describe('room chat panels', () => {
  it('renders public and private channel labels', async () => {
    render(
      <RoomPublicChatPanel
        roomId="t_001"
        roomAgentName="HS300 Momentum"
        userSessionId="usr_sess_1"
        userNickname="TraderFox"
      />
    )
    expect(screen.getByText(/^Public$/i)).toBeInTheDocument()
    await screen.findByText('TraderFox')

    render(<RoomPrivateChatPanel roomId="t_001" userSessionId="usr_sess_1" userNickname="TraderFox" />)
    expect(screen.getByText(/^Private$/i)).toBeInTheDocument()
    await screen.findByText('HS300 Momentum')
  })
})
