import { useEffect, useState } from 'react'
import { Pause, Play, RotateCcw, StepForward, X } from 'lucide-react'
import type {
  AgentRuntimeControlAction,
  AgentRuntimeStatus,
  ReplayRuntimeStatus,
} from '../types'
import type { Language } from '../i18n/translations'

interface SystemRuntimeModalProps {
  open: boolean
  onClose: () => void
  language: Language
  runtimeStatus?: AgentRuntimeStatus
  replayRuntimeStatus?: ReplayRuntimeStatus
  onRuntimeControl: (action: AgentRuntimeControlAction, value?: number) => Promise<void>
  onFactoryReset: (useWarmup?: boolean) => Promise<void>
  onKillSwitch: (action: 'activate' | 'deactivate', reason?: string) => Promise<void>
}

export default function SystemRuntimeModal({
  open,
  onClose,
  language,
  runtimeStatus,
  replayRuntimeStatus,
  onRuntimeControl,
  onFactoryReset,
  onKillSwitch,
}: SystemRuntimeModalProps) {
  const [cadenceInput, setCadenceInput] = useState('10')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (runtimeStatus?.decision_every_bars) {
      setCadenceInput(String(runtimeStatus.decision_every_bars))
    }
  }, [runtimeStatus?.decision_every_bars])

  if (!open) return null

  const run = async (fn: () => Promise<void>, successText: string) => {
    setPending(true)
    setMessage('')
    try {
      await fn()
      setMessage(successText)
    } catch (error) {
      const fallback = language === 'zh' ? '操作失败，请重试。' : 'Operation failed. Please retry.'
      const msg = error instanceof Error && error.message ? error.message : fallback
      setMessage(msg)
    } finally {
      setPending(false)
    }
  }

  const applyCadence = () => {
    const bars = Number(cadenceInput)
    if (!Number.isFinite(bars) || bars <= 0) {
      setMessage(language === 'zh' ? '请输入有效的决策间隔。' : 'Please enter a valid cadence value.')
      return
    }
    void run(
      async () => onRuntimeControl('set_decision_every_bars', bars),
      language === 'zh' ? `决策节奏已更新为每 ${bars} 根K线` : `Cadence updated to every ${bars} bars`
    )
  }

  const isKillActive = !!runtimeStatus?.kill_switch?.active

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
      <button type="button" aria-label="overlay" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-[min(980px,96vw)] max-h-[90vh] overflow-y-auto nofx-glass p-4 border border-white/15 rounded-lg">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-sm font-semibold text-nofx-text-main">
              {language === 'zh' ? '系统运行控制台' : 'System Runtime Console'}
            </div>
            <div className="text-[11px] text-nofx-text-muted mt-1">
              {language === 'zh'
                ? '全局控制：影响全部 Agent，而非当前房间单个交易员。'
                : 'Global controls affect all agents, not just one room trader.'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded border border-white/15 text-nofx-text-main hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 mb-3">
          <input
            value={cadenceInput}
            onChange={(e) => setCadenceInput(e.target.value)}
            placeholder={language === 'zh' ? '每次决策间隔 K 线数' : 'bars per decision'}
            className="px-3 py-2 rounded bg-black/40 border border-white/10 text-sm text-nofx-text-main focus:outline-none focus:border-nofx-gold/50"
            disabled={pending}
          />
          <button
            onClick={applyCadence}
            disabled={pending}
            className="px-3 py-2 rounded text-sm font-semibold border border-white/15 text-nofx-text-main hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            {language === 'zh' ? '更新节奏' : 'Apply Cadence'}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <button
            onClick={() => void run(async () => onRuntimeControl('pause'), language === 'zh' ? '已暂停' : 'Paused')}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-semibold border border-white/15 text-nofx-text-main hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <Pause className="w-3.5 h-3.5" /> {language === 'zh' ? '暂停' : 'Pause'}
          </button>
          <button
            onClick={() => void run(async () => onRuntimeControl('resume'), language === 'zh' ? '已恢复' : 'Resumed')}
            disabled={pending || isKillActive}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-semibold bg-nofx-green/20 border border-nofx-green/30 text-nofx-green hover:bg-nofx-green/30 transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" /> {language === 'zh' ? '恢复' : 'Resume'}
          </button>
          <button
            onClick={() => void run(async () => onRuntimeControl('step'), language === 'zh' ? '已单步执行' : 'Stepped once')}
            disabled={pending || isKillActive}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-semibold bg-nofx-gold/15 border border-nofx-gold/35 text-nofx-gold hover:bg-nofx-gold/25 transition-colors disabled:opacity-50"
          >
            <StepForward className="w-3.5 h-3.5" /> {language === 'zh' ? '单步' : 'Step'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
          <button
            onClick={() => void run(async () => onFactoryReset(false), language === 'zh' ? '已重置到首根K线' : 'Reset to first bar')}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-semibold border border-red-500/35 text-red-300 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" /> {language === 'zh' ? '重置（首根K线）' : 'Reset (First Bar)'}
          </button>
          <button
            onClick={() => void run(async () => onFactoryReset(true), language === 'zh' ? '已重置到warmup' : 'Reset to warmup')}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-semibold border border-red-500/30 text-red-200 bg-red-500/5 hover:bg-red-500/15 transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" /> {language === 'zh' ? '重置（Warmup）' : 'Reset (Warmup)'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
          <button
            onClick={() => void run(async () => onKillSwitch('activate', 'manual_emergency_stop_from_system_popup'), language === 'zh' ? 'Kill Switch 已激活' : 'Kill switch activated')}
            disabled={pending || isKillActive}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-semibold border border-red-500/50 text-red-200 bg-red-500/15 hover:bg-red-500/25 transition-colors disabled:opacity-50"
          >
            {language === 'zh' ? '紧急停止全部 Agent' : 'Emergency Stop All Agents'}
          </button>
          <button
            onClick={() => void run(async () => onKillSwitch('deactivate', 'manual_reactivate_from_system_popup'), language === 'zh' ? 'Kill Switch 已解除' : 'Kill switch deactivated')}
            disabled={pending || !isKillActive}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-semibold border border-emerald-500/40 text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
          >
            {language === 'zh' ? '解除紧急停止' : 'Deactivate Kill Switch'}
          </button>
        </div>

        <div className="text-[11px] text-nofx-text-muted space-y-1">
          <div>
            {language === 'zh' ? '运行状态' : 'Runtime'}: <span className="text-nofx-text-main ml-1">{runtimeStatus?.running ? 'Running' : 'Paused'}</span>
            <span className="mx-2">|</span>
            {language === 'zh' ? '循环间隔' : 'Cycle'}: <span className="text-nofx-text-main ml-1">{runtimeStatus?.cycle_ms ?? '--'} ms</span>
          </div>
          <div>
            {language === 'zh' ? '决策节奏' : 'Cadence'}: <span className="text-nofx-text-main ml-1">{runtimeStatus?.decision_every_bars ?? '--'} bars</span>
            <span className="mx-2">|</span>
            LLM: <span className="text-nofx-text-main ml-1">{runtimeStatus?.llm?.enabled ? (runtimeStatus?.llm?.model || 'enabled') : 'disabled'}</span>
          </div>
          <div>
            Kill Switch: <span className={`ml-1 ${isKillActive ? 'text-red-300' : 'text-nofx-green'}`}>{isKillActive ? 'ACTIVE' : 'inactive'}</span>
          </div>
          <div>
            {language === 'zh' ? '回放交易日' : 'Replay day'}: <span className="text-nofx-text-main ml-1">{replayRuntimeStatus?.trading_day ?? '--'}</span>
            <span className="mx-2">|</span>
            {language === 'zh' ? '第' : 'Day'} <span className="text-nofx-text-main ml-1">{replayRuntimeStatus?.day_index ?? '--'}</span>/{replayRuntimeStatus?.day_count ?? '--'}
          </div>
          {message && <div className="text-nofx-text-main">{message}</div>}
        </div>
      </div>
    </div>
  )
}
