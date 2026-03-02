/**
 * Agent Pipeline Control Panel -- Phase 3, Task 3.6
 * Visualization and control for the multi-agent production pipeline.
 * - Agent roster with status indicators
 * - Pipeline progress timeline
 * - Manual intervention (pause / skip / reset)
 * - Decision log timeline
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Bot, Play, Pause, SkipForward, RefreshCw,
  CheckCircle, Clock, AlertTriangle, Loader2,
  ChevronDown, ChevronRight, Activity, FileText,
  Eye, Zap,
} from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentRoleInfo {
  role_id: string
  display_name: string
  display_name_en: string
  department: string
  model_tier: string
  description: string
  status: 'idle' | 'working' | 'waiting' | 'completed' | 'error'
}

interface PipelineStageInfo {
  stage: string
  label: string
  agent_role: string
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'error'
  started_at?: string
  completed_at?: string
  duration_ms?: number
  output_summary?: string
}

interface DecisionLogEntry {
  agent_role: string
  action: string
  input_summary: string
  output_summary: string
  model_used: string
  tokens_used: number
  duration_ms: number
  created_at: string
}

interface PipelineState {
  pipeline_id: string
  current_stage: string
  stages: PipelineStageInfo[]
  decision_log: DecisionLogEntry[]
  started_at: string
  error?: string
}

interface AgentPipelinePanelProps {
  episodeId: string
  seriesId: string
  onClose?: () => void
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STAGE_LABELS: Record<string, string> = {
  planning: '任务规划',
  world_building: '世界观构建',
  character_development: '角色开发',
  dialogue_writing: '对话编写',
  storyboard_planning: '分镜规划',
  narrative_qa: '叙事质检',
  prompt_composition: '提示词组装',
  prompt_qa: '提示词质检',
  image_generation: '图像生成',
  visual_qa: '视觉质检',
  video_generation: '视频生成',
  audio_generation: '音频生成',
  completed: '已完成',
}

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-green-400',
  working: 'bg-blue-400 animate-pulse',
  waiting: 'bg-yellow-400',
  completed: 'bg-gray-500',
  error: 'bg-red-400',
}

const DEPT_COLOR: Record<string, string> = {
  executive: 'border-purple-600/60 bg-purple-900/20',
  story: 'border-blue-600/60 bg-blue-900/20',
  visual: 'border-green-600/60 bg-green-900/20',
  tech: 'border-orange-600/60 bg-orange-900/20',
}

const DEPT_BADGE: Record<string, string> = {
  executive: 'bg-purple-800/60 text-purple-300',
  story: 'bg-blue-800/60 text-blue-300',
  visual: 'bg-green-800/60 text-green-300',
  tech: 'bg-orange-800/60 text-orange-300',
}

const STAGE_STATUS_ICON: Record<string, JSX.Element> = {
  pending: <Clock className="w-3.5 h-3.5 text-gray-500" />,
  running: <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />,
  completed: <CheckCircle className="w-3.5 h-3.5 text-green-400" />,
  skipped: <SkipForward className="w-3.5 h-3.5 text-gray-500" />,
  error: <AlertTriangle className="w-3.5 h-3.5 text-red-400" />,
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return iso }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AgentPipelinePanel({ episodeId, seriesId, onClose }: AgentPipelinePanelProps) {
  const [agents, setAgents] = useState<AgentRoleInfo[]>([])
  const [pipeline, setPipeline] = useState<PipelineState | null>(null)
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [logOpen, setLogOpen] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ---- Fetch pipeline state ---- */
  const getPipelineState = useCallback(async () => {
    try {
      const res = await fetch(`/api/studio/agent-pipeline/${episodeId}/state`)
      if (!res.ok) return
      const data: PipelineState = await res.json()
      setPipeline(data)
      // derive agent statuses from stages
      setAgents(prev => {
        const roleStatus: Record<string, AgentRoleInfo['status']> = {}
        for (const s of data.stages) {
          if (s.status === 'running') roleStatus[s.agent_role] = 'working'
          else if (s.status === 'completed') roleStatus[s.agent_role] = 'completed'
          else if (s.status === 'error') roleStatus[s.agent_role] = 'error'
        }
        return prev.map(a => ({ ...a, status: roleStatus[a.role_id] ?? a.status }))
      })
      const isActive = data.stages.some(s => s.status === 'running')
      setRunning(isActive)
    } catch { /* silent */ }
  }, [episodeId])

  /* ---- Load agent roster on mount ---- */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/studio/agent-pipeline/${seriesId}/agents`)
        if (!cancelled && res.ok) setAgents(await res.json())
      } catch { /* silent */ }
    })()
    getPipelineState()
    return () => { cancelled = true }
  }, [seriesId, getPipelineState])

  /* ---- Polling while running ---- */
  useEffect(() => {
    if (running) {
      pollRef.current = setInterval(getPipelineState, 2000)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [running, getPipelineState])

  /* ---- Actions ---- */
  const startPipeline = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/studio/agent-pipeline/${episodeId}/start`, { method: 'POST' })
      if (!res.ok) throw new Error(`启动失败: ${res.status}`)
      setRunning(true)
      await getPipelineState()
    } catch (e) { setError(e instanceof Error ? e.message : '未知错误') }
    finally { setLoading(false) }
  }, [episodeId, getPipelineState])

  const pausePipeline = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/studio/agent-pipeline/${episodeId}/pause`, { method: 'POST' })
      if (!res.ok) throw new Error(`暂停失败: ${res.status}`)
      setRunning(false)
      await getPipelineState()
    } catch (e) { setError(e instanceof Error ? e.message : '未知错误') }
    finally { setLoading(false) }
  }, [episodeId, getPipelineState])

  const skipStage = useCallback(async (stage: string) => {
    try {
      const res = await fetch(`/api/studio/agent-pipeline/${episodeId}/skip/${stage}`, { method: 'POST' })
      if (!res.ok) throw new Error(`跳过失败: ${res.status}`)
      await getPipelineState()
    } catch (e) { setError(e instanceof Error ? e.message : '未知错误') }
  }, [episodeId, getPipelineState])

  const resetPipeline = useCallback(async () => {
    setRunning(false); setPipeline(null); setError('')
    setAgents(prev => prev.map(a => ({ ...a, status: 'idle' as const })))
  }, [])

  /* ---- Derived data ---- */
  const stages = pipeline?.stages ?? []
  const decisionLog = pipeline?.decision_log ?? []
  const completedCount = stages.filter(s => s.status === 'completed').length
  const progress = stages.length ? Math.round((completedCount / stages.length) * 100) : 0

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      {/* ---- Header ---- */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-gray-100">Agent Pipeline</h3>
          {pipeline && (
            <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 rounded">
              {progress}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!running ? (
            <button onClick={startPipeline} disabled={loading}
              className="px-2.5 py-1 rounded text-xs bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 inline-flex items-center gap-1">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              启动
            </button>
          ) : (
            <button onClick={pausePipeline} disabled={loading}
              className="px-2.5 py-1 rounded text-xs bg-yellow-600 hover:bg-yellow-500 text-white disabled:opacity-50 inline-flex items-center gap-1">
              <Pause className="w-3 h-3" /> 暂停
            </button>
          )}
          <button onClick={resetPipeline}
            className="px-2.5 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 inline-flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> 重置
          </button>
          {onClose && (
            <button onClick={onClose} className="text-gray-500 hover:text-white text-xs ml-1">&#x2715;</button>
          )}
        </div>
      </div>

      {/* ---- Error banner ---- */}
      {error && <div className="px-4 py-2 bg-red-900/20 text-red-400 text-xs">{error}</div>}

      <div className="p-4 space-y-5 max-h-[70vh] overflow-y-auto">
        {/* ============================================================ */}
        {/*  1. Agent Roster                                              */}
        {/* ============================================================ */}
        <section>
          <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
            <Eye className="w-3 h-3" /> Agent 列表
          </h4>
          {agents.length === 0 ? (
            <p className="text-xs text-gray-600">暂无 Agent 信息</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {agents.map(a => (
                <div key={a.role_id}
                  className={`rounded-lg border p-2.5 ${DEPT_COLOR[a.department] ?? 'border-gray-700 bg-gray-800/40'}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[a.status]}`} />
                    <span className="text-xs font-medium text-gray-100 truncate">{a.display_name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[10px] px-1.5 rounded ${DEPT_BADGE[a.department] ?? 'bg-gray-700 text-gray-400'}`}>
                      {a.department}
                    </span>
                    <span className="text-[10px] text-gray-500">{a.model_tier}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ============================================================ */}
        {/*  2. Pipeline Progress                                         */}
        {/* ============================================================ */}
        <section>
          <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
            <Activity className="w-3 h-3" /> 流水线进度
          </h4>

          {/* Progress bar */}
          {stages.length > 0 && (
            <div className="w-full h-1.5 bg-gray-800 rounded-full mb-3 overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          )}

          {stages.length === 0 ? (
            <p className="text-xs text-gray-600">尚未启动流水线</p>
          ) : (
            <div className="relative pl-5 space-y-0">
              {/* vertical line */}
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-700" />

              {stages.map((s) => {
                const isCurrent = s.status === 'running'
                return (
                  <div key={s.stage}
                    className={`relative py-2 pl-4 rounded-lg transition-colors ${isCurrent ? 'bg-indigo-900/20' : ''}`}>
                    {/* timeline dot */}
                    <span className="absolute left-[-13px] top-[13px]">
                      {STAGE_STATUS_ICON[s.status]}
                    </span>

                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`text-xs font-medium ${isCurrent ? 'text-indigo-300' : 'text-gray-200'}`}>
                          {STAGE_LABELS[s.stage] ?? s.label}
                        </p>
                        <p className="text-[10px] text-gray-500 truncate">
                          {s.agent_role}
                          {s.duration_ms != null && <> &middot; {fmtDuration(s.duration_ms)}</>}
                        </p>
                        {s.output_summary && (
                          <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{s.output_summary}</p>
                        )}
                      </div>

                      {/* Skip button for pending stages */}
                      {s.status === 'pending' && (
                        <button onClick={() => skipStage(s.stage)}
                          className="shrink-0 px-2 py-0.5 rounded text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white inline-flex items-center gap-0.5">
                          <SkipForward className="w-2.5 h-2.5" /> 跳过
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ============================================================ */}
        {/*  3. Decision Log                                              */}
        {/* ============================================================ */}
        {decisionLog.length > 0 && (
          <section>
            <button onClick={() => setLogOpen(p => !p)}
              className="flex items-center gap-1 text-xs font-medium text-gray-400 uppercase tracking-wide hover:text-white mb-2">
              {logOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <FileText className="w-3 h-3" /> 决策日志 ({decisionLog.length})
            </button>

            {logOpen && (
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {decisionLog.map((d, idx) => {
                  const agent = agents.find(a => a.role_id === d.agent_role)
                  const badge = agent ? (DEPT_BADGE[agent.department] ?? 'bg-gray-700 text-gray-400') : 'bg-gray-700 text-gray-400'
                  return (
                    <div key={idx} className="rounded border border-gray-800 bg-gray-950/50 p-2">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-[10px] text-gray-500">{fmtTime(d.created_at)}</span>
                        <span className={`text-[10px] px-1.5 rounded ${badge}`}>{d.agent_role}</span>
                        <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                          <Zap className="w-2.5 h-2.5" /> {d.tokens_used} tok
                        </span>
                        <span className="text-[10px] text-gray-500">{fmtDuration(d.duration_ms)}</span>
                      </div>
                      <p className="text-xs text-gray-200">{d.action}</p>
                      {d.output_summary && (
                        <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{d.output_summary}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {/* ---- Empty state ---- */}
      {!pipeline && !loading && !error && agents.length === 0 && (
        <div className="px-4 py-8 text-center">
          <Bot className="w-8 h-8 mx-auto mb-2 text-gray-600" />
          <p className="text-sm text-gray-500">点击"启动"开始 Agent 流水线</p>
          <p className="text-xs text-gray-600 mt-1">多 Agent 协作完成从规划到生成的完整制片流程</p>
        </div>
      )}
    </div>
  )
}
