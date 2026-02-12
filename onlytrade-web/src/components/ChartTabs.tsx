import { useState, useEffect, useRef } from 'react'
import { EquityChart } from './EquityChart'
import { AdvancedChart } from './AdvancedChart'
import { useLanguage } from '../contexts/LanguageContext'
import { t } from '../i18n/translations'
import { BarChart3, CandlestickChart, ChevronDown, Search } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface ChartTabsProps {
  traderId: string
  selectedSymbol?: string
  updateKey?: number
  exchangeId?: string
}

type ChartTab = 'equity' | 'kline'
type Interval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d'

interface SymbolInfo {
  symbol: string
  name: string
  category: string
}

const INTERVALS: { value: Interval; label: string }[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '1d', label: '1d' },
]

export function ChartTabs({ traderId, selectedSymbol, updateKey, exchangeId }: ChartTabsProps) {
  const { language } = useLanguage()
  const [activeTab, setActiveTab] = useState<ChartTab>('equity')
  const [chartSymbol, setChartSymbol] = useState<string>('600519.SH')
  const [interval, setInterval] = useState<Interval>('1m')
  const [symbolInput, setSymbolInput] = useState('')
  const [availableSymbols, setAvailableSymbols] = useState<SymbolInfo[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searchFilter, setSearchFilter] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  const currentExchange = exchangeId || 'sim-cn'

  // Load room symbol universe (A-share focused).
  useEffect(() => {
    fetch('/api/symbols?exchange=sim-cn')
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data?.symbols) ? data.symbols : []
        if (list.length > 0) {
          const sorted = [...list].sort((a: SymbolInfo, b: SymbolInfo) => a.symbol.localeCompare(b.symbol))
          setAvailableSymbols(sorted)
          return
        }
        setAvailableSymbols([
          { symbol: '600519.SH', name: '贵州茅台', category: 'stock' },
          { symbol: '601318.SH', name: '中国平安', category: 'stock' },
          { symbol: '300750.SZ', name: '宁德时代', category: 'stock' },
        ])
      })
      .catch(() => {
        setAvailableSymbols([
          { symbol: '600519.SH', name: '贵州茅台', category: 'stock' },
          { symbol: '601318.SH', name: '中国平安', category: 'stock' },
          { symbol: '300750.SZ', name: '宁德时代', category: 'stock' },
        ])
      })
  }, [])

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 过滤后的币种列表
  const filteredSymbols = availableSymbols.filter(s =>
    s.symbol.toLowerCase().includes(searchFilter.toLowerCase()) ||
    s.name.toLowerCase().includes(searchFilter.toLowerCase())
  )

  const selectedSymbolInfo = availableSymbols.find((item) => item.symbol === chartSymbol)

  // 当从外部选择币种时，自动切换到K线图
  useEffect(() => {
    if (selectedSymbol) {
      setChartSymbol(selectedSymbol)
      setActiveTab('kline')
    }
  }, [selectedSymbol, updateKey])

  // 处理手动输入符号
  const handleSymbolSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (symbolInput.trim()) {
      const symbol = symbolInput.trim().toUpperCase()
      setChartSymbol(symbol)
      setSymbolInput('')
    }
  }

  return (
    <div className={`nofx-glass rounded-lg border border-white/5 relative z-10 w-full flex flex-col transition-all duration-300 ${typeof window !== 'undefined' && window.innerWidth < 768 ? 'h-[500px]' : 'h-[600px]'
      }`}>
      {/* 
        Premium Professional Toolbar 
        Mobile: Single row, horizontal scroll with gradient mask
        Desktop: Standard flex-wrap/nowrap
      */}
      <div
        className="relative z-20 flex flex-wrap md:flex-nowrap items-center justify-between gap-y-2 px-3 py-2 shrink-0 backdrop-blur-md bg-[#0B0E11]/80 rounded-t-lg"
        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}
      >
        {/* Left: Tab Switcher */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => setActiveTab('equity')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${activeTab === 'equity'
              ? 'bg-nofx-gold/10 text-nofx-gold border border-nofx-gold/20 shadow-[0_0_10px_rgba(240,185,11,0.1)]'
              : 'text-nofx-text-muted hover:text-nofx-text-main hover:bg-white/5'
              }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t('accountEquityCurve', language)}</span>
            <span className="md:hidden">Eq</span>
          </button>

          <button
            onClick={() => setActiveTab('kline')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${activeTab === 'kline'
              ? 'bg-nofx-gold/10 text-nofx-gold border border-nofx-gold/20 shadow-[0_0_10px_rgba(240,185,11,0.1)]'
              : 'text-nofx-text-muted hover:text-nofx-text-main hover:bg-white/5'
              }`}
          >
            <CandlestickChart className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t('marketChart', language)}</span>
            <span className="md:hidden">Kline</span>
          </button>

          {activeTab === 'kline' && (
            <div className="hidden md:flex items-center gap-2 ml-2 border-l border-white/10 pl-2">
              <span className="text-[10px] px-2 py-1 rounded border border-nofx-gold/25 bg-nofx-gold/10 text-nofx-gold font-semibold">
                {language === 'zh' ? 'A股' : 'A-Shares'}
              </span>
            </div>
          )}
        </div>

        {/* Right: Symbol + Interval */}
        {activeTab === 'kline' && (
          <div className="flex items-center gap-2 md:gap-3 w-full md:w-auto min-w-0">
            {/* Symbol Dropdown */}
            <div className="shrink-0 relative" ref={dropdownRef}>
              <>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-black/40 border border-white/10 rounded text-[11px] font-bold text-nofx-text-main hover:border-nofx-gold/30 hover:text-nofx-gold transition-all"
                >
                  <span>{chartSymbol}</span>
                  {selectedSymbolInfo?.name && (
                    <span className="text-[9px] opacity-55 hidden md:inline">{selectedSymbolInfo.name}</span>
                  )}
                  <ChevronDown className={`w-3 h-3 text-nofx-text-muted transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                </button>
                {showDropdown && (
                  <div className="absolute top-full right-0 mt-2 w-64 bg-[#0B0E11] border border-white/10 rounded-lg shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] z-50 overflow-hidden nofx-glass ring-1 ring-white/5">
                    <div className="p-2 border-b border-white/5">
                      <div className="flex items-center gap-2 px-2 py-1.5 bg-black/40 rounded border border-white/10 focus-within:border-nofx-gold/50 transition-colors">
                        <Search className="w-3.5 h-3.5 text-nofx-text-muted" />
                        <input
                          type="text"
                          value={searchFilter}
                          onChange={(e) => setSearchFilter(e.target.value)}
                          placeholder={language === 'zh' ? '搜索代码...' : 'Search symbol...'}
                          className="flex-1 bg-transparent text-[11px] text-white placeholder-gray-600 focus:outline-none font-mono"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="overflow-y-auto max-h-60 custom-scrollbar">
                      {filteredSymbols.map((s) => (
                        <button
                          key={s.symbol}
                          onClick={() => { setChartSymbol(s.symbol); setShowDropdown(false); setSearchFilter('') }}
                          className={`w-full px-3 py-2 text-left text-[11px] font-mono hover:bg-white/5 transition-all flex items-center justify-between ${chartSymbol === s.symbol ? 'bg-nofx-gold/10 text-nofx-gold' : 'text-nofx-text-muted'}`}
                        >
                          <span>{s.symbol}</span>
                          <span className="text-[10px] opacity-75">{s.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            </div>

            {/* Interval Selector - Allow scrolling if needed */}
            <div className="flex items-center bg-black/40 rounded border border-white/10 overflow-x-auto no-scrollbar max-w-[200px] md:max-w-none">
              {INTERVALS.map((int) => (
                <button
                  key={int.value}
                  onClick={() => setInterval(int.value)}
                  className={`px-2 py-1 text-[10px] font-medium transition-all ${interval === int.value
                    ? 'bg-nofx-gold/20 text-nofx-gold'
                    : 'text-nofx-text-muted hover:text-white hover:bg-white/5'
                    }`}
                >
                  {int.label}
                </button>
              ))}
            </div>

            {/* Quick Input - Hidden on mobile, dropdown search is enough */}
            <form onSubmit={handleSymbolSubmit} className="hidden md:flex items-center shrink-0">
              <input
                type="text"
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value)}
                placeholder="Sym"
                className="w-16 px-2 py-1 bg-black/40 border border-white/10 rounded-l text-[10px] text-white placeholder-gray-600 focus:outline-none focus:border-nofx-gold/50 font-mono transition-colors"
              />
              <button type="submit" className="px-2 py-1 bg-white/5 border border-white/10 border-l-0 rounded-r text-[10px] text-nofx-text-muted hover:text-white hover:bg-white/10 transition-all">
                Go
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Tab Content - Chart autosizes to this container */}
      <div className="relative flex-1 bg-[#0B0E11]/50 rounded-b-lg overflow-hidden h-full min-h-0">
        <AnimatePresence mode="wait">
          {activeTab === 'equity' ? (
            <motion.div
              key="equity"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="h-full w-full absolute inset-0"
            >
              <EquityChart traderId={traderId} embedded />
            </motion.div>
          ) : (
            <motion.div
              key={`kline-${chartSymbol}-${interval}-${currentExchange}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="h-full w-full absolute inset-0"
            >
              <AdvancedChart
                symbol={chartSymbol}
                interval={interval}
                traderID={traderId}
                // Dynamic auto-sizing via ResizeObserver
                exchange={currentExchange}
                onSymbolChange={setChartSymbol}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
