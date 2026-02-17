import { describe, it, expect } from 'vitest'
import { isRegistrationEnabled, type SystemConfig } from './config'

describe('registration_enabled toggle', () => {
  it('defaults to enabled when config is missing', () => {
    expect(isRegistrationEnabled(undefined)).toBe(true)
    expect(isRegistrationEnabled(null)).toBe(true)
  })

  it('treats undefined registration_enabled as enabled', () => {
    const cfg = { beta_mode: false } satisfies SystemConfig
    expect(isRegistrationEnabled(cfg)).toBe(true)
  })

  it('treats registration_enabled=true as enabled', () => {
    const cfg = {
      beta_mode: false,
      registration_enabled: true,
    } satisfies SystemConfig
    expect(isRegistrationEnabled(cfg)).toBe(true)
  })

  it('treats registration_enabled=false as disabled', () => {
    const cfg = {
      beta_mode: false,
      registration_enabled: false,
    } satisfies SystemConfig
    expect(isRegistrationEnabled(cfg)).toBe(false)
  })
})
