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
    candidate_set: {
      symbols: ['600519.SH'],
      selected_symbol: '600519.SH',
      items: [
        {
          symbol: '600519.SH',
          latest_price: 1500,
          ret_5: 0.001,
          ret_20: 0.002,
          vol_ratio_20: 1.1,
          rsi_14: 58,
          rank_score: 1,
        },
      ],
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

test('llm decider emits distinct style playbooks and removes engagement objective', async () => {
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
                      confidence: 0.65,
                      quantity_shares: 0,
                      reasoning: '信号混杂，先观望。',
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

    await decide({
      trader: {
        trader_id: 't_001',
        trader_name: 'HS300 Momentum',
        ai_model: 'qwen',
        trading_style: 'momentum_trend',
        risk_profile: 'balanced',
      },
      cycleNumber: 1,
      context: makeContext(),
    })

    await decide({
      trader: {
        trader_id: 't_002',
        trader_name: 'Value Rebound',
        ai_model: 'deepseek',
        trading_style: 'mean_reversion',
        risk_profile: 'conservative',
      },
      cycleNumber: 2,
      context: makeContext(),
    })

    assert.equal(recordedBodies.length, 2)
    const promptA = String(recordedBodies[0]?.messages?.[0]?.content || '')
    const promptB = String(recordedBodies[1]?.messages?.[0]?.content || '')

    assert.equal(promptA.includes('Style momentum_trend'), true)
    assert.equal(promptB.includes('Style mean_reversion'), true)
    assert.notEqual(promptA, promptB)
    assert.equal(/engagement/i.test(promptA), false)
    assert.equal(/engagement/i.test(promptB), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('llm decider allows candidate-set symbol selection', async () => {
  const originalFetch = globalThis.fetch
  const recordedBodies = []

  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(String(options.body || '{}'))
    recordedBodies.push(body)

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
                      action: 'buy',
                      symbol: '300750.SZ',
                      confidence: 0.71,
                      quantity_shares: 100,
                      reasoning: '强势延续，执行小仓位。',
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
    const context = makeContext()
    context.candidate_set = {
      symbols: ['600519.SH', '300750.SZ'],
      selected_symbol: '600519.SH',
      items: [
        { symbol: '600519.SH', latest_price: 1500, ret_5: 0.001, ret_20: 0.002, rank_score: 2 },
        { symbol: '300750.SZ', latest_price: 220, ret_5: 0.004, ret_20: 0.01, rank_score: 1 },
      ],
    }

    const decide = createOpenAIAgentDecider({
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      timeoutMs: 3000,
      devTokenSaver: true,
    })

    const result = await decide({
      trader: {
        trader_id: 't_001',
        trader_name: 'HS300 Momentum',
        ai_model: 'qwen',
        trading_style: 'momentum_trend',
        risk_profile: 'balanced',
      },
      cycleNumber: 3,
      context,
    })

    assert.equal(result.symbol, '300750.SZ')
    assert.equal(recordedBodies.length, 1)
    const enumSymbols = recordedBodies[0]?.response_format?.json_schema?.schema?.properties?.decisions?.items?.properties?.symbol?.enum
    assert.deepEqual(enumSymbols, ['600519.SH', '300750.SZ'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
