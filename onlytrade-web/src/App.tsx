import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import useSWR from 'swr'
import { api } from './lib/api'
import { TraderDashboardPage } from './pages/TraderDashboardPage'
import { LobbyPage } from './pages/LobbyPage'
import { LoginPage } from './components/LoginPage'
import { RegisterPage } from './components/RegisterPage'
import { ResetPasswordPage } from './components/ResetPasswordPage'
import { CompetitionPage } from './components/CompetitionPage'
import { LoginRequiredOverlay } from './components/LoginRequiredOverlay'
import SystemRuntimeModal from './components/SystemRuntimeModal'
import HeaderBar from './components/HeaderBar'
import { LanguageProvider, useLanguage } from './contexts/LanguageContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ConfirmDialogProvider } from './components/ConfirmDialog'
import { t } from './i18n/translations'
import { useSystemConfig } from './hooks/useSystemConfig'
import { isStaticDemoMode } from './demo/staticDemo'

import { OFFICIAL_LINKS } from './constants/branding'
import type {
  TraderInfo,
  AgentRuntimeStatus,
  AgentRuntimeControlAction,
  ReplayRuntimeStatus,
  RoomStreamPacket,
} from './types'

type Page =
  | 'lobby'
  | 'room'
  | 'leaderboard'
  | 'login'
  | 'register'



