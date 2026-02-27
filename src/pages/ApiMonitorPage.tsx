/**
 * 功能模块：页面模块，负责 ApiMonitorPage 场景的页面布局与交互编排
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Gauge,
  RefreshCw,
  Save,
  Server,
  Timer,
  Waves
} from 'lucide-react'
import {
  getApiMonitorConfig,
  getApiMonitorBudget,
  updateApiMonitorConfig,
  getApiMonitorProviders,
  getApiMonitorUsage,
  updateApiMonitorBudget,
  type ApiMonitorProbeConfig,
  type ApiMonitorUsageSnapshot,
  type ApiProviderStatusItem
} from '../services/api'

type MonitorScope = 'module' | 'agent'
type BudgetKey = 'llm' | 'image' | 'storyboard' | 'video' | 'tts'

const BUDGET_KEYS: BudgetKey[] = ['llm', 'image', 'storyboard', 'video', 'tts']

const CATEGORY_LABELS: Record<string, string> = {
  llm: 'LLM',
  image: '图像',
  storyboard: '分镜',
  video: '视频',
  tts: '语音',
  agent: 'Agent',
  system: '系统'
}

const PROVIDER_STATUS_META: Record<string, { label: string; className: string }> = {
  ok: { label: '正常', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30' },
  reachable: { label: '可达', className: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/30' },
  configured: { label: '已配置', className: 'bg-sky-500/20 text-sky-300 border-sky-400/30' },
  local: { label: '本地', className: 'bg-indigo-500/20 text-indigo-300 border-indigo-400/30' },
  auth_error: { label: '鉴权失败', className: 'bg-amber-500/20 text-amber-300 border-amber-400/30' },
  network_error: { label: '网络异常', className: 'bg-orange-500/20 text-orange-300 border-orange-400/30' },
  not_configured: { label: '未配置', className: 'bg-slate-500/20 text-slate-300 border-slate-400/30' },
  error: { label: '错误', className: 'bg-rose-500/20 text-rose-300 border-rose-400/30' }
}

const WINDOW_OPTIONS = [
  { label: '15 分钟', value: 15 },
  { label: '1 小时', value: 60 },
  { label: '4 小时', value: 240 }
]

type VolcConfigDraft = {
  access_key: string
  secret_key: string
  region: string
  provider_code: string
  quota_code: string
}

function formatNum(v: number | null | undefined): string {
  if (typeof v !== 'number' || Number.isNaN(v)) return '--'
  return v.toLocaleString('zh-CN')
}

function formatMetricNumber(v: number | null | undefined): string {
  if (typeof v !== 'number' || Number.isNaN(v)) return '--'
  if (Number.isInteger(v)) return v.toLocaleString('zh-CN')
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 6 })
}

function formatTime(value?: string): string {
  if (!value) return '--'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '--'
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

function normalizeBudgetDraft(budgets: Record<string, number>): Record<string, string> {
  const next: Record<string, string> = {}
  for (const key of BUDGET_KEYS) {
    next[key] = String(Math.max(0, Number(budgets[key] || 0)))
  }
  return next
}

function normalizeVolcDraft(config?: ApiMonitorProbeConfig['volcengine']): VolcConfigDraft {
  return {
    access_key: '',
    secret_key: '',
    region: String(config?.region || 'cn-beijing'),
    provider_code: String(config?.provider_code || ''),
    quota_code: String(config?.quota_code || '')
  }
}

export default function ApiMonitorPage() {
  const [scope, setScope] = useState<MonitorScope>('module')
  const [windowMinutes, setWindowMinutes] = useState(60)
  const [usage, setUsage] = useState<ApiMonitorUsageSnapshot | null>(null)
  const [providers, setProviders] = useState<ApiProviderStatusItem[]>([])
  const [budgetDraft, setBudgetDraft] = useState<Record<string, string>>({})
  const [monitorConfig, setMonitorConfig] = useState<ApiMonitorProbeConfig | null>(null)
  const [volcDraft, setVolcDraft] = useState<VolcConfigDraft>(normalizeVolcDraft())
  const [loading, setLoading] = useState(true)
  const [providersLoading, setProvidersLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [savingBudget, setSavingBudget] = useState(false)
  const [savingVolcConfig, setSavingVolcConfig] = useState(false)
  const [error, setError] = useState<string>('')

  const loadBudgets = useCallback(async () => {
    const data = await getApiMonitorBudget()
    setBudgetDraft(normalizeBudgetDraft(data))
  }, [])

  const loadMonitorConfig = useCallback(async () => {
    const data = await getApiMonitorConfig()
    setMonitorConfig(data)
    setVolcDraft(normalizeVolcDraft(data?.volcengine))
  }, [])

  const loadUsage = useCallback(async () => {
    const data = await getApiMonitorUsage(windowMinutes)
    setUsage(data)
  }, [windowMinutes])

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true)
    try {
      const data = await getApiMonitorProviders(scope)
      setProviders(Array.isArray(data.providers) ? data.providers : [])
    } finally {
      setProvidersLoading(false)
    }
  }, [scope])

  const refreshAll = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      await Promise.all([loadUsage(), loadProviders(), loadBudgets(), loadMonitorConfig()])
    } catch (e) {
      setError((e as Error)?.message || '刷新失败')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [loadUsage, loadProviders, loadBudgets, loadMonitorConfig])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    const timer = setInterval(() => {
      void loadUsage()
    }, 5000)
    return () => clearInterval(timer)
  }, [loadUsage])

  useEffect(() => {
    const timer = setInterval(() => {
      void loadProviders()
    }, 30000)
    return () => clearInterval(timer)
  }, [loadProviders])

  useEffect(() => {
    void loadUsage()
  }, [loadUsage])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  const handleBudgetInput = (key: BudgetKey, value: string) => {
    const cleaned = value.replace(/[^\d]/g, '')
    setBudgetDraft((prev) => ({ ...prev, [key]: cleaned }))
  }

  const handleSaveBudget = async () => {
    setSavingBudget(true)
    try {
      const next: Record<string, number> = {}
      for (const key of BUDGET_KEYS) {
        const raw = budgetDraft[key]
        next[key] = raw ? Math.max(0, parseInt(raw, 10) || 0) : 0
      }
      const saved = await updateApiMonitorBudget(next)
      setBudgetDraft(normalizeBudgetDraft(saved))
      await loadUsage()
    } catch (e) {
      setError((e as Error)?.message || '保存预算失败')
    } finally {
      setSavingBudget(false)
    }
  }

  const handleVolcDraftInput = (key: keyof VolcConfigDraft, value: string) => {
    setVolcDraft((prev) => ({ ...prev, [key]: value }))
  }

  const handleSaveVolcConfig = async () => {
    setSavingVolcConfig(true)
    try {
      const payload = {
        access_key: volcDraft.access_key.trim() || null,
        secret_key: volcDraft.secret_key.trim() || null,
        region: volcDraft.region.trim() || 'cn-beijing',
        provider_code: volcDraft.provider_code.trim(),
        quota_code: volcDraft.quota_code.trim()
      }
      const config = await updateApiMonitorConfig(payload)
      setMonitorConfig(config)
      setVolcDraft(normalizeVolcDraft(config?.volcengine))
      await loadProviders()
    } catch (e) {
      setError((e as Error)?.message || '保存火山配额配置失败')
    } finally {
      setSavingVolcConfig(false)
    }
  }

  const handleClearVolcKey = async (field: 'access_key' | 'secret_key') => {
    setSavingVolcConfig(true)
    try {
      const config = await updateApiMonitorConfig({ [field]: '' })
      setMonitorConfig(config)
      setVolcDraft(normalizeVolcDraft(config?.volcengine))
      await loadProviders()
    } catch (e) {
      setError((e as Error)?.message || '清空密钥失败')
    } finally {
      setSavingVolcConfig(false)
    }
  }

  const categoryRows = useMemo(() => {
    const byCategory = usage?.by_category || {}
    return Object.keys(CATEGORY_LABELS).map((key) => ({
      key,
      label: CATEGORY_LABELS[key],
      total: byCategory[key]?.total || 0,
      success: byCategory[key]?.success || 0,
      error: byCategory[key]?.error || 0,
      avgLatency: byCategory[key]?.avg_latency_ms || 0
    }))
  }, [usage])

  if (loading && !usage) {
    return (
      <div className="h-full overflow-auto p-8">
        <div className="max-w-6xl mx-auto">
          <div className="glass-card p-10 text-center">
            <div className="w-10 h-10 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-400">正在加载 API 监控...</p>
          </div>
        </div>
      </div>
    )
  }

  const summary = usage?.summary || {
    total: 0,
    success: 0,
    error: 0,
    success_rate: 0,
    avg_latency_ms: 0
  }
  const dailyUsage = usage?.daily_usage?.items || {}

  return (
    <div className="h-full overflow-auto p-8 animate-fadeIn">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 via-sky-500 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <Activity size={24} className="text-white" strokeWidth={2.4} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gradient">API 实时监控</h1>
              <p className="text-sm text-gray-400">
                最近更新时间：{formatTime(usage?.generated_at)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value === 'agent' ? 'agent' : 'module')}
              className="glass-input px-3 py-2 text-sm"
            >
              <option value="module">独立模块</option>
              <option value="agent">Agent 模式</option>
            </select>
            <select
              value={windowMinutes}
              onChange={(e) => setWindowMinutes(parseInt(e.target.value, 10) || 60)}
              className="glass-input px-3 py-2 text-sm"
            >
              {WINDOW_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => void refreshAll()}
              disabled={refreshing}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
              刷新
            </button>
          </div>
        </div>

        {error && (
          <div className="glass-card p-4 border border-rose-500/30 text-rose-200 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="glass-card p-5">
            <p className="text-xs text-gray-400 mb-2">窗口内请求量</p>
            <p className="text-2xl font-semibold">{formatNum(summary.total)}</p>
          </div>
          <div className="glass-card p-5">
            <p className="text-xs text-gray-400 mb-2">成功率</p>
            <p className="text-2xl font-semibold">{summary.success_rate.toFixed(2)}%</p>
          </div>
          <div className="glass-card p-5">
            <p className="text-xs text-gray-400 mb-2">平均延迟</p>
            <p className="text-2xl font-semibold">{summary.avg_latency_ms.toFixed(1)} ms</p>
          </div>
          <div className="glass-card p-5">
            <p className="text-xs text-gray-400 mb-2">当前处理中</p>
            <p className="text-2xl font-semibold">{formatNum(usage?.in_flight || 0)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Waves size={16} className="text-cyan-300" />
              <h2 className="font-semibold">分类使用状态</h2>
            </div>
            <div className="space-y-2">
              {categoryRows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{row.label}</p>
                    <p className="text-[11px] text-gray-400">平均 {row.avgLatency.toFixed(1)} ms</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm">
                      <span className="text-white">{formatNum(row.total)}</span>
                      <span className="text-gray-500"> 次</span>
                    </p>
                    <p className="text-[11px] text-gray-400">
                      成功 {formatNum(row.success)} / 失败 {formatNum(row.error)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Gauge size={16} className="text-emerald-300" />
                <h2 className="font-semibold">日预算与余量</h2>
              </div>
              <button
                onClick={() => void handleSaveBudget()}
                disabled={savingBudget}
                className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-50"
              >
                <Save size={13} />
                {savingBudget ? '保存中...' : '保存预算'}
              </button>
            </div>
            <div className="space-y-2">
              {BUDGET_KEYS.map((key) => {
                const item = dailyUsage[key]
                const used = item?.used || 0
                const remaining = item?.remaining
                const remainingRatio = item?.remaining_ratio
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">{CATEGORY_LABELS[key]}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-400">预算/日</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={budgetDraft[key] ?? ''}
                          onChange={(e) => handleBudgetInput(key, e.target.value)}
                          className="w-20 glass-input px-2 py-1 text-xs text-right"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-gray-400 flex items-center justify-between">
                      <span>已用：{formatNum(used)}</span>
                      <span>
                        剩余：
                        {remaining === null ? ' 无上限' : ` ${formatNum(remaining)} (${remainingRatio?.toFixed(1) || '0'}%)`}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-gray-500 mt-3">
              说明：预算是本地阈值。填 `0` 表示不限制，仅显示已用。
            </p>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Server size={16} className="text-cyan-300" />
              <h2 className="font-semibold">火山官方配额配置</h2>
            </div>
            <button
              onClick={() => void handleSaveVolcConfig()}
              disabled={savingVolcConfig}
              className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-50"
            >
              <Save size={13} />
              {savingVolcConfig ? '保存中...' : '保存配置'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <label className="text-xs text-gray-400">
              Access Key (AK)
              <input
                type="text"
                value={volcDraft.access_key}
                onChange={(e) => handleVolcDraftInput('access_key', e.target.value)}
                placeholder={monitorConfig?.volcengine?.access_key_masked || '输入新的 AK（留空则保持不变）'}
                className="mt-1 w-full glass-input px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-gray-400">
              Secret Key (SK)
              <input
                type="password"
                value={volcDraft.secret_key}
                onChange={(e) => handleVolcDraftInput('secret_key', e.target.value)}
                placeholder={monitorConfig?.volcengine?.secret_key_masked || '输入新的 SK（留空则保持不变）'}
                className="mt-1 w-full glass-input px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-gray-400">
              Region
              <input
                type="text"
                value={volcDraft.region}
                onChange={(e) => handleVolcDraftInput('region', e.target.value)}
                placeholder="cn-beijing"
                className="mt-1 w-full glass-input px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-gray-400">
              ProviderCode（可选）
              <input
                type="text"
                value={volcDraft.provider_code}
                onChange={(e) => handleVolcDraftInput('provider_code', e.target.value)}
                placeholder="如 vei_api"
                className="mt-1 w-full glass-input px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-gray-400">
              QuotaCode（可选）
              <input
                type="text"
                value={volcDraft.quota_code}
                onChange={(e) => handleVolcDraftInput('quota_code', e.target.value)}
                placeholder="如 ai-gateway-token-limit"
                className="mt-1 w-full glass-input px-3 py-2 text-sm"
              />
            </label>

            <div className="text-xs text-gray-400 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
              <p>已保存 AK：{monitorConfig?.volcengine?.has_access_key ? '是' : '否'}</p>
              <p className="mt-1">已保存 SK：{monitorConfig?.volcengine?.has_secret_key ? '是' : '否'}</p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => void handleClearVolcKey('access_key')}
                  disabled={savingVolcConfig || !monitorConfig?.volcengine?.has_access_key}
                  className="btn-secondary text-[11px] px-2 py-1 disabled:opacity-50"
                >
                  清空 AK
                </button>
                <button
                  onClick={() => void handleClearVolcKey('secret_key')}
                  disabled={savingVolcConfig || !monitorConfig?.volcengine?.has_secret_key}
                  className="btn-secondary text-[11px] px-2 py-1 disabled:opacity-50"
                >
                  清空 SK
                </button>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-gray-500 mt-3">
            说明：AK/SK 仅保存到本机 `backend/data/api_monitor.local.yaml`，用于监控页调用火山官方配额中心，不影响你现有业务 API Key。
          </p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Server size={16} className="text-sky-300" />
              <h2 className="font-semibold">上游 API 状态与余量</h2>
            </div>
            <span className="text-xs text-gray-400">
              {providersLoading ? '探测中...' : `共 ${providers.length} 项`}
            </span>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm min-w-[780px]">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-white/10">
                  <th className="py-2 pr-3">服务</th>
                  <th className="py-2 pr-3">Provider / Model</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3">剩余请求</th>
                  <th className="py-2 pr-3">剩余 Tokens</th>
                  <th className="py-2">说明</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((item) => {
                  const statusMeta = PROVIDER_STATUS_META[item.status] || {
                    label: item.status || '未知',
                    className: 'bg-slate-500/20 text-slate-300 border-slate-400/30'
                  }
                  const reqRemaining = item.rate_limit?.requests?.remaining
                  const rateLimitTokenRemaining = item.rate_limit?.tokens?.remaining
                  const tokenQuota = item.token_quota
                  const tokenQuotaRemaining = typeof tokenQuota?.remaining === 'number' ? tokenQuota.remaining : null
                  const tokenQuotaTotal = typeof tokenQuota?.total === 'number' ? tokenQuota.total : null
                  const tokRemaining = rateLimitTokenRemaining
                    || (tokenQuotaRemaining !== null
                      ? (
                        tokenQuotaTotal !== null
                          ? `${formatMetricNumber(tokenQuotaRemaining)} / ${formatMetricNumber(tokenQuotaTotal)}`
                          : formatMetricNumber(tokenQuotaRemaining)
                      )
                      : '--')

                  return (
                    <tr key={`${item.category}_${item.provider}_${item.model}`} className="border-b border-white/5">
                      <td className="py-2 pr-3 text-gray-200">{CATEGORY_LABELS[item.category] || item.category}</td>
                      <td className="py-2 pr-3">
                        <div className="text-gray-100">{item.provider || '--'}</div>
                        <div className="text-[11px] text-gray-500">{item.model || '--'}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${statusMeta.className}`}>
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="py-2 pr-3">{reqRemaining || '--'}</td>
                      <td className="py-2 pr-3">
                        <div>{tokRemaining}</div>
                        {!rateLimitTokenRemaining && tokenQuota?.quota_code && (
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {tokenQuota.quota_code}
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-gray-400 text-xs">
                        <div>{item.message || '--'}</div>
                        {!rateLimitTokenRemaining && tokenQuota?.source === 'volc_quota_openapi' && (
                          <div className="text-[11px] text-cyan-300/80 mt-0.5">数据源：火山官方配额中心</div>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {providers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-gray-500 text-sm">
                      暂无探测结果
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Timer size={16} className="text-amber-300" />
            <h2 className="font-semibold">最近错误（窗口内）</h2>
          </div>
          {usage?.recent_errors?.length ? (
            <div className="space-y-2">
              {usage.recent_errors.map((item, idx) => (
                <div key={`${item.timestamp}_${idx}`} className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2">
                  <div className="flex items-center justify-between text-xs text-rose-200">
                    <span>{formatTime(item.timestamp)}</span>
                    <span>HTTP {item.status_code}</span>
                  </div>
                  <p className="text-sm text-rose-100 mt-1">{item.path}</p>
                  {item.error && <p className="text-xs text-rose-200/80 mt-1">{item.error}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">当前窗口内没有错误记录。</p>
          )}
        </div>
      </div>
    </div>
  )
}
