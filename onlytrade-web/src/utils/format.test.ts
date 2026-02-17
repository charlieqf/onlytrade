import { describe, it, expect } from 'vitest'

import {
  isFiniteNumber,
  coerceFiniteNumber,
  formatSignedPercentDisplay,
} from './format'

describe('format utils', () => {
  describe('isFiniteNumber', () => {
    it('returns true only for finite numbers', () => {
      expect(isFiniteNumber(0)).toBe(true)
      expect(isFiniteNumber(1.25)).toBe(true)
      expect(isFiniteNumber(-3)).toBe(true)

      expect(isFiniteNumber(Number.NaN)).toBe(false)
      expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false)
      expect(isFiniteNumber(Number.NEGATIVE_INFINITY)).toBe(false)
      expect(isFiniteNumber('1')).toBe(false)
      expect(isFiniteNumber(null)).toBe(false)
      expect(isFiniteNumber(undefined)).toBe(false)
    })
  })

  describe('coerceFiniteNumber', () => {
    it('returns fallback for non-finite values', () => {
      expect(coerceFiniteNumber(Number.NaN, 9)).toBe(9)
      expect(coerceFiniteNumber(Number.POSITIVE_INFINITY, 9)).toBe(9)
      expect(coerceFiniteNumber('3', 9)).toBe(9)
      expect(coerceFiniteNumber(null, 9)).toBe(9)
      expect(coerceFiniteNumber(undefined, 9)).toBe(9)
    })

    it('returns value for finite numbers', () => {
      expect(coerceFiniteNumber(3.5, 9)).toBe(3.5)
      expect(coerceFiniteNumber(0, 9)).toBe(0)
    })
  })

  describe('formatSignedPercentDisplay', () => {
    it('formats finite number with sign and percent', () => {
      expect(formatSignedPercentDisplay(0)).toBe('+0.00%')
      expect(formatSignedPercentDisplay(1.2)).toBe('+1.20%')
      expect(formatSignedPercentDisplay(-1.2)).toBe('-1.20%')
      expect(formatSignedPercentDisplay(1.234, 1)).toBe('+1.2%')
    })

    it('returns missing placeholder for invalid numbers', () => {
      expect(formatSignedPercentDisplay(undefined)).toBe('—')
      expect(formatSignedPercentDisplay(null)).toBe('—')
      expect(formatSignedPercentDisplay(Number.NaN)).toBe('—')
      expect(formatSignedPercentDisplay(Number.POSITIVE_INFINITY)).toBe('—')
      expect(formatSignedPercentDisplay(Number.NEGATIVE_INFINITY)).toBe('—')
      expect(formatSignedPercentDisplay(Number.NaN, 2, 'MISSING')).toBe(
        'MISSING'
      )
    })
  })
})
