import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Settings2, Plus, Film, Users, MapPin, Package,
  Loader2, Play, RefreshCw, Trash2, ChevronRight, ImageIcon,
  Video, Mic, Layers, Sparkles, Clock, CheckCircle, AlertCircle, X, Save, ChevronLeft, Wand2,
  Star, Eye, Pencil, FileText, History, RotateCcw,
} from 'lucide-react'
import { useStudioStore } from '../store/studioStore'
import axios from 'axios'
import {
  studioCheckConfig, studioExportEpisode, studioExportSeries, studioGetSeriesStats, studioGetSettings, studioSaveSettings,
  studioGetPromptTemplateDefaults,
  listAgentProjects, studioExportEpisodeToAgent, studioImportEpisodeFromAgent,
  studioPromptCheck, studioPromptBatchCheck, studioPromptOptimize,
} from '../services/api'
import type {
  StudioSeriesStats,
  StudioEpisodeHistoryEntry,
  StudioPromptAnalysis,
  StudioPromptBatchCheckItem,
} from '../services/api'
import type {
  StudioSeries,
  StudioEpisode,
  StudioElement,
  StudioShot,
  StudioEpisodeElement,
  StudioGenerationScope,
  StudioGenerationProgress,
  StudioGenerationStage,
  StudioFailedOperation,
  StudioRetryRecord,
} from '../store/studioStore'
import Timeline from '../components/studio/Timeline'
import PreviewPlayer from '../components/studio/PreviewPlayer'

type ServiceKey = 'llm' | 'image' | 'video' | 'tts'

interface StudioToast {
  id: string
  message: string
  code?: string | null
  context?: Record<string, unknown> | null
}

type ExportPhase = 'packing' | 'downloading' | 'saving' | 'done' | 'error'

interface StudioExportProgress {
  title: string
  phase: ExportPhase
  loaded: number
  total?: number
  percent?: number
  error?: string
}

type StudioActivityTone = 'idle' | 'info' | 'working' | 'success' | 'warning' | 'error'

interface StudioActivityIndicator {
  active: boolean
  title: string
  detail: string
  progress: number | null
  tone: StudioActivityTone
}

interface AgentProjectOption {
  id: string
  name: string
  updated_at?: string
  elements_count?: number
  segments_count?: number
  creative_brief?: Record<string, unknown>
}

interface AgentExportOptions {
  mode: 'new' | 'existing'
  projectName: string
  selectedProjectId: string
  includeSharedElements: boolean
  includeEpisodeElements: boolean
  preserveExistingMessages: boolean
}

type PreviewPanelRect = {
  x: number
  y: number
  width: number
  height: number
}

type PreviewPanelResizeDirection =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

const LAYOUT_SIDEBAR_WIDTH_KEY = 'studio.layout.sidebarWidth'
const LAYOUT_SIDEBAR_COLLAPSED_KEY = 'studio.layout.sidebarCollapsed'
const LAYOUT_DETAIL_PANEL_WIDTH_KEY = 'studio.layout.detailPanelWidth'
const LAYOUT_DETAIL_PANEL_COLLAPSED_KEY = 'studio.layout.detailPanelCollapsed'

type PromptFieldKey = 'prompt' | 'end_prompt' | 'video_prompt'

const PROMPT_FIELD_META: Array<{ field: PromptFieldKey; label: string }> = [
  { field: 'prompt', label: '起始帧提示词' },
  { field: 'end_prompt', label: '尾帧提示词' },
  { field: 'video_prompt', label: '视频提示词' },
]

function isPromptFieldKey(value: string): value is PromptFieldKey {
  return value === 'prompt' || value === 'end_prompt' || value === 'video_prompt'
}

function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
  } catch {
    return fallback
  }
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw == null) return fallback
    return raw === '1'
  } catch {
    return fallback
  }
}

function formatStorage(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatRelativeTime(input: string): string {
  const timestamp = new Date(input).getTime()
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--'
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s 前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

function defaultPreviewPanelRect(): PreviewPanelRect {
  if (typeof window === 'undefined') {
    return { x: 220, y: 120, width: 1020, height: 420 }
  }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const minW = Math.min(420, Math.max(320, vw - 16))
  const minH = Math.min(260, Math.max(200, vh - 56))
  const width = Math.max(minW, Math.min(1200, Math.round(vw * 0.72)))
  const height = Math.max(minH, Math.min(620, Math.round(vh * 0.58)))
  const x = Math.max(8, Math.round((vw - width) / 2))
  const y = Math.max(44, Math.round((vh - height) / 2))
  return { x, y, width, height }
}

function createDefaultAgentExportOptions(): AgentExportOptions {
  return {
    mode: 'new',
    projectName: '',
    selectedProjectId: '',
    includeSharedElements: true,
    includeEpisodeElements: true,
    preserveExistingMessages: true,
  }
}

function clampPreviewPanelRect(next: PreviewPanelRect): PreviewPanelRect {
  if (typeof window === 'undefined') return next

  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxW = Math.max(320, vw - 16)
  const maxH = Math.max(200, vh - 56)
  const minW = Math.min(420, maxW)
  const minH = Math.min(260, maxH)

  const width = Math.min(maxW, Math.max(minW, next.width))
  const height = Math.min(maxH, Math.max(minH, next.height))
  const maxX = Math.max(8, vw - width - 8)
  const maxY = Math.max(40, vh - height - 8)
  const x = Math.min(maxX, Math.max(8, next.x))
  const y = Math.min(maxY, Math.max(40, next.y))

  return { x, y, width, height }
}

function getEpisodeStatusText(status: string): string {
  if (status === 'draft') return '草稿'
  if (status === 'planned') return '已规划'
  if (status === 'in_progress') return '制作中'
  if (status === 'completed') return '已完成'
  return status
}

function getEpisodeStatusBadgeClass(status: string): string {
  if (status === 'planned') return 'bg-blue-900/30 text-blue-300'
  if (status === 'completed') return 'bg-green-900/30 text-green-300'
  if (status === 'in_progress') return 'bg-yellow-900/30 text-yellow-300'
  if (status === 'draft') return 'bg-gray-800 text-gray-300'
  return 'bg-gray-800 text-gray-400'
}

function getGenerationStageText(stage: StudioGenerationStage): string {
  if (stage === 'generating_elements') return '生成元素图中'
  if (stage === 'generating_frames') return '生成起始帧中'
  if (stage === 'generating_end_frames') return '生成尾帧中'
  if (stage === 'generating_videos') return '生成视频中'
  if (stage === 'generating_audio') return '生成音频中'
  if (stage === 'complete') return '批量生成完成'
  if (stage === 'error') return '批量生成失败'
  return '批量生成进行中'
}

function getGenerationDetail(progress: StudioGenerationProgress): string {
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0))
  const counter = progress.totalItems > 0
    ? `${Math.min(progress.currentIndex, progress.totalItems)}/${progress.totalItems}`
    : ''
  const item = progress.currentItem ? ` · ${progress.currentItem}` : ''
  const errors = progress.errors.length > 0 ? ` · 异常 ${progress.errors.length}` : ''
  if (!counter) return `${percent.toFixed(0)}%${item}${errors}`.trim()
  return `${counter} (${percent.toFixed(0)}%)${item}${errors}`
}

const MULTI_AGE_SIGNAL_KEYWORDS = [
  '幼年', '童年', '少年', '青年', '中年', '老年', '晚年',
  '前期', '后期', '早期',
  '中期', '初期', '晚期', '末期',
  '年轻时', '年老时',
  '十年后', '多年后', '若干年后',
  '战前', '战后', '回忆', '现实',
  '白天', '夜晚', '雨夜', '雪夜',
]

function hasMultiAgeSignals(text: string): boolean {
  const source = (text || '').trim()
  if (!source) return false
  if (source.includes('前期') && source.includes('后期')) return true
  const hits = MULTI_AGE_SIGNAL_KEYWORDS.filter((keyword) => source.includes(keyword))
  return new Set(hits).size >= 2
}

function formatHistoryAction(action: string): string {
  if (action === 'plan') return '分镜规划'
  if (action === 'enhance_refine') return '镜头优化'
  if (action === 'enhance_expand') return '镜头扩展'
  if (action === 'batch_generate') return '批量生成'
  if (action === 'edit_episode') return '编辑集信息'
  if (action === 'edit_shot') return '编辑镜头'
  if (action.startsWith('restore_')) return '版本回退'
  return action
}

interface HistoryShotDiffItem {
  index: number
  type: 'added' | 'removed' | 'changed'
  current?: StudioShot
  previous?: StudioShot
  changedFields?: string[]
}

interface HistoryShotDiffSummary {
  added: number
  removed: number
  changed: number
  unchanged: number
  items: HistoryShotDiffItem[]
}

function summarizeShotDiff(currentShots: StudioShot[], previousShots: StudioShot[]): HistoryShotDiffSummary {
  const current = [...currentShots].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const previous = [...previousShots].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const total = Math.max(current.length, previous.length)
  const items: HistoryShotDiffItem[] = []
  let added = 0
  let removed = 0
  let changed = 0
  let unchanged = 0

  for (let index = 0; index < total; index += 1) {
    const cur = current[index]
    const prev = previous[index]
    if (cur && !prev) {
      added += 1
      items.push({ index, type: 'added', current: cur })
      continue
    }
    if (!cur && prev) {
      removed += 1
      items.push({ index, type: 'removed', previous: prev })
      continue
    }
    if (!cur || !prev) continue

    const changedFields: string[] = []
    if ((cur.name || '') !== (prev.name || '')) changedFields.push('名称')
    if ((cur.type || '') !== (prev.type || '')) changedFields.push('类型')
    if (Number(cur.duration || 0) !== Number(prev.duration || 0)) changedFields.push('时长')
    if ((cur.description || '') !== (prev.description || '')) changedFields.push('描述')
    if ((cur.prompt || '') !== (prev.prompt || '')) changedFields.push('首帧提示词')
    if ((cur.end_prompt || '') !== (prev.end_prompt || '')) changedFields.push('尾帧提示词')
    if ((cur.video_prompt || '') !== (prev.video_prompt || '')) changedFields.push('视频提示词')
    if ((cur.narration || '') !== (prev.narration || '')) changedFields.push('旁白')
    if ((cur.dialogue_script || '') !== (prev.dialogue_script || '')) changedFields.push('对白')

    if (changedFields.length > 0) {
      changed += 1
      items.push({ index, type: 'changed', current: cur, previous: prev, changedFields })
    } else {
      unchanged += 1
    }
  }

  return { added, removed, changed, unchanged, items }
}

function resizeCursorByDirection(direction: PreviewPanelResizeDirection): string {
  if (direction === 'left' || direction === 'right') return 'ew-resize'
  if (direction === 'top' || direction === 'bottom') return 'ns-resize'
  if (direction === 'top-left' || direction === 'bottom-right') return 'nwse-resize'
  return 'nesw-resize'
}

function HoverOverviewPanel({
  children,
  maxWidthClass = 'max-w-3xl',
}: {
  children: ReactNode
  maxWidthClass?: string
}) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center px-4 py-8 opacity-0 scale-[0.97] transition-all duration-150 delay-0 group-hover:delay-700 group-focus-within:delay-300 group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100">
      <div className={`w-full ${maxWidthClass} rounded-xl border border-gray-600 bg-gray-950/95 p-4 shadow-2xl backdrop-blur-sm`}>
        {children}
      </div>
    </div>
  )
}

function calcExportPercent(progress: StudioExportProgress): number | null {
  if (typeof progress.percent === 'number' && Number.isFinite(progress.percent)) {
    return Math.min(100, Math.max(0, progress.percent))
  }
  if (progress.total && progress.total > 0) {
    return Math.min(100, Math.max(0, (progress.loaded / progress.total) * 100))
  }
  if (progress.phase === 'packing') return 8
  if (progress.phase === 'saving') return 94
  if (progress.phase === 'done') return 100
  if (progress.phase === 'error') return 100
  return null
}