function App() {
  const { language, setLanguage } = useLanguage()
  const { user, logout, isLoading } = useAuth()
  const { loading: configLoading } = useSystemConfig()
  const loginRequired = (import.meta.env.VITE_REQUIRE_LOGIN || 'false').toLowerCase() === 'true'
  const hasRuntimeAccess = !loginRequired || !!user
  const [route, setRoute] = useState(window.location.pathname)

  // Resolve page from current path.
  const getInitialPage = (): Page => {
    const path = window.location.pathname

    if (path === '/' || path === '' || path === '/lobby') return 'lobby'
    if (path === '/leaderboard' || path === '/competition') return 'leaderboard'
    if (path === '/room' || path === '/dashboard') return 'room'
    return 'lobby'
  }

  // Login required overlay state
  const [loginOverlayOpen, setLoginOverlayOpen] = useState(false)
  const [loginOverlayFeature, setLoginOverlayFeature] = useState('')

  const handleLoginRequired = (featureName: string) => {
    setLoginOverlayFeature(featureName)
    setLoginOverlayOpen(true)
  }

  // Unified page navigation handler
  const navigateToPage = (page: Page) => {
    const pathMap: Record<Page, string> = {
      'lobby': '/lobby',
      'room': '/room',
      'leaderboard': '/leaderboard',
      'login': '/login',
      'register': '/register',
    }
    const path = pathMap[page]
    if (path) {
      window.history.pushState({}, '', path)
      setRoute(path)
      setCurrentPage(page)
    }
  }

  const [currentPage, setCurrentPage] = useState<Page>(getInitialPage())
  // 从 URL 参数读取初始 trader 标识（格式: name-id前4位）
  const [selectedTraderSlug, setSelectedTraderSlug] = useState<string | undefined>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('trader') || undefined
  })
  const [selectedTraderId, setSelectedTraderId] = useState<string | undefined>()

  // 生成 trader URL slug（name + ID 前 4 位）
  const getTraderSlug = (trader: TraderInfo) => {
    const idPrefix = trader.trader_id.slice(0, 4)
    return `${trader.trader_name}-${idPrefix}`
  }

  // 从 slug 解析并匹配 trader
  const findTraderBySlug = (slug: string, traderList: TraderInfo[]) => {
    // slug 格式: name-xxxx (xxxx 是 ID 前 4 位)
    const lastDashIndex = slug.lastIndexOf('-')
    if (lastDashIndex === -1) {
      // 没有 dash，直接按 name 匹配
      return traderList.find(t => t.trader_name === slug)
    }
    const name = slug.slice(0, lastDashIndex)
    const idPrefix = slug.slice(lastDashIndex + 1)
    return traderList.find(t =>
      t.trader_name === name && t.trader_id.startsWith(idPrefix)
    )
  }
  const [lastUpdate, setLastUpdate] = useState<string>('--:--:--')
  const [decisionsLimit, setDecisionsLimit] = useState<number>(5)
  const runtimeControlsEnabled = !isStaticDemoMode()
  const [systemRuntimeModalOpen, setSystemRuntimeModalOpen] = useState(false)

  // Keep page state in sync with URL.
  useEffect(() => {
    const handleRouteChange = () => {
      const path = window.location.pathname
      const params = new URLSearchParams(window.location.search)
      const traderParam = params.get('trader')

      if (path === '/lobby' || path === '/') {
        setCurrentPage('lobby')
      } else if (path === '/leaderboard' || path === '/competition') {
        setCurrentPage('leaderboard')
      } else if (path === '/room' || path === '/dashboard') {
        setCurrentPage('room')
        if (traderParam) {
          setSelectedTraderSlug(traderParam)
        }
      }
      setRoute(path)
    }

    window.addEventListener('popstate', handleRouteChange)
    return () => {
      window.removeEventListener('popstate', handleRouteChange)
    }
  }, [])

  // Public trader list (virtual-only product: room list should be viewable without auth)
  const { data: traders, error: tradersError } = useSWR<TraderInfo[]>(
    'public-traders',
    api.getPublicTraders,
    {
      refreshInterval: 30000,
      shouldRetryOnError: false,
    }
  )

  // Keep selected trader in sync with URL slug and available list.
  useEffect(() => {
    if (!traders || traders.length === 0) return

    if (selectedTraderSlug) {
      const traderFromSlug = findTraderBySlug(selectedTraderSlug, traders)
      if (traderFromSlug) {
        if (selectedTraderId !== traderFromSlug.trader_id) {
          setSelectedTraderId(traderFromSlug.trader_id)
        }
        return
      }
    }

    const selectedStillExists = !!selectedTraderId && traders.some((t) => t.trader_id === selectedTraderId)
    if (!selectedStillExists) {
      setSelectedTraderId(traders[0].trader_id)
    }
  }, [traders, selectedTraderId, selectedTraderSlug])

  // Room atomic stream packet (status/account/positions/decisions/context)
  const { data: streamPacket, mutate: mutateStreamPacket } = useSWR<RoomStreamPacket>(
    currentPage === 'room' && selectedTraderId
      ? `room-stream-packet-${selectedTraderId}-${decisionsLimit}`
      : null,
    () => api.getRoomStreamPacket(selectedTraderId!, decisionsLimit),
    {
      refreshInterval: 5000,
      revalidateOnFocus: false,
      dedupingInterval: 1500,
    }
  )

  const status = streamPacket?.status
  const account = streamPacket?.account
  const positions = streamPacket?.positions
  const decisions = streamPacket?.decisions_latest

  const { data: runtimeStatus, mutate: mutateRuntimeStatus } = useSWR<AgentRuntimeStatus>(
    runtimeControlsEnabled && hasRuntimeAccess
      ? 'agent-runtime-status'
      : null,
    api.getAgentRuntimeStatus,
    {
      refreshInterval: 5000,
      revalidateOnFocus: false,
      dedupingInterval: 2000,
    }
  )

  const { data: replayRuntimeStatus, mutate: mutateReplayRuntimeStatus } = useSWR<ReplayRuntimeStatus>(
    runtimeControlsEnabled && hasRuntimeAccess
      ? 'replay-runtime-status'
      : null,
    api.getReplayRuntimeStatus,
    {
      refreshInterval: 5000,
      revalidateOnFocus: false,
      dedupingInterval: 2000,
    }
  )

  const handleRuntimeControl = useCallback(
    async (action: AgentRuntimeControlAction, value?: number) => {
      if (!runtimeControlsEnabled) return

      const tasks: Array<Promise<unknown>> = []

      if (action === 'step') {
        tasks.push(api.controlReplayRuntime('step'))
      } else {
        tasks.push(api.controlAgentRuntime(action, value))
        if (action === 'pause' || action === 'resume') {
          const replayAction = action === 'pause' ? 'pause' : 'resume'
          tasks.push(api.controlReplayRuntime(replayAction))
        }
      }

      await Promise.all(tasks)
      await Promise.all([
        mutateRuntimeStatus(),
        mutateReplayRuntimeStatus(),
        mutateStreamPacket(),
      ])
    },
    [runtimeControlsEnabled, mutateRuntimeStatus, mutateReplayRuntimeStatus, mutateStreamPacket]
  )

  const handleFactoryReset = useCallback(
    async (useWarmup = false) => {
      if (!runtimeControlsEnabled) return

      await api.factoryResetRuntime({ useWarmup })
      await Promise.all([
        mutateRuntimeStatus(),
        mutateReplayRuntimeStatus(),
        mutateStreamPacket(),
      ])
    },
    [
      runtimeControlsEnabled,
      mutateRuntimeStatus,
      mutateReplayRuntimeStatus,
      mutateStreamPacket,
    ]
  )

  const handleKillSwitch = useCallback(
    async (action: 'activate' | 'deactivate', reason?: string) => {
      if (!runtimeControlsEnabled) return

      await api.setAgentKillSwitch(action, reason)
      await Promise.all([
        mutateRuntimeStatus(),
        mutateReplayRuntimeStatus(),
        mutateStreamPacket(),
      ])
    },
    [
      runtimeControlsEnabled,
      mutateRuntimeStatus,
      mutateReplayRuntimeStatus,
      mutateStreamPacket,
    ]
  )

  useEffect(() => {
    if (account) {
      const now = new Date().toLocaleTimeString()
      setLastUpdate(now)
    }
  }, [account])

  const selectedTrader = traders?.find((t) => t.trader_id === selectedTraderId)

  // Set current page based on route for consistent navigation state.
  useEffect(() => {
    if (route === '/leaderboard' || route === '/competition') {
      setCurrentPage('leaderboard')
    } else if (route === '/lobby' || route === '/' || route === '') {
      setCurrentPage('lobby')
    } else if (route === '/room' || route === '/dashboard') {
      setCurrentPage('room')
    }
  }, [route])

  // Show loading spinner while checking auth or config
  if (isLoading || configLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: '#0B0E11' }}
      >
        <div className="text-center">
          <img
            src="/icons/onlytrade.svg"
            alt="OpenTrade Logo"
            className="w-16 h-16 mx-auto mb-4 animate-pulse"
          />
          <p style={{ color: '#EAECEF' }}>{t('loading', language)}</p>
        </div>
      </div>
    )
  }

  // Handle specific routes regardless of authentication
  if (route === '/login') {
    return <LoginPage />
  }
  if (route === '/register') {
    return <RegisterPage />
  }
  if (route === '/reset-password') {
    return <ResetPasswordPage />
  }
  return (
    <div
      className="min-h-screen"
      style={{ background: '#0B0E11', color: '#EAECEF' }}
    >
      <HeaderBar
        isLoggedIn={!!user}
        currentPage={currentPage}
        language={language}
        onLanguageChange={setLanguage}
        user={user}
        onLogout={logout}
        onLoginRequired={handleLoginRequired}
        onPageChange={navigateToPage}
      />

      {/* Main Content with Page Transitions */}
      <main className="min-h-screen pt-16">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPage}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {currentPage === 'lobby' ? (
              <LobbyPage />
            ) : currentPage === 'leaderboard' ? (
              <CompetitionPage />
            ) : currentPage === 'room' ? (
              selectedTrader ? (
                <TraderDashboardPage
                  selectedTrader={selectedTrader}
                  status={status}
                  account={account}
                  positions={positions}
                  decisions={decisions}
                  streamPacket={streamPacket}
                  decisionsLimit={decisionsLimit}
                  onDecisionsLimitChange={setDecisionsLimit}
                  lastUpdate={lastUpdate}
                  language={language}
                  traders={traders}
                  tradersError={tradersError}
                  selectedTraderId={selectedTraderId}
                  onTraderSelect={(traderId) => {
                    setSelectedTraderId(traderId)
                    const trader = traders?.find(t => t.trader_id === traderId)
                    if (trader) {
                      const traderSlug = getTraderSlug(trader)
                      setSelectedTraderSlug(traderSlug)
                      const url = new URL(window.location.href)
                      url.searchParams.set('trader', traderSlug)
                      window.history.replaceState({}, '', url.toString())
                    }
                  }}
                  onNavigateToLobby={() => {
                    window.history.pushState({}, '', '/lobby')
                    setRoute('/lobby')
                    setCurrentPage('lobby')
                  }}
                />
              ) : (
                <div className="px-6 py-10 text-sm text-zinc-300">
                  {language === 'zh'
                    ? '未选择交易员。请从大厅进入房间。'
                    : 'No trader selected. Enter a room from the lobby.'}
                </div>
              )
            ) : (
              <LobbyPage />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {runtimeControlsEnabled && hasRuntimeAccess && (
        <button
          onClick={() => setSystemRuntimeModalOpen(true)}
          className="fixed right-4 bottom-6 z-[110] px-4 py-2 rounded-lg border border-white/20 bg-black/70 text-sm font-semibold text-nofx-text-main hover:bg-black/85 transition-colors"
        >
          {language === 'zh' ? '系统控制台' : 'System Console'}
        </button>
      )}

      {runtimeControlsEnabled && hasRuntimeAccess && (
        <SystemRuntimeModal
          open={systemRuntimeModalOpen}
          onClose={() => setSystemRuntimeModalOpen(false)}
          language={language}
          runtimeStatus={runtimeStatus}
          replayRuntimeStatus={replayRuntimeStatus}
          onRuntimeControl={handleRuntimeControl}
          onFactoryReset={handleFactoryReset}
          onKillSwitch={handleKillSwitch}
        />
      )}

      <footer
        className="mt-16"
        style={{ borderTop: '1px solid #2B3139', background: '#181A20' }}
      >
          <div
            className="max-w-[1920px] mx-auto px-6 py-6 text-center text-sm"
            style={{ color: '#5E6673' }}
          >
            <p>{t('footerTitle', language)}</p>
            <p className="mt-1">{t('footerWarning', language)}</p>
            <div className="mt-4 flex items-center justify-center gap-3 flex-wrap">
              {/* GitHub */}
              <a
                href={OFFICIAL_LINKS.github}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-semibold transition-all hover:scale-105"
                style={{
                  background: '#1E2329',
                  color: '#848E9C',
                  border: '1px solid #2B3139',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#2B3139'
                  e.currentTarget.style.color = '#EAECEF'
                  e.currentTarget.style.borderColor = '#F0B90B'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#1E2329'
                  e.currentTarget.style.color = '#848E9C'
                  e.currentTarget.style.borderColor = '#2B3139'
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                Source
              </a>
            </div>
          </div>
      </footer>

      {/* Login Required Overlay */}
      <LoginRequiredOverlay
        isOpen={loginOverlayOpen}
        onClose={() => setLoginOverlayOpen(false)}
        featureName={loginOverlayFeature}
      />
    </div>
  )
}


// Wrap App with providers
export default function AppWithProviders() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <ConfirmDialogProvider>
          <App />
        </ConfirmDialogProvider>
      </AuthProvider>
    </LanguageProvider>
  )
}
