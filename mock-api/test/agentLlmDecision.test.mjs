import test from 'node:test'
import assert from 'node:assert/strict'

import { createOpenAIAgentDecider } from '../src/agentLlmDecision.mjs'

function makeContext() {
  return {
    symbol: '600519.SH',
    constraints: {
      lot_size: 100,
    },
    intraday: {
      feature_snapshot: {
        ret_5: 0.001,
        ret_20: 0.002,
        atr_14: 1.2,
      },
      frames: [{ bar: { close: 1500 } }],
    },
    daily: {
      feature_snapshot: {
        sma_20: 1490,
        sma_60: 1470,
        rsi_14: 58,
      },
    },
    position_state: {
      shares: 0,
      cash_cny: 100000,
      mark_price: 1500,
    },
    memory_state: {
      stats: {
        return_rate_pct: 0,
        decisions: 0,
        wins: 0,
        losses: 0,
      },
      recent_actions: [],
    },
  }
}

test('llm decider uses style prompt from manifest metadata (not trader id hardcoding)', async () => {
  const originalFetch = globalThis.fetch
  const recordedBodies = []

  globalThis.fetch = async (_url, options = {}) => {
    recordedBodies.push(JSON.parse(String(options.body || '{}')))

    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decisions: [
                    {
                      action: 'hold',
                      symbol: '600519.SH',
                      confidence: 0.66,
                      quantity_shares: 0,
                      reasoning: '等待确认。',
                    },
                  ],
                }),
              },
            },
          ],
        })
      },
    }
  }

  try {
    const decide = createOpenAIAgentDecider({
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      timeoutMs: 3000,
      devTokenSaver: true,
    })

    const stylePrompt = '你是宏观波段交易员，优先看日线结构，不追涨。'
    const result = await decide({
      trader: {
        trader_id: 't_001',
        trader_name: 'HS300 Momentum',
        ai_model: 'qwen',
        trading_style: 'macro_swing',
        risk_profile: 'conservative',
        style_prompt_cn: stylePrompt,
      },
      cycleNumber: 1,
      context: makeContext(),
    })

    assert.equal(result.action, 'hold')
    assert.equal(recordedBodies.length, 1)
    const systemPrompt = String(recordedBodies[0]?.messages?.[0]?.content || '')
    assert.equal(systemPrompt.includes(stylePrompt), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
