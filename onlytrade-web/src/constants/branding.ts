export const OFFICIAL_LINKS = {
  github: 'https://github.com/charlieqf/onlytrade',
  twitter: '',
  telegram: '',
} as const

export const BRAND_INFO = {
  name: 'OnlyTrade',
  tagline: 'Virtual A-Share AI trading rooms',
  version: '0.1.0',
  social: {
    gh: () => OFFICIAL_LINKS.github,
  },
} as const
