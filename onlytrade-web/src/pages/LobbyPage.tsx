import { useMemo } from 'react'
import useSWR from 'swr'
import { Trophy, ArrowRight, Sparkles } from 'lucide-react'
import { api } from '../lib/api'
import type { CompetitionData, CompetitionTraderData } from '../types'
import { DeepVoidBackground } from '../components/DeepVoidBackground'
import { TraderAvatar } from '../components/TraderAvatar'
import { useLanguage } from '../contexts/LanguageContext'
import { coerceFiniteNumber, formatSignedPercentDisplay } from '../utils/format'

function getTraderSlug(trader: CompetitionTraderData) {
  const idPrefix = trader.trader_id.slice(0, 4)
  return `${trader.trader_name}-${idPrefix}`
}

export function LobbyPage() {
  const { language } = useLanguage()

  const navigate = (path: string) => {
    window.history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const { data: competition } = useSWR<CompetitionData>(
    'competition',
    api.getCompetition,
    {
      refreshInterval: 15000,
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    }
  )

  const topTraders = useMemo(() => {
    const traders = competition?.traders ?? []
    return [...traders]
      .sort((a, b) => (b.total_pnl_pct ?? 0) - (a.total_pnl_pct ?? 0))
      .slice(0, 9)
  }, [competition])

  return (
    <DeepVoidBackground className="py-10" disableAnimation>
      <div
        className="w-full px-4 md:px-8 space-y-8 animate-fade-in"
        data-testid="page-lobby"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8">
            <div className="bg-black/40 border border-white/10 rounded-2xl p-7 backdrop-blur-md hover:border-white/20 transition-colors">
              <div className="flex items-start justify-between gap-6">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border border-nofx-gold/25 bg-nofx-gold/10 text-nofx-gold">
                    <Sparkles className="w-3.5 h-3.5" />
                    {language === 'zh'
                      ? '虚拟交易 · A股'
                      : 'Virtual Trading · A-Shares'}
                  </div>
                  <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
                    {language === 'zh'
                      ? 'OpenTrade 房间大厅'
                      : 'OpenTrade Lobby'}
                  </h1>
                  <p className="text-sm md:text-base text-zinc-300 leading-relaxed max-w-2xl">
                    {language === 'zh'
                      ? '观看 AI 交易员基于真实行情进行虚拟交易，并实时解释决策。无下注、无分红、无收益承诺。'
                      : 'Watch AI traders run virtual portfolios on real market data and narrate decisions live. No betting, no payouts, no profit promises.'}
                  </p>
                </div>
                <div className="hidden md:block text-right">
                  <div className="text-xs text-zinc-400">
                    {language === 'zh'
                      ? '数据每 15 秒刷新'
                      : 'Refresh every 15s'}
                  </div>
                  <div className="text-sm font-semibold text-zinc-200">
                    {language === 'zh' ? 'HS300' : 'HS300'}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  data-testid="lobby-enter-room"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm bg-nofx-gold text-black hover:opacity-90 transition-opacity"
                  onClick={() => {
                    if (topTraders[0]) {
                      navigate(
                        `/room?trader=${encodeURIComponent(getTraderSlug(topTraders[0]))}`
                      )
                    } else {
                      navigate('/room')
                    }
                  }}
                >
                  {language === 'zh' ? '进入房间' : 'Enter Room'}
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm border border-nofx-gold/25 bg-black/30 text-zinc-100 hover:bg-black/40 transition-colors"
                  data-testid="lobby-go-leaderboard"
                  onClick={() => navigate('/leaderboard')}
                >
                  <Trophy className="w-4 h-4 text-nofx-gold" />
                  {language === 'zh' ? '排行榜' : 'Leaderboard'}
                </button>

                <div className="text-xs text-zinc-400">
                  {language === 'zh'
                    ? '实时模式：页面使用实时行情与实盘运行状态。'
                    : 'Live mode: pages use realtime market data and runtime state.'}
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4">
            <div className="bg-black/40 border border-white/10 rounded-2xl p-7 backdrop-blur-md">
              <div className="text-xs text-zinc-400">
                {language === 'zh' ? '免责声明' : 'Disclaimer'}
              </div>
              <div className="mt-2 text-sm text-zinc-200 leading-relaxed">
                {language === 'zh'
                  ? '本产品仅用于学习与娱乐。AI 可能出错。不要将内容视为投资建议。'
                  : 'For learning and entertainment only. AI can be wrong. Not investment advice.'}
              </div>
              <div className="mt-4 text-xs text-zinc-500">
                {language === 'zh'
                  ? '虚拟交易：无真实资金流转。'
                  : 'Virtual trading: no real funds involved.'}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-black/40 border border-white/10 rounded-2xl p-7 backdrop-blur-md">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <div className="text-lg font-bold text-white">
                {language === 'zh' ? '热门房间' : 'Popular Rooms'}
              </div>
              <div className="text-xs text-zinc-400">
                {language === 'zh'
                  ? '点击进入单个交易员房间（当前数据来自 leaderboard 接口）。'
                  : 'Click to enter a trader room (data currently sourced from leaderboard endpoint).'}
              </div>
            </div>
            <div className="text-xs px-2 py-1 rounded bg-nofx-gold/10 text-nofx-gold border border-nofx-gold/20">
              {competition?.count ?? 0}
              {language === 'zh' ? ' 个交易员' : ' traders'}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {topTraders.map((trader, idx) => {
              const pct = coerceFiniteNumber(trader.total_pnl_pct, 0)
              const positive = pct >= 0
              const isRunning = !!trader.is_running
              return (
                <button
                  key={trader.trader_id}
                  onClick={() => {
                    const slug = getTraderSlug(trader)
                    navigate(`/room?trader=${encodeURIComponent(slug)}`)
                  }}
                  className="text-left bg-black/30 border border-white/10 rounded-xl p-4 hover:border-white/20 hover:bg-black/35 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <TraderAvatar
                        traderId={trader.trader_id}
                        traderName={trader.trader_name}
                        avatarUrl={trader.avatar_url}
                        avatarHdUrl={trader.avatar_hd_url}
                        size={40}
                        className="rounded-lg"
                      />
                      <div>
                        <div className="text-sm font-bold text-white line-clamp-1">
                          {trader.trader_name}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="text-xs text-zinc-400">
                            #{idx + 1}
                          </div>
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-full border"
                            style={{
                              color: isRunning ? '#0ECB81' : '#A1A1AA',
                              borderColor: isRunning
                                ? 'rgba(14,203,129,0.35)'
                                : 'rgba(161,161,170,0.35)',
                              backgroundColor: isRunning
                                ? 'rgba(14,203,129,0.12)'
                                : 'rgba(161,161,170,0.10)',
                            }}
                          >
                            {isRunning
                              ? language === 'zh'
                                ? '运行中'
                                : 'Running'
                              : language === 'zh'
                                ? '已停止'
                                : 'Stopped'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div
                      className="text-sm font-bold"
                      style={{ color: positive ? '#0ECB81' : '#F6465D' }}
                    >
                      {formatSignedPercentDisplay(pct, 2, '+0.00%')}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {!competition && (
            <div className="mt-6 text-sm text-zinc-400">
              {language === 'zh'
                ? '正在加载房间列表…（如果你还没跑后端，会看到空数据/报错 toast）'
                : 'Loading rooms… (if backend is not running you may see empty data/toast errors)'}
            </div>
          )}
        </div>
      </div>
    </DeepVoidBackground>
  )
}
