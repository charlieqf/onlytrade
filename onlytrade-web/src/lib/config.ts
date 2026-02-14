export interface SystemConfig {
  beta_mode: boolean
  registration_enabled?: boolean
}

export function isRegistrationEnabled(config?: SystemConfig | null): boolean {
  return config?.registration_enabled !== false
}

let configPromise: Promise<SystemConfig> | null = null
let cachedConfig: SystemConfig | null = null

export function getSystemConfig(): Promise<SystemConfig> {
  if (cachedConfig) {
    return Promise.resolve(cachedConfig)
  }
  if (configPromise) {
    return configPromise
  }
  configPromise = fetch('/api/config')
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`config http ${res.status}`)
      }
      return (await res.json()) as SystemConfig
    })
    .catch(() => {
      // Dev-friendly fallback: allow UI to boot without a backend.
      return {
        beta_mode: true,
        registration_enabled: false,
      } satisfies SystemConfig
    })
    .then((data) => {
      cachedConfig = data
      return data
    })
    .finally(() => {
      // Keep cachedConfig for reuse; allow re-fetch via explicit invalidation if added later
    })
  return configPromise
}
