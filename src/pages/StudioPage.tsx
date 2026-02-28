import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Settings2, Plus, Film, Users, MapPin, Package,
  Loader2, Play, RefreshCw, ChevronRight, ImageIcon,
  Video, Mic, Layers, Sparkles, CheckCircle, AlertCircle, X, Save, ChevronLeft, Wand2,
  FileText, History, RotateCcw, Undo2, Redo2,
} from 'lucide-react'
import { useStudioStore } from '../store/studioStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import axios from 'axios'
import {
  studioCheckConfig, studioExportEpisode, studioExportSeries,
  listAgentProjects, studioExportEpisodeToAgent, studioImportEpisodeFromAgent,
  studioPromptBatchCheck, studioPromptOptimize, studioSaveDigitalHumanProfiles,
} from '../services/api'
import type {
  StudioEpisodeHistoryEntry,
  StudioElementRenderMode,
  StudioElementReferenceMode,
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
import HoverMediaPreview from '../components/studio/HoverMediaPreview'
import CharacterDesignConsoleDialog from '../components/studio/CharacterDesignConsoleDialog'
import ElementLibraryPanel from '../components/studio/ElementLibraryPanel'
import HoverOverviewPanel from '../components/studio/HoverOverviewPanel'
import SeriesOverview from '../components/studio/SeriesOverview'
import ShotDetailPanel from '../components/studio/ShotDetailPanel'
import StudioSettingsPanel from '../components/studio/StudioSettingsPanel'
import DocumentUploadButton from '../components/studio/DocumentUploadButton'
import CharacterSettingCardDialog from '../components/studio/CharacterSettingCardDialog'
import {
  STUDIO_IMAGE_RATIO_PRESETS,
  isStudioImageRatioValue,
  resolveStudioImageRatioPreset,
  type StudioImageRatioValue,
} from '../components/studio/imageRatio'

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
const GENERATION_VIDEO_MODEL_AUDIO_KEY = 'studio.generation.videoModelAudio'
const SHOT_IMAGE_RATIO_KEY = 'studio.shot.imageRatio'
export type WorkbenchMode = 'longform' | 'short_video' | 'digital_human'

type PromptFieldKey = 'prompt' | 'end_prompt' | 'video_prompt'

type DigitalHumanProfileDraft = {
  id: string
  base_name: string
  display_name: string
  stage_label: string
  appearance: string
  voice_profile: string
  scene_template: string
  lip_sync_style: string
}

const SHORT_VIDEO_DURATION_PRESETS = [15, 30, 45, 60] as const
const DIGITAL_HUMAN_LIP_SYNC_OPTIONS = [
  '写实口型',
  '轻拟合口型',
  '夸张口型',
  '对白优先',
  '旁白优先',
] as const

const PROMPT_FIELD_META: Array<{ field: PromptFieldKey; label: string }> = [
  { field: 'prompt', label: '起始帧提示词' },
  { field: 'end_prompt', label: '尾帧提示词' },
  { field: 'video_prompt', label: '视频提示词' },
]

function isPromptFieldKey(value: string): value is PromptFieldKey {
  return value === 'prompt' || value === 'end_prompt' || value === 'video_prompt'
}

function resolveRouteBase(pathname: string, fallback: string = '/studio'): string {
  const path = (pathname || '').toLowerCase()
  if (path.startsWith('/short-video')) return '/short-video'
  if (path.startsWith('/digital-human')) return '/digital-human'
  return fallback
}

function inferModeByRoute(routeBase: string): WorkbenchMode {
  if (routeBase === '/short-video') return 'short_video'
  if (routeBase === '/digital-human') return 'digital_human'
  return 'longform'
}

function getWorkbenchLabel(mode: WorkbenchMode): string {
  if (mode === 'short_video') return '短视频制作工作台'
  if (mode === 'digital_human') return '数字人短剧工作台'
  return '长篇制作工作台'
}

function getWorkbenchWelcomeText(mode: WorkbenchMode): string {
  if (mode === 'short_video') {
    return '面向 15-60 秒快节奏内容，支持脚本快速拆分、批量生成和时间线预览导出。'
  }
  if (mode === 'digital_human') {
    return '聚焦数字人角色驱动创作，支持按阶段管理角色形象、音色与场景模板。'
  }
  return '在这里创建系列故事，进行分幕拆解、元素提取、逐集分镜规划和资产生成。适合多集、长篇精细化视频制作。'
}

function createDigitalHumanProfile(): DigitalHumanProfileDraft {
  return {
    id: `dh_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    base_name: '',
    display_name: '',
    stage_label: '',
    appearance: '',
    voice_profile: '',
    scene_template: '',
    lip_sync_style: DIGITAL_HUMAN_LIP_SYNC_OPTIONS[0],
  }
}

function normalizeDigitalHumanProfiles(value: unknown): DigitalHumanProfileDraft[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): DigitalHumanProfileDraft | null => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const baseName = String(row.base_name || row.character_name || row.name || '').trim()
      const displayName = String(row.display_name || row.name || baseName).trim()
      if (!baseName && !displayName) return null
      return {
        id: String(row.id || row.profile_id || `${baseName}_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`),
        base_name: baseName || displayName,
        display_name: displayName || baseName,
        stage_label: String(row.stage_label || row.stage || '').trim(),
        appearance: String(row.appearance || row.description || '').trim(),
        voice_profile: String(row.voice_profile || '').trim(),
        scene_template: String(row.scene_template || row.scene || '').trim(),
        lip_sync_style: String(row.lip_sync_style || row.lip_sync || DIGITAL_HUMAN_LIP_SYNC_OPTIONS[0]).trim() || DIGITAL_HUMAN_LIP_SYNC_OPTIONS[0],
      }
    })
    .filter((item): item is DigitalHumanProfileDraft => Boolean(item))
}

function getDigitalHumanProfileDisplayName(profile: DigitalHumanProfileDraft): string {
  const name = profile.display_name.trim() || profile.base_name.trim() || '未命名角色'
  const stage = profile.stage_label.trim()
  return stage ? `${name}（${stage}）` : name
}

function buildDigitalHumanProfileElementDescription(profile: DigitalHumanProfileDraft): string {
  const chunks: string[] = []
  if (profile.appearance.trim()) chunks.push(profile.appearance.trim())
  if (profile.scene_template.trim()) chunks.push(`场景模板：${profile.scene_template.trim()}`)
  if (profile.lip_sync_style.trim()) chunks.push(`口型策略：${profile.lip_sync_style.trim()}`)
  return chunks.join('；')
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

export function getEpisodeStatusText(status: string): string {
  if (status === 'draft') return '草稿'
  if (status === 'planned') return '已规划'
  if (status === 'in_progress') return '制作中'
  if (status === 'completed') return '已完成'
  return status
}

export function getEpisodeStatusBadgeClass(status: string): string {
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
    if ((cur.sound_effects || '') !== (prev.sound_effects || '')) changedFields.push('音效信息')

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

interface StudioPageProps {
  forcedWorkbenchMode?: WorkbenchMode
  routeBase?: '/studio' | '/short-video' | '/digital-human'
}

export default function StudioPage({ forcedWorkbenchMode, routeBase }: StudioPageProps = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const { seriesId, episodeId } = useParams()
  const store = useStudioStore()
  const workspaceInitialized = useWorkspaceStore((state) => state.initialized)
  const initWorkspace = useWorkspaceStore((state) => state.init)
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId)
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const setWorkspaceId = useWorkspaceStore((state) => state.setCurrentWorkspaceId)
  const routePrefix = routeBase || resolveRouteBase(location.pathname, '/studio')
  const workbenchMode: WorkbenchMode = forcedWorkbenchMode || inferModeByRoute(routePrefix)
  const workbenchLabel = getWorkbenchLabel(workbenchMode)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showCharacterConsole, setShowCharacterConsole] = useState(false)
  const [showCharacterCard, setShowCharacterCard] = useState(false)
  const [showDigitalHumanConsole, setShowDigitalHumanConsole] = useState(false)
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
  const [videoModelAudioEnabled, setVideoModelAudioEnabled] = useState<boolean>(() => readStoredBoolean(GENERATION_VIDEO_MODEL_AUDIO_KEY, false))
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
  const visibleSeriesList = useMemo(
    () => store.seriesList.filter((series) => {
      const mode = String(series.settings?.workbench_mode || 'longform')
      if (!series.settings?.workbench_mode) return workbenchMode === 'longform'
      return mode === workbenchMode
    }),
    [store.seriesList, workbenchMode],
  )
  const projectScope = useMemo(() => {
    if (store.currentEpisodeId) return `episode:${store.currentEpisodeId}`
    if (store.currentSeriesId) return `series:${store.currentSeriesId}`
    return 'studio:global'
  }, [store.currentEpisodeId, store.currentSeriesId])
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
    if (!workspaceInitialized) {
      void initWorkspace()
      return
    }
    store.loadSeriesList()
  }, [workspaceInitialized, currentWorkspaceId, initWorkspace])

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

  useEffect(() => {
    const currentSeries = store.currentSeries
    if (!currentSeries) return
    const mode = String(currentSeries.settings?.workbench_mode || 'longform')
    if (mode === workbenchMode) return
    store.selectSeries(null)
    navigate(routePrefix, { replace: true })
  }, [store.currentSeries, workbenchMode, routePrefix, navigate])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      if (!meta) return
      const key = event.key.toLowerCase()
      if (key !== 'z') return
      const isRedo = event.shiftKey
      event.preventDefault()
      if (isRedo) {
        if (!currentWorkspaceId) {
          pushToast({ message: '请先选择工作区后再执行重做', code: 'workspace_required' })
          return
        }
        void store.redoWorkspaceOperation(currentWorkspaceId, projectScope)
      } else {
        if (!currentWorkspaceId) {
          pushToast({ message: '请先选择工作区后再执行撤销', code: 'workspace_required' })
          return
        }
        void store.undoWorkspaceOperation(currentWorkspaceId, projectScope)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentWorkspaceId, projectScope, pushToast, store])

  const handleSelectSeries = useCallback((id: string) => {
    navigate(`${routePrefix}/${id}`)
  }, [navigate, routePrefix])

  const handleSelectEpisode = useCallback((id: string) => {
    if (store.currentSeriesId) {
      navigate(`${routePrefix}/${store.currentSeriesId}/${id}`)
    }
  }, [navigate, routePrefix, store.currentSeriesId])

  const handleBackToSeries = useCallback(() => {
    if (store.currentSeriesId) {
      navigate(`${routePrefix}/${store.currentSeriesId}`)
    }
  }, [navigate, routePrefix, store.currentSeriesId])

  const handleCreateSeries = useCallback(async (params: {
    name: string
    script: string
    description?: string
    visual_style?: string
    series_bible?: string
    target_episode_count?: number
    episode_duration_seconds?: number
  }) => {
    const ok = await ensureConfigReady(['llm'])
    if (!ok) return null
    return store.createSeries({
      ...params,
      workspace_id: currentWorkspaceId || undefined,
      workbench_mode: workbenchMode,
    })
  }, [ensureConfigReady, store, currentWorkspaceId, workbenchMode])

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

  const handleGenerateShotAsset = useCallback(async (
    shotId: string,
    stage: 'frame' | 'key_frame' | 'end_frame' | 'video' | 'audio',
    options?: { width?: number; height?: number },
  ) => {
    const required: ServiceKey[] =
      stage === 'frame' || stage === 'key_frame' || stage === 'end_frame' ? ['image'] : stage === 'video' ? ['video'] : ['tts']
    const ok = await ensureConfigReady(required)
    if (!ok) return
    await store.generateShotAsset(
      shotId,
      stage,
      stage === 'video'
        ? { video_generate_audio: videoModelAudioEnabled }
        : stage === 'frame' || stage === 'key_frame' || stage === 'end_frame'
          ? { width: options?.width, height: options?.height }
          : undefined,
    )
  }, [ensureConfigReady, store, videoModelAudioEnabled])

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

  const handleBatchGenerate = useCallback(async (
    episodeId: string,
    stages?: string[],
    options?: {
      image_width?: number
      image_height?: number
      element_use_reference?: boolean
      element_reference_mode?: StudioElementReferenceMode
    },
  ) => {
    const defaultStages = videoModelAudioEnabled
      ? ['elements', 'frames', 'end_frames', 'videos']
      : ['elements', 'frames', 'end_frames', 'videos', 'audio']
    const actualStages = stages && stages.length > 0 ? stages : defaultStages
    const required = new Set<ServiceKey>()
    if (actualStages.includes('elements') || actualStages.includes('frames') || actualStages.includes('end_frames')) required.add('image')
    if (actualStages.includes('videos')) required.add('video')
    if (actualStages.includes('audio')) required.add('tts')
    const ok = await ensureConfigReady(Array.from(required))
    if (!ok) return
    await store.batchGenerate(
      episodeId,
      actualStages,
      {
        video_generate_audio: videoModelAudioEnabled,
        image_width: options?.image_width,
        image_height: options?.image_height,
        element_use_reference: options?.element_use_reference,
        element_reference_mode: options?.element_reference_mode,
      },
    )
  }, [ensureConfigReady, store, videoModelAudioEnabled])

  const handleBatchGenerateElementsForSeries = useCallback(async (options?: {
    width?: number
    height?: number
    useReference?: boolean
    referenceMode?: StudioElementReferenceMode
  }) => {
    const targetEpisodeId = store.episodes[0]?.id
    if (!targetEpisodeId) {
      pushToast({ message: '当前系列尚未生成分幕，无法批量生成素材', code: 'series_has_no_episode' })
      return
    }
    await handleBatchGenerate(targetEpisodeId, ['elements'], {
      image_width: options?.width,
      image_height: options?.height,
      element_use_reference: options?.useReference,
      element_reference_mode: options?.referenceMode,
    })
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

  const handleShortVideoQuickPipeline = useCallback(async (
    episodeId: string,
    options?: { image_width?: number; image_height?: number },
  ) => {
    const required: ServiceKey[] = ['llm', 'image', 'video']
    if (!videoModelAudioEnabled) required.push('tts')
    const ok = await ensureConfigReady(required)
    if (!ok) return
    const currentHasShots = store.currentEpisodeId === episodeId && store.shots.length > 0
    if (!currentHasShots) {
      await store.planEpisode(episodeId)
    }
    await store.batchGenerate(
      episodeId,
      videoModelAudioEnabled ? ['frames', 'videos'] : ['frames', 'videos', 'audio'],
      {
        video_generate_audio: videoModelAudioEnabled,
        image_width: options?.image_width,
        image_height: options?.image_height,
      },
    )
  }, [ensureConfigReady, store, videoModelAudioEnabled])

  const handleSaveDigitalHumanProfiles = useCallback(async (profiles: DigitalHumanProfileDraft[]) => {
    if (!store.currentSeriesId || !store.currentSeries) return
    const cleaned = profiles.map((profile) => ({
      id: profile.id,
      base_name: profile.base_name.trim(),
      display_name: profile.display_name.trim() || profile.base_name.trim(),
      stage_label: profile.stage_label.trim(),
      appearance: profile.appearance.trim(),
      voice_profile: profile.voice_profile.trim(),
      scene_template: profile.scene_template.trim(),
      lip_sync_style: profile.lip_sync_style.trim() || DIGITAL_HUMAN_LIP_SYNC_OPTIONS[0],
    })).filter((profile) => profile.base_name || profile.display_name)
    const currentMode = String(store.currentSeries.settings?.workbench_mode || 'longform')
    if (currentMode !== 'digital_human') {
      await store.updateSeries(store.currentSeriesId, {
        settings: {
          ...(store.currentSeries.settings || {}),
          workbench_mode: 'digital_human',
        },
      })
    }
    await studioSaveDigitalHumanProfiles(store.currentSeriesId, cleaned)
    await store.selectSeries(store.currentSeriesId)
    pushToast({ message: `数字人角色配置已保存（${cleaned.length} 条）` })
  }, [pushToast, store, store.currentSeries, store.currentSeriesId])

  const handleSyncDigitalHumanProfilesToElements = useCallback(async (profiles: DigitalHumanProfileDraft[]) => {
    if (!store.currentSeriesId) return
    const characterElements = store.sharedElements.filter((item) => item.type === 'character')
    let created = 0
    let updated = 0
    for (const profile of profiles) {
      const name = getDigitalHumanProfileDisplayName(profile)
      const description = buildDigitalHumanProfileElementDescription(profile)
      const voiceProfile = profile.voice_profile.trim()
      if (!name.trim()) continue

      const existing = characterElements.find((item) => item.name.trim() === name.trim())
      if (existing) {
        // eslint-disable-next-line no-await-in-loop
        await store.updateElement(existing.id, {
          description: description || existing.description,
          voice_profile: voiceProfile || existing.voice_profile,
        })
        updated += 1
      } else {
        // eslint-disable-next-line no-await-in-loop
        await store.addElement(store.currentSeriesId, {
          name,
          type: 'character',
          description,
          voice_profile: voiceProfile,
        })
        created += 1
      }
    }
    pushToast({ message: `已同步数字人角色到素材库：新增 ${created}，更新 ${updated}` })
  }, [pushToast, store, store.currentSeriesId, store.sharedElements])

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

  const handleUndoOperation = useCallback(async () => {
    if (!currentWorkspaceId) {
      pushToast({ message: '请先选择工作区后再执行撤销', code: 'workspace_required' })
      return
    }
    await store.undoWorkspaceOperation(currentWorkspaceId, projectScope)
  }, [currentWorkspaceId, projectScope, pushToast, store])

  const handleRedoOperation = useCallback(async () => {
    if (!currentWorkspaceId) {
      pushToast({ message: '请先选择工作区后再执行重做', code: 'workspace_required' })
      return
    }
    await store.redoWorkspaceOperation(currentWorkspaceId, projectScope)
  }, [currentWorkspaceId, projectScope, pushToast, store])

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
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(GENERATION_VIDEO_MODEL_AUDIO_KEY, videoModelAudioEnabled ? '1' : '0')
    } catch {
      // ignore layout persistence errors
    }
  }, [videoModelAudioEnabled])

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
            {workbenchLabel}
            {store.currentSeries && (
              <>
                <span className="text-gray-600">·</span>
                <span className="text-purple-300">{store.currentSeries.name}</span>
              </>
            )}
          </h1>
          <div className="hidden md:flex items-center gap-1 ml-2">
            <button
              onClick={() => navigate('/studio')}
              className={`px-2 py-1 rounded text-[11px] transition-colors ${routePrefix === '/studio' ? 'bg-purple-700/60 text-purple-100' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            >
              长篇
            </button>
            <button
              onClick={() => navigate('/short-video')}
              className={`px-2 py-1 rounded text-[11px] transition-colors ${routePrefix === '/short-video' ? 'bg-purple-700/60 text-purple-100' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            >
              短视频
            </button>
            <button
              onClick={() => navigate('/digital-human')}
              className={`px-2 py-1 rounded text-[11px] transition-colors ${routePrefix === '/digital-human' ? 'bg-purple-700/60 text-purple-100' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            >
              数字人
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {workspaces.length > 0 && (
            <select
              value={currentWorkspaceId || ''}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="px-2 py-1 rounded border border-gray-700 bg-gray-800/80 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
              title="切换工作区"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => void handleUndoOperation()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-700 bg-gray-800/70 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
            title={`撤销（${projectScope}）`}
          >
            <Undo2 className="w-3.5 h-3.5" />
            撤销
          </button>
          <button
            onClick={() => void handleRedoOperation()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-700 bg-gray-800/70 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
            title={`重做（${projectScope}）`}
          >
            <Redo2 className="w-3.5 h-3.5" />
            重做
          </button>
          <button
            onClick={() => navigate('/workspace/dashboard')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-700 bg-gray-800/70 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
            title="工作区协作 Dashboard"
          >
            协作
          </button>
          <button
            onClick={() => navigate('/workspace/okr')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-700 bg-gray-800/70 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
            title="工作区 OKR 看板"
          >
            OKR
          </button>
          <button
            onClick={() => navigate('/auth')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-700 bg-gray-800/70 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
            title="账号管理"
          >
            账号
          </button>
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
          {store.currentSeries && (
            <button
              onClick={() => setShowCharacterCard(true)}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-gray-700 bg-gray-800/70 text-gray-300 hover:bg-gray-800 hover:text-white text-xs transition-colors"
              title="角色设定卡"
            >
              <FileText className="w-3.5 h-3.5" />
              角色卡
            </button>
          )}
          {workbenchMode === 'digital_human' && store.currentSeries && (
            <button
              onClick={() => setShowDigitalHumanConsole(true)}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-indigo-700/70 bg-indigo-900/25 text-indigo-100 hover:bg-indigo-900/35 text-xs transition-colors"
              title="数字人角色阶段控制台"
            >
              <Sparkles className="w-3.5 h-3.5" />
              数字人台
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
                {visibleSeriesList.map((s) => (
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
                {visibleSeriesList.map((s) => (
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
                {visibleSeriesList.length === 0 && !store.loading && (
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
            <WelcomeView
              mode={workbenchMode}
              onCreateClick={() => setShowCreateDialog(true)}
            />
          )}

          {!store.loading && store.currentSeries && !store.currentEpisode && (
            <SeriesOverview
              workbenchMode={workbenchMode}
              series={store.currentSeries}
              episodes={store.episodes}
              elements={store.sharedElements}
              onSelectEpisode={handleSelectEpisode}
              onPlanEpisode={handlePlanEpisode}
              onDeleteSeries={() => {
                if (store.currentSeriesId) {
                  store.deleteSeries(store.currentSeriesId)
                  navigate(routePrefix)
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
              workbenchMode={workbenchMode}
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
              onBatchGenerate={async (stages, options) => {
                if (!store.currentEpisodeId) return
                await handleBatchGenerate(store.currentEpisodeId, stages, options)
              }}
              videoModelAudioEnabled={videoModelAudioEnabled}
              onVideoModelAudioEnabledChange={setVideoModelAudioEnabled}
              onRunShortVideoQuickPipeline={async (options) => {
                if (!store.currentEpisodeId) return
                await handleShortVideoQuickPipeline(store.currentEpisodeId, options)
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
              onBatchGenerateElementImages={async (options) => {
                if (!store.currentEpisodeId) return
                await handleBatchGenerate(store.currentEpisodeId, ['elements'], {
                  image_width: options?.width,
                  image_height: options?.height,
                  element_use_reference: options?.useReference,
                  element_reference_mode: options?.referenceMode,
                })
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
          mode={workbenchMode}
          onClose={() => setShowCreateDialog(false)}
          onSubmit={async (params) => {
            const s = await handleCreateSeries(params)
            if (s) {
              setShowCreateDialog(false)
              navigate(`${routePrefix}/${s.id}`)
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

      {showCharacterCard && store.currentSeries && (
        <CharacterSettingCardDialog
          series={store.currentSeries}
          elements={store.sharedElements}
          onUpdateElement={(id, updates) => store.updateElement(id, updates)}
          onAddElement={(el) => store.addElement(store.currentSeriesId!, el)}
          onDeleteElement={(id) => store.deleteElement(id)}
          onGenerateElementImage={(id, opts) => store.generateElementImage(id, opts)}
          generating={store.generating}
          onClose={() => setShowCharacterCard(false)}
        />
      )}

      {showDigitalHumanConsole && workbenchMode === 'digital_human' && store.currentSeries && (
        <DigitalHumanProfileConsoleDialog
          series={store.currentSeries}
          elements={store.sharedElements}
          busy={store.generating || store.planning}
          onClose={() => setShowDigitalHumanConsole(false)}
          onSaveProfiles={handleSaveDigitalHumanProfiles}
          onSyncProfilesToElements={handleSyncDigitalHumanProfilesToElements}
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

export function StatusDot({ status }: { status: string }) {
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

function WelcomeView({
  mode,
  onCreateClick,
}: {
  mode: WorkbenchMode
  onCreateClick: () => void
}) {
  const title = getWorkbenchLabel(mode)
  const description = getWorkbenchWelcomeText(mode)
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md">
        <Film className="w-16 h-16 text-purple-500 mx-auto mb-4 opacity-50" />
        <h2 className="text-xl font-semibold text-gray-200 mb-2">{title}</h2>
        <p className="text-sm text-gray-400 mb-6">{description}</p>
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
// 单集工作台
// ============================================================

function EpisodeWorkbench({
  workbenchMode,
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
  videoModelAudioEnabled,
  onVideoModelAudioEnabledChange,
  onRunShortVideoQuickPipeline,
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
  workbenchMode: WorkbenchMode
  episode: StudioEpisode
  shots: StudioShot[]
  elements: StudioElement[]
  episodeElements: StudioEpisodeElement[]
  onBack: () => void
  onPlan: () => void | Promise<void>
  onEnhance: (mode: 'refine' | 'expand') => void | Promise<void>
  onGenerateAsset: (
    shotId: string,
    stage: 'frame' | 'key_frame' | 'end_frame' | 'video' | 'audio',
    options?: { width?: number; height?: number }
  ) => void | Promise<void>
  onInpaintShot: (shotId: string, payload: { editPrompt: string; maskData?: string }) => void | Promise<void>
  onUpdateShot: (shotId: string, updates: Record<string, unknown>) => void | Promise<void>
  onReorderShots: (shotIds: string[]) => void | Promise<void>
  onUpdateEpisode: (updates: Record<string, unknown>) => void | Promise<void>
  onBatchGenerate: (
    stages?: string[],
    options?: {
      image_width?: number
      image_height?: number
      element_use_reference?: boolean
      element_reference_mode?: StudioElementReferenceMode
    }
  ) => void | Promise<void>
  videoModelAudioEnabled: boolean
  onVideoModelAudioEnabledChange: (enabled: boolean) => void
  onRunShortVideoQuickPipeline?: (options?: { image_width?: number; image_height?: number }) => void | Promise<void>
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
    options?: {
      useReference?: boolean
      referenceMode?: StudioElementReferenceMode
      width?: number
      height?: number
      renderMode?: StudioElementRenderMode
      maxImages?: number
      steps?: number
      seed?: number
    }
  ) => void | Promise<void>
  onBatchGenerateElementImages: (options?: {
    width?: number
    height?: number
    useReference?: boolean
    referenceMode?: StudioElementReferenceMode
  }) => void | Promise<void>
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
  const [shotImageRatio, setShotImageRatio] = useState<StudioImageRatioValue>(() => {
    if (typeof window === 'undefined') return '16:9'
    try {
      const raw = window.localStorage.getItem(SHOT_IMAGE_RATIO_KEY)
      return raw && isStudioImageRatioValue(raw) ? raw : '16:9'
    } catch {
      return '16:9'
    }
  })
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
  const shotImageRatioPreset = useMemo(
    () => resolveStudioImageRatioPreset(shotImageRatio, '16:9'),
    [shotImageRatio],
  )
  const shotImageGenerationOptions = useMemo(
    () => ({ width: shotImageRatioPreset.width, height: shotImageRatioPreset.height }),
    [shotImageRatioPreset.height, shotImageRatioPreset.width],
  )
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
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(SHOT_IMAGE_RATIO_KEY, shotImageRatio)
    } catch {
      // ignore layout persistence errors
    }
  }, [shotImageRatio])

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
        const value = String((shot as unknown as Record<string, unknown>)[meta.field] || '').trim()
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
              <label className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-900/70 border border-gray-800 text-[11px] text-gray-300">
                <span>分镜比例</span>
                <select
                  value={shotImageRatio}
                  onChange={(e) => {
                    const next = e.target.value
                    if (isStudioImageRatioValue(next)) setShotImageRatio(next)
                  }}
                  className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-[11px] text-gray-200 focus:outline-none focus:border-purple-500"
                  title="用于首帧/关键帧/尾帧生成"
                >
                  {STUDIO_IMAGE_RATIO_PRESETS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-900/70 border border-gray-800 text-[11px] text-gray-300">
                <input
                  type="checkbox"
                  checked={videoModelAudioEnabled}
                  onChange={(e) => onVideoModelAudioEnabledChange(e.target.checked)}
                />
                音画同出（视频模型音轨）
              </label>
              <button
                onClick={() => onBatchGenerate(undefined, {
                  image_width: shotImageGenerationOptions.width,
                  image_height: shotImageGenerationOptions.height,
                })}
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

      {workbenchMode === 'short_video' && (
        <div className="px-4 py-2 border-b border-purple-900/35 bg-purple-950/15 flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-[11px] text-purple-200/85">短视频快编</span>
          {SHORT_VIDEO_DURATION_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => onUpdateEpisode({ target_duration_seconds: preset })}
              className={`text-[11px] px-2 py-1 rounded transition-colors ${
                Math.round(Number(episode.target_duration_seconds || 0)) === preset
                  ? 'bg-purple-700/70 text-purple-100'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {preset}s
            </button>
          ))}
          <button
            onClick={() => onBatchGenerate(
              videoModelAudioEnabled ? ['frames', 'videos'] : ['frames', 'videos', 'audio'],
              {
                image_width: shotImageGenerationOptions.width,
                image_height: shotImageGenerationOptions.height,
              },
            )}
            disabled={planning || generating || shots.length <= 0}
            className="ml-auto text-[11px] px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-40 transition-colors"
          >
            {videoModelAudioEnabled ? '快编生成（帧+视频音轨）' : '快编生成（帧+视频+音频）'}
          </button>
          <button
            onClick={() => onRunShortVideoQuickPipeline?.({
              image_width: shotImageGenerationOptions.width,
              image_height: shotImageGenerationOptions.height,
            })}
            disabled={planning || generating}
            className="text-[11px] px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 transition-colors"
          >
            一键快编
          </button>
        </div>
      )}

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
                  onGenerateFrame={() => onGenerateAsset(shot.id, 'frame', shotImageGenerationOptions)}
                  onGenerateEndFrame={() => onGenerateAsset(shot.id, 'end_frame', shotImageGenerationOptions)}
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
                onGenerateAsset={(stage, options) => onGenerateAsset(selectedShot!.id, stage, options)}
                imageGeneration={{
                  ratioLabel: shotImageRatioPreset.value,
                  width: shotImageRatioPreset.width,
                  height: shotImageRatioPreset.height,
                }}
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
            onGenerateAsset={(stage, options) => onGenerateAsset(selectedShot!.id, stage, options)}
            imageGeneration={{
              ratioLabel: shotImageRatioPreset.value,
              width: shotImageRatioPreset.width,
              height: shotImageRatioPreset.height,
            }}
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
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
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
            className="w-full h-full object-contain bg-gray-900/70"
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
            <img src={shot.end_image_url} alt="end-frame" className="w-full h-full object-contain bg-gray-900/70" />
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

      <HoverMediaPreview
        active={hovered}
        shot={shot}
        index={index}
        maxWidthClass="max-w-5xl"
        openDelayMs={800}
        videoDelayMs={800}
      />
    </div>
  )
}


function DigitalHumanProfileConsoleDialog({
  series,
  elements,
  busy,
  onClose,
  onSaveProfiles,
  onSyncProfilesToElements,
}: {
  series: StudioSeries
  elements: StudioElement[]
  busy: boolean
  onClose: () => void
  onSaveProfiles: (profiles: DigitalHumanProfileDraft[]) => Promise<void>
  onSyncProfilesToElements: (profiles: DigitalHumanProfileDraft[]) => Promise<void>
}) {
  const [profiles, setProfiles] = useState<DigitalHumanProfileDraft[]>(
    () => normalizeDigitalHumanProfiles(series.digital_human_profiles),
  )
  const [selectedId, setSelectedId] = useState<string | null>(profiles[0]?.id || null)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    const normalized = normalizeDigitalHumanProfiles(series.digital_human_profiles)
    setProfiles(normalized)
    setSelectedId(normalized[0]?.id || null)
  }, [series.id, series.digital_human_profiles])

  const selectedProfile = profiles.find((profile) => profile.id === selectedId) || null
  const normalizedKeyword = keyword.trim().toLowerCase()
  const filteredProfiles = profiles.filter((profile) => {
    if (!normalizedKeyword) return true
    return [
      profile.base_name,
      profile.display_name,
      profile.stage_label,
      profile.appearance,
      profile.scene_template,
    ].join(' ').toLowerCase().includes(normalizedKeyword)
  })

  const linkedCharacterNames = useMemo(() => {
    const names = new Set<string>()
    elements
      .filter((item) => item.type === 'character')
      .forEach((item) => {
        const key = item.name.trim()
        if (key) names.add(key)
      })
    return names
  }, [elements])

  const upsertProfile = (profileId: string, patch: Partial<DigitalHumanProfileDraft>) => {
    setProfiles((prev) => prev.map((profile) => (
      profile.id === profileId ? { ...profile, ...patch } : profile
    )))
  }

  const addProfile = () => {
    const profile = createDigitalHumanProfile()
    setProfiles((prev) => [profile, ...prev])
    setSelectedId(profile.id)
  }

  const removeProfile = (profileId: string) => {
    setProfiles((prev) => {
      const next = prev.filter((profile) => profile.id !== profileId)
      if (!next.some((profile) => profile.id === selectedId)) {
        setSelectedId(next[0]?.id || null)
      }
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveProfiles(profiles)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndSync = async () => {
    setSyncing(true)
    try {
      await onSaveProfiles(profiles)
      await onSyncProfilesToElements(profiles)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[82]">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-6xl max-h-[90vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">数字人角色控制台</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {series.name} · 阶段角色 {profiles.length} 条
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={busy || saving || syncing}
              className="text-xs px-2.5 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-40"
            >
              {saving ? '保存中...' : '保存配置'}
            </button>
            <button
              onClick={handleSaveAndSync}
              disabled={busy || saving || syncing}
              className="text-xs px-2.5 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40"
            >
              {(saving || syncing) ? '处理中...' : '保存并同步素材库'}
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[300px_minmax(0,1fr)] max-h-[calc(90vh-64px)]">
          <aside className="border-r border-gray-800 p-3 space-y-2 overflow-y-auto">
            <div className="flex items-center gap-2">
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索角色/阶段..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={addProfile}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded bg-purple-700/70 hover:bg-purple-600/70 text-white text-xs"
              >
                <Plus className="w-3 h-3" />
                新增
              </button>
            </div>
            <div className="space-y-1">
              {filteredProfiles.map((profile) => {
                const name = getDigitalHumanProfileDisplayName(profile)
                const linked = linkedCharacterNames.has(name)
                return (
                  <button
                    key={profile.id}
                    onClick={() => setSelectedId(profile.id)}
                    className={`w-full text-left rounded border px-2.5 py-2 transition-colors ${
                      selectedId === profile.id
                        ? 'border-indigo-500/70 bg-indigo-900/25'
                        : 'border-gray-800 bg-gray-950/50 hover:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-gray-100 truncate">{name}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${linked ? 'bg-emerald-900/40 text-emerald-300' : 'bg-gray-800 text-gray-500'}`}>
                        {linked ? '已同步' : '未同步'}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1 line-clamp-1">
                      {profile.appearance || '暂无形象描述'}
                    </p>
                  </button>
                )
              })}
              {filteredProfiles.length === 0 && (
                <p className="text-xs text-gray-500 py-6 text-center">暂无角色配置</p>
              )}
            </div>
          </aside>

          <div className="p-4 overflow-y-auto">
            {!selectedProfile && (
              <div className="h-full min-h-[240px] flex items-center justify-center text-sm text-gray-500">
                请选择一个数字人角色配置，或新建角色
              </div>
            )}
            {selectedProfile && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-medium text-gray-100">角色阶段配置</h4>
                  <button
                    onClick={() => removeProfile(selectedProfile.id)}
                    className="text-xs px-2 py-1 rounded bg-red-900/35 hover:bg-red-900/50 text-red-200"
                  >
                    删除
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">角色主名</label>
                    <input
                      value={selectedProfile.base_name}
                      onChange={(e) => upsertProfile(selectedProfile.id, { base_name: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                      placeholder="例如：金蚊子"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">展示名（可选）</label>
                    <input
                      value={selectedProfile.display_name}
                      onChange={(e) => upsertProfile(selectedProfile.id, { display_name: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                      placeholder="例如：金蚊子（青年期）"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">阶段标签</label>
                    <input
                      value={selectedProfile.stage_label}
                      onChange={(e) => upsertProfile(selectedProfile.id, { stage_label: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                      placeholder="前期 / 后期 / 战后..."
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">口型策略</label>
                    <select
                      value={selectedProfile.lip_sync_style}
                      onChange={(e) => upsertProfile(selectedProfile.id, { lip_sync_style: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                    >
                      {DIGITAL_HUMAN_LIP_SYNC_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">形象描述</label>
                  <textarea
                    rows={4}
                    value={selectedProfile.appearance}
                    onChange={(e) => upsertProfile(selectedProfile.id, { appearance: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
                    placeholder="描述该阶段的服饰、年龄感、神态、镜头友好特征"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">音色配置</label>
                  <input
                    value={selectedProfile.voice_profile}
                    onChange={(e) => upsertProfile(selectedProfile.id, { voice_profile: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                    placeholder="用于 TTS 的角色音色描述"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">场景模板</label>
                  <textarea
                    rows={3}
                    value={selectedProfile.scene_template}
                    onChange={(e) => upsertProfile(selectedProfile.id, { scene_template: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
                    placeholder="常用背景、布光、机位和空间语义"
                  />
                </div>

                <div className="rounded border border-gray-800 bg-gray-950/60 px-3 py-2 text-[11px] text-gray-400">
                  同步到素材库后，会自动创建或更新同名 `character` 元素，供起始帧和视频提示词引用。
                </div>
              </div>
            )}
          </div>
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
  mode = 'longform',
  onClose,
  onSubmit,
  creating,
}: {
  mode?: WorkbenchMode
  onClose: () => void
  onSubmit: (params: {
    name: string
    script: string
    description?: string
    visual_style?: string
    series_bible?: string
    target_episode_count?: number
    episode_duration_seconds?: number
  }) => void | Promise<void>
  creating: boolean
}) {
  const isShortVideo = mode === 'short_video'
  const isDigitalHuman = mode === 'digital_human'
  const title = isShortVideo ? '创建短视频项目' : isDigitalHuman ? '创建数字人短剧项目' : '创建新系列'
  const scriptPlaceholder = isShortVideo
    ? '粘贴短视频脚本（建议 15-60 秒内容）...'
    : isDigitalHuman
      ? '粘贴数字人短剧脚本（对白/口播可更详细）...'
      : '粘贴完整的故事脚本...'
  const [name, setName] = useState('')
  const [script, setScript] = useState('')
  const [description, setDescription] = useState('')
  const [visualStyle, setVisualStyle] = useState('')
  const [seriesBible, setSeriesBible] = useState('')
  const [targetCount, setTargetCount] = useState(isShortVideo || isDigitalHuman ? 1 : 0)
  const [duration, setDuration] = useState(isShortVideo ? 30 : isDigitalHuman ? 45 : 90)

  const handleSubmit = () => {
    if (!name.trim() || !script.trim()) return
    onSubmit({
      name: name.trim(),
      script: script.trim(),
      description: description.trim() || undefined,
      visual_style: visualStyle.trim() || undefined,
      series_bible: seriesBible.trim() || undefined,
      target_episode_count: targetCount || undefined,
      episode_duration_seconds: duration || undefined,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-lg font-semibold text-gray-100 mb-4">{title}</h2>

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
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-gray-400">完整脚本 *</label>
              <DocumentUploadButton
                onTextExtracted={(text) => setScript(text)}
                label="上传脚本"
              />
            </div>
            <textarea
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 resize-none"
              rows={isShortVideo ? 7 : 10}
              placeholder={scriptPlaceholder}
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">
              {script.length} 字
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-gray-400">世界观 / 人物设定</label>
              <DocumentUploadButton
                onTextExtracted={(text) => setSeriesBible((prev) => prev ? prev + '\n\n' + text : text)}
                label="上传设定文档"
              />
            </div>
            <textarea
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 resize-none"
              rows={4}
              placeholder="可选，粘贴或上传世界观设定、人物设定卡等文档..."
              value={seriesBible}
              onChange={(e) => setSeriesBible(e.target.value)}
            />
            {seriesBible && (
              <p className="text-xs text-gray-500 mt-1">
                {seriesBible.length} 字
              </p>
            )}
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
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-400">视觉风格</label>
                <DocumentUploadButton
                  onTextExtracted={(text) => setVisualStyle(text)}
                  label="上传画风"
                />
              </div>
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
                onChange={(e) => setDuration(parseInt(e.target.value) || (isShortVideo ? 30 : 90))}
                min={isShortVideo ? 10 : 30}
                max={isShortVideo ? 90 : 300}
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