function StudioLoadingSkeleton() {
  return (
    <div className="flex-1 p-4 overflow-hidden">
      <div className="h-full rounded-xl border border-gray-800 bg-gray-900/40 p-4 animate-pulse flex flex-col gap-4">
        <div className="h-8 w-1/3 rounded bg-gray-800" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 flex-1">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="rounded-lg border border-gray-800 bg-gray-900/50 p-3 space-y-2">
              <div className="aspect-video rounded bg-gray-800" />
              <div className="h-3 rounded bg-gray-800 w-2/3" />
              <div className="h-3 rounded bg-gray-800 w-5/6" />
              <div className="h-3 rounded bg-gray-800 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StudioDynamicIsland({ indicator }: { indicator: StudioActivityIndicator }) {
  const toneCls =
    indicator.tone === 'error' ? 'border-red-700/70 from-red-900/50 to-gray-900 text-red-100' :
    indicator.tone === 'warning' ? 'border-amber-700/70 from-amber-900/45 to-gray-900 text-amber-100' :
    indicator.tone === 'success' ? 'border-emerald-700/70 from-emerald-900/40 to-gray-900 text-emerald-100' :
    indicator.tone === 'working' ? 'border-purple-700/70 from-purple-900/45 to-gray-900 text-purple-100' :
    indicator.tone === 'info' ? 'border-blue-700/70 from-blue-900/45 to-gray-900 text-blue-100' :
    'border-gray-700 from-gray-900/95 to-gray-900 text-gray-200'

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[72] pointer-events-none">
      <div
        className={`pointer-events-auto rounded-2xl border bg-gradient-to-b shadow-2xl backdrop-blur transition-all duration-250 ease-out overflow-hidden ${
          indicator.active ? 'w-[min(520px,92vw)] px-4 py-2.5' : 'w-[min(340px,88vw)] px-4 py-1.5'
        } ${toneCls}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">{indicator.title}</p>
            <p className="text-[11px] text-gray-300 truncate">{indicator.detail}</p>
          </div>
          {indicator.active ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 opacity-80" />
          ) : (
            <Wand2 className="w-3.5 h-3.5 shrink-0 opacity-70" />
          )}
        </div>
        <div className={`transition-all duration-250 ${indicator.active ? 'max-h-12 opacity-100 mt-2' : 'max-h-0 opacity-0 mt-0'}`}>
          <div className="h-1.5 rounded-full bg-gray-900/70 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-400 via-fuchsia-400 to-indigo-300 transition-all duration-300"
              style={{ width: `${Math.max(10, indicator.progress ?? 35)}%` }}
            />
          </div>
          {typeof indicator.progress === 'number' && (
            <div className="mt-1 text-[10px] text-gray-300 text-right">{indicator.progress.toFixed(0)}%</div>
          )}
        </div>
      </div>
    </div>
  )
}

function RecoveryCenterPanel({
  failedOperations,
  retryHistory,
  onRetry,
  onDismiss,
  onClearResolved,
  onClearHistory,
  onClose,
}: {
  failedOperations: StudioFailedOperation[]
  retryHistory: StudioRetryRecord[]
  onRetry: (operationId: string) => void
  onDismiss: (operationId: string) => void
  onClearResolved: () => void
  onClearHistory: () => void
  onClose: () => void
}) {
  const orderedFailedOperations = useMemo(
    () => [...failedOperations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [failedOperations],
  )
  const orderedRetryHistory = useMemo(
    () => [...retryHistory].sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime()),
    [retryHistory],
  )

  return (
    <div className="fixed top-14 right-2 md:right-4 xl:right-[26rem] z-[69] w-[min(460px,calc(100vw-1rem))] rounded-xl border border-gray-700 bg-gray-950/96 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <div>
          <p className="text-sm font-semibold text-gray-100">恢复中心</p>
          <p className="text-[11px] text-gray-500">失败队列与重试记录</p>
        </div>
        <button onClick={onClose} className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 border-b border-gray-800">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-gray-300">失败队列</h4>
          <button
            onClick={onClearResolved}
            className="text-[11px] text-gray-500 hover:text-gray-200"
          >
            清理已恢复
          </button>
        </div>
        <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
          {orderedFailedOperations.length === 0 && (
            <div className="rounded border border-gray-800 bg-gray-900/60 px-3 py-2 text-xs text-gray-500">
              当前没有失败操作
            </div>
          )}
          {orderedFailedOperations.map((operation) => (
            <div key={operation.id} className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-100 truncate">{operation.title}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{operation.message}</p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {formatRelativeTime(operation.updatedAt)} · 重试 {operation.retryCount} 次
                    {operation.code ? ` · ${operation.code}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                  operation.status === 'resolved'
                    ? 'bg-emerald-900/40 text-emerald-300'
                    : operation.status === 'retrying'
                      ? 'bg-blue-900/40 text-blue-300'
                      : 'bg-red-900/40 text-red-300'
                }`}>
                  {operation.status === 'resolved' ? '已恢复' : operation.status === 'retrying' ? '重试中' : '失败'}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-end gap-2">
                {operation.status !== 'resolved' && (
                  <button
                    onClick={() => onRetry(operation.id)}
                    disabled={operation.status === 'retrying' || !operation.retryable}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] bg-purple-700/70 hover:bg-purple-600/70 text-white disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    {operation.status === 'retrying' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    {operation.status === 'retrying' ? '处理中' : '重试'}
                  </button>
                )}
                <button
                  onClick={() => onDismiss(operation.id)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-200"
                >
                  <X className="w-3 h-3" />
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-gray-300">重试历史</h4>
          <button
            onClick={onClearHistory}
            className="text-[11px] text-gray-500 hover:text-gray-200"
          >
            清空历史
          </button>
        </div>
        <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
          {orderedRetryHistory.length === 0 && (
            <div className="rounded border border-gray-800 bg-gray-900/60 px-3 py-2 text-xs text-gray-500">
              暂无重试记录
            </div>
          )}
          {orderedRetryHistory.slice(0, 12).map((record) => (
            <div key={record.id} className="rounded border border-gray-800 bg-gray-900/60 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-gray-200 line-clamp-1">{record.operationTitle}</p>
                <span className={`text-[10px] shrink-0 ${record.success ? 'text-emerald-300' : 'text-red-300'}`}>
                  {record.success ? '成功' : '失败'}
                </span>
              </div>
              <p className="text-[10px] text-gray-500 mt-0.5">
                第 {record.attempt} 次 · {formatRelativeTime(record.finishedAt)}
              </p>
              {!record.success && (
                <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{record.message}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// StudioPage - 长篇制作工作台
// ============================================================

export default function StudioPage() {
  const navigate = useNavigate()
  const { seriesId, episodeId } = useParams()
  const store = useStudioStore()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showCharacterConsole, setShowCharacterConsole] = useState(false)
  const [showAgentExportDialog, setShowAgentExportDialog] = useState(false)
  const [showAgentImportDialog, setShowAgentImportDialog] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [bridgingAgent, setBridgingAgent] = useState(false)
  const [agentProjectsLoading, setAgentProjectsLoading] = useState(false)
  const [agentProjectOptions, setAgentProjectOptions] = useState<AgentProjectOption[]>([])
  const [agentExportOptions, setAgentExportOptions] = useState<AgentExportOptions>(createDefaultAgentExportOptions)
  const [selectedAgentProjectId, setSelectedAgentProjectId] = useState('')
  const [exportProgress, setExportProgress] = useState<StudioExportProgress | null>(null)
  const exportHideTimerRef = useRef<number | null>(null)
  const [toasts, setToasts] = useState<StudioToast[]>([])
  const [networkIssue, setNetworkIssue] = useState<string | null>(null)
  const [retryingNetwork, setRetryingNetwork] = useState(false)
  const [showRecoveryCenter, setShowRecoveryCenter] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readStoredNumber(LAYOUT_SIDEBAR_WIDTH_KEY, 256, 220, 420))
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => readStoredBoolean(LAYOUT_SIDEBAR_COLLAPSED_KEY, false))
  const [compactLayout, setCompactLayout] = useState<boolean>(() => (typeof window !== 'undefined' ? window.innerWidth < 1100 : false))
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const actualSidebarCollapsed = compactLayout ? true : sidebarCollapsed
  const actualSidebarWidth = actualSidebarCollapsed ? 56 : sidebarWidth
  const unresolvedFailedOps = useMemo(
    () => store.failedOperations.filter((item) => item.status !== 'resolved'),
    [store.failedOperations],
  )
  const retryingFailedOpsCount = useMemo(
    () => unresolvedFailedOps.filter((item) => item.status === 'retrying').length,
    [unresolvedFailedOps],
  )
  const activityIndicator = useMemo<StudioActivityIndicator>(() => {
    const generationProgress = store.generationProgress
    const isBatchGenerating = store.generating && store.generationScope === 'batch'
    const isSingleGenerating = store.generating && store.generationScope === 'single'

    if (exportProgress) {
      return {
        active: exportProgress.phase !== 'done' && exportProgress.phase !== 'error',
        title: exportProgress.title,
        detail: exportProgress.error || (
          exportProgress.phase === 'packing' ? '正在整理导出清单…' :
          exportProgress.phase === 'downloading' ? `下载中 ${exportProgress.loaded}/${exportProgress.total || '?'}` :
          exportProgress.phase === 'saving' ? '写入本地文件…' :
          exportProgress.phase === 'done' ? '导出完成' :
          '导出失败'
        ),
        progress: calcExportPercent(exportProgress),
        tone: exportProgress.phase === 'done'
          ? 'success'
          : exportProgress.phase === 'error'
            ? 'error'
            : 'info',
      }
    }

    const hasDetailedGeneration = isBatchGenerating
      && generationProgress.stage !== 'idle'
      && generationProgress.totalItems > 0
    if (hasDetailedGeneration) {
      return {
        active: true,
        title: getGenerationStageText(generationProgress.stage),
        detail: getGenerationDetail(generationProgress),
        progress: Math.max(0, Math.min(100, generationProgress.percent)),
        tone: generationProgress.errors.length > 0 ? 'warning' : 'working',
      }
    }

    if (!store.generating && generationProgress.stage === 'complete' && generationProgress.totalItems > 0) {
      return {
        active: false,
        title: getGenerationStageText(generationProgress.stage),
        detail: getGenerationDetail(generationProgress),
        progress: 100,
        tone: generationProgress.errors.length > 0 ? 'warning' : 'success',
      }
    }

    if (!store.generating && generationProgress.stage === 'error') {
      return {
        active: false,
        title: getGenerationStageText(generationProgress.stage),
        detail: generationProgress.currentItem || generationProgress.errors[generationProgress.errors.length - 1] || '批量生成失败',
        progress: Math.max(0, Math.min(100, generationProgress.percent)),
        tone: 'error',
      }
    }

    if (isSingleGenerating) {
      return {
        active: true,
        title: '单项生成进行中',
        detail: store.generationMessage || '正在处理当前素材',
        progress: null,
        tone: 'working',
      }
    }

    if (isBatchGenerating) {
      return {
        active: true,
        title: '批量生成进行中',
        detail: store.currentEpisode ? `第${store.currentEpisode.act_number}幕 · 正在处理镜头素材` : '正在处理当前任务',
        progress: null,
        tone: 'working',
      }
    }
    if (store.planning) {
      return {
        active: true,
        title: '分幕规划中',
        detail: store.currentEpisode ? `第${store.currentEpisode.act_number}幕 · 正在拆分与构图` : '正在规划剧本',
        progress: null,
        tone: 'working',
      }
    }
    if (store.creating) {
      return {
        active: true,
        title: '创建系列中',
        detail: '正在执行脚本拆分与共享元素提取',
        progress: null,
        tone: 'working',
      }
    }

    return {
      active: false,
      title: 'Studio 就绪',
      detail: store.currentSeries
        ? `${store.currentSeries.name} · ${store.episodes.length} 集 · ${store.sharedElements.length} 元素`
        : '选择系列或创建新项目开始制作',
      progress: null,
      tone: 'idle',
    }
  }, [
    exportProgress,
    store.creating,
    store.currentEpisode,
    store.currentSeries,
    store.episodes.length,
    store.generating,
    store.generationMessage,
    store.generationScope,
    store.generationProgress,
    store.planning,
    store.sharedElements.length,
  ])

  const pushToast = useCallback((toast: Omit<StudioToast, 'id'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
    setToasts((prev) => [...prev, { ...toast, id }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id))
    }, 5000)
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const scheduleHideExportProgress = useCallback((delayMs: number) => {
    if (exportHideTimerRef.current) window.clearTimeout(exportHideTimerRef.current)
    exportHideTimerRef.current = window.setTimeout(() => {
      setExportProgress(null)
      exportHideTimerRef.current = null
    }, delayMs)
  }, [])

  useEffect(() => {
    return () => {
      if (exportHideTimerRef.current) {
        window.clearTimeout(exportHideTimerRef.current)
      }
    }
  }, [])

  const ensureConfigReady = useCallback(async (required: ServiceKey[]) => {
    try {
      const check = await studioCheckConfig()
      const missing = required.filter((key) => !check.services[key]?.configured)
      if (missing.length === 0) return true

      const first = missing[0]
      pushToast({
        message: check.services[first]?.message || `请先配置 ${first.toUpperCase()} 服务`,
        code: `config_missing_${first}`,
        context: { required: missing },
      })
      setShowSettings(true)
      return false
    } catch {
      pushToast({ message: '配置检测失败，请检查后端服务状态', code: 'config_check_failed' })
      return false
    }
  }, [pushToast])

  // 初始化加载
  useEffect(() => {
    store.loadSeriesList()
  }, [])

  // Store 错误统一转为 Toast
  useEffect(() => {
    if (!store.error) return
    if (store.errorCode === 'network_error' || store.errorCode === 'network_timeout') {
      setNetworkIssue(store.error)
    }
    pushToast({
      message: store.error,
      code: store.errorCode,
      context: store.errorContext,
    })
    store.clearError()
  }, [store.error, store.errorCode, store.errorContext])

  // 路由参数同步
  useEffect(() => {
    if (seriesId && seriesId !== store.currentSeriesId) {
      store.selectSeries(seriesId)
    }
  }, [seriesId])

  useEffect(() => {
    if (episodeId && episodeId !== store.currentEpisodeId) {
      store.selectEpisode(episodeId)
    } else if (!episodeId && store.currentEpisodeId) {
      store.selectEpisode(null)
    }
  }, [episodeId])

  const handleSelectSeries = useCallback((id: string) => {
    navigate(`/studio/${id}`)
  }, [navigate])

  const handleSelectEpisode = useCallback((id: string) => {
    if (store.currentSeriesId) {
      navigate(`/studio/${store.currentSeriesId}/${id}`)
    }
  }, [navigate, store.currentSeriesId])

  const handleBackToSeries = useCallback(() => {
    if (store.currentSeriesId) {
      navigate(`/studio/${store.currentSeriesId}`)
    }
  }, [navigate, store.currentSeriesId])

  const handleCreateSeries = useCallback(async (params: {
    name: string
    script: string
    description?: string
    visual_style?: string
    target_episode_count?: number
    episode_duration_seconds?: number
  }) => {
    const ok = await ensureConfigReady(['llm'])
    if (!ok) return null
    return store.createSeries(params)
  }, [ensureConfigReady, store])

  const handlePlanEpisode = useCallback(async (id: string) => {
    const ok = await ensureConfigReady(['llm'])
    if (!ok) return
    await store.planEpisode(id)
  }, [ensureConfigReady, store])

  const handleEnhanceEpisode = useCallback(async (id: string, mode: 'refine' | 'expand') => {
    const ok = await ensureConfigReady(['llm'])
    if (!ok) return
    await store.enhanceEpisode(id, mode)
  }, [ensureConfigReady, store])

  const handleGenerateShotAsset = useCallback(async (shotId: string, stage: 'frame' | 'end_frame' | 'video' | 'audio') => {
    const required: ServiceKey[] =
      stage === 'frame' || stage === 'end_frame' ? ['image'] : stage === 'video' ? ['video'] : ['tts']
    const ok = await ensureConfigReady(required)
    if (!ok) return
    await store.generateShotAsset(shotId, stage)
  }, [ensureConfigReady, store])

  const handleInpaintShot = useCallback(async (
    shotId: string,
    payload: { editPrompt: string; maskData?: string },
  ) => {
    const ok = await ensureConfigReady(['image'])
    if (!ok) return
    await store.inpaintShotFrame(shotId, {
      edit_prompt: payload.editPrompt,
      mask_data: payload.maskData,
    })
  }, [ensureConfigReady, store])

  const handleBatchGenerate = useCallback(async (episodeId: string, stages?: string[]) => {
    const actualStages = stages && stages.length > 0 ? stages : ['elements', 'frames', 'end_frames', 'videos', 'audio']
    const required = new Set<ServiceKey>()
    if (actualStages.includes('elements') || actualStages.includes('frames') || actualStages.includes('end_frames')) required.add('image')
    if (actualStages.includes('videos')) required.add('video')
    if (actualStages.includes('audio')) required.add('tts')
    const ok = await ensureConfigReady(Array.from(required))
    if (!ok) return
    await store.batchGenerate(episodeId, stages)
  }, [ensureConfigReady, store])

  const handleBatchGenerateElementsForSeries = useCallback(async () => {
    const targetEpisodeId = store.episodes[0]?.id
    if (!targetEpisodeId) {
      pushToast({ message: '当前系列尚未生成分幕，无法批量生成素材', code: 'series_has_no_episode' })
      return
    }
    await handleBatchGenerate(targetEpisodeId, ['elements'])
  }, [handleBatchGenerate, pushToast, store.episodes])

  const handleImportCharacterDocument = useCallback(async (
    documentText: string,
    options?: { saveToElements?: boolean; dedupeByName?: boolean },
  ) => {
    if (!store.currentSeriesId) return null
    const ok = await ensureConfigReady(['llm'])
    if (!ok) return null
    const result = await store.importCharacterDocument(store.currentSeriesId, documentText, options)
    if (result) {
      pushToast({
        message: `角色文档处理完成：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}`,
      })
    }
    return result
  }, [ensureConfigReady, pushToast, store, store.currentSeriesId])

  const handleSplitCharacterByAge = useCallback(async (
    elementId: string,
    options?: { replaceOriginal?: boolean },
  ) => {
    const ok = await ensureConfigReady(['llm'])
    if (!ok) return null
    const result = await store.splitCharacterByAge(elementId, options)
    if (result) {
      if (result.need_split) {
        const migrated = result.migrated_refs
        const migratedText = migrated && (migrated.updated_shots > 0 || migrated.updated_fields > 0)
          ? `，镜头引用迁移 ${migrated.updated_shots} 条`
          : ''
        pushToast({ message: `角色拆分完成：新增 ${result.created}，更新 ${result.updated}${migratedText}` })
      } else {
        pushToast({ message: result.reason || '该角色当前无需按阶段拆分' })
      }
    }
    return result
  }, [ensureConfigReady, pushToast, store])

  const handleRetryNetworkIssue = useCallback(async () => {
    setRetryingNetwork(true)
    try {
      if (store.currentEpisodeId) {
        await store.selectEpisode(store.currentEpisodeId)
        await store.loadEpisodeHistory(store.currentEpisodeId, 80, true)
      } else if (store.currentSeriesId) {
        await store.selectSeries(store.currentSeriesId)
      } else {
        await store.loadSeriesList()
      }
      setNetworkIssue(null)
    } finally {
      setRetryingNetwork(false)
    }
  }, [store, store.currentEpisodeId, store.currentSeriesId])

  const handleRetryFailedOperation = useCallback((operationId: string) => {
    void store.retryFailedOperation(operationId)
  }, [store])

  const handleDismissFailedOperation = useCallback((operationId: string) => {
    store.dismissFailedOperation(operationId)
  }, [store])

  const handleClearResolvedFailedOperations = useCallback(() => {
    store.clearResolvedFailedOperations()
  }, [store])

  const handleClearRetryHistory = useCallback(() => {
    store.clearRetryHistory()
  }, [store])

  const saveBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [])

  const parseExportError = useCallback(async (e: unknown): Promise<string> => {
    if (axios.isAxiosError(e)) {
      const payload = e.response?.data
      if (payload instanceof Blob) {
        try {
          const text = await payload.text()
          const parsed = JSON.parse(text) as { detail?: string | { detail?: string } }
          if (typeof parsed.detail === 'string') return parsed.detail
          if (parsed.detail && typeof parsed.detail === 'object' && typeof parsed.detail.detail === 'string') {
            return parsed.detail.detail
          }
          if (text) return text.slice(0, 160)
        } catch {
          return e.message || '导出失败'
        }
      }
      if (typeof payload?.detail === 'string') return payload.detail
      return e.message || '导出失败'
    }
    if (e instanceof Error) return e.message
    return '导出失败'
  }, [])

  const handleExportEpisode = useCallback(async (mode: 'assets' | 'video') => {
    if (!store.currentEpisodeId) return
    if (exportHideTimerRef.current) {
      window.clearTimeout(exportHideTimerRef.current)
      exportHideTimerRef.current = null
    }
    setExporting(true)
    setExportProgress({
      title: mode === 'video' ? '导出本集合并视频' : '导出本集素材',
      phase: 'packing',
      loaded: 0,
    })
    try {
      const { blob, filename } = await studioExportEpisode(store.currentEpisodeId, {
        mode,
        onProgress: (progress) => {
          setExportProgress((prev) => prev ? {
            ...prev,
            phase: 'downloading',
            loaded: progress.loaded,
            total: progress.total,
            percent: progress.percent,
          } : prev)
        },
      })
      setExportProgress((prev) => prev ? { ...prev, phase: 'saving', percent: 100 } : prev)
      saveBlob(blob, filename)
      setExportProgress((prev) => prev ? { ...prev, phase: 'done', percent: 100 } : prev)
      scheduleHideExportProgress(2200)
      pushToast({ message: mode === 'video' ? '本集视频导出已开始下载' : '本集素材导出已开始下载' })
    } catch (e) {
      const message = await parseExportError(e)
      setExportProgress((prev) => ({
        title: prev?.title || (mode === 'video' ? '导出本集合并视频' : '导出本集素材'),
        phase: 'error',
        loaded: prev?.loaded || 0,
        total: prev?.total,
        percent: prev?.percent,
        error: message,
      }))
      scheduleHideExportProgress(5200)
      pushToast({ message: `导出失败：${message}`, code: 'studio_export_error' })
    } finally {
      setExporting(false)
    }
  }, [parseExportError, pushToast, saveBlob, scheduleHideExportProgress, store.currentEpisodeId])

  const handleExportSeries = useCallback(async (mode: 'assets' | 'video') => {
    if (!store.currentSeriesId) return
    if (exportHideTimerRef.current) {
      window.clearTimeout(exportHideTimerRef.current)
      exportHideTimerRef.current = null
    }
    setExporting(true)
    setExportProgress({
      title: mode === 'video' ? '导出全系列合并视频' : '导出全系列素材',
      phase: 'packing',
      loaded: 0,
    })
    try {
      const { blob, filename } = await studioExportSeries(store.currentSeriesId, {
        mode,
        onProgress: (progress) => {
          setExportProgress((prev) => prev ? {
            ...prev,
            phase: 'downloading',
            loaded: progress.loaded,
            total: progress.total,
            percent: progress.percent,
          } : prev)
        },
      })
      setExportProgress((prev) => prev ? { ...prev, phase: 'saving', percent: 100 } : prev)
      saveBlob(blob, filename)
      setExportProgress((prev) => prev ? { ...prev, phase: 'done', percent: 100 } : prev)
      scheduleHideExportProgress(2200)
      pushToast({ message: mode === 'video' ? '全系列视频导出已开始下载' : '全系列素材导出已开始下载' })
    } catch (e) {
      const message = await parseExportError(e)
      setExportProgress((prev) => ({
        title: prev?.title || (mode === 'video' ? '导出全系列合并视频' : '导出全系列素材'),
        phase: 'error',
        loaded: prev?.loaded || 0,
        total: prev?.total,
        percent: prev?.percent,
        error: message,
      }))
      scheduleHideExportProgress(5200)
      pushToast({ message: `导出失败：${message}`, code: 'studio_export_error' })
    } finally {
      setExporting(false)
    }
  }, [parseExportError, pushToast, saveBlob, scheduleHideExportProgress, store.currentSeriesId])

  const loadAgentProjectOptions = useCallback(async () => {
    setAgentProjectsLoading(true)
    try {
      const projects = await listAgentProjects(50)
      const normalized: AgentProjectOption[] = projects.map((project) => ({
        id: project.id,
        name: project.name || project.id,
        updated_at: project.updated_at,
        creative_brief: project.creative_brief || {},
        elements_count: (project as unknown as { elements_count?: number }).elements_count,
        segments_count: (project as unknown as { segments_count?: number }).segments_count,
      }))
      setAgentProjectOptions(normalized)
      setSelectedAgentProjectId((prev) => {
        if (prev && normalized.some((item) => item.id === prev)) return prev
        return normalized[0]?.id || ''
      })
      setAgentExportOptions((prev) => {
        if (prev.selectedProjectId && normalized.some((item) => item.id === prev.selectedProjectId)) {
          return prev
        }
        return {
          ...prev,
          selectedProjectId: normalized[0]?.id || '',
        }
      })
    } catch (e) {
      const message = await parseExportError(e)
      setAgentProjectOptions([])
      setSelectedAgentProjectId('')
      setAgentExportOptions((prev) => ({
        ...prev,
        selectedProjectId: '',
      }))
      pushToast({ message: `获取 Agent 项目列表失败：${message}`, code: 'studio_agent_list_error' })
    } finally {
      setAgentProjectsLoading(false)
    }
  }, [parseExportError, pushToast])

  const handleExportToAgent = useCallback(async () => {
    if (!store.currentEpisodeId) return
    setShowAgentImportDialog(false)
    setAgentExportOptions((prev) => ({
      ...createDefaultAgentExportOptions(),
      selectedProjectId: prev.selectedProjectId,
    }))
    setShowAgentExportDialog(true)
    await loadAgentProjectOptions()
  }, [loadAgentProjectOptions, store.currentEpisodeId])

  const handleConfirmExportToAgent = useCallback(async () => {
    if (!store.currentEpisodeId) return
    if (agentExportOptions.mode === 'existing' && !agentExportOptions.selectedProjectId) {
      pushToast({ message: '请先选择要覆盖的 Agent 项目', code: 'studio_export_agent_missing_project' })
      return
    }

    const payload: {
      project_id?: string
      project_name?: string
      include_shared_elements: boolean
      include_episode_elements: boolean
      preserve_existing_messages: boolean
    } = {
      include_shared_elements: agentExportOptions.includeSharedElements,
      include_episode_elements: agentExportOptions.includeEpisodeElements,
      preserve_existing_messages: agentExportOptions.mode === 'existing'
        ? agentExportOptions.preserveExistingMessages
        : false,
    }
    if (agentExportOptions.mode === 'existing') {
      payload.project_id = agentExportOptions.selectedProjectId
    } else {
      const nextName = agentExportOptions.projectName.trim()
      if (nextName) payload.project_name = nextName
    }

    setBridgingAgent(true)
    try {
      const result = await studioExportEpisodeToAgent(store.currentEpisodeId, payload)
      setShowAgentExportDialog(false)
      pushToast({
        message: `${result.created ? '已新建并导出' : '已更新并导出'} Agent 项目：${result.project_name}（${result.shots_count} 镜头）`,
      })

      const shouldOpen = window.confirm(
        `导出完成：${result.project_name}\n项目ID：${result.project_id}\n\n是否立即前往 Agent 继续精修？`,
      )
      if (shouldOpen) {
        navigate(`/agent/${result.project_id}`)
      }
    } catch (e) {
      const message = await parseExportError(e)
      pushToast({ message: `导出到 Agent 失败：${message}`, code: 'studio_export_agent_error' })
    } finally {
      setBridgingAgent(false)
    }
  }, [agentExportOptions, navigate, parseExportError, pushToast, store.currentEpisodeId])

  const handleImportFromAgent = useCallback(async () => {
    if (!store.currentEpisodeId) return
    setShowAgentExportDialog(false)
    setShowAgentImportDialog(true)
    await loadAgentProjectOptions()
  }, [loadAgentProjectOptions, store.currentEpisodeId])

  const handleConfirmImportFromAgent = useCallback(async () => {
    if (!store.currentEpisodeId || !selectedAgentProjectId) return
    setBridgingAgent(true)
    try {
      const result = await studioImportEpisodeFromAgent(store.currentEpisodeId, {
        project_id: selectedAgentProjectId,
        overwrite_episode_meta: true,
        import_elements: true,
      })

      await store.selectEpisode(store.currentEpisodeId)
      await store.loadEpisodeHistory(store.currentEpisodeId, 80, true)
      setShowAgentImportDialog(false)

      pushToast({
        message: `已从 Agent 导入：镜头 ${result.shots_imported} 条，元素 ${result.elements_imported} 个`,
      })
    } catch (e) {
      const message = await parseExportError(e)
      pushToast({ message: `从 Agent 导入失败：${message}`, code: 'studio_import_agent_error' })
    } finally {
      setBridgingAgent(false)
    }
  }, [parseExportError, pushToast, selectedAgentProjectId, store])

  useEffect(() => {
    const handleViewportResize = () => {
      setCompactLayout(window.innerWidth < 1100)
    }
    window.addEventListener('resize', handleViewportResize)
    return () => window.removeEventListener('resize', handleViewportResize)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(LAYOUT_SIDEBAR_WIDTH_KEY, String(Math.round(sidebarWidth)))
    } catch {
      // ignore layout persistence errors
    }
  }, [sidebarWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(LAYOUT_SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
    } catch {
      // ignore layout persistence errors
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      const dragging = sidebarResizeRef.current
      if (!dragging) return
      const delta = event.clientX - dragging.startX
      const next = Math.min(420, Math.max(220, dragging.startWidth + delta))
      setSidebarWidth(next)
    }

    const handlePointerUp = () => {
      sidebarResizeRef.current = null
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
      handlePointerUp()
    }
  }, [])

  const startSidebarResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (actualSidebarCollapsed) return
    event.preventDefault()
    sidebarResizeRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      {/* 顶部工具栏 */}
      <header className="flex items-center justify-between h-12 px-4 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            返回首页
          </button>
          <span className="text-gray-600">|</span>
          <h1 className="text-sm font-semibold flex items-center gap-2">
            <Film className="w-4 h-4 text-purple-400" />
            长篇制作工作台
            {store.currentSeries && (
              <>
                <span className="text-gray-600">·</span>
                <span className="text-purple-300">{store.currentSeries.name}</span>
              </>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRecoveryCenter((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors ${
              unresolvedFailedOps.length > 0
                ? 'border-red-700/70 bg-red-900/30 text-red-100 hover:bg-red-900/45'
                : 'border-gray-700 bg-gray-800/70 text-gray-300 hover:bg-gray-800'
            }`}
            title="恢复中心"
          >
            {retryingFailedOpsCount > 0 ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertCircle className="w-3.5 h-3.5" />}
            <span>恢复</span>
            {(unresolvedFailedOps.length > 0 || store.retryHistory.length > 0) && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-gray-900/80 text-gray-200">
                {unresolvedFailedOps.length}/{store.retryHistory.length}
              </span>
            )}
          </button>
          {store.currentSeries && (
            <button
              onClick={() => setShowCharacterConsole(true)}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-gray-700 bg-gray-800/70 text-gray-300 hover:bg-gray-800 hover:text-white text-xs transition-colors"
              title="角色设计控制台"
            >
              <Users className="w-3.5 h-3.5" />
              角色台
            </button>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
            title="设置"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      {showRecoveryCenter && (
        <RecoveryCenterPanel
          failedOperations={store.failedOperations}
          retryHistory={store.retryHistory}
          onRetry={handleRetryFailedOperation}
          onDismiss={handleDismissFailedOperation}
          onClearResolved={handleClearResolvedFailedOperations}
          onClearHistory={handleClearRetryHistory}
          onClose={() => setShowRecoveryCenter(false)}
        />
      )}

      {networkIssue && (
        <div className="px-4 py-2 border-b border-amber-800/40 bg-amber-950/25 text-amber-100 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">网络连接不稳定，部分数据可能未刷新</p>
            <p className="text-[11px] text-amber-200/80 truncate">{networkIssue}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleRetryNetworkIssue}
              disabled={retryingNetwork}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] bg-amber-700/60 hover:bg-amber-600/70 text-white disabled:opacity-50 transition-colors"
            >
              {retryingNetwork ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              重试
            </button>
            <button
              onClick={() => setNetworkIssue(null)}
              className="inline-flex items-center justify-center rounded p-1 text-amber-200 hover:text-white hover:bg-amber-700/30 transition-colors"
              title="关闭提示"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧导航面板 */}
        <aside
          className="bg-gray-900 border-r border-gray-800 flex flex-col shrink-0 transition-[width] duration-200 ease-out"
          style={{ width: actualSidebarWidth }}
        >
          {actualSidebarCollapsed ? (
            <>
              <div className="p-2 border-b border-gray-800 flex flex-col items-center gap-2">
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="w-9 h-9 rounded-lg bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center transition-colors"
                  title="新建系列"
                >
                  <Plus className="w-4 h-4" />
                </button>
                {!compactLayout && (
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className="w-8 h-8 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center transition-colors"
                    title="展开侧边栏"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                {store.seriesList.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleSelectSeries(s.id)}
                    title={s.name}
                    className={`w-full h-9 rounded text-xs font-semibold flex items-center justify-center transition-colors ${
                      s.id === store.currentSeriesId
                        ? 'bg-purple-900/50 text-purple-100'
                        : 'bg-gray-800/60 text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                    }`}
                  >
                    {(s.name || 'S').slice(0, 1)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="p-3 border-b border-gray-800 flex items-center gap-2">
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  新建系列
                </button>
                {!compactLayout && (
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="w-8 h-8 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center transition-colors"
                    title="折叠侧边栏"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* 系列列表 */}
              <div className="flex-1 overflow-y-auto p-2">
                {store.seriesList.map((s) => (
                  <SeriesTreeItem
                    key={s.id}
                    series={s}
                    isSelected={s.id === store.currentSeriesId}
                    selectedEpisodeId={store.currentEpisodeId}
                    episodes={s.id === store.currentSeriesId ? store.episodes : []}
                    onSelectSeries={handleSelectSeries}
                    onSelectEpisode={handleSelectEpisode}
                  />
                ))}
                {store.seriesList.length === 0 && !store.loading && (
                  <p className="text-xs text-gray-500 text-center py-8">暂无系列，点击上方创建</p>
                )}
              </div>

              {/* 共享元素库快捷入口 */}
              {store.currentSeries && (
                <div className="p-2 border-t border-gray-800">
                  <p className="text-xs text-gray-500 mb-1 px-2">共享元素</p>
                  <div className="space-y-0.5 max-h-32 overflow-y-auto">
                    {store.sharedElements.slice(0, 8).map((el) => (
                      <div
                        key={el.id}
                        className="flex items-center gap-2 px-2 py-1 rounded text-xs text-gray-400 hover:bg-gray-800"
                        title={el.description}
                      >
                        {el.type === 'character' ? (
                          <Users className="w-3 h-3 text-blue-400 shrink-0" />
                        ) : el.type === 'scene' ? (
                          <MapPin className="w-3 h-3 text-green-400 shrink-0" />
                        ) : (
                          <Package className="w-3 h-3 text-yellow-400 shrink-0" />
                        )}
                        <span className="truncate">{el.name}</span>
                      </div>
                    ))}
                    {store.sharedElements.length > 8 && (
                      <p className="text-xs text-gray-600 text-center">+{store.sharedElements.length - 8} 更多</p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </aside>

        {!actualSidebarCollapsed && (
          <div
            onMouseDown={startSidebarResize}
            className="w-1 shrink-0 cursor-col-resize bg-gray-800/80 hover:bg-purple-600/70 transition-colors"
            title="拖拽调整侧边栏宽度"
          />
        )}

        {/* 主工作区 */}
        <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {store.loading && (
            <StudioLoadingSkeleton />
          )}

          {!store.loading && !store.currentSeries && (
            <WelcomeView onCreateClick={() => setShowCreateDialog(true)} />
          )}

          {!store.loading && store.currentSeries && !store.currentEpisode && (
            <SeriesOverview
              series={store.currentSeries}
              episodes={store.episodes}
              elements={store.sharedElements}
              onSelectEpisode={handleSelectEpisode}
              onPlanEpisode={handlePlanEpisode}
              onDeleteSeries={() => {
                if (store.currentSeriesId) {
                  store.deleteSeries(store.currentSeriesId)
                  navigate('/studio')
                }
              }}
              onUpdateSeries={async (updates) => {
                if (!store.currentSeriesId) return
                await store.updateSeries(store.currentSeriesId, updates)
              }}
              onAddElement={async (payload) => {
                if (!store.currentSeriesId) return
                await store.addElement(store.currentSeriesId, payload)
              }}
              onUpdateElement={(elementId, updates) => store.updateElement(elementId, updates)}
              onDeleteElement={(elementId) => store.deleteElement(elementId)}
              onGenerateElementImage={async (elementId, options) => {
                const ok = await ensureConfigReady(['image'])
                if (!ok) return
                await store.generateElementImage(elementId, options)
              }}
              onBatchGenerateElementImages={handleBatchGenerateElementsForSeries}
              onExportAssets={() => handleExportSeries('assets')}
              onExportVideo={() => handleExportSeries('video')}
              exporting={exporting}
              planning={store.planning}
              generating={store.generating}
              generationScope={store.generationScope}
            />
          )}

          {!store.loading && store.currentEpisode && (
            <EpisodeWorkbench
              episode={store.currentEpisode}
              shots={store.shots}
              elements={store.sharedElements}
              episodeElements={store.currentEpisode.episode_elements || []}
              onBack={handleBackToSeries}
              onPlan={async () => {
                if (!store.currentEpisodeId) return
                await handlePlanEpisode(store.currentEpisodeId)
              }}
              onEnhance={async (mode) => {
                if (!store.currentEpisodeId) return
                await handleEnhanceEpisode(store.currentEpisodeId, mode)
              }}
              onGenerateAsset={handleGenerateShotAsset}
              onInpaintShot={handleInpaintShot}
              onUpdateShot={(shotId, updates) => store.updateShot(shotId, updates)}
              onReorderShots={(shotIds) => {
                if (!store.currentEpisodeId) return Promise.resolve()
                return store.reorderShots(store.currentEpisodeId, shotIds)
              }}
              onUpdateEpisode={async (updates) => {
                if (!store.currentEpisodeId) return
                await store.updateEpisode(store.currentEpisodeId, updates)
              }}
              onBatchGenerate={async (stages) => {
                if (!store.currentEpisodeId) return
                await handleBatchGenerate(store.currentEpisodeId, stages)
              }}
              historyEntries={store.episodeHistory}
              historyLoading={store.historyLoading}
              historyRestoring={store.historyRestoring}
              onLoadHistory={async (limit, includeSnapshot) => {
                if (!store.currentEpisodeId) return
                await store.loadEpisodeHistory(store.currentEpisodeId, limit, includeSnapshot)
              }}
              onRestoreHistory={async (historyId) => {
                if (!store.currentEpisodeId) return
                await store.restoreEpisodeHistory(store.currentEpisodeId, historyId)
              }}
              onExportAssets={() => handleExportEpisode('assets')}
              onExportVideo={() => handleExportEpisode('video')}
              onExportToAgent={handleExportToAgent}
              onImportFromAgent={handleImportFromAgent}
              onUpdateElement={(elementId, updates) => store.updateElement(elementId, updates)}
              onDeleteElement={(elementId) => store.deleteElement(elementId)}
              onGenerateElementImage={async (elementId, options) => {
                const ok = await ensureConfigReady(['image'])
                if (!ok) return
                await store.generateElementImage(elementId, options)
              }}
              onBatchGenerateElementImages={async () => {
                if (!store.currentEpisodeId) return
                await handleBatchGenerate(store.currentEpisodeId, ['elements'])
              }}
              exporting={exporting}
              bridgingAgent={bridgingAgent}
              planning={store.planning}
              generating={store.generating}
              generationScope={store.generationScope}
            />
          )}
        </main>
      </div>

      {/* 底部状态栏 */}
      <footer className="h-7 px-4 flex items-center justify-between text-xs text-gray-500 bg-gray-900 border-t border-gray-800 shrink-0">
        <div className="flex items-center gap-4">
          {store.currentSeries && (
            <>
              <span>系列: {store.currentSeries.name}</span>
              <span>集数: {store.episodes.length}</span>
              <span>元素: {store.sharedElements.length}</span>
            </>
          )}
          {store.currentEpisode && (
            <>
              <span className="text-gray-600">|</span>
              <span>第{store.currentEpisode.act_number}集</span>
              <span>镜头: {store.shots.length}</span>
              <span>
                时长: {store.shots.reduce((sum, s) => sum + (s.duration || 0), 0).toFixed(0)}s
              </span>
            </>
          )}
        </div>
        <div>
          {store.creating && <span className="text-purple-400">创建中...</span>}
          {store.planning && <span className="text-purple-400">规划中...</span>}
          {store.generating && store.generationScope === 'batch' && store.generationProgress.totalItems > 0 && store.generationProgress.stage !== 'idle' && (
            <span className="text-purple-400">
              {getGenerationStageText(store.generationProgress.stage)} {Math.max(0, Math.min(100, store.generationProgress.percent)).toFixed(0)}% ({Math.min(store.generationProgress.currentIndex, store.generationProgress.totalItems)}/{store.generationProgress.totalItems})
            </span>
          )}
          {store.generating && store.generationScope === 'batch' && (store.generationProgress.totalItems <= 0 || store.generationProgress.stage === 'idle') && (
            <span className="text-purple-400">批量生成中...</span>
          )}
          {store.generating && store.generationScope === 'single' && (
            <span className="text-purple-400">{store.generationMessage || '处理中...'}</span>
          )}
        </div>
      </footer>

      {toasts.length > 0 && (
        <ToastStack
          toasts={toasts}
          onClose={removeToast}
        />
      )}

      <StudioDynamicIsland indicator={activityIndicator} />

      {/* 创建对话框 */}
      {showCreateDialog && (
        <CreateSeriesDialog
          onClose={() => setShowCreateDialog(false)}
          onSubmit={async (params) => {
            const s = await handleCreateSeries(params)
            if (s) {
              setShowCreateDialog(false)
              navigate(`/studio/${s.id}`)
            }
          }}
          creating={store.creating}
        />
      )}

      {showAgentImportDialog && (
        <AgentProjectImportDialog
          projects={agentProjectOptions}
          loading={agentProjectsLoading}
          importing={bridgingAgent}
          selectedProjectId={selectedAgentProjectId}
          onSelectProject={setSelectedAgentProjectId}
          onRefresh={loadAgentProjectOptions}
          onClose={() => setShowAgentImportDialog(false)}
          onConfirm={handleConfirmImportFromAgent}
        />
      )}

      {showAgentExportDialog && (
        <AgentProjectExportDialog
          projects={agentProjectOptions}
          loading={agentProjectsLoading}
          exporting={bridgingAgent}
          options={agentExportOptions}
          onChangeOptions={(patch) => {
            setAgentExportOptions((prev) => ({ ...prev, ...patch }))
          }}
          onRefresh={loadAgentProjectOptions}
          onClose={() => setShowAgentExportDialog(false)}
          onConfirm={handleConfirmExportToAgent}
        />
      )}

      {showCharacterConsole && store.currentSeries && (
        <CharacterDesignConsoleDialog
          series={store.currentSeries}
          elements={store.sharedElements}
          busy={store.generating || store.planning}
          onImportDocument={handleImportCharacterDocument}
          onSplitCharacterByAge={handleSplitCharacterByAge}
          onClose={() => setShowCharacterConsole(false)}
        />
      )}

      {/* 设置面板 */}
      {showSettings && (
        <StudioSettingsPanel onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}

// ============================================================
// 系列树节点
// ============================================================

function SeriesTreeItem({
  series,
  isSelected,
  selectedEpisodeId,
  episodes,
  onSelectSeries,
  onSelectEpisode,
}: {
  series: StudioSeries
  isSelected: boolean
  selectedEpisodeId: string | null
  episodes: StudioEpisode[]
  onSelectSeries: (id: string) => void
  onSelectEpisode: (id: string) => void
}) {
  return (
    <div className="mb-1">
      <div className="group relative">
        <button
          onClick={() => onSelectSeries(series.id)}
          className={`w-full text-left px-3 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
            isSelected ? 'bg-purple-900/40 text-purple-200' : 'hover:bg-gray-800 text-gray-300'
          }`}
        >
          <Film className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{series.name}</span>
          {series.episode_count !== undefined && (
            <span className="ml-auto text-xs text-gray-500">{series.episode_count}集</span>
          )}
        </button>
        <HoverOverviewPanel maxWidthClass="max-w-xl">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-gray-100 font-semibold line-clamp-1">{series.name}</p>
                <p className="text-xs text-gray-500">系列概览</p>
              </div>
              <div className="text-xs text-gray-400">{series.episode_count || episodes.length} 集</div>
            </div>
            <p className="text-sm text-gray-200 leading-relaxed line-clamp-5">
              {series.description || '暂无系列描述'}
            </p>
            <div className="text-xs text-gray-500 flex items-center justify-between">
              <span>视觉风格: {series.visual_style || '未设置'}</span>
              <span>{series.element_count || 0} 个共享元素</span>
            </div>
          </div>
        </HoverOverviewPanel>
      </div>

      {isSelected && episodes.length > 0 && (
        <div className="ml-4 mt-0.5 space-y-0.5">
          {episodes.map((ep) => (
            <div key={ep.id} className="group relative">
              <button
                onClick={() => onSelectEpisode(ep.id)}
                className={`w-full text-left px-3 py-1 rounded text-xs flex items-center gap-2 transition-colors ${
                  ep.id === selectedEpisodeId
                    ? 'bg-purple-900/30 text-purple-200'
                    : 'hover:bg-gray-800 text-gray-400'
                }`}
              >
                <StatusDot status={ep.status} />
                <span className="truncate">第{ep.act_number}幕 {ep.title}</span>
              </button>
              <HoverOverviewPanel maxWidthClass="max-w-xl">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-gray-100 font-semibold line-clamp-2">
                        第{ep.act_number}幕 {ep.title || '未命名分幕'}
                      </p>
                      <p className="text-xs text-gray-500">{series.name}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded ${getEpisodeStatusBadgeClass(ep.status)}`}>
                      {getEpisodeStatusText(ep.status)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-200 leading-relaxed line-clamp-5">
                    {ep.summary || '暂无摘要'}
                  </p>
                  <div className="text-xs text-gray-500 flex items-center justify-between">
                    <span>目标时长 {ep.target_duration_seconds || 0}s</span>
                    <span className="line-clamp-1 max-w-[60%]">{ep.script_excerpt || '无脚本片段'}</span>
                  </div>
                </div>
              </HoverOverviewPanel>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'completed' ? 'bg-green-400' :
    status === 'in_progress' ? 'bg-yellow-400' :
    status === 'planned' ? 'bg-blue-400' :
    'bg-gray-600'
  return <span className={`w-1.5 h-1.5 rounded-full ${color} shrink-0`} />
}

// ============================================================
// 欢迎页
// ============================================================

function WelcomeView({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md">
        <Film className="w-16 h-16 text-purple-500 mx-auto mb-4 opacity-50" />
        <h2 className="text-xl font-semibold text-gray-200 mb-2">长篇制作工作台</h2>
        <p className="text-sm text-gray-400 mb-6">
          在这里创建系列故事，进行分幕拆解、元素提取、逐集分镜规划和资产生成。
          适合多集、长篇精细化视频制作。
        </p>
        <button
          onClick={onCreateClick}
          className="px-6 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors"
        >
          创建第一个系列
        </button>
      </div>
    </div>
  )
}

// ============================================================
// 系列总览
// ============================================================

function SeriesOverview({
  series,
  episodes,
  elements,
  onSelectEpisode,
  onPlanEpisode,
  onDeleteSeries,
  onUpdateSeries,
  onAddElement,
  onUpdateElement,
  onDeleteElement,
  onGenerateElementImage,
  onBatchGenerateElementImages,
  onExportAssets,
  onExportVideo,
  exporting,
  planning,
  generating,
  generationScope,
}: {
  series: StudioSeries
  episodes: StudioEpisode[]
  elements: StudioElement[]
  onSelectEpisode: (id: string) => void
  onPlanEpisode: (id: string) => void | Promise<void>
  onDeleteSeries: () => void
  onUpdateSeries: (updates: Record<string, unknown>) => void | Promise<void>
  onAddElement: (element: { name: string; type: string; description?: string; voice_profile?: string; is_favorite?: number }) => void | Promise<void>
  onUpdateElement: (elementId: string, updates: Record<string, unknown>) => void | Promise<void>
  onDeleteElement: (elementId: string) => void | Promise<void>
  onGenerateElementImage: (
    elementId: string,
    options?: { useReference?: boolean; referenceMode?: 'none' | 'light' | 'full' }
  ) => void | Promise<void>
  onBatchGenerateElementImages?: () => void | Promise<void>
  onExportAssets: () => void | Promise<void>
  onExportVideo: () => void | Promise<void>
  exporting: boolean
  planning: boolean
  generating: boolean
  generationScope: StudioGenerationScope
}) {
  const [stats, setStats] = useState<StudioSeriesStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [elementTypeFilter, setElementTypeFilter] = useState<'all' | 'character' | 'scene' | 'object'>('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [editingBible, setEditingBible] = useState(false)
  const [bibleDraft, setBibleDraft] = useState(series.series_bible || '')
  const [showScriptPreview, setShowScriptPreview] = useState(false)
  const [showElementLibrary, setShowElementLibrary] = useState(false)
  const [showElementDialog, setShowElementDialog] = useState(false)
  const [editingElement, setEditingElement] = useState<StudioElement | null>(null)
  const [historyElement, setHistoryElement] = useState<StudioElement | null>(null)
  const [characterRefModeMap, setCharacterRefModeMap] = useState<Record<string, 'none' | 'light' | 'full'>>({})

  useEffect(() => {
    setBibleDraft(series.series_bible || '')
  }, [series.id, series.series_bible])

  useEffect(() => {
    setStatsLoading(true)
    studioGetSeriesStats(series.id)
      .then((data) => setStats(data))
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false))
  }, [series.id, episodes.length, elements.length, planning, generating])

  const filteredElements = elements.filter((el) => {
    if (elementTypeFilter !== 'all' && el.type !== elementTypeFilter) return false
    if (favoriteOnly && el.is_favorite !== 1) return false
    return true
  })

  const saveBible = () => {
    onUpdateSeries({ series_bible: bibleDraft })
    setEditingBible(false)
  }

  const getCharacterRefMode = (element: StudioElement): 'none' | 'light' | 'full' => {
    if (element.type !== 'character') return 'none'
    return characterRefModeMap[element.id] || 'light'
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* 系列信息 */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">{series.name}</h2>
            {series.description && <p className="text-sm text-gray-400 mt-1">{series.description}</p>}
            {series.visual_style && (
              <p className="text-xs text-gray-500 mt-1">视觉风格: {series.visual_style}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onExportAssets()}
              disabled={exporting}
              className="px-2.5 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-200 disabled:opacity-50"
            >
              {exporting ? '导出中...' : '导出素材'}
            </button>
            <button
              onClick={() => onExportVideo()}
              disabled={exporting}
              className="px-2.5 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-200 disabled:opacity-50"
            >
              导出合并视频
            </button>
            <button
              onClick={onDeleteSeries}
              className="p-2 rounded hover:bg-red-900/30 text-gray-500 hover:text-red-400 transition-colors"
              title="删除系列"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 项目统计 */}
        <section className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">项目统计</h3>
          {statsLoading && (
            <div className="text-xs text-gray-500">统计加载中...</div>
          )}
          {!statsLoading && stats && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="rounded bg-gray-800 px-3 py-2">
                  <p className="text-gray-500">集数</p>
                  <p className="text-gray-200">{stats.episodes.total}</p>
                </div>
                <div className="rounded bg-gray-800 px-3 py-2">
                  <p className="text-gray-500">镜头</p>
                  <p className="text-gray-200">{stats.shots.total}</p>
                </div>
                <div className="rounded bg-gray-800 px-3 py-2">
                  <p className="text-gray-500">预计总时长</p>
                  <p className="text-gray-200">{stats.shots.total_duration_seconds.toFixed(0)}s</p>
                </div>
                <div className="rounded bg-gray-800 px-3 py-2">
                  <p className="text-gray-500">存储占用</p>
                  <p className="text-gray-200">{formatStorage(stats.storage.bytes)}</p>
                </div>
              </div>
              <div className="text-xs text-gray-400 flex flex-wrap items-center gap-3">
                <span>帧 {stats.shots.frames}/{stats.shots.total}</span>
                <span>视频 {stats.shots.videos}/{stats.shots.total}</span>
                <span>音频 {stats.shots.audio}/{stats.shots.total}</span>
                <span>角色 {stats.elements.by_type.character || 0}</span>
                <span>场景 {stats.elements.by_type.scene || 0}</span>
                <span>道具 {stats.elements.by_type.object || 0}</span>
              </div>
            </div>
          )}
        </section>

        {/* 分集卡片 */}
        <section>
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4" />
            分集列表（{episodes.length} 集）
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {episodes.map((ep) => (
              <div
                key={ep.id}
                className="group relative p-4 rounded-lg bg-gray-900 border border-gray-800 hover:border-purple-700 cursor-pointer transition-colors"
                onClick={() => onSelectEpisode(ep.id)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <StatusDot status={ep.status} />
                    <span className="text-sm font-medium text-gray-200">
                      第{ep.act_number}幕 {ep.title}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">
                    <Clock className="w-3 h-3 inline mr-0.5" />
                    {ep.target_duration_seconds}s
                  </span>
                </div>
                <p className="text-xs text-gray-400 line-clamp-2 mb-3">{ep.summary || '暂无摘要'}</p>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${getEpisodeStatusBadgeClass(ep.status)}`}>
                    {getEpisodeStatusText(ep.status)}
                  </span>
                  {ep.status === 'draft' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onPlanEpisode(ep.id)
                      }}
                      disabled={planning}
                      className="text-xs px-2 py-0.5 rounded bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 transition-colors"
                    >
                      {planning ? '规划中...' : '生成规划'}
                    </button>
                  )}
                </div>

                <HoverOverviewPanel maxWidthClass="max-w-2xl">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-base text-gray-100 font-semibold line-clamp-2">
                          第{ep.act_number}幕 {ep.title || '未命名分幕'}
                        </p>
                        <p className="text-xs text-gray-500">{series.name}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${getEpisodeStatusBadgeClass(ep.status)}`}>
                        {getEpisodeStatusText(ep.status)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-200 leading-relaxed line-clamp-6">
                      {ep.summary || '暂无摘要'}
                    </p>
                    <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-2.5">
                      <p className="text-xs text-gray-500 mb-1">脚本片段</p>
                      <p className="text-xs text-gray-300 leading-relaxed line-clamp-4">
                        {ep.script_excerpt || '暂无脚本片段'}
                      </p>
                    </div>
                    <div className="text-xs text-gray-500 flex items-center justify-between">
                      <span>目标时长 {ep.target_duration_seconds || 0}s</span>
                      <span>状态: {ep.status}</span>
                    </div>
                  </div>
                </HoverOverviewPanel>
              </div>
            ))}
          </div>
        </section>

        {/* 共享元素库 */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Users className="w-4 h-4" />
              共享元素库（{filteredElements.length}/{elements.length}）
            </h3>
            <div className="flex items-center gap-1.5">
              {(['all', 'character', 'scene', 'object'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setElementTypeFilter(type)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    elementTypeFilter === type ? 'bg-purple-700/60 text-purple-100' : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  {type === 'all' ? '全部' : type === 'character' ? '角色' : type === 'scene' ? '场景' : '道具'}
                </button>
              ))}
              <button
                onClick={() => setFavoriteOnly((prev) => !prev)}
                className={`px-2 py-1 rounded text-xs transition-colors flex items-center gap-1 ${
                  favoriteOnly ? 'bg-yellow-700/50 text-yellow-200' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                <Star className="w-3 h-3" />
                收藏
              </button>
              <button
                onClick={() => setShowElementLibrary(true)}
                className="px-2 py-1 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-300"
              >
                素材库视图
              </button>
              <button
                onClick={() => {
                  setEditingElement(null)
                  setShowElementDialog(true)
                }}
                className="px-2 py-1 rounded text-xs bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                新增
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredElements.map((el) => (
              <div
                key={el.id}
                className="group relative p-3 rounded-lg bg-gray-900 border border-gray-800"
              >
                <div className="flex items-center gap-2 mb-2">
                  {el.type === 'character' ? (
                    <Users className="w-4 h-4 text-blue-400" />
                  ) : el.type === 'scene' ? (
                    <MapPin className="w-4 h-4 text-green-400" />
                  ) : (
                    <Package className="w-4 h-4 text-yellow-400" />
                  )}
                  <span className="text-sm font-medium text-gray-200">{el.name}</span>
                  <button
                    className={`ml-auto ${el.is_favorite === 1 ? 'text-yellow-300' : 'text-gray-600 hover:text-yellow-300'} transition-colors`}
                    onClick={() => onUpdateElement(el.id, { is_favorite: el.is_favorite === 1 ? 0 : 1 })}
                    title="收藏"
                  >
                    <Star className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setEditingElement(el)
                      setShowElementDialog(true)
                    }}
                    className="text-gray-500 hover:text-white"
                    title="编辑"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`确定删除元素「${el.name}」吗？`)) onDeleteElement(el.id)
                    }}
                    className="text-gray-500 hover:text-red-400"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs text-gray-500">[{el.id}]</span>
                </div>
                <p className="text-xs text-gray-400 line-clamp-3">{el.description}</p>
                {el.voice_profile && (
                  <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                    <Mic className="w-3 h-3" />
                    {el.voice_profile}
                  </p>
                )}
                {el.image_url && (
                  <img
                    src={el.image_url}
                    alt={el.name}
                    className="w-full h-24 object-cover rounded mt-2"
                  />
                )}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {el.type === 'character' && (
                    <select
                      value={getCharacterRefMode(el)}
                      onChange={(e) => {
                        const next = e.target.value as 'none' | 'light' | 'full'
                        setCharacterRefModeMap((prev) => ({ ...prev, [el.id]: next }))
                      }}
                      className="text-[11px] px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300 focus:outline-none focus:border-purple-500"
                      title="角色一致性参考强度"
                      disabled={generating}
                    >
                      <option value="none">一致性: 关</option>
                      <option value="light">一致性: 轻</option>
                      <option value="full">一致性: 强</option>
                    </select>
                  )}
                  <button
                    onClick={() => {
                      const mode = getCharacterRefMode(el)
                      onGenerateElementImage(el.id, {
                        useReference: el.type === 'character' && mode !== 'none',
                        referenceMode: el.type === 'character' ? mode : 'none',
                      })
                    }}
                    disabled={generating}
                    className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-50 flex items-center gap-1 transition-colors"
                    title={el.type === 'character' ? '角色可按一致性档位重做参考图' : undefined}
                  >
                    {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
                    {el.image_url ? (el.type === 'character' ? '一致性重做参考图' : '重做参考图') : '生成参考图'}
                  </button>
                </div>
                {el.image_history && el.image_history.length > 0 && (
                  <button
                    onClick={() => setHistoryElement(el)}
                    className="mt-2 ml-2 text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                  >
                    历史({el.image_history.length})
                  </button>
                )}

                <HoverOverviewPanel maxWidthClass="max-w-4xl">
                  <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
                    <div className="rounded-lg overflow-hidden border border-gray-800 bg-gray-900/70">
                      <div className="aspect-video w-full bg-gray-900/80">
                        {el.image_url ? (
                          <img src={el.image_url} alt={el.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-600">
                            <ImageIcon className="w-10 h-10" />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-base text-gray-100 font-semibold line-clamp-1">{el.name}</p>
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">{el.type}</span>
                      </div>
                      <p className="text-sm text-gray-200 leading-relaxed line-clamp-8">
                        {el.description || '暂无描述'}
                      </p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded border border-gray-800 bg-gray-900/70 px-2 py-1.5 text-gray-400">
                          出现集数: {el.appears_in_episodes?.length || 0}
                        </div>
                        <div className="rounded border border-gray-800 bg-gray-900/70 px-2 py-1.5 text-gray-400">
                          图像版本: {el.image_history?.length || 0}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 line-clamp-1">
                        语音配置: {el.voice_profile || '未配置'}
                      </div>
                    </div>
                  </div>
                </HoverOverviewPanel>
              </div>
            ))}
          </div>
        </section>

        {/* Series Bible */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-300">世界观设定</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowScriptPreview(true)}
                className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center gap-1"
              >
                <Eye className="w-3 h-3" />
                查看完整脚本
              </button>
              {!editingBible ? (
                <button
                  onClick={() => setEditingBible(true)}
                  className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center gap-1"
                >
                  <Pencil className="w-3 h-3" />
                  编辑
                </button>
              ) : (
                <>
                  <button
                    onClick={saveBible}
                    className="text-xs px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => {
                      setBibleDraft(series.series_bible || '')
                      setEditingBible(false)
                    }}
                    className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200"
                  >
                    取消
                  </button>
                </>
              )}
            </div>
          </div>
          {editingBible ? (
            <textarea
              value={bibleDraft}
              onChange={(e) => setBibleDraft(e.target.value)}
              rows={10}
              className="w-full p-3 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-300 focus:outline-none focus:border-purple-500 resize-y"
            />
          ) : (
            <pre className="p-4 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-400 whitespace-pre-wrap max-h-64 overflow-y-auto">
              {series.series_bible || '暂无世界观设定'}
            </pre>
          )}
        </section>
      </div>

      {showElementDialog && (
        <ElementEditDialog
          initial={editingElement}
          onClose={() => {
            setShowElementDialog(false)
            setEditingElement(null)
          }}
          onSubmit={(payload) => {
            if (editingElement) {
              onUpdateElement(editingElement.id, payload)
            } else {
              onAddElement(payload)
            }
            setShowElementDialog(false)
            setEditingElement(null)
          }}
        />
      )}

      {showScriptPreview && (
        <SimpleTextDialog
          title="完整脚本"
          text={series.source_script || '暂无完整脚本'}
          onClose={() => setShowScriptPreview(false)}
        />
      )}

      {historyElement && (
        <ImageHistoryDialog
          title={`${historyElement.name} · 图片历史`}
          current={historyElement.image_url}
          history={historyElement.image_history || []}
          onClose={() => setHistoryElement(null)}
          onApply={(url) => {
            onUpdateElement(historyElement.id, { image_url: url })
            setHistoryElement(null)
          }}
        />
      )}

      {showElementLibrary && (
        <ElementLibraryPanel
          sharedElements={elements}
          episodeElements={[]}
          onUpdateSharedElement={onUpdateElement}
          onDeleteSharedElement={onDeleteElement}
          onGenerateSharedElementImage={onGenerateElementImage}
          onBatchGenerateMissingSharedElements={onBatchGenerateElementImages}
          generating={generating}
          generationScope={generationScope}
          onClose={() => setShowElementLibrary(false)}
        />
      )}
    </div>
  )
}

// ============================================================
// 单集工作台
// ============================================================

function EpisodeWorkbench({
  episode,
  shots,
  elements,
  episodeElements,
  onBack,
  onPlan,
  onEnhance,
  onGenerateAsset,
  onInpaintShot,
  onUpdateShot,
  onReorderShots,
  onUpdateEpisode,
  onBatchGenerate,
  historyEntries,
  historyLoading,
  historyRestoring,
  onLoadHistory,
  onRestoreHistory,
  onExportAssets,
  onExportVideo,
  onExportToAgent,
  onImportFromAgent,
  onUpdateElement,
  onDeleteElement,
  onGenerateElementImage,
  onBatchGenerateElementImages,
  exporting,
  bridgingAgent,
  planning,
  generating,
  generationScope,
}: {
  episode: StudioEpisode
  shots: StudioShot[]
  elements: StudioElement[]
  episodeElements: StudioEpisodeElement[]
  onBack: () => void
  onPlan: () => void | Promise<void>
  onEnhance: (mode: 'refine' | 'expand') => void | Promise<void>
  onGenerateAsset: (shotId: string, stage: 'frame' | 'end_frame' | 'video' | 'audio') => void | Promise<void>
  onInpaintShot: (shotId: string, payload: { editPrompt: string; maskData?: string }) => void | Promise<void>
  onUpdateShot: (shotId: string, updates: Record<string, unknown>) => void | Promise<void>
  onReorderShots: (shotIds: string[]) => void | Promise<void>
  onUpdateEpisode: (updates: Record<string, unknown>) => void | Promise<void>
  onBatchGenerate: (stages?: string[]) => void | Promise<void>
  historyEntries: StudioEpisodeHistoryEntry[]
  historyLoading: boolean
  historyRestoring: boolean
  onLoadHistory: (limit?: number, includeSnapshot?: boolean) => void | Promise<void>
  onRestoreHistory: (historyId: string) => void | Promise<void>
  onExportAssets: () => void | Promise<void>
  onExportVideo: () => void | Promise<void>
  onExportToAgent: () => void | Promise<void>
  onImportFromAgent: () => void | Promise<void>
  onUpdateElement: (elementId: string, updates: Record<string, unknown>) => void | Promise<void>
  onDeleteElement: (elementId: string) => void | Promise<void>
  onGenerateElementImage: (
    elementId: string,
    options?: { useReference?: boolean; referenceMode?: 'none' | 'light' | 'full' }
  ) => void | Promise<void>
  onBatchGenerateElementImages: () => void | Promise<void>
  exporting: boolean
  bridgingAgent: boolean
  planning: boolean
  generating: boolean
  generationScope: StudioGenerationScope
}) {
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [previewShotId, setPreviewShotId] = useState<string | null>(null)
  const [showPreviewPanel, setShowPreviewPanel] = useState(false)
  const [previewPanelRect, setPreviewPanelRect] = useState<PreviewPanelRect>(() => defaultPreviewPanelRect())
  const [showScriptEditor, setShowScriptEditor] = useState(false)
  const [showElementLibrary, setShowElementLibrary] = useState(false)
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [historyLoadedOnce, setHistoryLoadedOnce] = useState(false)
  const [restoringHistoryId, setRestoringHistoryId] = useState<string | null>(null)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [showPromptHealthPanel, setShowPromptHealthPanel] = useState(false)
  const [promptHealthLoading, setPromptHealthLoading] = useState(false)
  const [promptHealthIssues, setPromptHealthIssues] = useState<StudioPromptBatchCheckItem[]>([])
  const [promptHealthScannedAt, setPromptHealthScannedAt] = useState<string | null>(null)
  const [optimizingPromptIssueId, setOptimizingPromptIssueId] = useState<string | null>(null)
  const [narrowWorkbench, setNarrowWorkbench] = useState<boolean>(() => (typeof window !== 'undefined' ? window.innerWidth < 1340 : false))
  const [titleDraft, setTitleDraft] = useState(episode.title || '')
  const [summaryDraft, setSummaryDraft] = useState(episode.summary || '')
  const [scriptDraft, setScriptDraft] = useState(episode.script_excerpt || '')
  const [detailPanelWidth, setDetailPanelWidth] = useState<number>(() => readStoredNumber(LAYOUT_DETAIL_PANEL_WIDTH_KEY, 320, 280, 540))
  const [detailPanelCollapsed, setDetailPanelCollapsed] = useState<boolean>(() => readStoredBoolean(LAYOUT_DETAIL_PANEL_COLLAPSED_KEY, false))
  const previewPanelDragRef = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
    width: number
    height: number
  } | null>(null)
  const detailPanelResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const previewPanelResizeRef = useRef<{
    direction: PreviewPanelResizeDirection
    startX: number
    startY: number
    originRect: PreviewPanelRect
  } | null>(null)
  const selectedShot = shots.find((s) => s.id === selectedShotId)
  const showDetailPanel = Boolean(selectedShot)
  const detailPanelExpanded = showDetailPanel && !detailPanelCollapsed
  const previewPanelWide = previewPanelRect.width >= 980
  const detailPanelFloating = narrowWorkbench && showDetailPanel && detailPanelExpanded
  const shotGridClass = detailPanelExpanded && !detailPanelFloating
    ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-3'
    : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'
  const previewPanelGridClass = previewPanelWide ? 'grid-cols-2' : 'grid-cols-1'
  const previewPanelGridStyle = previewPanelWide
    ? undefined
    : { gridTemplateRows: 'minmax(0, 1.2fr) minmax(0, 1fr)' }
  const previewPlayerPaneClass = previewPanelWide
    ? 'min-h-0 border-r border-gray-800'
    : 'min-h-0 border-b border-gray-800'
  const selectedHistoryEntry = historyEntries.find((entry) => entry.id === selectedHistoryId) || historyEntries[0]
  const selectedHistoryShots = Array.isArray(selectedHistoryEntry?.snapshot?.shots) ? selectedHistoryEntry?.snapshot?.shots || [] : []
  const historyDiff = useMemo(
    () => summarizeShotDiff(shots, selectedHistoryShots),
    [selectedHistoryShots, shots],
  )

  useEffect(() => {
    setTitleDraft(episode.title || '')
    setSummaryDraft(episode.summary || '')
    setScriptDraft(episode.script_excerpt || '')
    setShowHistoryPanel(false)
    setHistoryLoadedOnce(false)
    setRestoringHistoryId(null)
    setShowPromptHealthPanel(false)
    setPromptHealthIssues([])
    setPromptHealthScannedAt(null)
    setOptimizingPromptIssueId(null)
  }, [episode.id, episode.title, episode.summary, episode.script_excerpt])

  useEffect(() => {
    if (!shots.length) {
      setSelectedShotId(null)
      setPreviewShotId(null)
      setShowPreviewPanel(false)
      return
    }
    if (!previewShotId || !shots.some((s) => s.id === previewShotId)) {
      setPreviewShotId(shots[0].id)
    }
    if (selectedShotId && !shots.some((s) => s.id === selectedShotId)) {
      setSelectedShotId(null)
    }
  }, [shots, previewShotId, selectedShotId])

  useEffect(() => {
    const handleViewportResize = () => {
      setPreviewPanelRect((prev) => clampPreviewPanelRect(prev))
      setNarrowWorkbench(window.innerWidth < 1340)
    }
    window.addEventListener('resize', handleViewportResize)
    return () => window.removeEventListener('resize', handleViewportResize)
  }, [])

  useEffect(() => {
    if (narrowWorkbench && detailPanelExpanded) {
      setDetailPanelWidth((prev) => Math.min(prev, 420))
    }
  }, [detailPanelExpanded, narrowWorkbench])

  useEffect(() => {
    if (!showHistoryPanel) return
    if (!historyEntries.length) {
      setSelectedHistoryId(null)
      return
    }
    if (!selectedHistoryId || !historyEntries.some((entry) => entry.id === selectedHistoryId)) {
      setSelectedHistoryId(historyEntries[0].id)
    }
  }, [historyEntries, selectedHistoryId, showHistoryPanel])

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      const dragging = previewPanelDragRef.current
      if (dragging) {
        const dx = event.clientX - dragging.startX
        const dy = event.clientY - dragging.startY
        setPreviewPanelRect(clampPreviewPanelRect({
          x: dragging.originX + dx,
          y: dragging.originY + dy,
          width: dragging.width,
          height: dragging.height,
        }))
        return
      }

      const resizing = previewPanelResizeRef.current
      if (!resizing) return
      const dx = event.clientX - resizing.startX
      const dy = event.clientY - resizing.startY
      const base = resizing.originRect
      const direction = resizing.direction
      const next: PreviewPanelRect = { ...base }

      if (direction.includes('right')) next.width = base.width + dx
      if (direction.includes('left')) {
        next.width = base.width - dx
        next.x = base.x + dx
      }
      if (direction.includes('bottom')) next.height = base.height + dy
      if (direction.includes('top')) {
        next.height = base.height - dy
        next.y = base.y + dy
      }

      setPreviewPanelRect(clampPreviewPanelRect(next))
    }

    const handlePointerUp = () => {
      previewPanelDragRef.current = null
      previewPanelResizeRef.current = null
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
      handlePointerUp()
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(LAYOUT_DETAIL_PANEL_WIDTH_KEY, String(Math.round(detailPanelWidth)))
    } catch {
      // ignore layout persistence errors
    }
  }, [detailPanelWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(LAYOUT_DETAIL_PANEL_COLLAPSED_KEY, detailPanelCollapsed ? '1' : '0')
    } catch {
      // ignore layout persistence errors
    }
  }, [detailPanelCollapsed])

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      const resizing = detailPanelResizeRef.current
      if (!resizing) return
      const delta = event.clientX - resizing.startX
      const next = Math.min(540, Math.max(280, resizing.startWidth - delta))
      setDetailPanelWidth(next)
    }

    const handlePointerUp = () => {
      detailPanelResizeRef.current = null
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
      handlePointerUp()
    }
  }, [])

  const startDetailPanelResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!detailPanelExpanded) return
    event.preventDefault()
    detailPanelResizeRef.current = {
      startX: event.clientX,
      startWidth: detailPanelWidth,
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  const startPreviewPanelDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    previewPanelResizeRef.current = null
    previewPanelDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: previewPanelRect.x,
      originY: previewPanelRect.y,
      width: previewPanelRect.width,
      height: previewPanelRect.height,
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'move'
  }

  const startPreviewPanelResize = (direction: PreviewPanelResizeDirection) => (
    event: ReactMouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault()
    event.stopPropagation()
    previewPanelDragRef.current = null
    previewPanelResizeRef.current = {
      direction,
      startX: event.clientX,
      startY: event.clientY,
      originRect: previewPanelRect,
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = resizeCursorByDirection(direction)
  }

  const toggleHistoryPanel = async () => {
    const next = !showHistoryPanel
    setShowHistoryPanel(next)
    if (next && !historyLoadedOnce) {
      setHistoryLoadedOnce(true)
      await onLoadHistory(80, true)
    }
  }

  const handleRestoreHistory = async (entry: StudioEpisodeHistoryEntry) => {
    const action = formatHistoryAction(entry.action)
    const confirmed = window.confirm(`确认回退到 ${action}（${new Date(entry.created_at).toLocaleString()}）？\n当前未保存的修改将被覆盖。`)
    if (!confirmed) return
    setRestoringHistoryId(entry.id)
    try {
      await onRestoreHistory(entry.id)
    } finally {
      setRestoringHistoryId(null)
    }
  }

  const runPromptHealthScan = useCallback(async () => {
    const items = shots.flatMap((shot, idx) => (
      PROMPT_FIELD_META.map((meta) => {
        const value = String((shot as Record<string, unknown>)[meta.field] || '').trim()
        if (!value) return null
        return {
          id: `${shot.id}::${meta.field}`,
          field: meta.field,
          label: `#${idx + 1} ${shot.name || '未命名镜头'} · ${meta.label}`,
          prompt: value,
        }
      }).filter((item): item is {
        id: string
        field: PromptFieldKey
        label: string
        prompt: string
      } => Boolean(item))
    ))

    setPromptHealthLoading(true)
    try {
      if (items.length === 0) {
        setPromptHealthIssues([])
        setPromptHealthScannedAt(new Date().toISOString())
        return
      }
      const results = await studioPromptBatchCheck(items)
      const risky = results
        .filter((item) => !item.safe && Array.isArray(item.matches) && item.matches.length > 0)
        .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))
      setPromptHealthIssues(risky)
      setPromptHealthScannedAt(new Date().toISOString())
    } finally {
      setPromptHealthLoading(false)
    }
  }, [shots])

  const togglePromptHealthPanel = async () => {
    const next = !showPromptHealthPanel
    setShowPromptHealthPanel(next)
    if (next) {
      await runPromptHealthScan()
    }
  }

  const handleOptimizePromptIssue = useCallback(async (issue: StudioPromptBatchCheckItem) => {
    const issueId = issue.id || ''
    const [shotId, fieldRaw] = issueId.split('::')
    if (!shotId || !fieldRaw || !isPromptFieldKey(fieldRaw)) return

    setOptimizingPromptIssueId(issueId)
    try {
      const optimized = await studioPromptOptimize(issue.prompt || '', { use_llm: true })
      const nextPrompt = (optimized.optimized_prompt || issue.prompt || '').trim()
      if (!nextPrompt) return

      if (optimized.changed) {
        await Promise.resolve(onUpdateShot(shotId, { [fieldRaw]: nextPrompt }))
      }
      await runPromptHealthScan()
    } finally {
      setOptimizingPromptIssueId(null)
    }
  }, [onUpdateShot, runPromptHealthScan])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 集头部 */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-sm text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
          <span className="text-gray-600">|</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">第{episode.act_number}幕</span>
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                if (titleDraft !== episode.title) onUpdateEpisode({ title: titleDraft })
              }}
              className="bg-transparent border-b border-transparent hover:border-gray-700 focus:border-purple-500 text-sm font-semibold text-gray-200 focus:outline-none"
            />
          </div>
          <StatusDot status={episode.status} />
          <span className="text-xs text-gray-500">{episode.status}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowElementLibrary(true)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 transition-colors"
          >
            <Layers className="w-3 h-3" />
            素材库
          </button>
          <button
            onClick={() => setShowScriptEditor((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 transition-colors"
          >
            <FileText className="w-3 h-3" />
            {showScriptEditor ? '收起脚本' : '查看/编辑脚本'}
          </button>
          <button
            onClick={toggleHistoryPanel}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
              showHistoryPanel
                ? 'bg-blue-700/60 text-blue-100'
                : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
            }`}
          >
            <History className="w-3 h-3" />
            {showHistoryPanel ? '关闭历史' : '历史记录'}
          </button>
          <button
            onClick={togglePromptHealthPanel}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
              showPromptHealthPanel
                ? 'bg-amber-700/60 text-amber-100'
                : promptHealthIssues.length > 0
                  ? 'bg-red-900/35 text-red-200 hover:bg-red-900/45'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
            }`}
          >
            {promptHealthLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertCircle className="w-3 h-3" />}
            {showPromptHealthPanel ? '关闭体检' : '提示词体检'}
            {!showPromptHealthPanel && promptHealthIssues.length > 0 && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-black/35">{promptHealthIssues.length}</span>
            )}
          </button>
          {showDetailPanel && (
            <button
              onClick={() => setDetailPanelCollapsed((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 transition-colors"
            >
              {detailPanelCollapsed ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {detailPanelCollapsed ? '展开详情' : '收起详情'}
            </button>
          )}
          <button
            onClick={() => setShowPreviewPanel((v) => !v)}
            disabled={shots.length === 0}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors disabled:opacity-50 ${
              showPreviewPanel
                ? 'bg-purple-700/60 text-purple-100'
                : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
            }`}
          >
            <Play className="w-3 h-3" />
            {showPreviewPanel ? '关闭预览面板' : '预览/时间线'}
          </button>
          <button
            onClick={() => onExportToAgent()}
            disabled={bridgingAgent}
            className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 disabled:opacity-50 transition-colors"
          >
            {bridgingAgent ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
            导出到Agent
          </button>
          <button
            onClick={() => onImportFromAgent()}
            disabled={bridgingAgent}
            className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 disabled:opacity-50 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            导入Agent
          </button>
          <button
            onClick={() => onExportAssets()}
            disabled={exporting}
            className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 disabled:opacity-50 transition-colors"
          >
            {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            导出素材
          </button>
          <button
            onClick={() => onExportVideo()}
            disabled={exporting}
            className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 disabled:opacity-50 transition-colors"
          >
            <Video className="w-3 h-3" />
            导出视频
          </button>
          {shots.length === 0 ? (
            <button
              onClick={onPlan}
              disabled={planning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
            >
              {planning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              生成分镜规划
            </button>
          ) : (
            <>
              <button
                onClick={() => onEnhance('refine')}
                disabled={planning}
                className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                优化
              </button>
              <button
                onClick={() => onEnhance('expand')}
                disabled={planning}
                className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 disabled:opacity-50 transition-colors"
              >
                <Plus className="w-3 h-3" />
                扩展
              </button>
              <button
                onClick={() => onBatchGenerate()}
                disabled={generating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
              >
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                批量生成
              </button>
            </>
          )}
        </div>
      </div>

      {showScriptEditor && (
        <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/40 space-y-2 shrink-0">
          <div>
            <label className="text-xs text-gray-500 block mb-1">集摘要</label>
            <textarea
              value={summaryDraft}
              onChange={(e) => setSummaryDraft(e.target.value)}
              onBlur={() => {
                if (summaryDraft !== episode.summary) onUpdateEpisode({ summary: summaryDraft })
              }}
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-none"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">集脚本（script_excerpt）</label>
            <textarea
              value={scriptDraft}
              onChange={(e) => setScriptDraft(e.target.value)}
              onBlur={() => {
                if (scriptDraft !== episode.script_excerpt) onUpdateEpisode({ script_excerpt: scriptDraft })
              }}
              rows={6}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
            />
          </div>
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 镜头列表 */}
        <div className="flex-1 overflow-y-auto p-4">
          {shots.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              暂无镜头，点击"生成分镜规划"开始
            </div>
          ) : (
            <div className={shotGridClass}>
              {shots.map((shot, idx) => (
                <ShotCard
                  key={shot.id}
                  shot={shot}
                  index={idx}
                  isSelected={shot.id === selectedShotId}
                  onClick={() => {
                    setSelectedShotId(shot.id === selectedShotId ? null : shot.id)
                    setPreviewShotId(shot.id)
                    if (shot.id !== selectedShotId) setDetailPanelCollapsed(false)
                  }}
                  onGenerateFrame={() => onGenerateAsset(shot.id, 'frame')}
                  onGenerateEndFrame={() => onGenerateAsset(shot.id, 'end_frame')}
                  onGenerateVideo={() => onGenerateAsset(shot.id, 'video')}
                  onGenerateAudio={() => onGenerateAsset(shot.id, 'audio')}
                  generating={generating}
                />
              ))}
            </div>
          )}
        </div>

        {/* 右侧详情面板 */}
        {showDetailPanel && detailPanelExpanded && !detailPanelFloating && (
          <div
            onMouseDown={startDetailPanelResize}
            className="w-1 shrink-0 cursor-col-resize bg-gray-800/80 hover:bg-purple-600/70 transition-colors"
            title="拖拽调整详情面板宽度"
          />
        )}
        {showDetailPanel && !detailPanelFloating && (
          detailPanelExpanded ? (
            <div
              className="border-l border-gray-800 overflow-y-auto p-4 bg-gray-900/50 shrink-0 transition-[width] duration-200 ease-out"
              style={{ width: detailPanelWidth }}
            >
              <ShotDetailPanel
                shot={selectedShot!}
                elements={elements}
                onGenerateAsset={(stage) => onGenerateAsset(selectedShot!.id, stage)}
                onInpaint={(payload) => onInpaintShot(selectedShot!.id, payload)}
                onUpdate={(updates) => onUpdateShot(selectedShot!.id, updates)}
                onCollapse={() => setDetailPanelCollapsed(true)}
                onClose={() => setSelectedShotId(null)}
              />
            </div>
          ) : (
            <div className="w-10 border-l border-gray-800 bg-gray-900/50 shrink-0 flex items-center justify-center">
              <button
                onClick={() => setDetailPanelCollapsed(false)}
                className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                title="展开详情面板"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        )}
      </div>

      {showDetailPanel && detailPanelFloating && (
        <div className="fixed z-[66] right-3 top-16 bottom-3 w-[min(440px,95vw)] rounded-xl border border-gray-700 bg-gray-950/95 backdrop-blur shadow-2xl overflow-y-auto p-4">
          <ShotDetailPanel
            shot={selectedShot!}
            elements={elements}
            onGenerateAsset={(stage) => onGenerateAsset(selectedShot!.id, stage)}
            onInpaint={(payload) => onInpaintShot(selectedShot!.id, payload)}
            onUpdate={(updates) => onUpdateShot(selectedShot!.id, updates)}
            onCollapse={() => setDetailPanelCollapsed(true)}
            onClose={() => setSelectedShotId(null)}
          />
        </div>
      )}

      {showPromptHealthPanel && (
        <div className="fixed inset-0 z-[67] bg-black/45 flex items-start justify-center p-4 md:p-8">
          <div className="w-[min(980px,98vw)] max-h-[92vh] rounded-xl border border-gray-700 bg-gray-950/98 backdrop-blur shadow-2xl flex flex-col overflow-hidden">
            <div className="h-12 px-4 border-b border-gray-800 flex items-center justify-between shrink-0">
              <div>
                <p className="text-sm font-semibold text-gray-100">提示词体检</p>
                <p className="text-[11px] text-gray-500">
                  {promptHealthScannedAt
                    ? `最近扫描：${new Date(promptHealthScannedAt).toLocaleTimeString()}`
                    : '扫描起始帧/尾帧/视频提示词风险'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={runPromptHealthScan}
                  className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                  title="重新扫描"
                >
                  {promptHealthLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => setShowPromptHealthPanel(false)}
                  className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                  title="关闭体检面板"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="px-4 py-2 border-b border-gray-800 text-xs text-gray-400">
              风险项 {promptHealthIssues.length} 条 · 镜头总数 {shots.length}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {promptHealthLoading && (
                <div className="h-44 flex items-center justify-center text-xs text-gray-500 gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  正在扫描提示词风险...
                </div>
              )}
              {!promptHealthLoading && promptHealthIssues.length === 0 && (
                <div className="h-44 flex items-center justify-center text-sm text-emerald-300">
                  当前集提示词未发现明显风险
                </div>
              )}
              {!promptHealthLoading && promptHealthIssues.map((issue) => {
                const issueId = issue.id || ''
                const [shotId, issueFieldRaw] = issueId.split('::')
                const issueField = issueFieldRaw && isPromptFieldKey(issueFieldRaw) ? issueFieldRaw : null
                const fieldLabel = issueField
                  ? (PROMPT_FIELD_META.find((item) => item.field === issueField)?.label || issueField)
                  : (issue.field || '提示词')
                const optimizing = optimizingPromptIssueId === issueId
                return (
                  <div key={issueId || `${issue.field}_${issue.label}_${issue.prompt.slice(0, 12)}`} className="rounded-lg border border-red-800/45 bg-red-950/15 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-red-100 line-clamp-1">{issue.label || '未命名提示词'}</p>
                        <p className="text-[11px] text-red-200/80">{fieldLabel} · 风险分 {issue.risk_score || 0}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => {
                            if (!shotId) return
                            setSelectedShotId(shotId)
                            setPreviewShotId(shotId)
                            setDetailPanelCollapsed(false)
                          }}
                          className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors"
                        >
                          定位镜头
                        </button>
                        <button
                          onClick={() => void handleOptimizePromptIssue(issue)}
                          disabled={optimizing}
                          className="text-[11px] px-2 py-1 rounded bg-amber-700/70 hover:bg-amber-600/70 text-white disabled:opacity-50 transition-colors inline-flex items-center gap-1"
                        >
                          {optimizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          优化
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-300 rounded border border-gray-800 bg-gray-950/70 px-2 py-1.5 line-clamp-3">
                      {issue.prompt}
                    </p>
                    <div className="text-[11px] text-red-200/85">
                      命中词：{issue.matches.slice(0, 4).map((item) => item.term).join('、')}
                    </div>
                    {issue.suggestions.length > 0 && (
                      <div className="text-[11px] text-gray-300">
                        建议：{issue.suggestions.slice(0, 3).map((item) => `${item.source}→${item.replacement}`).join('；')}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {showHistoryPanel && (
        <div className="fixed inset-0 z-[68] bg-black/45 flex justify-end">
          <div className="h-full w-[min(980px,98vw)] border-l border-gray-800 bg-gray-950/98 backdrop-blur grid grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)]">
            <div className="min-h-0 border-r border-gray-800 flex flex-col">
              <div className="h-12 px-4 border-b border-gray-800 flex items-center justify-between shrink-0">
                <div>
                  <p className="text-sm font-semibold text-gray-100">历史记录</p>
                  <p className="text-[11px] text-gray-500">按时间倒序 · 点击可查看差异</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onLoadHistory(80, true)}
                    className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                    title="刷新历史"
                  >
                    {historyLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => setShowHistoryPanel(false)}
                    className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                    title="关闭历史面板"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {historyLoading && historyEntries.length === 0 && (
                  <div className="h-full flex items-center justify-center text-xs text-gray-500 gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    正在加载历史记录...
                  </div>
                )}
                {!historyLoading && historyEntries.length === 0 && (
                  <div className="h-full flex items-center justify-center text-xs text-gray-500">
                    暂无历史记录，执行规划/增强/编辑后会自动记录
                  </div>
                )}
                {historyEntries.map((entry) => {
                  const restoring = historyRestoring && restoringHistoryId === entry.id
                  const selected = selectedHistoryEntry?.id === entry.id
                  return (
                    <button
                      key={entry.id}
                      onClick={() => setSelectedHistoryId(entry.id)}
                      className={`w-full text-left rounded-lg border p-3 space-y-2 transition-colors ${
                        selected ? 'border-blue-500/70 bg-blue-950/30' : 'border-gray-800 bg-gray-900/70 hover:border-gray-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-gray-200">{formatHistoryAction(entry.action)}</p>
                        <span className="text-[10px] text-gray-500">{new Date(entry.created_at).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-gray-400">
                        <span>{entry.shot_count} 镜头</span>
                        <span>·</span>
                        <span>{entry.target_duration_seconds || 0}s</span>
                      </div>
                      {entry.summary && (
                        <p className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed">{entry.summary}</p>
                      )}
                      <div className="pt-1 flex justify-end">
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            handleRestoreHistory(entry)
                          }}
                          disabled={historyRestoring}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs disabled:opacity-50 transition-colors"
                        >
                          {restoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                          回退
                        </button>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="min-h-0 flex flex-col">
              <div className="h-12 px-4 border-b border-gray-800 flex items-center justify-between shrink-0">
                <div>
                  <p className="text-sm font-semibold text-gray-100">版本差异</p>
                  <p className="text-[11px] text-gray-500">
                    {selectedHistoryEntry
                      ? `${formatHistoryAction(selectedHistoryEntry.action)} · ${new Date(selectedHistoryEntry.created_at).toLocaleString()}`
                      : '选择左侧历史记录查看差异'}
                  </p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {!selectedHistoryEntry && (
                  <div className="h-full flex items-center justify-center text-xs text-gray-500">
                    请从左侧选择一个历史节点
                  </div>
                )}
                {selectedHistoryEntry && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                      <div className="rounded border border-green-800/50 bg-green-900/20 px-2 py-1.5 text-green-200">新增镜头: {historyDiff.added}</div>
                      <div className="rounded border border-red-800/50 bg-red-900/20 px-2 py-1.5 text-red-200">移除镜头: {historyDiff.removed}</div>
                      <div className="rounded border border-amber-800/50 bg-amber-900/20 px-2 py-1.5 text-amber-200">修改镜头: {historyDiff.changed}</div>
                      <div className="rounded border border-gray-700 bg-gray-900/70 px-2 py-1.5 text-gray-300">未变镜头: {historyDiff.unchanged}</div>
                    </div>
                    {historyDiff.items.length === 0 && (
                      <div className="rounded border border-gray-800 bg-gray-900/70 px-3 py-2 text-xs text-gray-400">
                        与当前版本无可见差异
                      </div>
                    )}
                    {historyDiff.items.map((item) => {
                      const name = item.current?.name || item.previous?.name || `镜头${item.index + 1}`
                      const badgeCls = item.type === 'added'
                        ? 'bg-green-900/30 text-green-200 border-green-800/40'
                        : item.type === 'removed'
                          ? 'bg-red-900/30 text-red-200 border-red-800/40'
                          : 'bg-amber-900/30 text-amber-200 border-amber-800/40'
                      const badgeText = item.type === 'added' ? '新增' : item.type === 'removed' ? '移除' : '修改'
                      return (
                        <div key={`${item.type}_${item.index}_${name}`} className="rounded-lg border border-gray-800 bg-gray-900/70 p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-gray-200 truncate">#{item.index + 1} {name}</p>
                            <span className={`text-[10px] px-2 py-0.5 rounded border ${badgeCls}`}>{badgeText}</span>
                          </div>
                          {item.changedFields && item.changedFields.length > 0 && (
                            <p className="text-[11px] text-gray-400">变化字段: {item.changedFields.join('、')}</p>
                          )}
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 text-[11px]">
                            <div className="rounded border border-gray-800 bg-gray-950/70 p-2">
                              <p className="text-gray-500 mb-1">历史版本</p>
                              <p className="text-gray-300 truncate">{item.previous?.name || '—'}</p>
                              <p className="text-gray-500">时长: {item.previous?.duration || 0}s</p>
                            </div>
                            <div className="rounded border border-gray-800 bg-gray-950/70 p-2">
                              <p className="text-gray-500 mb-1">当前版本</p>
                              <p className="text-gray-300 truncate">{item.current?.name || '—'}</p>
                              <p className="text-gray-500">时长: {item.current?.duration || 0}s</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showPreviewPanel && (
        <div
          className="fixed z-[65] rounded-xl border border-gray-700 bg-gray-950/95 backdrop-blur shadow-2xl overflow-hidden"
          style={{
            left: previewPanelRect.x,
            top: previewPanelRect.y,
            width: previewPanelRect.width,
            height: previewPanelRect.height,
          }}
        >
          <div className="h-10 px-3 border-b border-gray-800 flex items-center justify-between gap-2">
            <div
              onMouseDown={startPreviewPanelDrag}
              className="min-w-0 flex-1 h-full flex items-center gap-2 cursor-move select-none"
            >
              <div className="text-xs text-gray-300">预览与时间线</div>
              <div className="text-[10px] text-gray-500 truncate">拖动移动 · 拖边缩放</div>
            </div>
            <button
              onClick={() => setShowPreviewPanel(false)}
              className="text-gray-500 hover:text-white"
              data-preview-panel-action="true"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div
            className={`h-[calc(100%-40px)] min-h-0 grid ${previewPanelGridClass}`}
            style={previewPanelGridStyle}
          >
            <div className={previewPlayerPaneClass}>
              <PreviewPlayer
                shots={shots}
                currentShotId={previewShotId}
                onCurrentShotChange={(shotId) => setPreviewShotId(shotId)}
              />
            </div>
            <div className="min-h-0">
              <Timeline
                shots={shots}
                currentShotId={previewShotId}
                onSelectShot={(shotId) => {
                  setPreviewShotId(shotId)
                  setSelectedShotId(shotId)
                  setDetailPanelCollapsed(false)
                }}
                onReorder={onReorderShots}
              />
            </div>
          </div>
          <button
            type="button"
            aria-label="向上调整预览面板高度"
            onMouseDown={startPreviewPanelResize('top')}
            className="absolute -top-1 left-3 right-3 h-2 cursor-ns-resize bg-transparent"
          />
          <button
            type="button"
            aria-label="向右调整预览面板宽度"
            onMouseDown={startPreviewPanelResize('right')}
            className="absolute -right-1 top-3 bottom-3 w-2 cursor-ew-resize bg-transparent"
          />
          <button
            type="button"
            aria-label="向下调整预览面板高度"
            onMouseDown={startPreviewPanelResize('bottom')}
            className="absolute -bottom-1 left-3 right-3 h-2 cursor-ns-resize bg-transparent"
          />
          <button
            type="button"
            aria-label="向左调整预览面板宽度"
            onMouseDown={startPreviewPanelResize('left')}
            className="absolute -left-1 top-3 bottom-3 w-2 cursor-ew-resize bg-transparent"
          />
          <button
            type="button"
            aria-label="从右下角缩放预览面板"
            onMouseDown={startPreviewPanelResize('bottom-right')}
            className="absolute -right-1.5 -bottom-1.5 h-4 w-4 cursor-nwse-resize rounded-full border border-gray-600 bg-gray-900/80"
          />
          <button
            type="button"
            aria-label="从左下角缩放预览面板"
            onMouseDown={startPreviewPanelResize('bottom-left')}
            className="absolute -left-1.5 -bottom-1.5 h-4 w-4 cursor-nesw-resize rounded-full border border-gray-600 bg-gray-900/80"
          />
          <button
            type="button"
            aria-label="从右上角缩放预览面板"
            onMouseDown={startPreviewPanelResize('top-right')}
            className="absolute -right-1.5 -top-1.5 h-4 w-4 cursor-nesw-resize rounded-full border border-gray-600 bg-gray-900/80"
          />
          <button
            type="button"
            aria-label="从左上角缩放预览面板"
            onMouseDown={startPreviewPanelResize('top-left')}
            className="absolute -left-1.5 -top-1.5 h-4 w-4 cursor-nwse-resize rounded-full border border-gray-600 bg-gray-900/80"
          />
        </div>
      )}

      {showElementLibrary && (
        <ElementLibraryPanel
          sharedElements={elements}
          episodeElements={episodeElements}
          onUpdateSharedElement={onUpdateElement}
          onDeleteSharedElement={onDeleteElement}
          onGenerateSharedElementImage={onGenerateElementImage}
          onBatchGenerateMissingSharedElements={onBatchGenerateElementImages}
          generating={generating}
          generationScope={generationScope}
          onClose={() => setShowElementLibrary(false)}
        />
      )}
    </div>
  )
}

// ============================================================
// 镜头卡片
// ============================================================

function ShotCard({
  shot,
  index,
  isSelected,
  onClick,
  onGenerateFrame,
  onGenerateEndFrame,
  onGenerateVideo,
  onGenerateAudio,
  generating,
}: {
  shot: StudioShot
  index: number
  isSelected: boolean
  onClick: () => void
  onGenerateFrame: () => void
  onGenerateEndFrame: () => void
  onGenerateVideo: () => void
  onGenerateAudio: () => void
  generating: boolean
}) {
  return (
    <div
      onClick={onClick}
      className={`group relative rounded-lg border cursor-pointer transition-all ${
        isSelected
          ? 'border-purple-500 bg-gray-900/80'
          : 'border-gray-800 bg-gray-900 hover:border-gray-700'
      }`}
    >
      {/* 缩略图区域 */}
      <div className="aspect-video bg-gray-800 rounded-t-lg overflow-hidden relative">
        {shot.start_image_url ? (
          <img
            src={shot.start_image_url}
            alt={shot.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <ImageIcon className="w-8 h-8" />
          </div>
        )}
        <div className="absolute top-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
          #{index + 1}
        </div>
        <div className="absolute top-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
          {shot.duration}s
        </div>
        {shot.end_image_url && (
          <div className="absolute bottom-1 left-1 w-12 h-8 rounded border border-white/30 overflow-hidden bg-black/40">
            <img src={shot.end_image_url} alt="end-frame" className="w-full h-full object-cover" />
          </div>
        )}
        {shot.video_url && (
          <div className="absolute bottom-1 right-1 bg-green-500/80 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-0.5">
            <Video className="w-3 h-3" />
          </div>
        )}
      </div>

      {/* 内容 */}
      <div className="p-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-200 truncate">{shot.name || `镜头${index + 1}`}</span>
          <span className="text-xs text-gray-500">{shot.type}</span>
        </div>
        {shot.narration && (
          <p className="text-xs text-gray-400 line-clamp-2 mb-2">{shot.narration}</p>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 flex-wrap">
          {!shot.start_image_url ? (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateFrame() }}
              disabled={generating}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              <ImageIcon className="w-3 h-3" />
              帧
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateFrame() }}
              disabled={generating}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              重做帧
            </button>
          )}
          {shot.end_prompt && (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateEndFrame() }}
              disabled={generating}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              <ImageIcon className="w-3 h-3" />
              {shot.end_image_url ? '重做尾帧' : '尾帧'}
            </button>
          )}
          {shot.start_image_url && (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateVideo() }}
              disabled={generating}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              {shot.video_url ? <RefreshCw className="w-3 h-3" /> : <Video className="w-3 h-3" />}
              {shot.video_url ? '重做视频' : '视频'}
            </button>
          )}
          {(shot.narration || shot.dialogue_script) && (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateAudio() }}
              disabled={generating}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              {shot.audio_url ? <RefreshCw className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
              {shot.audio_url ? '重做音频' : '音频'}
            </button>
          )}
          {shot.status === 'completed' && (
            <CheckCircle className="w-3.5 h-3.5 text-green-400 ml-auto" />
          )}
        </div>
      </div>

      <HoverOverviewPanel maxWidthClass="max-w-5xl">
        <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
          <div className="space-y-2">
            <div className="rounded-lg overflow-hidden border border-gray-800 bg-gray-900/70">
              <div className="aspect-video w-full bg-gray-900/80">
                {shot.start_image_url ? (
                  <img src={shot.start_image_url} alt={shot.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-600">
                    <ImageIcon className="w-10 h-10" />
                  </div>
                )}
              </div>
            </div>
            {shot.end_image_url && (
              <div className="rounded-lg overflow-hidden border border-gray-800 bg-gray-900/70">
                <div className="aspect-video w-full bg-gray-900/80">
                  <img src={shot.end_image_url} alt={`${shot.name || '镜头'}-end`} className="w-full h-full object-cover" />
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-base text-gray-100 font-semibold line-clamp-2">
                {shot.name || `镜头${index + 1}`}
              </p>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">{shot.type || 'standard'}</span>
            </div>
            <p className="text-sm text-gray-200 leading-relaxed line-clamp-6">
              {shot.narration || shot.description || '暂无描述'}
            </p>
            <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-2.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-gray-400">
                <span>状态</span>
                <span>{shot.status || 'pending'}</span>
              </div>
              <div className="flex items-center justify-between text-gray-400">
                <span>时长</span>
                <span>{shot.duration || 0}s</span>
              </div>
              <div className="flex items-center justify-between text-gray-400">
                <span>首帧</span>
                <span>{shot.start_image_url ? '已生成' : '未生成'}</span>
              </div>
              <div className="flex items-center justify-between text-gray-400">
                <span>视频/音频</span>
                <span>{shot.video_url ? '视频就绪' : '视频未生成'} · {shot.audio_url ? '音频就绪' : '音频未生成'}</span>
              </div>
            </div>
            {(shot.dialogue_script || shot.prompt || shot.video_prompt) && (
              <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-2.5">
                <p className="text-xs text-gray-500 mb-1">补充信息</p>
                <p className="text-xs text-gray-300 leading-relaxed line-clamp-4">
                  {shot.dialogue_script || shot.video_prompt || shot.prompt}
                </p>
              </div>
            )}
          </div>
        </div>
      </HoverOverviewPanel>
    </div>
  )
}

// ============================================================
// 镜头详情面板
// ============================================================

function ShotDetailPanel({
  shot,
  elements,
  onGenerateAsset,
  onInpaint,
  onUpdate,
  onCollapse,
  onClose,
}: {
  shot: StudioShot
  elements: StudioElement[]
  onGenerateAsset: (stage: 'frame' | 'end_frame' | 'video' | 'audio') => void | Promise<void>
  onInpaint: (payload: { editPrompt: string; maskData?: string }) => void | Promise<void>
  onUpdate: (updates: Record<string, unknown>) => void
  onCollapse: () => void
  onClose: () => void
}) {
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [inpaintPrompt, setInpaintPrompt] = useState((shot.prompt || shot.description || '').trim())
  const [maskData, setMaskData] = useState('')
  const [inpainting, setInpainting] = useState(false)
  const [promptAnalysis, setPromptAnalysis] = useState<Partial<Record<PromptFieldKey, StudioPromptAnalysis>>>({})
  const [checkingPromptField, setCheckingPromptField] = useState<Partial<Record<PromptFieldKey, boolean>>>({})
  const [optimizingPromptField, setOptimizingPromptField] = useState<PromptFieldKey | null>(null)
  const promptCheckTimerRef = useRef<Partial<Record<PromptFieldKey, number>>>({})

  useEffect(() => {
    setInpaintPrompt((shot.prompt || shot.description || '').trim())
    setMaskData('')
    setInpainting(false)
  }, [shot.id, shot.prompt, shot.description])

  const handleSave = (field: string) => {
    if (editing[field] !== undefined) {
      onUpdate({ [field]: editing[field] })
      setEditing((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  const fieldValue = (field: string) =>
    editing[field] !== undefined ? editing[field] : (shot as unknown as Record<string, unknown>)[field] as string || ''

  const handleInpaint = async () => {
    const prompt = inpaintPrompt.trim()
    if (!shot.start_image_url || !prompt) return
    setInpainting(true)
    try {
      await onInpaint({
        editPrompt: prompt,
        maskData: maskData.trim() || undefined,
      })
    } finally {
      setInpainting(false)
    }
  }

  const runPromptCheck = useCallback(async (field: PromptFieldKey, value: string) => {
    const prompt = value.trim()
    if (!prompt) {
      setPromptAnalysis((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
      setCheckingPromptField((prev) => ({ ...prev, [field]: false }))
      return
    }
    setCheckingPromptField((prev) => ({ ...prev, [field]: true }))
    try {
      const analysis = await studioPromptCheck(prompt)
      setPromptAnalysis((prev) => ({ ...prev, [field]: analysis }))
    } catch {
      // ignore prompt-check transient errors in local field validation
    } finally {
      setCheckingPromptField((prev) => ({ ...prev, [field]: false }))
    }
  }, [])

  const schedulePromptCheck = useCallback((field: PromptFieldKey, value: string) => {
    const timer = promptCheckTimerRef.current[field]
    if (timer) {
      window.clearTimeout(timer)
    }
    promptCheckTimerRef.current[field] = window.setTimeout(() => {
      void runPromptCheck(field, value)
    }, 720)
  }, [runPromptCheck])

  const optimizePromptField = useCallback(async (field: PromptFieldKey) => {
    const current = fieldValue(field).trim()
    if (!current) return

    setOptimizingPromptField(field)
    try {
      const optimized = await studioPromptOptimize(current, { use_llm: true })
      const nextPrompt = (optimized.optimized_prompt || current).trim()
      setEditing((prev) => ({ ...prev, [field]: nextPrompt }))
      onUpdate({ [field]: nextPrompt })
      await runPromptCheck(field, nextPrompt)
    } finally {
      setOptimizingPromptField(null)
    }
  }, [onUpdate, runPromptCheck, fieldValue])

  useEffect(() => {
    const timers = promptCheckTimerRef.current
    return () => {
      Object.values(timers).forEach((timer) => {
        if (timer) window.clearTimeout(timer)
      })
    }
  }, [])

  useEffect(() => {
    Object.values(promptCheckTimerRef.current).forEach((timer) => {
      if (timer) window.clearTimeout(timer)
    })
    promptCheckTimerRef.current = {}
    setPromptAnalysis({})
    setCheckingPromptField({})
    setOptimizingPromptField(null)
    PROMPT_FIELD_META.forEach((meta) => {
      const value = String((shot as Record<string, unknown>)[meta.field] || '')
      if (value.trim()) {
        void runPromptCheck(meta.field, value)
      }
    })
  }, [runPromptCheck, shot.id, shot.prompt, shot.end_prompt, shot.video_prompt])

  const renderPromptFieldFooter = (field: PromptFieldKey) => {
    const checking = Boolean(checkingPromptField[field])
    const analysis = promptAnalysis[field]
    const hasRisk = Boolean(analysis && !analysis.safe && analysis.matches.length > 0)
    return (
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
            {checking ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-gray-500" />
                检测中...
              </>
            ) : analysis ? (
              analysis.safe ? (
                <span className="text-emerald-300">安全</span>
              ) : (
                <span className="text-amber-300">命中 {analysis.matches.length} 项风险</span>
              )
            ) : (
              <span className="text-gray-500">输入后自动检测</span>
            )}
          </div>
          {hasRisk && (
            <button
              onClick={() => void optimizePromptField(field)}
              disabled={optimizingPromptField === field}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] bg-amber-700/65 hover:bg-amber-600/75 text-white disabled:opacity-50 transition-colors"
            >
              {optimizingPromptField === field ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              一键优化
            </button>
          )}
        </div>
        {hasRisk && analysis && analysis.suggestions.length > 0 && (
          <p className="text-[10px] text-gray-400 leading-relaxed">
            建议：{analysis.suggestions.slice(0, 3).map((item) => `${item.source}→${item.replacement}`).join('；')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-200">{shot.name || '镜头详情'}</h4>
        <div className="flex items-center gap-1">
          <button onClick={onCollapse} className="text-gray-500 hover:text-white" title="收起详情面板">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="text-gray-500 hover:text-white" title="关闭详情">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onGenerateAsset('frame')}
          className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center justify-center gap-1"
        >
          <ImageIcon className="w-3 h-3" />
          {shot.start_image_url ? '重做首帧' : '生成首帧'}
        </button>
        <button
          onClick={() => onGenerateAsset('end_frame')}
          className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center justify-center gap-1"
        >
          <ImageIcon className="w-3 h-3" />
          {shot.end_image_url ? '重做尾帧' : '生成尾帧'}
        </button>
        <button
          onClick={() => onGenerateAsset('video')}
          className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center justify-center gap-1"
        >
          <Video className="w-3 h-3" />
          {shot.video_url ? '重做视频' : '生成视频'}
        </button>
        <button
          onClick={() => onGenerateAsset('audio')}
          className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center justify-center gap-1"
        >
          <Mic className="w-3 h-3" />
          {shot.audio_url ? '重做音频' : '生成音频'}
        </button>
      </div>

      <div className="p-3 rounded-lg border border-gray-800 bg-gray-900/70 space-y-2">
        <p className="text-xs font-medium text-gray-300">局部重绘（Inpaint）</p>
        <textarea
          rows={3}
          value={inpaintPrompt}
          onChange={(e) => setInpaintPrompt(e.target.value)}
          placeholder="描述需要修改的局部效果，例如：将人物手中的道具改为折扇，保持服饰和背景不变"
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
        />
        <textarea
          rows={2}
          value={maskData}
          onChange={(e) => setMaskData(e.target.value)}
          placeholder="可选：mask 数据（base64 / URL / JSON）。当前未接入画布选区时可留空"
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500 resize-y"
        />
        <button
          onClick={handleInpaint}
          disabled={!shot.start_image_url || !inpaintPrompt.trim() || inpainting}
          className="w-full text-xs px-2 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 flex items-center justify-center gap-1 transition-colors"
        >
          {inpainting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {!shot.start_image_url ? '请先生成首帧' : '执行局部重绘'}
        </button>
      </div>

      {/* 基本信息 */}
      <div className="space-y-3">
        <DetailField
          label="时长（秒）"
          value={String(fieldValue('duration') || '')}
          onChange={(v) => setEditing((p) => ({ ...p, duration: v }))}
          onBlur={() => {
            const raw = editing.duration
            if (raw !== undefined) {
              const duration = Number(raw)
              if (!Number.isNaN(duration) && duration > 0) {
                onUpdate({ duration })
              }
              setEditing((prev) => {
                const next = { ...prev }
                delete next.duration
                return next
              })
            }
          }}
        />
        <DetailField
          label="描述"
          value={fieldValue('description')}
          onChange={(v) => setEditing((p) => ({ ...p, description: v }))}
          onBlur={() => handleSave('description')}
          multiline
        />
        <DetailField
          label="起始帧提示词"
          value={fieldValue('prompt')}
          onChange={(v) => {
            setEditing((p) => ({ ...p, prompt: v }))
            schedulePromptCheck('prompt', v)
          }}
          onBlur={() => handleSave('prompt')}
          multiline
          footer={renderPromptFieldFooter('prompt')}
        />
        <DetailField
          label="尾帧提示词"
          value={fieldValue('end_prompt')}
          onChange={(v) => {
            setEditing((p) => ({ ...p, end_prompt: v }))
            schedulePromptCheck('end_prompt', v)
          }}
          onBlur={() => handleSave('end_prompt')}
          multiline
          footer={renderPromptFieldFooter('end_prompt')}
        />
        <DetailField
          label="视频提示词"
          value={fieldValue('video_prompt')}
          onChange={(v) => {
            setEditing((p) => ({ ...p, video_prompt: v }))
            schedulePromptCheck('video_prompt', v)
          }}
          onBlur={() => handleSave('video_prompt')}
          multiline
          footer={renderPromptFieldFooter('video_prompt')}
        />
        <DetailField
          label="旁白"
          value={fieldValue('narration')}
          onChange={(v) => setEditing((p) => ({ ...p, narration: v }))}
          onBlur={() => handleSave('narration')}
          multiline
        />
        <DetailField
          label="对白"
          value={fieldValue('dialogue_script')}
          onChange={(v) => setEditing((p) => ({ ...p, dialogue_script: v }))}
          onBlur={() => handleSave('dialogue_script')}
          multiline
        />
      </div>

      <VisualActionDesigner
        value={(shot.visual_action || {}) as Record<string, unknown>}
        onChange={(visualAction) => onUpdate({ visual_action: visualAction })}
        onApplyToPrompt={(text) => {
          const current = fieldValue('video_prompt')
          const next = current ? `${current}\n${text}` : text
          onUpdate({ video_prompt: next })
        }}
      />

      {(shot.frame_history && shot.frame_history.length > 0) && (
        <div>
          <p className="text-xs text-gray-500 mb-1">首帧历史（{shot.frame_history.length}）</p>
          <div className="grid grid-cols-3 gap-2">
            {shot.frame_history.slice().reverse().map((url, idx) => (
              <button
                key={`${url}_${idx}`}
                onClick={() => onUpdate({ start_image_url: url })}
                className="relative aspect-video rounded border border-gray-700 overflow-hidden hover:border-purple-500"
                title="点击设为当前首帧"
              >
                <img src={url} alt="frame-history" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {(shot.video_history && shot.video_history.length > 0) && (
        <div>
          <p className="text-xs text-gray-500 mb-1">视频历史（{shot.video_history.length}）</p>
          <div className="space-y-1">
            {shot.video_history.slice().reverse().map((url, idx) => (
              <div key={`${url}_${idx}`} className="flex items-center gap-2">
                <a href={url} target="_blank" rel="noreferrer" className="text-xs text-purple-300 truncate flex-1">
                  {url}
                </a>
                <button
                  onClick={() => onUpdate({ video_url: url })}
                  className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-200"
                >
                  设为当前
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 引用的共享元素 */}
      {elements.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1">可引用元素（[SE_XXX]）</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {elements.map((el) => (
              <div key={el.id} className="flex items-center gap-2 text-xs text-gray-400">
                <span className="font-mono text-purple-300">[{el.id}]</span>
                <span>{el.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DetailField({
  label,
  value,
  onChange,
  onBlur,
  multiline = false,
  footer,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur: () => void
  multiline?: boolean
  footer?: ReactNode
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {multiline ? (
        <textarea
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-none"
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      ) : (
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      )}
      {footer}
    </div>
  )
}

function ElementLibraryPanel({
  sharedElements,
  episodeElements,
  onUpdateSharedElement,
  onDeleteSharedElement,
  onGenerateSharedElementImage,
  onBatchGenerateMissingSharedElements,
  generating = false,
  generationScope = 'none',
  onClose,
}: {
  sharedElements: StudioElement[]
  episodeElements: StudioEpisodeElement[]
  onUpdateSharedElement?: (elementId: string, updates: Record<string, unknown>) => void | Promise<void>
  onDeleteSharedElement?: (elementId: string) => void | Promise<void>
  onGenerateSharedElementImage?: (
    elementId: string,
    options?: { useReference?: boolean; referenceMode?: 'none' | 'light' | 'full' }
  ) => void | Promise<void>
  onBatchGenerateMissingSharedElements?: () => void | Promise<void>
  generating?: boolean
  generationScope?: StudioGenerationScope
  onClose: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'character' | 'scene' | 'object'>('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [editingElement, setEditingElement] = useState<StudioElement | null>(null)
  const [historyElement, setHistoryElement] = useState<StudioElement | null>(null)
  const [characterRefModeMap, setCharacterRefModeMap] = useState<Record<string, 'none' | 'light' | 'full'>>({})

  const norm = keyword.trim().toLowerCase()
  const filterByKeyword = (name: string, desc: string) =>
    !norm || `${name} ${desc}`.toLowerCase().includes(norm)

  const sharedFiltered = sharedElements.filter((el) => {
    if (typeFilter !== 'all' && el.type !== typeFilter) return false
    if (favoriteOnly && el.is_favorite !== 1) return false
    return filterByKeyword(el.name, el.description)
  })
  const sharedMissingCount = sharedFiltered.filter((el) => !el.image_url).length
  const isBatchGenerating = generating && generationScope === 'batch'

  const episodeOnly = episodeElements.filter((el) => !el.shared_element_id).filter((el) => {
    if (typeFilter !== 'all' && el.type !== typeFilter) return false
    return filterByKeyword(el.name, el.description)
  })

  const getCharacterRefMode = (element: StudioElement): 'none' | 'light' | 'full' => {
    if (element.type !== 'character') return 'none'
    return characterRefModeMap[element.id] || 'light'
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-5xl max-h-[90vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-100">素材库</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 border-b border-gray-800 space-y-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索名称或描述..."
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
          />
          <div className="flex items-center gap-2 flex-wrap">
            {(['all', 'character', 'scene', 'object'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-2 py-1 rounded text-xs ${
                  typeFilter === type ? 'bg-purple-700/60 text-purple-100' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {type === 'all' ? '全部' : type === 'character' ? '角色' : type === 'scene' ? '场景' : '道具'}
              </button>
            ))}
            <button
              onClick={() => setFavoriteOnly((v) => !v)}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${
                favoriteOnly ? 'bg-yellow-700/50 text-yellow-200' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              <Star className="w-3 h-3" />
              仅收藏
            </button>
            {onBatchGenerateMissingSharedElements && (
              <button
                onClick={() => onBatchGenerateMissingSharedElements()}
                disabled={generating || sharedMissingCount <= 0}
                className="px-2 py-1 rounded text-xs bg-purple-700/70 hover:bg-purple-600/70 text-white disabled:opacity-40 inline-flex items-center gap-1 transition-colors"
                title="批量生成当前筛选中缺少参考图的共享素材"
              >
                {isBatchGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                批量生成缺图({sharedMissingCount})
              </button>
            )}
          </div>
        </div>
        <div className="p-4 overflow-y-auto max-h-[calc(90vh-130px)] space-y-5">
          <section>
            <h4 className="text-sm font-medium text-gray-300 mb-2">系列共享素材（{sharedFiltered.length}）</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {sharedFiltered.map((el) => (
                <div key={el.id} className="group relative p-3 rounded-lg border border-gray-800 bg-gray-950/60">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{el.type}</span>
                    <span className="text-sm text-gray-200 truncate">{el.name}</span>
                    <div className="ml-auto flex items-center gap-1">
                      {onUpdateSharedElement && (
                        <button
                          onClick={() => onUpdateSharedElement(el.id, { is_favorite: el.is_favorite === 1 ? 0 : 1 })}
                          className={`${el.is_favorite === 1 ? 'text-yellow-300' : 'text-gray-500 hover:text-yellow-300'} transition-colors`}
                          title={el.is_favorite === 1 ? '取消收藏' : '收藏'}
                        >
                          <Star className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onUpdateSharedElement && (
                        <button
                          onClick={() => setEditingElement(el)}
                          className="text-gray-500 hover:text-white transition-colors"
                          title="编辑素材"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onDeleteSharedElement && (
                        <button
                          onClick={() => {
                            if (confirm(`确定删除素材「${el.name}」吗？`)) onDeleteSharedElement(el.id)
                          }}
                          className="text-gray-500 hover:text-red-400 transition-colors"
                          title="删除素材"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {el.image_url ? (
                    <img src={el.image_url} alt={el.name} className="w-full h-24 rounded object-cover mb-2" />
                  ) : (
                    <div className="w-full h-24 rounded bg-gray-800 mb-2 flex items-center justify-center text-gray-600">
                      <ImageIcon className="w-5 h-5" />
                    </div>
                  )}
                  <p className="text-xs text-gray-400 line-clamp-3">{el.description}</p>
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    {el.type === 'character' && (
                      <select
                        value={getCharacterRefMode(el)}
                        onChange={(e) => {
                          const next = e.target.value as 'none' | 'light' | 'full'
                          setCharacterRefModeMap((prev) => ({ ...prev, [el.id]: next }))
                        }}
                        disabled={generating}
                        className="text-[11px] px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300 focus:outline-none focus:border-purple-500 disabled:opacity-40"
                        title="角色一致性参考强度"
                      >
                        <option value="none">一致性: 关</option>
                        <option value="light">一致性: 轻</option>
                        <option value="full">一致性: 强</option>
                      </select>
                    )}
                    {onGenerateSharedElementImage && (
                      <button
                        onClick={() => {
                          const mode = getCharacterRefMode(el)
                          onGenerateSharedElementImage(el.id, {
                            useReference: el.type === 'character' && mode !== 'none',
                            referenceMode: el.type === 'character' ? mode : 'none',
                          })
                        }}
                        disabled={generating}
                        className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-50 inline-flex items-center gap-1 transition-colors"
                        title={el.type === 'character' ? '角色可按一致性档位重做参考图' : undefined}
                      >
                        {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
                        {el.image_url ? (el.type === 'character' ? '一致性重做参考图' : '重做参考图') : '生成参考图'}
                      </button>
                    )}
                    {onUpdateSharedElement && el.image_history && el.image_history.length > 0 && (
                      <button
                        onClick={() => setHistoryElement(el)}
                        className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                      >
                        历史({el.image_history.length})
                      </button>
                    )}
                  </div>

                  <HoverOverviewPanel maxWidthClass="max-w-4xl">
                    <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
                      <div className="rounded-lg overflow-hidden border border-gray-800 bg-gray-900/70">
                        <div className="aspect-video w-full bg-gray-900/80">
                          {el.image_url ? (
                            <img src={el.image_url} alt={el.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-600">
                              <ImageIcon className="w-10 h-10" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-base text-gray-100 font-semibold line-clamp-1">{el.name}</p>
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">{el.type}</span>
                        </div>
                        <p className="text-sm text-gray-200 leading-relaxed line-clamp-8">
                          {el.description || '暂无描述'}
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded border border-gray-800 bg-gray-900/70 px-2 py-1.5 text-gray-400">
                            出现集数: {el.appears_in_episodes?.length || 0}
                          </div>
                          <div className="rounded border border-gray-800 bg-gray-900/70 px-2 py-1.5 text-gray-400">
                            图像版本: {el.image_history?.length || 0}
                          </div>
                        </div>
                      </div>
                    </div>
                  </HoverOverviewPanel>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h4 className="text-sm font-medium text-gray-300">本集特有素材（{episodeOnly.length}）</h4>
              <span className="text-[11px] text-gray-500">当前支持在镜头详情中直接生成，后续会补齐独立生成</span>
            </div>
            {episodeOnly.length === 0 ? (
              <p className="text-xs text-gray-500">暂无本集特有素材</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {episodeOnly.map((el) => (
                  <div key={el.id} className="group relative p-3 rounded-lg border border-gray-800 bg-gray-950/60">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300">{el.type}</span>
                      <span className="text-sm text-gray-200 truncate">{el.name}</span>
                    </div>
                    <p className="text-xs text-gray-400 line-clamp-3">{el.description}</p>

                    <HoverOverviewPanel maxWidthClass="max-w-2xl">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-base text-gray-100 font-semibold line-clamp-1">{el.name}</p>
                          <span className="text-xs px-2 py-0.5 rounded bg-blue-900/30 text-blue-300">{el.type}</span>
                        </div>
                        <p className="text-sm text-gray-200 leading-relaxed line-clamp-8">
                          {el.description || '暂无描述'}
                        </p>
                        <div className="text-xs text-gray-500 flex items-center justify-between">
                          <span>本集特有素材</span>
                          <span>{el.image_url ? '含参考图' : '无参考图'}</span>
                        </div>
                      </div>
                    </HoverOverviewPanel>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {editingElement && onUpdateSharedElement && (
        <ElementEditDialog
          initial={editingElement}
          onClose={() => setEditingElement(null)}
          onSubmit={(payload) => {
            onUpdateSharedElement(editingElement.id, payload)
            setEditingElement(null)
          }}
        />
      )}

      {historyElement && onUpdateSharedElement && (
        <ImageHistoryDialog
          title={`${historyElement.name} · 图片历史`}
          current={historyElement.image_url}
          history={historyElement.image_history || []}
          onClose={() => setHistoryElement(null)}
          onApply={(url) => {
            onUpdateSharedElement(historyElement.id, { image_url: url })
            setHistoryElement(null)
          }}
        />
      )}

    </div>
  )
}

const GRID_POSITIONS = [
  'TL', 'TC', 'TR',
  'ML', 'MC', 'MR',
  'BL', 'BC', 'BR',
] as const

function VisualActionDesigner({
  value,
  onChange,
  onApplyToPrompt,
}: {
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  onApplyToPrompt: (text: string) => void
}) {
  const [subject, setSubject] = useState((value.subject as string) || '主体')
  const [fromPos, setFromPos] = useState((value.from as string) || 'MC')
  const [toPos, setToPos] = useState((value.to as string) || 'TR')
  const [motion, setMotion] = useState((value.motion as string) || '缓慢转身并移动')
  const [pickTarget, setPickTarget] = useState<'from' | 'to'>('from')

  useEffect(() => {
    setSubject((value.subject as string) || '主体')
    setFromPos((value.from as string) || 'MC')
    setToPos((value.to as string) || 'TR')
    setMotion((value.motion as string) || '缓慢转身并移动')
  }, [value])

  const description = `${subject} 从画面 ${fromPos} 向 ${toPos} 运动，${motion}。`

  const persist = () => {
    onChange({
      subject,
      from: fromPos,
      to: toPos,
      motion,
      generated_text: description,
    })
  }

  return (
    <div className="p-3 rounded-lg border border-gray-800 bg-gray-900/70 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-300">视觉动作设计（3×3）</p>
        <button
          onClick={() => {
            persist()
            onApplyToPrompt(`动作设计: ${description}`)
          }}
          className="text-xs px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white"
        >
          应用到视频提示词
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1 w-36">
        {GRID_POSITIONS.map((pos) => {
          const isFrom = pos === fromPos
          const isTo = pos === toPos
          return (
            <button
              key={pos}
              onClick={() => {
                if (pickTarget === 'from') {
                  setFromPos(pos)
                  onChange({
                    subject,
                    from: pos,
                    to: toPos,
                    motion,
                    generated_text: `${subject} 从画面 ${pos} 向 ${toPos} 运动，${motion}。`,
                  })
                } else {
                  setToPos(pos)
                  onChange({
                    subject,
                    from: fromPos,
                    to: pos,
                    motion,
                    generated_text: `${subject} 从画面 ${fromPos} 向 ${pos} 运动，${motion}。`,
                  })
                }
              }}
              className={`h-8 text-[10px] rounded border ${
                isFrom ? 'border-blue-400 bg-blue-900/30 text-blue-200' :
                isTo ? 'border-green-400 bg-green-900/30 text-green-200' :
                'border-gray-700 bg-gray-800 text-gray-500'
              }`}
              title={pos}
            >
              {pos}
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setPickTarget('from')}
          className={`text-xs px-2 py-1 rounded ${pickTarget === 'from' ? 'bg-blue-700/50 text-blue-100' : 'bg-gray-800 text-gray-400'}`}
        >
          点击网格设置起点
        </button>
        <button
          onClick={() => setPickTarget('to')}
          className={`text-xs px-2 py-1 rounded ${pickTarget === 'to' ? 'bg-green-700/50 text-green-100' : 'bg-gray-800 text-gray-400'}`}
        >
          点击网格设置终点
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onBlur={persist}
          placeholder="主体"
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
        />
        <input
          value={motion}
          onChange={(e) => setMotion(e.target.value)}
          onBlur={persist}
          placeholder="动作描述"
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={fromPos}
          onChange={(e) => {
            setFromPos(e.target.value)
            onChange({ ...value, from: e.target.value, to: toPos, subject, motion })
          }}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
        >
          {GRID_POSITIONS.map((p) => <option key={p} value={p}>起点 {p}</option>)}
        </select>
        <select
          value={toPos}
          onChange={(e) => {
            setToPos(e.target.value)
            onChange({ ...value, from: fromPos, to: e.target.value, subject, motion })
          }}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
        >
          {GRID_POSITIONS.map((p) => <option key={p} value={p}>终点 {p}</option>)}
        </select>
      </div>
      <p className="text-xs text-gray-400">{description}</p>
    </div>
  )
}

function ImageHistoryDialog({
  title,
  current,
  history,
  onClose,
  onApply,
}: {
  title: string
  current: string
  history: string[]
  onClose: () => void
  onApply: (url: string) => void
}) {
  const list = [current, ...history.slice().reverse()].filter((url, idx, arr) => !!url && arr.indexOf(url) === idx)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-4xl max-h-[90vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3 overflow-y-auto max-h-[78vh]">
          {list.map((url, idx) => (
            <button
              key={`${url}_${idx}`}
              onClick={() => onApply(url)}
              className={`text-left rounded-lg border overflow-hidden ${
                url === current ? 'border-purple-500' : 'border-gray-800 hover:border-purple-600'
              }`}
            >
              <div className="aspect-video bg-gray-800">
                <img src={url} alt={`history-${idx}`} className="w-full h-full object-cover" />
              </div>
              <div className="px-2 py-1 text-xs text-gray-300">
                {idx === 0 ? '当前' : `历史 #${idx}`}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function CharacterDesignConsoleDialog({
  series,
  elements,
  busy,
  onImportDocument,
  onSplitCharacterByAge,
  onClose,
}: {
  series: StudioSeries
  elements: StudioElement[]
  busy: boolean
  onImportDocument: (
    documentText: string,
    options: { saveToElements: boolean; dedupeByName: boolean },
  ) => Promise<{ created: number; updated: number; skipped: number; items: Array<{ name: string; stage_label: string; description: string }> } | null>
  onSplitCharacterByAge: (
    elementId: string,
    options: { replaceOriginal: boolean },
  ) => Promise<{ need_split: boolean; created: number; updated: number; reason?: string } | null>
  onClose: () => void
}) {
  const [tab, setTab] = useState<'import' | 'split'>('import')
  const [docText, setDocText] = useState('')
  const [docFileName, setDocFileName] = useState('')
  const [saveToElements, setSaveToElements] = useState(true)
  const [dedupeByName, setDedupeByName] = useState(true)
  const [replaceOriginal, setReplaceOriginal] = useState(false)
  const [importing, setImporting] = useState(false)
  const [batchSplitting, setBatchSplitting] = useState(false)
  const [splittingId, setSplittingId] = useState<string | null>(null)
  const [importSummary, setImportSummary] = useState<{
    created: number
    updated: number
    skipped: number
    total: number
  } | null>(null)
  const [splitMessages, setSplitMessages] = useState<Record<string, string>>({})

  const characters = useMemo(
    () => elements.filter((el) => el.type === 'character'),
    [elements],
  )
  const suspiciousCharacters = useMemo(
    () => characters.filter((el) => hasMultiAgeSignals(el.description) || hasMultiAgeSignals(el.voice_profile)),
    [characters],
  )

  const handlePickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setDocText(text)
    setDocFileName(file.name)
  }

  const handleImport = async () => {
    if (!docText.trim()) return
    setImporting(true)
    try {
      const result = await onImportDocument(docText, { saveToElements, dedupeByName })
      if (!result) return
      setImportSummary({
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        total: result.items.length,
      })
      if (saveToElements) {
        setTab('split')
      }
    } finally {
      setImporting(false)
    }
  }

  const runSplit = async (elementId: string) => {
    setSplittingId(elementId)
    try {
      const result = await onSplitCharacterByAge(elementId, { replaceOriginal })
      if (!result) return
      setSplitMessages((prev) => ({
        ...prev,
        [elementId]: result.need_split
          ? `完成：新增 ${result.created}，更新 ${result.updated}`
          : (result.reason || '无需拆分'),
      }))
    } finally {
      setSplittingId(null)
    }
  }

  const runBatchSplit = async () => {
    if (suspiciousCharacters.length <= 0) return
    setBatchSplitting(true)
    try {
      for (const character of suspiciousCharacters) {
        // eslint-disable-next-line no-await-in-loop
        await runSplit(character.id)
      }
    } finally {
      setBatchSplitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-5xl max-h-[90vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">角色设计控制台</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {series.name} · 角色 {characters.length} · 多阶段疑似 {suspiciousCharacters.length}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pt-3 border-b border-gray-800 flex items-center gap-2">
          <button
            onClick={() => setTab('import')}
            className={`px-2 py-1 text-xs rounded ${tab === 'import' ? 'bg-purple-700/60 text-purple-100' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
          >
            文档导入拆分
          </button>
          <button
            onClick={() => setTab('split')}
            className={`px-2 py-1 text-xs rounded ${tab === 'split' ? 'bg-purple-700/60 text-purple-100' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
          >
            阶段拆分
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[calc(90vh-120px)]">
          {tab === 'import' ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-gray-300 inline-flex items-center gap-2 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 cursor-pointer">
                    <FileText className="w-3.5 h-3.5" />
                    上传角色文档（txt/md）
                    <input
                      type="file"
                      accept=".txt,.md,.markdown,text/plain,text/markdown"
                      className="hidden"
                      onChange={handlePickFile}
                    />
                  </label>
                  {docFileName && <span className="text-[11px] text-gray-500">{docFileName}</span>}
                </div>
                <textarea
                  rows={12}
                  value={docText}
                  onChange={(e) => setDocText(e.target.value)}
                  placeholder="粘贴角色设定文档；可包含多人资料，系统会自动拆分为单角色单阶段版本。"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
                />
                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400">
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={saveToElements} onChange={(e) => setSaveToElements(e.target.checked)} />
                    写入素材库
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={dedupeByName} onChange={(e) => setDedupeByName(e.target.checked)} />
                    同名角色优先更新
                  </label>
                  <button
                    onClick={handleImport}
                    disabled={busy || importing || !docText.trim()}
                    className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-purple-700/70 hover:bg-purple-600/70 text-white disabled:opacity-40"
                  >
                    {(busy || importing) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    解析并导入
                  </button>
                </div>
              </div>

              {importSummary && (
                <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-3 text-xs text-gray-300">
                  处理结果：解析 {importSummary.total} 条，新增 {importSummary.created}，更新 {importSummary.updated}，跳过 {importSummary.skipped}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-3 flex flex-wrap items-center gap-3">
                <span className="text-xs text-gray-300">
                  已识别多阶段疑似角色：{suspiciousCharacters.length}
                </span>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                  <input type="checkbox" checked={replaceOriginal} onChange={(e) => setReplaceOriginal(e.target.checked)} />
                  拆分后删除原条目
                </label>
                <button
                  onClick={runBatchSplit}
                  disabled={busy || batchSplitting || suspiciousCharacters.length <= 0}
                  className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-purple-700/70 hover:bg-purple-600/70 text-white disabled:opacity-40"
                >
                  {(batchSplitting || busy) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  批量拆分疑似多阶段角色
                </button>
              </div>

              <div className="space-y-2 max-h-[56vh] overflow-y-auto pr-1">
                {characters.map((el) => {
                  const suspicious = hasMultiAgeSignals(el.description) || hasMultiAgeSignals(el.voice_profile)
                  return (
                    <div key={el.id} className={`rounded-lg border p-3 ${suspicious ? 'border-amber-700/50 bg-amber-950/10' : 'border-gray-800 bg-gray-950/40'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-100 truncate">{el.name}</p>
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2">{el.description || '暂无描述'}</p>
                          {splitMessages[el.id] && (
                            <p className="text-[11px] text-purple-300 mt-1">{splitMessages[el.id]}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {suspicious && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-200">
                              多阶段疑似
                            </span>
                          )}
                          <button
                            onClick={() => runSplit(el.id)}
                            disabled={busy || splittingId === el.id}
                            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-40"
                          >
                            {splittingId === el.id ? '拆分中...' : '按阶段拆分'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {characters.length <= 0 && (
                  <p className="text-xs text-gray-500 py-4 text-center">暂无角色素材</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ElementEditDialog({
  initial,
  onClose,
  onSubmit,
}: {
  initial: StudioElement | null
  onClose: () => void
  onSubmit: (payload: { name: string; type: string; description?: string; voice_profile?: string; is_favorite?: number }) => void
}) {
  const [name, setName] = useState(initial?.name || '')
  const [type, setType] = useState(initial?.type || 'character')
  const [description, setDescription] = useState(initial?.description || '')
  const [voiceProfile, setVoiceProfile] = useState(initial?.voice_profile || '')
  const [favorite, setFavorite] = useState(initial?.is_favorite === 1)

  const submit = () => {
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      type,
      description: description.trim(),
      voice_profile: voiceProfile.trim(),
      is_favorite: favorite ? 1 : 0,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-xl p-6">
        <h3 className="text-base font-semibold text-gray-100 mb-4">{initial ? '编辑元素' : '新增元素'}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">类型</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            >
              <option value="character">角色</option>
              <option value="scene">场景</option>
              <option value="object">道具</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">描述</label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
            />
            {type === 'character' && hasMultiAgeSignals(description) && (
              <p className="text-[11px] text-amber-300 mt-1">
                检测到可能混入多个版本（如前期/后期、战前/战后），建议拆分为单独条目。
              </p>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">音色（角色可填）</label>
            <input
              value={voiceProfile}
              onChange={(e) => setVoiceProfile(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
              className="rounded"
            />
            收藏
          </label>
        </div>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm text-gray-400 hover:text-white">取消</button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

function SimpleTextDialog({
  title,
  text,
  onClose,
}: {
  title: string
  text: string
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-3xl max-h-[85vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-y-auto">
          <pre className="text-xs text-gray-300 whitespace-pre-wrap">{text}</pre>
        </div>
      </div>
    </div>
  )
}

function AgentProjectExportDialog({
  projects,
  loading,
  exporting,
  options,
  onChangeOptions,
  onRefresh,
  onClose,
  onConfirm,
}: {
  projects: AgentProjectOption[]
  loading: boolean
  exporting: boolean
  options: AgentExportOptions
  onChangeOptions: (patch: Partial<AgentExportOptions>) => void
  onRefresh: () => void | Promise<void>
  onClose: () => void
  onConfirm: () => void | Promise<void>
}) {
  const [keyword, setKeyword] = useState('')
  const filteredProjects = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    if (!normalizedKeyword) return projects
    return projects.filter((project) => {
      const brief = (project.creative_brief || {}) as Record<string, unknown>
      const briefTitle = typeof brief.title === 'string' ? brief.title : ''
      return [project.name, project.id, briefTitle]
        .join(' ')
        .toLowerCase()
        .includes(normalizedKeyword)
    })
  }, [keyword, projects])
  const selectedProject = projects.find((project) => project.id === options.selectedProjectId)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-3xl max-h-[88vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-200">导出到 Agent</h3>
            <p className="text-xs text-gray-500 mt-0.5">可选择新建项目或覆盖已有项目</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white" disabled={exporting}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onChangeOptions({ mode: 'new' })}
              className={`px-3 py-2 rounded border text-sm transition-colors ${
                options.mode === 'new'
                  ? 'border-purple-500/70 bg-purple-900/25 text-purple-100'
                  : 'border-gray-700 bg-gray-800/70 text-gray-300 hover:bg-gray-800'
              }`}
              disabled={exporting}
            >
              新建 Agent 项目
            </button>
            <button
              onClick={() => onChangeOptions({ mode: 'existing' })}
              className={`px-3 py-2 rounded border text-sm transition-colors ${
                options.mode === 'existing'
                  ? 'border-purple-500/70 bg-purple-900/25 text-purple-100'
                  : 'border-gray-700 bg-gray-800/70 text-gray-300 hover:bg-gray-800'
              }`}
              disabled={exporting}
            >
              覆盖已有项目
            </button>
          </div>

          {options.mode === 'new' ? (
            <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 space-y-2">
              <label className="text-xs text-gray-500">项目名称（可选，不填则自动生成）</label>
              <input
                value={options.projectName}
                onChange={(e) => onChangeOptions({ projectName: e.target.value })}
                disabled={exporting}
                placeholder="例如：竹取物语 · 第1幕 精修"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 disabled:opacity-60"
              />
            </div>
          ) : (
            <div className="rounded-lg border border-gray-800 bg-gray-950/35">
              <div className="p-3 pb-2 flex items-center gap-2">
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索 Agent 项目（名称 / ID / 标题）"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                  disabled={loading || exporting}
                />
                <button
                  onClick={() => onRefresh()}
                  disabled={loading || exporting}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>

              {loading ? (
                <div className="h-52 flex items-center justify-center text-gray-400 text-sm gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                  正在加载 Agent 项目列表...
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-gray-500 text-sm">
                  {projects.length === 0 ? '暂无可覆盖的 Agent 项目' : '没有匹配的项目'}
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto p-2 space-y-2">
                  {filteredProjects.map((project) => {
                    const brief = (project.creative_brief || {}) as Record<string, unknown>
                    const briefTitle = typeof brief.title === 'string' ? brief.title : ''
                    const updatedLabel = project.updated_at ? formatRelativeTime(project.updated_at) : '--'
                    return (
                      <button
                        key={project.id}
                        onClick={() => onChangeOptions({ selectedProjectId: project.id })}
                        className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                          options.selectedProjectId === project.id
                            ? 'border-purple-500/70 bg-purple-900/25'
                            : 'border-gray-800 bg-gray-900/55 hover:border-gray-600'
                        }`}
                        disabled={exporting}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-gray-100 truncate">{project.name || project.id}</p>
                          <span className="text-[11px] text-gray-500 shrink-0">{updatedLabel}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1 truncate">ID: {project.id}</p>
                        {briefTitle && (
                          <p className="text-xs text-gray-400 mt-1 line-clamp-1">{briefTitle}</p>
                        )}
                        <div className="mt-1.5 text-[11px] text-gray-500">
                          段落 {project.segments_count ?? '--'} · 元素 {project.elements_count ?? '--'}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 space-y-2">
            <p className="text-xs text-gray-500">同步选项</p>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={options.includeSharedElements}
                onChange={(e) => onChangeOptions({ includeSharedElements: e.target.checked })}
                disabled={exporting}
              />
              包含系列共享元素
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={options.includeEpisodeElements}
                onChange={(e) => onChangeOptions({ includeEpisodeElements: e.target.checked })}
                disabled={exporting}
              />
              包含当前分幕元素
            </label>
            {options.mode === 'existing' && (
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={options.preserveExistingMessages}
                  onChange={(e) => onChangeOptions({ preserveExistingMessages: e.target.checked })}
                  disabled={exporting}
                />
                保留 Agent 历史消息与记忆
              </label>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
          <div className="text-xs text-gray-500 truncate pr-3">
            {options.mode === 'existing'
              ? (selectedProject ? `将覆盖：${selectedProject.name || selectedProject.id}` : '请选择要覆盖的 Agent 项目')
              : (options.projectName.trim() ? `新建项目：${options.projectName.trim()}` : '将自动生成 Agent 项目名称')}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white"
              disabled={exporting}
            >
              取消
            </button>
            <button
              onClick={() => onConfirm()}
              disabled={loading || exporting || (options.mode === 'existing' && !options.selectedProjectId)}
              className="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
              {options.mode === 'existing' ? '覆盖并导出' : '新建并导出'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AgentProjectImportDialog({
  projects,
  loading,
  importing,
  selectedProjectId,
  onSelectProject,
  onRefresh,
  onClose,
  onConfirm,
}: {
  projects: AgentProjectOption[]
  loading: boolean
  importing: boolean
  selectedProjectId: string
  onSelectProject: (projectId: string) => void
  onRefresh: () => void | Promise<void>
  onClose: () => void
  onConfirm: () => void | Promise<void>
}) {
  const [keyword, setKeyword] = useState('')
  const filteredProjects = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    if (!normalizedKeyword) return projects
    return projects.filter((project) => {
      const brief = (project.creative_brief || {}) as Record<string, unknown>
      const briefTitle = typeof brief.title === 'string' ? brief.title : ''
      return [project.name, project.id, briefTitle]
        .join(' ')
        .toLowerCase()
        .includes(normalizedKeyword)
    })
  }, [keyword, projects])
  const selectedProject = projects.find((project) => project.id === selectedProjectId)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-3xl max-h-[85vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-200">从 Agent 导入项目</h3>
            <p className="text-xs text-gray-500 mt-0.5">选择一个 Agent 项目并导入到当前分幕</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              导入将覆盖当前分幕的镜头内容，并同步 Agent 项目的元素信息。
            </p>
            <button
              onClick={() => onRefresh()}
              disabled={loading || importing}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              刷新列表
            </button>
          </div>

          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索 Agent 项目（名称 / ID / 标题）"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
            disabled={loading || importing}
          />

          <div className="rounded-lg border border-gray-800 bg-gray-950/35">
            {loading ? (
              <div className="h-56 flex items-center justify-center text-gray-400 text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                正在加载 Agent 项目列表...
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-gray-500 text-sm">
                {projects.length === 0 ? '暂无可导入的 Agent 项目' : '没有匹配的项目'}
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto p-2 space-y-2">
                {filteredProjects.map((project) => {
                  const brief = (project.creative_brief || {}) as Record<string, unknown>
                  const briefTitle = typeof brief.title === 'string' ? brief.title : ''
                  const updatedLabel = project.updated_at ? formatRelativeTime(project.updated_at) : '--'
                  return (
                    <button
                      key={project.id}
                      onClick={() => onSelectProject(project.id)}
                      className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                        selectedProjectId === project.id
                          ? 'border-purple-500/70 bg-purple-900/25'
                          : 'border-gray-800 bg-gray-900/55 hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-gray-100 truncate">{project.name || project.id}</p>
                        <span className="text-[11px] text-gray-500 shrink-0">{updatedLabel}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 truncate">ID: {project.id}</p>
                      {briefTitle && (
                        <p className="text-xs text-gray-400 mt-1 line-clamp-1">{briefTitle}</p>
                      )}
                      <div className="mt-1.5 text-[11px] text-gray-500">
                        镜头段落 {project.segments_count ?? '--'} · 元素 {project.elements_count ?? '--'}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
          <div className="text-xs text-gray-500 truncate pr-3">
            {selectedProject ? `已选：${selectedProject.name || selectedProject.id}` : '请选择要导入的 Agent 项目'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white"
              disabled={importing}
            >
              取消
            </button>
            <button
              onClick={() => onConfirm()}
              disabled={!selectedProjectId || loading || importing}
              className="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              导入所选项目
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ToastStack({
  toasts,
  onClose,
}: {
  toasts: StudioToast[]
  onClose: (id: string) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  return (
    <div className="fixed top-14 right-4 z-[70] space-y-2 w-96 max-w-[calc(100vw-2rem)]">
      {toasts.map((toast) => (
        <div key={toast.id} className="bg-gray-900 border border-red-800/60 rounded-lg shadow-lg p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-red-200 break-words">{toast.message}</p>
                {toast.code && <p className="text-xs text-red-300/70 mt-1">code: {toast.code}</p>}
              </div>
            </div>
            <button onClick={() => onClose(toast.id)} className="text-gray-500 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {toast.context && Object.keys(toast.context).length > 0 && (
            <div className="mt-2">
              <button
                className="text-xs text-gray-400 hover:text-white"
                onClick={() => setExpanded((prev) => ({ ...prev, [toast.id]: !prev[toast.id] }))}
              >
                {expanded[toast.id] ? '收起详情' : '查看详情'}
              </button>
              {expanded[toast.id] && (
                <pre className="mt-2 text-xs text-gray-400 bg-gray-950 border border-gray-800 rounded p-2 whitespace-pre-wrap">
                  {JSON.stringify(toast.context, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ============================================================
// 创建系列对话框
// ============================================================

function CreateSeriesDialog({
  onClose,
  onSubmit,
  creating,
}: {
  onClose: () => void
  onSubmit: (params: {
    name: string
    script: string
    description?: string
    visual_style?: string
    target_episode_count?: number
    episode_duration_seconds?: number
  }) => void | Promise<void>
  creating: boolean
}) {
  const [name, setName] = useState('')
  const [script, setScript] = useState('')
  const [description, setDescription] = useState('')
  const [visualStyle, setVisualStyle] = useState('')
  const [targetCount, setTargetCount] = useState(0)
  const [duration, setDuration] = useState(90)

  const handleSubmit = () => {
    if (!name.trim() || !script.trim()) return
    onSubmit({
      name: name.trim(),
      script: script.trim(),
      description: description.trim() || undefined,
      visual_style: visualStyle.trim() || undefined,
      target_episode_count: targetCount || undefined,
      episode_duration_seconds: duration || undefined,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-lg font-semibold text-gray-100 mb-4">创建新系列</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">系列名称 *</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
              placeholder="例如：竹取物语"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-1">完整脚本 *</label>
            <textarea
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 resize-none"
              rows={10}
              placeholder="粘贴完整的故事脚本..."
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">
              {script.length} 字
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">简要描述</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                placeholder="可选"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">视觉风格</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                placeholder="例如：吉卜力2D / 电影级写实"
                value={visualStyle}
                onChange={(e) => setVisualStyle(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">期望集数（0=自动）</label>
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                value={targetCount}
                onChange={(e) => setTargetCount(parseInt(e.target.value) || 0)}
                min={0}
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">每集时长（秒）</label>
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value) || 90)}
                min={30}
                max={300}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !script.trim() || creating}
            className="px-6 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2 transition-colors"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            {creating ? '创建中（LLM 分幕+元素提取）...' : '创建系列'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 设置面板
// ============================================================

// 协议 → 后端 provider 映射
const PROTOCOL_OPTIONS = [
  { value: 'openai', label: 'OpenAI 协议' },
  { value: 'volcano', label: '火山引擎' },
  { value: 'wanxiang', label: '通义万相' },
  { value: 'relay', label: '中转站（OpenAI 兼容）' },
] as const

const BASE_URL_HINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  volcano: 'https://ark.cn-beijing.volces.com/api/v3',
  wanxiang: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  relay: 'https://your-relay.example.com/v1',
}

const MODEL_HINTS: Record<string, Record<string, string>> = {
  llm: {
    openai: 'gpt-4o / gpt-4o-mini',
    volcano: 'doubao-pro-4k / doubao-pro-128k',
    wanxiang: 'qwen-plus / qwen-max',
    relay: '按中转站支持的模型名填写',
  },
  image: {
    openai: 'dall-e-3',
    volcano: '按火山引擎图像模型填写',
    wanxiang: 'wanx-v1 / wanx2.1-t2i-turbo',
    relay: '按中转站支持的模型名填写',
  },
  video: {
    openai: '按 OpenAI 兼容视频模型填写',
    volcano: 'doubao-seedance-1-0-pro-250528 / doubao-seedance-1-5-pro-250926',
    wanxiang: 'wanx2.1-i2v-plus / wanx2.1-i2v-turbo',
    relay: '按中转站支持的视频模型名填写',
  },
}

// 协议值 → 后端实际 provider 值
const PROTOCOL_TO_PROVIDER: Record<string, Record<string, string>> = {
  llm: { openai: 'openai', volcano: 'doubao', wanxiang: 'qwen', relay: 'openai' },
  image: { openai: 'openai', volcano: 'doubao', wanxiang: 'dashscope', relay: 'openai' },
  // Studio 视频统一走 custom 分支，实际路由由 baseUrl 域名自动识别（ark/dashscope/relay）
  video: { openai: 'custom', volcano: 'custom', wanxiang: 'custom', relay: 'custom' },
}

// 后端 provider 值 → 协议值（反向映射，用于加载）
const PROVIDER_TO_PROTOCOL: Record<string, string> = {
  openai: 'openai',
  doubao: 'volcano',
  qwen: 'wanxiang',
  dashscope: 'wanxiang',
  kling: 'volcano',
  'qwen-video': 'wanxiang',
  custom: 'relay',
  // 其他一律归为中转站
}

interface ServiceConfig {
  protocol: string
  apiKey: string
  baseUrl: string
  model: string
}

type StudioTtsProvider =
  | 'volc_tts_v1_http'
  | 'fish_tts_v1'
  | 'aliyun_bailian_tts_v2'
  | 'custom_openai_tts'

interface StudioVolcTtsConfig {
  appid: string
  accessToken: string
  endpoint: string
  cluster: string
  model: string
  encoding: string
  rate: number
  speedRatio: number
  narratorVoiceType: string
  dialogueVoiceType: string
  dialogueMaleVoiceType: string
  dialogueFemaleVoiceType: string
}

interface StudioFishTtsConfig {
  apiKey: string
  baseUrl: string
  model: string
  encoding: string
  rate: number
  speedRatio: number
  narratorVoiceType: string
  dialogueVoiceType: string
  dialogueMaleVoiceType: string
  dialogueFemaleVoiceType: string
}

interface StudioBailianTtsConfig {
  apiKey: string
  baseUrl: string
  workspace: string
  model: string
  encoding: string
  rate: number
  speedRatio: number
  narratorVoiceType: string
  dialogueVoiceType: string
  dialogueMaleVoiceType: string
  dialogueFemaleVoiceType: string
}

interface StudioCustomTtsConfig {
  apiKey: string
  baseUrl: string
  model: string
  encoding: string
  rate: number
  speedRatio: number
  narratorVoiceType: string
  dialogueVoiceType: string
  dialogueMaleVoiceType: string
  dialogueFemaleVoiceType: string
}

interface TTSConfig {
  provider: StudioTtsProvider | string
  volc: StudioVolcTtsConfig
  fish: StudioFishTtsConfig
  bailian: StudioBailianTtsConfig
  custom: StudioCustomTtsConfig
}

const DEFAULT_STUDIO_TTS: TTSConfig = {
  provider: 'volc_tts_v1_http',
  volc: {
    appid: '',
    accessToken: '',
    endpoint: 'https://openspeech.bytedance.com/api/v1/tts',
    cluster: 'volcano_tts',
    model: 'seed-tts-1.1',
    encoding: 'mp3',
    rate: 24000,
    speedRatio: 1,
    narratorVoiceType: '',
    dialogueVoiceType: '',
    dialogueMaleVoiceType: '',
    dialogueFemaleVoiceType: '',
  },
  fish: {
    apiKey: '',
    baseUrl: 'https://api.fish.audio',
    model: 'speech-1.5',
    encoding: 'mp3',
    rate: 24000,
    speedRatio: 1,
    narratorVoiceType: '',
    dialogueVoiceType: '',
    dialogueMaleVoiceType: '',
    dialogueFemaleVoiceType: '',
  },
  bailian: {
    apiKey: '',
    baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    workspace: '',
    model: 'cosyvoice-v1',
    encoding: 'mp3',
    rate: 24000,
    speedRatio: 1,
    narratorVoiceType: '',
    dialogueVoiceType: '',
    dialogueMaleVoiceType: '',
    dialogueFemaleVoiceType: '',
  },
  custom: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-tts',
    encoding: 'mp3',
    rate: 24000,
    speedRatio: 1,
    narratorVoiceType: '',
    dialogueVoiceType: '',
    dialogueMaleVoiceType: '',
    dialogueFemaleVoiceType: '',
  },
}

function normalizeStudioTtsConfig(raw: unknown): TTSConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_STUDIO_TTS
  const obj = raw as Record<string, unknown>

  const asObj = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' ? value as Record<string, unknown> : {}
  )
  const asText = (value: unknown, fallback = ''): string => {
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    return fallback
  }
  const asNum = (value: unknown, fallback: number): number => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }

  const rawProvider = asText(obj.provider).trim()
  const legacyBase = asText(obj.baseUrl).trim()
  let provider = rawProvider
  if (!provider) {
    if (legacyBase.includes('fish.audio')) provider = 'fish_tts_v1'
    else if (legacyBase.includes('dashscope.aliyuncs.com')) provider = 'aliyun_bailian_tts_v2'
    else provider = 'volc_tts_v1_http'
  }

  const legacyVoice = asText(obj.voiceType).trim()
  const volcRaw = asObj(obj.volc)
  const fishRaw = asObj(obj.fish)
  const bailianRaw = asObj(obj.bailian)
  const customRaw = asObj(obj.custom)

  return {
    provider,
    volc: {
      appid: asText(volcRaw.appid ?? obj.appid, ''),
      accessToken: asText(volcRaw.accessToken ?? obj.accessToken, ''),
      endpoint: asText(volcRaw.endpoint, 'https://openspeech.bytedance.com/api/v1/tts'),
      cluster: asText(volcRaw.cluster ?? obj.cluster, 'volcano_tts'),
      model: asText(volcRaw.model ?? obj.model, 'seed-tts-1.1'),
      encoding: asText(volcRaw.encoding ?? obj.encoding, 'mp3'),
      rate: asNum(volcRaw.rate ?? obj.rate, 24000),
      speedRatio: asNum(volcRaw.speedRatio ?? obj.speedRatio, 1),
      narratorVoiceType: asText(volcRaw.narratorVoiceType ?? obj.narratorVoiceType ?? legacyVoice, ''),
      dialogueVoiceType: asText(volcRaw.dialogueVoiceType ?? obj.dialogueVoiceType, ''),
      dialogueMaleVoiceType: asText(volcRaw.dialogueMaleVoiceType ?? obj.dialogueMaleVoiceType, ''),
      dialogueFemaleVoiceType: asText(volcRaw.dialogueFemaleVoiceType ?? obj.dialogueFemaleVoiceType, ''),
    },
    fish: {
      apiKey: asText(fishRaw.apiKey ?? obj.apiKey ?? (provider === 'fish_tts_v1' ? obj.accessToken : ''), ''),
      baseUrl: asText(fishRaw.baseUrl ?? (legacyBase.includes('fish.audio') ? legacyBase : ''), 'https://api.fish.audio'),
      model: asText(fishRaw.model ?? obj.model, 'speech-1.5'),
      encoding: asText(fishRaw.encoding ?? obj.encoding, 'mp3'),
      rate: asNum(fishRaw.rate ?? obj.rate, 24000),
      speedRatio: asNum(fishRaw.speedRatio ?? obj.speedRatio, 1),
      narratorVoiceType: asText(fishRaw.narratorVoiceType ?? obj.narratorVoiceType ?? (provider === 'fish_tts_v1' ? legacyVoice : ''), ''),
      dialogueVoiceType: asText(fishRaw.dialogueVoiceType ?? obj.dialogueVoiceType, ''),
      dialogueMaleVoiceType: asText(fishRaw.dialogueMaleVoiceType ?? obj.dialogueMaleVoiceType, ''),
      dialogueFemaleVoiceType: asText(fishRaw.dialogueFemaleVoiceType ?? obj.dialogueFemaleVoiceType, ''),
    },
    bailian: {
      apiKey: asText(bailianRaw.apiKey ?? obj.apiKey ?? (provider === 'aliyun_bailian_tts_v2' ? obj.accessToken : ''), ''),
      baseUrl: asText(bailianRaw.baseUrl ?? (legacyBase.includes('dashscope.aliyuncs.com') ? legacyBase : ''), 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'),
      workspace: asText(bailianRaw.workspace, ''),
      model: asText(bailianRaw.model ?? obj.model, 'cosyvoice-v1'),
      encoding: asText(bailianRaw.encoding ?? obj.encoding, 'mp3'),
      rate: asNum(bailianRaw.rate ?? obj.rate, 24000),
      speedRatio: asNum(bailianRaw.speedRatio ?? obj.speedRatio, 1),
      narratorVoiceType: asText(bailianRaw.narratorVoiceType ?? obj.narratorVoiceType ?? (provider === 'aliyun_bailian_tts_v2' ? legacyVoice : ''), ''),
      dialogueVoiceType: asText(bailianRaw.dialogueVoiceType ?? obj.dialogueVoiceType, ''),
      dialogueMaleVoiceType: asText(bailianRaw.dialogueMaleVoiceType ?? obj.dialogueMaleVoiceType, ''),
      dialogueFemaleVoiceType: asText(bailianRaw.dialogueFemaleVoiceType ?? obj.dialogueFemaleVoiceType, ''),
    },
    custom: {
      apiKey: asText(customRaw.apiKey ?? obj.apiKey, ''),
      baseUrl: asText(customRaw.baseUrl ?? obj.baseUrl, 'https://api.openai.com/v1'),
      model: asText(customRaw.model ?? obj.model, 'gpt-4o-mini-tts'),
      encoding: asText(customRaw.encoding ?? obj.encoding, 'mp3'),
      rate: asNum(customRaw.rate ?? obj.rate, 24000),
      speedRatio: asNum(customRaw.speedRatio ?? obj.speedRatio, 1),
      narratorVoiceType: asText(customRaw.narratorVoiceType ?? obj.narratorVoiceType ?? (provider === 'custom_openai_tts' ? legacyVoice : ''), ''),
      dialogueVoiceType: asText(customRaw.dialogueVoiceType ?? obj.dialogueVoiceType, ''),
      dialogueMaleVoiceType: asText(customRaw.dialogueMaleVoiceType ?? obj.dialogueMaleVoiceType, ''),
      dialogueFemaleVoiceType: asText(customRaw.dialogueFemaleVoiceType ?? obj.dialogueFemaleVoiceType, ''),
    },
  }
}

interface GenerationDefaults {
  frame_width: number
  frame_height: number
  video_duration_seconds: number
  split_max_tokens: number
  plan_max_tokens: number
  enhance_max_tokens: number
}

type PromptModuleKey =
  | 'script_split'
  | 'element_extraction'
  | 'episode_planning'
  | 'episode_enhance'

interface PromptTemplateConfig {
  system: string
  user: string
}

type CustomPromptsConfig = Record<PromptModuleKey, PromptTemplateConfig>

const PROMPT_MODULE_META: Array<{ key: PromptModuleKey; label: string; description: string }> = [
  {
    key: 'script_split',
    label: '脚本拆分',
    description: '将完整脚本拆分为若干幕',
  },
  {
    key: 'element_extraction',
    label: '元素提取',
    description: '提取角色/场景/道具等共享元素',
  },
  {
    key: 'episode_planning',
    label: '分集规划',
    description: '为单集生成分镜与提示词',
  },
  {
    key: 'episode_enhance',
    label: '分镜增强',
    description: '对既有分镜做 Script Doctor 式增强',
  },
]

const DEFAULT_PROMPT_VARIABLE_HINTS: Record<PromptModuleKey, string[]> = {
  script_split: ['full_script', 'target_episode_count', 'episode_duration_seconds', 'visual_style'],
  element_extraction: ['full_script', 'acts_summary', 'visual_style'],
  episode_planning: [
    'series_name',
    'act_number',
    'episode_title',
    'series_bible',
    'visual_style',
    'shared_elements_list',
    'prev_summary',
    'script_excerpt',
    'next_summary',
    'target_duration_seconds',
    'suggested_shot_count',
  ],
  episode_enhance: ['series_bible', 'shared_elements_list', 'episode_json', 'mode'],
}

function createEmptyCustomPrompts(): CustomPromptsConfig {
  return {
    script_split: { system: '', user: '' },
    element_extraction: { system: '', user: '' },
    episode_planning: { system: '', user: '' },
    episode_enhance: { system: '', user: '' },
  }
}

function normalizePromptTemplateConfig(raw: unknown): PromptTemplateConfig {
  if (!raw || typeof raw !== 'object') return { system: '', user: '' }
  const obj = raw as Record<string, unknown>
  return {
    system: typeof obj.system === 'string' ? obj.system : '',
    user: typeof obj.user === 'string' ? obj.user : '',
  }
}

function normalizeCustomPrompts(raw: unknown): CustomPromptsConfig {
  const empty = createEmptyCustomPrompts()
  if (!raw || typeof raw !== 'object') return empty
  const obj = raw as Record<string, unknown>
  const normalized: CustomPromptsConfig = { ...empty }
  for (const module of PROMPT_MODULE_META) {
    normalized[module.key] = normalizePromptTemplateConfig(obj[module.key])
  }
  return normalized
}

function normalizePromptVariableHints(raw: unknown): Record<PromptModuleKey, string[]> {
  const normalized: Record<PromptModuleKey, string[]> = { ...DEFAULT_PROMPT_VARIABLE_HINTS }
  if (!raw || typeof raw !== 'object') return normalized
  const obj = raw as Record<string, unknown>
  for (const module of PROMPT_MODULE_META) {
    const list = obj[module.key]
    if (Array.isArray(list)) {
      normalized[module.key] = list.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    }
  }
  return normalized
}

function compactCustomPrompts(raw: CustomPromptsConfig): Record<string, PromptTemplateConfig> {
  const compacted: Record<string, PromptTemplateConfig> = {}
  for (const module of PROMPT_MODULE_META) {
    const value = raw[module.key]
    const system = value.system || ''
    const user = value.user || ''
    if (!system.trim() && !user.trim()) continue
    compacted[module.key] = { system, user }
  }
  return compacted
}

function StudioSettingsPanel({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'services' | 'prompts'>('services')
  const [promptModule, setPromptModule] = useState<PromptModuleKey>('script_split')
  const [llm, setLlm] = useState<ServiceConfig>({ protocol: 'openai', apiKey: '', baseUrl: '', model: '' })
  const [image, setImage] = useState<ServiceConfig>({ protocol: 'wanxiang', apiKey: '', baseUrl: '', model: '' })
  const [video, setVideo] = useState<ServiceConfig>({ protocol: 'volcano', apiKey: '', baseUrl: '', model: '' })
  const [tts, setTts] = useState<TTSConfig>(DEFAULT_STUDIO_TTS)
  const [defaults, setDefaults] = useState<GenerationDefaults>({
    frame_width: 1280,
    frame_height: 720,
    video_duration_seconds: 6,
    split_max_tokens: 8000,
    plan_max_tokens: 16000,
    enhance_max_tokens: 16000,
  })
  const [customPrompts, setCustomPrompts] = useState<CustomPromptsConfig>(createEmptyCustomPrompts())
  const [promptDefaults, setPromptDefaults] = useState<CustomPromptsConfig>(createEmptyCustomPrompts())
  const [promptVariableHints, setPromptVariableHints] = useState<Record<PromptModuleKey, string[]>>(DEFAULT_PROMPT_VARIABLE_HINTS)

  const currentPromptMeta = useMemo(
    () => PROMPT_MODULE_META.find((item) => item.key === promptModule) || PROMPT_MODULE_META[0],
    [promptModule],
  )
  const currentPromptCustom = customPrompts[promptModule]
  const currentPromptDefaults = promptDefaults[promptModule]
  const currentPromptVariableHints = promptVariableHints[promptModule] || []
  const currentPromptUsesDefault =
    !currentPromptCustom.system.trim() && !currentPromptCustom.user.trim()
  const ttsProvider = (tts.provider || 'volc_tts_v1_http').trim()
  const isVolcTTS = ttsProvider === 'volc_tts_v1_http'
  const isFishTTS = ttsProvider.startsWith('fish')
  const isBailianTTS = ttsProvider === 'aliyun_bailian_tts_v2' || ttsProvider === 'dashscope_tts_v2'
  const isCustomTTS = ttsProvider.startsWith('custom_') || ttsProvider === 'custom_openai_tts'
  const activeTts = isFishTTS ? tts.fish : isBailianTTS ? tts.bailian : isCustomTTS ? tts.custom : tts.volc

  useEffect(() => {
    let mounted = true
    const loadSettings = async () => {
      const [settings, promptDefaultsResp] = await Promise.all([
        studioGetSettings().catch(() => null),
        studioGetPromptTemplateDefaults().catch(() => null),
      ])

      if (!mounted) return

      if (promptDefaultsResp?.custom_prompts) {
        setPromptDefaults(normalizeCustomPrompts(promptDefaultsResp.custom_prompts))
      }
      if (promptDefaultsResp?.variable_hints) {
        setPromptVariableHints(normalizePromptVariableHints(promptDefaultsResp.variable_hints))
      }

      if (!settings) {
        setLoading(false)
        return
      }

      const mapLoad = (raw: Record<string, unknown>, service: 'llm' | 'image' | 'video'): ServiceConfig => {
        const provider = (raw.provider as string) || ''
        const baseUrl = (raw.baseUrl as string) || ''
        let protocol = PROVIDER_TO_PROTOCOL[provider] || (provider ? 'relay' : 'openai')
        if (service === 'video') {
          const lowerBase = baseUrl.toLowerCase()
          const lowerProvider = provider.toLowerCase()
          if (lowerProvider === 'custom' || lowerProvider.startsWith('custom_')) {
            if (lowerBase.includes('ark.cn') || lowerBase.includes('volces.com')) {
              protocol = 'volcano'
            } else if (lowerBase.includes('dashscope')) {
              protocol = 'wanxiang'
            } else {
              protocol = 'relay'
            }
          } else if (lowerProvider === 'kling' && (lowerBase.includes('ark.cn') || lowerBase.includes('volces.com'))) {
            // 兼容历史误映射：provider 被写成 kling，但 baseUrl 实际是火山 Ark
            protocol = 'volcano'
          } else if (lowerProvider === 'qwen-video' || lowerProvider === 'dashscope') {
            protocol = 'wanxiang'
          }
        }
        return {
          protocol,
          apiKey: (raw.apiKey as string) || '',
          baseUrl,
          model: (raw.model as string) || '',
        }
      }
      if (settings.llm) setLlm(mapLoad(settings.llm as Record<string, unknown>, 'llm'))
      if (settings.image) setImage(mapLoad(settings.image as Record<string, unknown>, 'image'))
      if (settings.video) setVideo(mapLoad(settings.video as Record<string, unknown>, 'video'))
      if (settings.tts) setTts(normalizeStudioTtsConfig(settings.tts))
      if (settings.generation_defaults && typeof settings.generation_defaults === 'object') {
        const raw = settings.generation_defaults as Record<string, unknown>
        setDefaults((prev) => ({
          frame_width: Number(raw.frame_width) || prev.frame_width,
          frame_height: Number(raw.frame_height) || prev.frame_height,
          video_duration_seconds: Number(raw.video_duration_seconds) || prev.video_duration_seconds,
          split_max_tokens: Number(raw.split_max_tokens) || prev.split_max_tokens,
          plan_max_tokens: Number(raw.plan_max_tokens) || prev.plan_max_tokens,
          enhance_max_tokens: Number(raw.enhance_max_tokens) || prev.enhance_max_tokens,
        }))
      }

      if (settings.custom_prompts) {
        setCustomPrompts(normalizeCustomPrompts(settings.custom_prompts))
      }
      setLoading(false)
    }

    loadSettings().catch(() => {
      if (mounted) setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  const updateCustomPrompt = useCallback(
    (module: PromptModuleKey, field: keyof PromptTemplateConfig, value: string) => {
      setCustomPrompts((prev) => ({
        ...prev,
        [module]: {
          ...prev[module],
          [field]: value,
        },
      }))
    },
    [],
  )

  const handleSave = async () => {
    setSaving(true)
    try {
      // 协议转换为后端 provider
      const mapSave = (cfg: ServiceConfig, service: string) => ({
        provider: PROTOCOL_TO_PROVIDER[service]?.[cfg.protocol] || cfg.protocol,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
      })
      await studioSaveSettings({
        llm: mapSave(llm, 'llm'),
        image: mapSave(image, 'image'),
        video: mapSave(video, 'video'),
        tts,
        generation_defaults: defaults,
        custom_prompts: compactCustomPrompts(customPrompts),
      })
      onClose()
    } catch (e) {
      console.error('保存设置失败:', e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-6xl max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-purple-400" />
            Studio 工作台设置
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-xs text-gray-500">
              Studio 工作台拥有独立配置，不与 Agent / Module 共享。未配置时自动复用 Module 设置。
            </p>

            <div className="inline-flex bg-gray-800/70 border border-gray-700 rounded-lg p-1">
              <button
                onClick={() => setActiveTab('services')}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  activeTab === 'services'
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                服务配置
              </button>
              <button
                onClick={() => setActiveTab('prompts')}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  activeTab === 'prompts'
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                提示词管理
              </button>
            </div>

            {activeTab === 'services' ? (
              <div className="space-y-6">
                <ServiceConfigForm
                  title="LLM 大语言模型"
                  description="用于脚本分幕、元素提取、分镜规划"
                  serviceKey="llm"
                  config={llm}
                  onChange={setLlm}
                />

                <ServiceConfigForm
                  title="图像生成"
                  description="用于共享元素参考图、镜头起始帧"
                  serviceKey="image"
                  config={image}
                  onChange={setImage}
                />

                <ServiceConfigForm
                  title="视频生成"
                  description="用于镜头视频生成"
                  serviceKey="video"
                  config={video}
                  onChange={setVideo}
                />

                <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-200 mb-1">语音合成（TTS）</h3>
                  <p className="text-xs text-gray-500 mb-3">用于镜头旁白/对白音频生成</p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Provider</label>
                      <select
                        value={ttsProvider}
                        onChange={(e) => setTts((prev) => ({ ...prev, provider: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                      >
                        {isCustomTTS && ttsProvider !== 'custom_openai_tts' && (
                          <option value={ttsProvider}>{`自定义（${ttsProvider}）`}</option>
                        )}
                        <option value="volc_tts_v1_http">Volc OpenSpeech</option>
                        <option value="fish_tts_v1">Fish Audio</option>
                        <option value="aliyun_bailian_tts_v2">阿里百炼（DashScope）</option>
                        <option value="custom_openai_tts">自定义（OpenAI 兼容）</option>
                      </select>
                    </div>

                    {isVolcTTS && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">App ID</label>
                          <input
                            value={tts.volc.appid}
                            onChange={(e) => setTts((prev) => ({ ...prev, volc: { ...prev.volc, appid: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="火山引擎 App ID"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Access Token</label>
                          <input
                            type="password"
                            value={tts.volc.accessToken}
                            onChange={(e) => setTts((prev) => ({ ...prev, volc: { ...prev.volc, accessToken: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="火山引擎 Access Token"
                          />
                        </div>
                      </div>
                    )}

                    {isFishTTS && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">API Key</label>
                          <input
                            type="password"
                            value={tts.fish.apiKey}
                            onChange={(e) => setTts((prev) => ({ ...prev, fish: { ...prev.fish, apiKey: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="Fish API Key"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Base URL</label>
                          <input
                            value={tts.fish.baseUrl}
                            onChange={(e) => setTts((prev) => ({ ...prev, fish: { ...prev.fish, baseUrl: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="https://api.fish.audio"
                          />
                        </div>
                      </div>
                    )}

                    {isBailianTTS && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">API Key</label>
                          <input
                            type="password"
                            value={tts.bailian.apiKey}
                            onChange={(e) => setTts((prev) => ({ ...prev, bailian: { ...prev.bailian, apiKey: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="阿里百炼 API Key"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">WebSocket URL</label>
                          <input
                            value={tts.bailian.baseUrl}
                            onChange={(e) => setTts((prev) => ({ ...prev, bailian: { ...prev.bailian, baseUrl: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="wss://dashscope.aliyuncs.com/api-ws/v1/inference"
                          />
                        </div>
                      </div>
                    )}

                    {isCustomTTS && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">API Key</label>
                          <input
                            type="password"
                            value={tts.custom.apiKey}
                            onChange={(e) => setTts((prev) => ({ ...prev, custom: { ...prev.custom, apiKey: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="OpenAI 兼容 API Key"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Base URL</label>
                          <input
                            value={tts.custom.baseUrl}
                            onChange={(e) => setTts((prev) => ({ ...prev, custom: { ...prev.custom, baseUrl: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="https://your-host/v1"
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">模型</label>
                        <input
                          value={activeTts.model}
                          onChange={(e) => {
                            const v = e.target.value
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, model: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, model: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, model: v } }
                              return { ...prev, volc: { ...prev.volc, model: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder={isVolcTTS ? 'seed-tts-1.1' : isFishTTS ? 'speech-1.5' : isBailianTTS ? 'cosyvoice-v1' : 'gpt-4o-mini-tts'}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">编码</label>
                        <input
                          value={activeTts.encoding}
                          onChange={(e) => {
                            const v = e.target.value
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, encoding: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, encoding: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, encoding: v } }
                              return { ...prev, volc: { ...prev.volc, encoding: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder="mp3 / wav / pcm / opus"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">采样率</label>
                        <input
                          type="number"
                          value={activeTts.rate}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10) || 24000
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, rate: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, rate: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, rate: v } }
                              return { ...prev, volc: { ...prev.volc, rate: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder="24000"
                        />
                      </div>
                    </div>

                    {isVolcTTS && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Endpoint</label>
                          <input
                            value={tts.volc.endpoint}
                            onChange={(e) => setTts((prev) => ({ ...prev, volc: { ...prev.volc, endpoint: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="https://openspeech.bytedance.com/api/v1/tts"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Cluster</label>
                          <input
                            value={tts.volc.cluster}
                            onChange={(e) => setTts((prev) => ({ ...prev, volc: { ...prev.volc, cluster: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="volcano_tts"
                          />
                        </div>
                      </div>
                    )}

                    {isBailianTTS && (
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Workspace（可选）</label>
                        <input
                          value={tts.bailian.workspace}
                          onChange={(e) => setTts((prev) => ({ ...prev, bailian: { ...prev.bailian, workspace: e.target.value } }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder="workspace id"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">旁白音色</label>
                        <input
                          value={activeTts.narratorVoiceType}
                          onChange={(e) => {
                            const v = e.target.value
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, narratorVoiceType: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, narratorVoiceType: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, narratorVoiceType: v } }
                              return { ...prev, volc: { ...prev.volc, narratorVoiceType: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder={isFishTTS ? 'reference_id' : isVolcTTS ? 'voice_type' : 'voice'}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">对白（男）</label>
                        <input
                          value={activeTts.dialogueMaleVoiceType}
                          onChange={(e) => {
                            const v = e.target.value
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, dialogueMaleVoiceType: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, dialogueMaleVoiceType: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, dialogueMaleVoiceType: v } }
                              return { ...prev, volc: { ...prev.volc, dialogueMaleVoiceType: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder={isFishTTS ? 'reference_id' : isVolcTTS ? 'voice_type' : 'voice'}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">对白（女）</label>
                        <input
                          value={activeTts.dialogueFemaleVoiceType}
                          onChange={(e) => {
                            const v = e.target.value
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, dialogueFemaleVoiceType: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, dialogueFemaleVoiceType: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, dialogueFemaleVoiceType: v } }
                              return { ...prev, volc: { ...prev.volc, dialogueFemaleVoiceType: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder={isFishTTS ? 'reference_id' : isVolcTTS ? 'voice_type' : 'voice'}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">对白（通用）</label>
                        <input
                          value={activeTts.dialogueVoiceType}
                          onChange={(e) => {
                            const v = e.target.value
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, dialogueVoiceType: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, dialogueVoiceType: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, dialogueVoiceType: v } }
                              return { ...prev, volc: { ...prev.volc, dialogueVoiceType: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder={isFishTTS ? 'reference_id' : isVolcTTS ? 'voice_type' : 'voice'}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-200 mb-1">默认生成参数</h3>
                  <p className="text-xs text-gray-500 mb-3">用于控制默认画面、视频和 LLM token 配置</p>
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">帧宽度</label>
                        <input
                          type="number"
                          value={defaults.frame_width}
                          onChange={(e) => setDefaults((prev) => ({ ...prev, frame_width: parseInt(e.target.value) || 1280 }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">帧高度</label>
                        <input
                          type="number"
                          value={defaults.frame_height}
                          onChange={(e) => setDefaults((prev) => ({ ...prev, frame_height: parseInt(e.target.value) || 720 }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">默认视频时长(s)</label>
                        <input
                          type="number"
                          value={defaults.video_duration_seconds}
                          onChange={(e) => setDefaults((prev) => ({ ...prev, video_duration_seconds: parseInt(e.target.value) || 6 }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">split max_tokens</label>
                        <input
                          type="number"
                          value={defaults.split_max_tokens}
                          onChange={(e) => setDefaults((prev) => ({ ...prev, split_max_tokens: parseInt(e.target.value) || 8000 }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">plan max_tokens</label>
                        <input
                          type="number"
                          value={defaults.plan_max_tokens}
                          onChange={(e) => setDefaults((prev) => ({ ...prev, plan_max_tokens: parseInt(e.target.value) || 16000 }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">enhance max_tokens</label>
                        <input
                          type="number"
                          value={defaults.enhance_max_tokens}
                          onChange={(e) => setDefaults((prev) => ({ ...prev, enhance_max_tokens: parseInt(e.target.value) || 16000 }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {PROMPT_MODULE_META.map((module) => (
                    <button
                      key={module.key}
                      onClick={() => setPromptModule(module.key)}
                      className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                        promptModule === module.key
                          ? 'bg-purple-600/20 text-purple-100 border-purple-500/60'
                          : 'bg-gray-800/60 text-gray-300 border-gray-700 hover:border-gray-500 hover:text-gray-100'
                      }`}
                    >
                      {module.label}
                    </button>
                  ))}
                </div>

                <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-100">{currentPromptMeta.label}</p>
                      <p className="text-xs text-gray-500 mt-1">{currentPromptMeta.description}</p>
                      <div className="mt-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] border ${
                            currentPromptUsesDefault
                              ? 'border-gray-600 text-gray-300 bg-gray-800/70'
                              : 'border-purple-500/50 text-purple-100 bg-purple-500/15'
                          }`}
                        >
                          {currentPromptUsesDefault ? '使用系统默认模板' : '已自定义模板'}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        setCustomPrompts((prev) => ({
                          ...prev,
                          [promptModule]: { system: '', user: '' },
                        }))
                      }
                      className="px-3 py-1.5 text-xs rounded border border-gray-600 text-gray-300 hover:text-gray-100 hover:border-gray-500"
                    >
                      恢复当前模块默认
                    </button>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-2">可用变量</p>
                    <div className="flex flex-wrap gap-2">
                      {currentPromptVariableHints.map((token) => (
                        <code
                          key={token}
                          className="px-2 py-0.5 rounded text-[11px] bg-gray-800 border border-gray-700 text-gray-300"
                        >
                          {`{${token}}`}
                        </code>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-300">系统提示词（System Prompt）</p>
                        <button
                          onClick={() => updateCustomPrompt(promptModule, 'system', currentPromptDefaults.system)}
                          className="text-[11px] px-2 py-1 rounded border border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-500"
                        >
                          填入默认模板
                        </button>
                      </div>
                      <textarea
                        value={currentPromptCustom.system}
                        onChange={(e) => updateCustomPrompt(promptModule, 'system', e.target.value)}
                        rows={12}
                        className="w-full resize-y bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                        placeholder="留空时自动使用系统默认模板"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-300">用户提示词模板（User Prompt）</p>
                        <button
                          onClick={() => updateCustomPrompt(promptModule, 'user', currentPromptDefaults.user)}
                          className="text-[11px] px-2 py-1 rounded border border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-500"
                        >
                          填入默认模板
                        </button>
                      </div>
                      <textarea
                        value={currentPromptCustom.user}
                        onChange={(e) => updateCustomPrompt(promptModule, 'user', e.target.value)}
                        rows={12}
                        className="w-full resize-y bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                        placeholder="留空时自动使用系统默认模板"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-800">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                保存设置
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ServiceConfigForm({
  title,
  description,
  serviceKey,
  config,
  onChange,
}: {
  title: string
  description: string
  serviceKey: string
  config: ServiceConfig
  onChange: (c: ServiceConfig) => void
}) {
  const urlHint = BASE_URL_HINTS[config.protocol] || ''
  const modelHint = MODEL_HINTS[serviceKey]?.[config.protocol] || ''

  return (
    <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
      <h3 className="text-sm font-semibold text-gray-200 mb-1">{title}</h3>
      <p className="text-xs text-gray-500 mb-3">{description}</p>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">协议</label>
          <select
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            value={config.protocol}
            onChange={(e) => onChange({ ...config, protocol: e.target.value })}
          >
            {PROTOCOL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">API Key</label>
          <input
            type="password"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            placeholder="sk-..."
            value={config.apiKey}
            onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Base URL</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            placeholder={urlHint}
            value={config.baseUrl}
            onChange={(e) => onChange({ ...config, baseUrl: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">模型</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            placeholder={modelHint}
            value={config.model}
            onChange={(e) => onChange({ ...config, model: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}
