import { getCnAMarketSessionStatus } from './cnMarketSession.mjs'
import { getUsMarketSessionStatus } from './usMarketSession.mjs'

export function inferMarketFromSymbol(symbol) {
  const s = String(symbol || '').trim().toUpperCase()
  if (!s) return 'CN-A'
  if (/^\d{6}\.(SH|SZ)$/.test(s)) return 'CN-A'
  return 'US'
}

export function marketIdForExchange(exchangeId) {
  const id = String(exchangeId || '').trim().toLowerCase()
  if (id.includes('sim-us')) return 'US'
  return 'CN-A'
}

export function getMarketSpecForExchange(exchangeId) {
  const market = marketIdForExchange(exchangeId)
  if (market === 'US') {
    return {
      market: 'US',
      timezone: 'America/New_York',
      currency: 'USD',
      lot_size: 1,
      t_plus_one: false,
    }
  }

  return {
    market: 'CN-A',
    timezone: 'Asia/Shanghai',
    currency: 'CNY',
    lot_size: 100,
    t_plus_one: true,
  }
}

export function getMarketSessionStatusForExchange(exchangeId, nowMs = Date.now()) {
  const market = marketIdForExchange(exchangeId)
  if (market === 'US') return getUsMarketSessionStatus(nowMs)
  return getCnAMarketSessionStatus(nowMs)
}

export function isUsTicker(symbol) {
  const s = String(symbol || '').trim().toUpperCase()
  return /^[A-Z]{1,6}$/.test(s)
}

export function isCnStockSymbol(symbol) {
  const s = String(symbol || '').trim().toUpperCase()
  return /^\d{6}\.(SH|SZ)$/.test(s)
}
