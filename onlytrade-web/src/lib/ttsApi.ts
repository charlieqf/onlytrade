

const API_BASE = '/api'

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

export type TtsTopicItem = {
  id: string
  entity_key: string
  entity_label: string
  category: string
  title: string
  screen_title: string
  summary_facts: string
  commentary_script: string
  screen_tags: string[]
  source: string
  source_url: string
  published_at: string
  script_estimated_seconds: number
  priority_score: number
  audio_file: string | null
  audio_status: 'ready' | 'missing'
  audio_url: string | null
  image_file: string | null
  image_url: string | null
}

export type TtsTopicsResponse = {
  room_id: string
  program_slug: string
  program_title: string
  as_of: string | null
  topic_count: number
  topics: TtsTopicItem[]
}

export type TtsSynthesizeResult = {
  audio_base64: string
  audio_size_bytes: number
  format: string
  saved_file: string | null
  saved_audio_url: string | null
  voice_id: string
  text_length: number
}

export const ttsApi = {
  async getTopics(roomId: string): Promise<TtsTopicsResponse> {
    const res = await fetch(
      `${API_BASE}/tts-manage/topics/${encodeURIComponent(roomId)}`,
      { method: 'GET', headers: getAuthHeaders(), cache: 'no-store' }
    )
    const payload = await res.json()
    if (!payload.success) throw new Error(payload.error || 'Failed to load topics')
    return payload.data
  },

  async synthesize(params: {
    text: string
    voice_id?: string
    format?: string
    sample_rate?: number
    speech_rate?: number
    volume?: number
    room_id?: string
    topic_id?: string
  }): Promise<TtsSynthesizeResult> {
    const res = await fetch(`${API_BASE}/tts-manage/synthesize`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(params),
    })
    const payload = await res.json()
    if (!payload.success) throw new Error(payload.error || 'TTS synthesis failed')
    return payload.data
  },

  async uploadPromptAudio(
    roomId: string,
    audioBlob: Blob
  ): Promise<{ room_id: string; file_name: string; size_bytes: number }> {
    const res = await fetch(
      `${API_BASE}/tts-manage/prompt-audio/${encodeURIComponent(roomId)}`,
      { method: 'POST', headers: { 'Content-Type': audioBlob.type || 'audio/wav' }, body: audioBlob }
    )
    const payload = await res.json()
    if (!payload.success) throw new Error(payload.error || 'Upload failed')
    return payload.data
  },

  async listPromptAudio(
    roomId: string
  ): Promise<{ room_id: string; files: string[] }> {
    const res = await fetch(
      `${API_BASE}/tts-manage/prompt-audio/${encodeURIComponent(roomId)}`,
      { method: 'GET', headers: getAuthHeaders() }
    )
    const payload = await res.json()
    if (!payload.success) throw new Error(payload.error || 'List failed')
    return payload.data
  },

  base64ToBlob(base64: string, mimeType: string = 'audio/mp3'): Blob {
    const bytes = atob(base64)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    return new Blob([arr], { type: mimeType })
  },
}
