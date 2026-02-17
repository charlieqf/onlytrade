import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { RegisterPage } from './RegisterPage'
import { LanguageProvider } from '../contexts/LanguageContext'

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    register: vi.fn(async () => ({ success: false, message: 'not used' })),
    completeRegistration: vi.fn(async () => ({
      success: false,
      message: 'not used',
    })),
  }),
}))

vi.mock('react-password-checklist', () => ({
  default: () => <div data-testid="password-checklist" />,
}))

const getSystemConfigMock = vi.fn()

vi.mock('../lib/config', async () => {
  const actual = await vi.importActual<any>('../lib/config')
  return {
    ...actual,
    getSystemConfig: () => getSystemConfigMock(),
  }
})

describe('RegisterPage', () => {
  it('renders RegistrationDisabled when registration is disabled by config', async () => {
    getSystemConfigMock.mockResolvedValueOnce({
      beta_mode: false,
      registration_enabled: false,
    })

    render(
      <LanguageProvider>
        <RegisterPage />
      </LanguageProvider>
    )

    expect(
      await screen.findByTestId('page-registration-disabled')
    ).toBeInTheDocument()
  })

  it('renders registration form when registration is enabled', async () => {
    getSystemConfigMock.mockResolvedValueOnce({
      beta_mode: false,
      registration_enabled: true,
    })

    render(
      <LanguageProvider>
        <RegisterPage />
      </LanguageProvider>
    )

    expect(await screen.findByTestId('page-register')).toBeInTheDocument()
    expect(
      screen.queryByTestId('page-registration-disabled')
    ).not.toBeInTheDocument()
  })
})
