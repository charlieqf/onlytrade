import { Trophy, Info } from 'lucide-react'
import useSWR from 'swr'
import { api } from '../lib/api'
import type { CompetitionData } from '../types'
import { ComparisonChart } from './ComparisonChart'
import { getTraderColor } from '../utils/traderColors'
import { useLanguage } from '../contexts/LanguageContext'
import { t } from '../i18n/translations'
import { TraderAvatar } from './TraderAvatar'
import { DeepVoidBackground } from './DeepVoidBackground'

export function CompetitionPage() {
  const { language } = useLanguage()

  const { data: competition } = useSWR<CompetitionData>(
    'competition',
    api.getCompetition,
    {
      refreshInterval: 15000, // 15秒刷新（竞赛数据不需要太频繁更新）
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    }
  )

  if (!competition) {
    return (
      <DeepVoidBackground className="py-8" disableAnimation>
        <div className="container mx-auto max-w-7xl px-4 md:px-8">
          <div className="space-y-6">
            <div className="animate-pulse bg-black/40 border border-white/10 rounded-xl p-8 backdrop-blur-md">
              <div className="flex items-center justify-between mb-6">
                <div className="space-y-3 flex-1">
                  <div className="h-8 w-64 bg-white/5 rounded"></div>
                  <div className="h-4 w-48 bg-white/5 rounded"></div>
                </div>
                <div className="h-12 w-32 bg-white/5 rounded"></div>
              </div>
            </div>
            <div className="bg-black/40 border border-white/10 rounded-xl p-6 backdrop-blur-md">
              <div className="h-6 w-40 mb-4 bg-white/5 rounded"></div>
              <div className="space-y-3">
                <div className="h-20 w-full bg-white/5 rounded"></div>
                <div className="h-20 w-full bg-white/5 rounded"></div>
              </div>
            </div>
          </div>
        </div>
      </DeepVoidBackground>
    )
  }

  // 如果有数据返回但没有交易员，显示空状态
  if (!competition.traders || competition.traders.length === 0) {
    return (
      <DeepVoidBackground className="py-8" disableAnimation>
        <div className="container mx-auto max-w-7xl px-4 md:px-8 space-y-8 animate-fade-in">
          {/* Competition Header - 精简版 */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-0">
            <div className="flex items-center gap-3 md:gap-4">
              <div
                className="w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center bg-black/60 border border-nofx-gold/30 shadow-[0_0_15px_rgba(240,185,11,0.2)]"
              >
                <Trophy
                  className="w-6 h-6 md:w-7 md:h-7 text-nofx-gold"
                />
              </div>
              <div>
                <h1
                  className="text-xl md:text-2xl font-bold flex items-center gap-2 text-white"
                >
                  {language === 'zh' ? '房间排行榜' : 'Room Leaderboard'}
                  <span
                    className="text-xs font-normal px-2 py-1 rounded bg-nofx-gold/10 text-nofx-gold border border-nofx-gold/20"
                  >
                    0 {language === 'zh' ? '个交易员' : 'traders'}
                  </span>
                </h1>
                <p className="text-xs text-zinc-400">
                  {language === 'zh' ? '实时交易表现对比' : 'Realtime trading performance comparison'}
                </p>
              </div>
            </div>
          </div>

          {/* Empty State */}
          <div className="bg-black/40 border border-white/10 rounded-xl p-16 text-center backdrop-blur-md">
            <Trophy
              className="w-16 h-16 mx-auto mb-4 text-zinc-700"
            />
            <h3 className="text-lg font-bold mb-2 text-white">
              {t('noTraders', language)}
            </h3>
            <p className="text-sm text-zinc-400">
              {t('createFirstTrader', language)}
            </p>
          </div>
        </div>
      </DeepVoidBackground>
    )
  }

  // 按收益率排序
  const sortedTraders = [...competition.traders].sort(
    (a, b) => b.total_pnl_pct - a.total_pnl_pct
  )

  // 找出领先者
  const leader = sortedTraders[0]
  const replayProgressPct = competition.replay?.day_bar_count
    ? Math.max(
      0,
      Math.min(
        100,
        Number((((competition.replay.day_bar_index || 0) / competition.replay.day_bar_count) * 100).toFixed(1))
      )
    )
    : null

  return (
    <DeepVoidBackground className="py-8" disableAnimation>
      <div className="w-full px-4 md:px-8 space-y-8 animate-fade-in">
        {/* Competition Header - 精简版 */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-0">
          <div className="flex items-center gap-3 md:gap-4">
            <div
              className="w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center bg-black/60 border border-nofx-gold/30 shadow-[0_0_15px_rgba(240,185,11,0.2)]"
            >
              <Trophy
                className="w-6 h-6 md:w-7 md:h-7 text-nofx-gold"
              />
            </div>
            <div>
              <h1
                className="text-xl md:text-2xl font-bold flex items-center gap-2 text-white"
              >
                {language === 'zh' ? '房间排行榜' : 'Room Leaderboard'}
                <span
                  className="text-xs font-normal px-2 py-1 rounded bg-nofx-gold/10 text-nofx-gold border border-nofx-gold/20"
                >
                  {competition.count} {language === 'zh' ? '个交易员' : 'traders'}
                </span>
              </h1>
              <p className="text-xs text-zinc-400">
                {language === 'zh' ? '按虚拟收益率排序，实时刷新。' : 'Sorted by virtual returns, refreshed live.'}
              </p>
            </div>
          </div>
            <div className="text-left md:text-right w-full md:w-auto">
              <div className="text-xs mb-1 text-zinc-400">
                {language === 'zh' ? '当前领先' : 'Current Leader'}
              </div>
            <div
              className="text-base md:text-lg font-bold text-nofx-gold"
            >
              {leader?.trader_name}
            </div>
            <div
              className="text-sm font-semibold"
              style={{
                color: (leader?.total_pnl ?? 0) >= 0 ? '#0ECB81' : '#F6465D',
              }}
            >
              {(leader?.total_pnl ?? 0) >= 0 ? '+' : ''}
              {leader?.total_pnl_pct?.toFixed(2) || '0.00'}%
            </div>
            <div className="text-[11px] text-zinc-400 mt-2 space-y-0.5">
              <div>
                {language === 'zh' ? '回放交易日' : 'Replay Day'}:
                <span className="text-zinc-200 ml-1">{competition.replay?.trading_day || '--'}</span>
              </div>
              <div>
                {language === 'zh' ? '日序' : 'Day'}:
                <span className="text-zinc-200 ml-1">{competition.replay?.day_index ?? '--'}</span>
                <span className="ml-1">/ {competition.replay?.day_count ?? '--'}</span>
              </div>
              <div>
                {language === 'zh' ? '日内进度' : 'In-day'}:
                <span className="text-zinc-200 ml-1">{competition.replay?.day_bar_index ?? '--'} / {competition.replay?.day_bar_count ?? '--'}</span>
                <span className="ml-1">({replayProgressPct != null ? `${replayProgressPct}%` : '--'})</span>
              </div>
            </div>
          </div>
        </div>

        {/* Left/Right Split: Performance Chart + Leaderboard */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Performance Comparison Chart */}
          <div
            className="bg-black/40 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-slide-in hover:border-white/20 transition-colors"
            style={{ animationDelay: '0.1s' }}
          >
            <div className="flex items-center justify-between mb-6">
              <h2
                className="text-lg font-bold flex items-center gap-2 text-white"
              >
                {language === 'zh' ? '收益曲线对比' : 'Performance Curves'}
              </h2>
              <div className="text-xs text-zinc-400">
                {language === 'zh' ? '动态刷新' : 'Dynamic refresh'}
              </div>
            </div>
            <ComparisonChart traders={sortedTraders.slice(0, 10)} />
          </div>

          {/* Right: Leaderboard */}
          <div
            className="bg-black/40 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-slide-in hover:border-white/20 transition-colors"
            style={{ animationDelay: '0.1s' }}
          >
            <div className="flex items-center justify-between mb-6">
              <h2
                className="text-lg font-bold flex items-center gap-2 text-white"
              >
                {language === 'zh' ? '排行明细' : 'Leaderboard Details'}
              </h2>
              <div
                className="text-xs px-2 py-1 rounded bg-nofx-gold/10 text-nofx-gold border border-nofx-gold/20 shadow-[0_0_8px_rgba(240,185,11,0.1)]"
              >
                {language === 'zh' ? 'Demo Live' : 'Demo Live'}
              </div>
            </div>
            <div className="space-y-2">
              {sortedTraders.map((trader, index) => {
                const isLeader = index === 0
                const traderColor = getTraderColor(
                  sortedTraders,
                  trader.trader_id
                )

                return (
                  <div
                    key={trader.trader_id}
                    className="rounded p-3 transition-all duration-300 hover:translate-y-[-1px] hover:shadow-lg"
                    style={{
                      background: isLeader
                        ? 'linear-gradient(135deg, rgba(240, 185, 11, 0.08) 0%, #0B0E11 100%)'
                        : '#0B0E11',
                      border: `1px solid ${isLeader ? 'rgba(240, 185, 11, 0.4)' : '#2B3139'}`,
                      boxShadow: isLeader
                        ? '0 3px 15px rgba(240, 185, 11, 0.12), 0 0 0 1px rgba(240, 185, 11, 0.15)'
                        : '0 1px 4px rgba(0, 0, 0, 0.3)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      {/* Rank & Avatar & Name */}
                      <div className="flex items-center gap-3">
                        {/* Rank Badge */}
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                          style={{
                            background: index === 0
                              ? 'linear-gradient(135deg, #F0B90B 0%, #FCD535 100%)'
                              : index === 1
                                ? 'linear-gradient(135deg, #C0C0C0 0%, #E8E8E8 100%)'
                                : index === 2
                                  ? 'linear-gradient(135deg, #CD7F32 0%, #E8A64C 100%)'
                                  : '#2B3139',
                            color: index < 3 ? '#000' : '#848E9C',
                          }}
                        >
                          {index + 1}
                        </div>
                        {/* Trader Avatar */}
                        <TraderAvatar
                          traderId={trader.trader_id}
                          traderName={trader.trader_name}
                          avatarUrl={trader.avatar_url}
                          avatarHdUrl={trader.avatar_hd_url}
                          size={36}
                          className="rounded-lg"
                        />
                        <div>
                          <div
                            className="font-bold text-sm"
                            style={{ color: '#EAECEF' }}
                          >
                            {trader.trader_name}
                          </div>
                          <div
                            className="text-xs mono font-semibold"
                            style={{ color: traderColor }}
                          >
                            {trader.ai_model.toUpperCase()} · CN-SIM
                          </div>
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="flex items-center gap-2 md:gap-3 flex-wrap md:flex-nowrap">
                        {/* Total Equity */}
                        <div className="text-right">
                          <div className="text-xs" style={{ color: '#848E9C' }}>
                            {t('equity', language)}
                          </div>
                          <div
                            className="text-xs md:text-sm font-bold mono"
                            style={{ color: '#EAECEF' }}
                          >
                            {trader.total_equity?.toFixed(2) || '0.00'}
                          </div>
                        </div>

                        {/* P&L */}
                        <div className="text-right min-w-[70px] md:min-w-[90px]">
                          <div className="text-xs" style={{ color: '#848E9C' }}>
                            {t('pnl', language)}
                          </div>
                          <div
                            className="text-base md:text-lg font-bold mono"
                            style={{
                              color:
                                (trader.total_pnl ?? 0) >= 0
                                  ? '#0ECB81'
                                  : '#F6465D',
                            }}
                          >
                            {(trader.total_pnl ?? 0) >= 0 ? '+' : ''}
                            {trader.total_pnl_pct?.toFixed(2) || '0.00'}%
                          </div>
                          <div
                            className="text-xs mono"
                            style={{ color: '#848E9C' }}
                          >
                            {(trader.total_pnl ?? 0) >= 0 ? '+' : ''}
                            {trader.total_pnl?.toFixed(2) || '0.00'}
                          </div>
                        </div>

                        {/* Positions */}
                        <div className="text-right">
                          <div className="text-xs" style={{ color: '#848E9C' }}>
                            {t('pos', language)}
                          </div>
                          <div
                            className="text-xs md:text-sm font-bold mono"
                            style={{ color: '#EAECEF' }}
                          >
                            {trader.position_count}
                          </div>
                          <div className="text-xs" style={{ color: '#848E9C' }}>
                            {language === 'zh' ? `占用 ${trader.margin_used_pct.toFixed(1)}%` : `Use ${trader.margin_used_pct.toFixed(1)}%`}
                          </div>
                        </div>

                        {/* Status */}
                        <div>
                          <div
                            className="px-2 py-1 rounded text-xs font-bold"
                            style={
                              trader.is_running
                                ? {
                                  background: 'rgba(14, 203, 129, 0.1)',
                                  color: '#0ECB81',
                                }
                                : {
                                  background: 'rgba(246, 70, 93, 0.1)',
                                  color: '#F6465D',
                                }
                            }
                          >
                            {trader.is_running ? '●' : '○'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="bg-black/40 border border-nofx-gold/20 rounded-xl p-4 backdrop-blur-md">
          <div className="flex items-center gap-2 text-sm font-semibold text-nofx-gold mb-2">
            <Info className="w-4 h-4" />
            {language === 'zh' ? '模拟规则' : 'Simulation Rules'}
          </div>
          <ul className="text-xs text-zinc-300 space-y-1">
            <li>{language === 'zh' ? '收益与排名来自虚拟交易账户（非真实资金）。' : 'Returns and ranking come from virtual accounts (no real funds).'}</li>
            <li>{language === 'zh' ? '交易逻辑使用固定规则：下一根K线开盘成交 + 固定滑点。' : 'Trade logic uses fixed rules: next-bar-open fills + fixed slippage.'}</li>
            <li>{language === 'zh' ? 'A股约束：100股一手，T+1。' : 'A-share constraints: 100-share lots and T+1.'}</li>
          </ul>
        </div>

        {/* Head-to-Head Stats */}
        {competition.traders.length === 2 && (
          <div
            className="bg-black/40 border border-white/10 rounded-xl p-6 backdrop-blur-md animate-slide-in"
            style={{ animationDelay: '0.3s' }}
          >
            <h2
              className="text-lg font-bold mb-6 flex items-center gap-2 text-white"
            >
              {t('headToHead', language)}
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {sortedTraders.map((trader, index) => {
                const isWinning = index === 0
                const opponent = sortedTraders[1 - index]

                // Check if both values are valid numbers
                const hasValidData =
                  trader.total_pnl_pct != null &&
                  opponent.total_pnl_pct != null &&
                  !isNaN(trader.total_pnl_pct) &&
                  !isNaN(opponent.total_pnl_pct)

                const gap = hasValidData
                  ? trader.total_pnl_pct - opponent.total_pnl_pct
                  : NaN

                return (
                  <div
                    key={trader.trader_id}
                    className="p-4 rounded transition-all duration-300 hover:scale-[1.02]"
                    style={
                      isWinning
                        ? {
                          background:
                            'linear-gradient(135deg, rgba(14, 203, 129, 0.08) 0%, rgba(14, 203, 129, 0.02) 100%)',
                          border: '2px solid rgba(14, 203, 129, 0.3)',
                          boxShadow: '0 3px 15px rgba(14, 203, 129, 0.12)',
                        }
                        : {
                          background: '#0B0E11',
                          border: '1px solid #2B3139',
                          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)',
                        }
                    }
                  >
                    <div className="text-center">
                      {/* Avatar */}
                      <div className="flex justify-center mb-3">
                        <TraderAvatar
                          traderId={trader.trader_id}
                          traderName={trader.trader_name}
                          avatarUrl={trader.avatar_url}
                          avatarHdUrl={trader.avatar_hd_url}
                          size={56}
                          className="rounded-xl"
                        />
                      </div>
                      <div
                        className="text-sm md:text-base font-bold mb-2"
                        style={{
                          color: getTraderColor(sortedTraders, trader.trader_id),
                        }}
                      >
                        {trader.trader_name}
                      </div>
                      <div
                        className="text-lg md:text-2xl font-bold mono mb-1"
                        style={{
                          color:
                            (trader.total_pnl ?? 0) >= 0 ? '#0ECB81' : '#F6465D',
                        }}
                      >
                        {trader.total_pnl_pct != null &&
                          !isNaN(trader.total_pnl_pct)
                          ? `${trader.total_pnl_pct >= 0 ? '+' : ''}${trader.total_pnl_pct.toFixed(2)}%`
                          : '—'}
                      </div>
                      {hasValidData && isWinning && gap > 0 && (
                        <div
                          className="text-xs font-semibold"
                          style={{ color: '#0ECB81' }}
                        >
                          {t('leadingBy', language, { gap: gap.toFixed(2) })}
                        </div>
                      )}
                      {hasValidData && !isWinning && gap < 0 && (
                        <div
                          className="text-xs font-semibold"
                          style={{ color: '#F6465D' }}
                        >
                          {t('behindBy', language, {
                            gap: Math.abs(gap).toFixed(2),
                          })}
                        </div>
                      )}
                      {!hasValidData && (
                        <div
                          className="text-xs font-semibold"
                          style={{ color: '#848E9C' }}
                        >
                          —
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </DeepVoidBackground>
  )
}
