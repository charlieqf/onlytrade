import test from 'node:test'
import assert from 'node:assert/strict'

import { createOpenAIChatResponder } from '../src/chat/chatLlmResponder.mjs'

test('chat responder forwards commentary/category context for proactive prompts', async () => {
  const originalFetch = globalThis.fetch
  let capturedBody = null

  globalThis.fetch = async (_url, options = {}) => {
    capturedBody = JSON.parse(String(options.body || '{}'))
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          choices: [
            {
              message: { content: '盘面震荡，先盯紧地缘与宏观线索。' },
            },
          ],
        })
      },
    }
  }

  try {
    const responder = createOpenAIChatResponder({
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      timeoutMs: 2000,
    })

    const text = await responder({
      kind: 'proactive',
      roomAgent: {
        roomId: 't_001',
        agentName: 'HS300 Momentum',
      },
      roomContext: {
        market_overview_brief: 'A股缩量震荡，科技分化。',
        news_digest_titles: ['地缘冲突推升油价', '美债收益率上行'],
        news_commentary: ['地缘热点：中东局势升级；能源价格波动'],
        news_categories: [
          { category: 'geopolitics', label: '地缘', count: 3 },
          { category: 'global_macro', label: '宏观', count: 2 },
        ],
        news_burst_signal: {
          category: 'geopolitics',
          title: '地缘冲突升级影响风险偏好',
          priority: 4,
        },
      },
      latestDecision: null,
      historyContext: [],
      inboundMessage: null,
    })

    assert.equal(typeof text, 'string')
    assert.equal(text.length > 0, true)

    const promptPayload = JSON.parse(String(capturedBody?.messages?.[1]?.content || '{}'))
    assert.equal(Array.isArray(promptPayload?.room_context?.news_commentary), true)
    assert.equal(Array.isArray(promptPayload?.room_context?.news_categories), true)
    assert.equal(promptPayload?.room_context?.news_burst_signal?.category, 'geopolitics')

    const systemPrompt = String(capturedBody?.messages?.[0]?.content || '')
    assert.match(systemPrompt, /tech, macro economy, and geopolitics/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})
