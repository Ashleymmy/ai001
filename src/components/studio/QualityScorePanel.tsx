/**
 * 质量评分面板 — Phase 2
 * 展示叙事 QA、提示词 QA、视觉 QA 的综合评分及问题列表
 */

import { useState, useCallback } from 'react'
import { Shield, AlertTriangle, Info, CheckCircle, Loader2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'

interface QAIssue {
  severity: string
  description: string
  fix_suggestion: string
  source?: string
  check?: string
  affected_shots?: string[]
  fix_instruction?: Record<string, unknown>
}

interface QualityScoreData {
  overall_score: number
  narrative_score: number
  prompt_score: number
  visual_score: number
  passed: boolean
  total_issues: number
  error_count: number
  warning_count: number
  info_count: number
  issues: QAIssue[]
}

interface QualityScorePanelProps {
  episodeId: string
  onClose?: () => void
}

const SCORE_COLORS: Record<string, string> = {
  excellent: 'text-green-400',
  good: 'text-blue-400',
  warning: 'text-yellow-400',
  poor: 'text-red-400',
}

function getScoreColor(score: number): string {
  if (score >= 90) return SCORE_COLORS.excellent
  if (score >= 70) return SCORE_COLORS.good
  if (score >= 50) return SCORE_COLORS.warning
  return SCORE_COLORS.poor
}

function getScoreBg(score: number): string {
  if (score >= 90) return 'bg-green-900/30 border-green-700/50'
  if (score >= 70) return 'bg-blue-900/30 border-blue-700/50'
  if (score >= 50) return 'bg-yellow-900/30 border-yellow-700/50'
  return 'bg-red-900/30 border-red-700/50'
}

const SEVERITY_CONFIG: Record<string, { icon: typeof AlertTriangle; color: string; bg: string; label: string }> = {
  error: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-900/20 border-red-800/40', label: '错误' },
  warning: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-800/40', label: '警告' },
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-900/20 border-blue-800/40', label: '信息' },
}

const SOURCE_LABELS: Record<string, string> = {
  narrative: '叙事QA',
  prompt: '提示词QA',
  visual: '视觉QA',
}

export default function QualityScorePanel({ episodeId, onClose }: QualityScorePanelProps) {
  const [data, setData] = useState<QualityScoreData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ issues: true })

  const runQA = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const resp = await fetch(`/api/studio/qa/full/${episodeId}`, { method: 'POST' })
      if (!resp.ok) throw new Error(`QA 检查失败: ${resp.status}`)
      const result = await resp.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }, [episodeId])

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-semibold text-gray-100">质量评分面板</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runQA}
            disabled={loading}
            className="px-3 py-1 rounded text-xs bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 inline-flex items-center gap-1"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {data ? '重新检查' : '开始检查'}
          </button>
          {onClose && (
            <button onClick={onClose} className="text-gray-500 hover:text-white text-xs">✕</button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-900/20 text-red-400 text-xs">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="px-4 py-8 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
          <span className="ml-2 text-sm text-gray-400">正在执行质量检查...</span>
        </div>
      )}

      {/* Results */}
      {data && !loading && (
        <div className="p-4 space-y-4">
          {/* Overall score */}
          <div className={`rounded-lg border p-4 ${getScoreBg(data.overall_score)}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">综合评分</p>
                <p className={`text-3xl font-bold ${getScoreColor(data.overall_score)}`}>
                  {data.overall_score}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {data.passed ? (
                  <><CheckCircle className="w-5 h-5 text-green-400" /><span className="text-sm text-green-400">通过</span></>
                ) : (
                  <><AlertTriangle className="w-5 h-5 text-red-400" /><span className="text-sm text-red-400">未通过</span></>
                )}
              </div>
            </div>
          </div>

          {/* Score breakdown */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: '叙事QA', score: data.narrative_score, weight: '40%' },
              { label: '提示词QA', score: data.prompt_score, weight: '35%' },
              { label: '视觉QA', score: data.visual_score, weight: '25%' },
            ].map(item => (
              <div key={item.label} className="rounded-lg border border-gray-800 bg-gray-950/50 p-3">
                <p className="text-[10px] text-gray-500 mb-1">{item.label} ({item.weight})</p>
                <p className={`text-xl font-semibold ${getScoreColor(item.score)}`}>{item.score}</p>
              </div>
            ))}
          </div>

          {/* Issue summary */}
          <div className="flex items-center gap-4 text-xs">
            <span className="text-gray-400">问题统计:</span>
            <span className="text-red-400">{data.error_count} 错误</span>
            <span className="text-yellow-400">{data.warning_count} 警告</span>
            <span className="text-blue-400">{data.info_count} 信息</span>
          </div>

          {/* Issues list */}
          {data.issues.length > 0 && (
            <div>
              <button
                onClick={() => toggleSection('issues')}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-white mb-2"
              >
                {expandedSections.issues ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                问题详情 ({data.issues.length})
              </button>
              {expandedSections.issues && (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {data.issues.map((issue, idx) => {
                    const config = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.info
                    const Icon = config.icon
                    return (
                      <div key={idx} className={`rounded border p-2.5 ${config.bg}`}>
                        <div className="flex items-start gap-2">
                          <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${config.color}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`text-[10px] ${config.color}`}>{config.label}</span>
                              {issue.source && (
                                <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 rounded">
                                  {SOURCE_LABELS[issue.source] || issue.source}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-200">{issue.description}</p>
                            {issue.fix_suggestion && (
                              <p className="text-[10px] text-gray-400 mt-1">💡 {issue.fix_suggestion}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <div className="px-4 py-8 text-center">
          <Shield className="w-8 h-8 mx-auto mb-2 text-gray-600" />
          <p className="text-sm text-gray-500">点击"开始检查"执行质量评估</p>
          <p className="text-xs text-gray-600 mt-1">将检查叙事一致性、提示词合规性和视觉一致性</p>
        </div>
      )}
    </div>
  )
}
