import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ttsApi, type TtsTopicItem, type TtsSynthesizeResult } from '../lib/ttsApi'
import './TTSManagePage.css'

const VOICE_OPTIONS = [
  { value: 'longxiaochun', label: '龙小淳 (女声)' },
  { value: 'longxing_v3', label: '龙星 v3 (男声)' },
  { value: 'longwan', label: '龙婉 (女声)' },
  { value: 'longyuan', label: '龙媛 (女声温柔)' },
  { value: 'longxiaoxia', label: '龙小夏 (女声活泼)' },
  { value: 'longlaotie', label: '龙老铁 (男声东北)' },
  { value: 'longshu', label: '龙叔 (男声成熟)' },
  { value: 'longshuo', label: '龙硕 (男声浑厚)' },
  { value: 'longjielidou', label: '龙杰力豆 (男声)' },
]

export default function TTSManagePage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const roomId = params.get('roomId') || params.get('room_id') || 't_019'


  const [topics, setTopics] = useState<TtsTopicItem[]>([])
  const [programTitle, setProgramTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editScript, setEditScript] = useState('')

  // TTS controls
  const [voiceId, setVoiceId] = useState('longxiaochun')
  const [speechRate, setSpeechRate] = useState(100)
  const [synthesizing, setSynthesizing] = useState(false)
  const [synthResult, setSynthResult] = useState<TtsSynthesizeResult | null>(null)
  const [synthError, setSynthError] = useState<string | null>(null)
  const [synthAudioUrl, setSynthAudioUrl] = useState<string | null>(null)

  // Prompt audio
  const [promptUploading, setPromptUploading] = useState(false)
  const [promptStatus, setPromptStatus] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load topics
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ttsApi
      .getTopics(roomId)
      .then((data) => {
        if (cancelled) return
        setTopics(data.topics)
        setProgramTitle(data.program_title)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [roomId])

  const selectedTopic = useMemo(
    () => topics.find((t) => t.id === selectedId) ?? null,
    [topics, selectedId]
  )

  const handleSelectTopic = useCallback((topic: TtsTopicItem) => {
    setSelectedId(topic.id)
    setEditScript(topic.commentary_script)
    setSynthResult(null)
    setSynthError(null)
    if (synthAudioUrl) {
      URL.revokeObjectURL(synthAudioUrl)
      setSynthAudioUrl(null)
    }
  }, [synthAudioUrl])

  // Synthesize
  const handleSynthesize = useCallback(async () => {
    if (!editScript.trim() || synthesizing) return
    setSynthesizing(true)
    setSynthError(null)
    setSynthResult(null)
    if (synthAudioUrl) {
      URL.revokeObjectURL(synthAudioUrl)
      setSynthAudioUrl(null)
    }
    try {
      const result = await ttsApi.synthesize({
        text: editScript.trim(),
        voice_id: voiceId,
        format: 'mp3',
        sample_rate: 16000,
        speech_rate: speechRate,
        room_id: roomId,
        topic_id: selectedId || undefined,
      })
      setSynthResult(result)
      const blob = ttsApi.base64ToBlob(result.audio_base64, 'audio/mp3')
      setSynthAudioUrl(URL.createObjectURL(blob))
    } catch (err: unknown) {
      setSynthError(err instanceof Error ? err.message : 'Synthesis failed')
    } finally {
      setSynthesizing(false)
    }
  }, [editScript, voiceId, speechRate, roomId, selectedId, synthesizing, synthAudioUrl])

  // Download
  const handleDownload = useCallback(() => {
    if (!synthAudioUrl || !synthResult) return
    const a = document.createElement('a')
    a.href = synthAudioUrl
    a.download = synthResult.saved_file || `tts_${Date.now()}.mp3`
    a.click()
  }, [synthAudioUrl, synthResult])

  // Prompt audio upload
  const handlePromptUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPromptUploading(true)
    setPromptStatus(null)
    try {
      const result = await ttsApi.uploadPromptAudio(roomId, file)
      setPromptStatus(`✓ 已上传 ${result.file_name} (${(result.size_bytes / 1024).toFixed(0)} KB)`)
    } catch (err: unknown) {
      setPromptStatus(`✗ ${err instanceof Error ? err.message : '上传失败'}`)
    } finally {
      setPromptUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [roomId])

  // Stats
  const readyCount = topics.filter((t) => t.audio_status === 'ready').length
  const missingCount = topics.filter((t) => t.audio_status === 'missing').length
  const estimatedChars = editScript.length
  const estimatedSeconds = Math.round(estimatedChars / 4.5)

  return (
    <div className="tts-manage-page">
      {/* ── Sidebar ── */}
      <aside className="tts-sidebar">
        <div className="tts-sidebar-header">
          <h1>TTS 管理</h1>
          <p className="tts-sub">Topic Commentary Audio Manager</p>
          {programTitle && (
            <span className="tts-program-badge">{programTitle}</span>
          )}
        </div>

        <div className="tts-stats-bar">
          <span className="tts-stat">
            <span className="tts-stat-dot green" />
            {readyCount} 已就绪
          </span>
          <span className="tts-stat">
            <span className="tts-stat-dot red" />
            {missingCount} 缺失
          </span>
          <span className="tts-stat">共 {topics.length} 话题</span>
        </div>

        <div className="tts-topic-list">
          {loading && (
            <div className="tts-loading-overlay">
              <span className="tts-spinner" />
              加载话题列表…
            </div>
          )}
          {error && <div className="tts-error">{error}</div>}
          {!loading && !error && topics.map((topic) => (
            <div
              key={topic.id}
              className={`tts-topic-card ${selectedId === topic.id ? 'active' : ''}`}
              onClick={() => handleSelectTopic(topic)}
            >
              <div className="tts-topic-entity">
                <span className="tts-topic-entity-label">{topic.entity_label}</span>
                <span
                  className={`tts-topic-status-dot ${topic.audio_status}`}
                  title={topic.audio_status === 'ready' ? '音频已就绪' : '音频缺失'}
                />
              </div>
              <p className="tts-topic-title">{topic.screen_title || topic.title}</p>
              <div className="tts-topic-meta">
                <span>{topic.source}</span>
                <span>~{topic.script_estimated_seconds?.toFixed(0)}s</span>
                <span>⬤ {topic.priority_score?.toFixed(0)}</span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Detail Panel ── */}
      <main className="tts-detail">
        {!selectedTopic ? (
          <div className="tts-detail-empty">← 选择一个话题开始管理 TTS 音频</div>
        ) : (
          <>
            <div className="tts-detail-header">
              <h2>{selectedTopic.screen_title || selectedTopic.title}</h2>
              <div className="tts-detail-tags">
                {selectedTopic.screen_tags?.map((tag) => (
                  <span key={tag} className="tts-tag">{tag}</span>
                ))}
              </div>
              <div className="tts-detail-source">
                {selectedTopic.source}
                {selectedTopic.source_url && (
                  <> · <a href={selectedTopic.source_url} target="_blank" rel="noopener">原文链接</a></>
                )}
                {selectedTopic.published_at && (
                  <> · {new Date(selectedTopic.published_at).toLocaleString('zh-CN')}</>
                )}
              </div>
            </div>

            <div className="tts-detail-body">
              {/* Current Audio */}
              {selectedTopic.audio_url && (
                <div className="tts-current-audio">
                  <div className="tts-current-audio-label">✓ 当前音频 ({selectedTopic.audio_file})</div>
                  <audio controls preload="metadata" src={selectedTopic.audio_url} />
                </div>
              )}

              {/* Script Editor */}
              <div className="tts-script-section">
                <p className="tts-section-label">文案脚本</p>
                <textarea
                  className="tts-script-textarea"
                  value={editScript}
                  onChange={(e) => setEditScript(e.target.value)}
                  placeholder="输入或编辑文案脚本…"
                />
                <div className="tts-script-stats">
                  <span>{estimatedChars} 字</span>
                  <span>≈ {estimatedSeconds}s</span>
                </div>
              </div>

              {/* Prompt Audio Upload */}
              <div className="tts-prompt-section">
                <p className="tts-section-label">Zero-Shot 提示音频</p>
                <div className="tts-prompt-upload">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={handlePromptUpload}
                    id="prompt-audio-input"
                  />
                  <label htmlFor="prompt-audio-input" className="tts-prompt-file-label">
                    {promptUploading ? '上传中…' : '📎 上传提示音频'}
                  </label>
                  {promptStatus && (
                    <span className="tts-prompt-status">{promptStatus}</span>
                  )}
                </div>
              </div>

              {/* Synthesis Result */}
              {synthError && <div className="tts-error">{synthError}</div>}
              {synthAudioUrl && synthResult && (
                <div className="tts-result">
                  <div className="tts-result-label">
                    <span>🔊 合成结果</span>
                    <button className="tts-btn tts-btn-secondary" onClick={handleDownload} style={{ padding: '4px 12px', fontSize: '11px' }}>
                      ⬇ 下载 MP3
                    </button>
                  </div>
                  <audio controls autoPlay preload="auto" src={synthAudioUrl} />
                  <div className="tts-result-meta">
                    <span>音色: {synthResult.voice_id}</span>
                    <span>大小: {(synthResult.audio_size_bytes / 1024).toFixed(0)} KB</span>
                    <span>字数: {synthResult.text_length}</span>
                    {synthResult.saved_file && <span>已保存: {synthResult.saved_file}</span>}
                  </div>
                </div>
              )}
            </div>

            {/* Controls Bar */}
            <div className="tts-controls">
              <div className="tts-controls-row">
                <div className="tts-control-group">
                  <label>音色</label>
                  <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                    {VOICE_OPTIONS.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div className="tts-control-group">
                  <label>语速</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="range"
                      min={50}
                      max={200}
                      step={5}
                      value={speechRate}
                      onChange={(e) => setSpeechRate(Number(e.target.value))}
                    />
                    <span className="tts-speed-value">{speechRate}%</span>
                  </div>
                </div>
              </div>
              <div className="tts-actions">
                <button
                  className="tts-btn tts-btn-primary"
                  disabled={synthesizing || !editScript.trim()}
                  onClick={handleSynthesize}
                >
                  {synthesizing ? (
                    <>
                      <span className="tts-spinner" />
                      合成中…
                    </>
                  ) : (
                    '🎙 合成语音'
                  )}
                </button>
                {synthAudioUrl && (
                  <button className="tts-btn tts-btn-secondary" onClick={handleDownload}>
                    ⬇ 下载 MP3
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
