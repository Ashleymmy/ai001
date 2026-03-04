import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Settings2, Plus, Film, Users, MapPin, Package,
  Loader2, Play, RefreshCw, ChevronRight,
  Video, Layers, Sparkles, AlertCircle, X, Save, ChevronLeft,
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
  StudioEpisode,
  StudioElement,
  StudioShot,
  StudioEpisodeElement,
  StudioGenerationScope,
} from '../store/studioStore'
import Timeline from '../components/studio/Timeline'
import PreviewPlayer from '../components/studio/PreviewPlayer'
import CharacterDesignConsoleDialog from '../components/studio/CharacterDesignConsoleDialog'
import ElementLibraryPanel from '../components/studio/ElementLibraryPanel'
import SeriesOverview from '../components/studio/SeriesOverview'
import ShotDetailPanel from '../components/studio/ShotDetailPanel'
import StudioSettingsPanel from '../components/studio/StudioSettingsPanel'
import CharacterSettingCardDialog from '../components/studio/CharacterSettingCardDialog'
import {
  STUDIO_IMAGE_RATIO_PRESETS,
  isStudioImageRatioValue,
  resolveStudioImageRatioPreset,
  type StudioImageRatioValue,
} from '../components/studio/imageRatio'
import ShotCard from '../components/studio/ShotCard'
import DigitalHumanProfileConsoleDialog from '../components/studio/DigitalHumanProfileConsoleDialog'
import AgentProjectExportDialog from '../components/studio/AgentProjectExportDialog'
import AgentProjectImportDialog from '../components/studio/AgentProjectImportDialog'
import ToastStack from '../components/studio/ToastStack'
import CreateSeriesDialog from '../components/studio/CreateSeriesDialog'
import StudioLoadingSkeleton from '../components/studio/StudioLoadingSkeleton'
import StudioDynamicIsland from '../components/studio/StudioDynamicIsland'
import RecoveryCenterPanel from '../components/studio/RecoveryCenterPanel'
import SeriesTreeItem from '../components/studio/SeriesTreeItem'
import WelcomeView from '../components/studio/WelcomeView'
import type {
  StudioToast,
  StudioExportProgress,
  StudioActivityIndicator,
  AgentProjectOption,
  AgentExportOptions,
  PreviewPanelRect,
  PreviewPanelResizeDirection,
  DigitalHumanProfileDraft,
  PromptFieldKey,
} from '../features/studio/types'
export type { WorkbenchMode } from '../features/studio/types'
import {
  isPromptFieldKey,
  resolveRouteBase,
  inferModeByRoute,
  getWorkbenchLabel,
  getDigitalHumanProfileDisplayName,
  buildDigitalHumanProfileElementDescription,
  readStoredNumber,
  readStoredBoolean,
  defaultPreviewPanelRect,
  createDefaultAgentExportOptions,
  clampPreviewPanelRect,
  getGenerationStageText,
  getGenerationDetail,
  formatHistoryAction,
  summarizeShotDiff,
  resizeCursorByDirection,
  calcExportPercent,
  DIGITAL_HUMAN_LIP_SYNC_OPTIONS,
} from '../features/studio/utils'
// Re-export for backwards compatibility
export { getEpisodeStatusText, getEpisodeStatusBadgeClass } from '../features/studio/utils'

type ServiceKey = 'llm' | 'image' | 'video' | 'tts'

const LAYOUT_SIDEBAR_WIDTH_KEY = 'studio.layout.sidebarWidth'
const LAYOUT_SIDEBAR_COLLAPSED_KEY = 'studio.layout.sidebarCollapsed'
const LAYOUT_DETAIL_PANEL_WIDTH_KEY = 'studio.layout.detailPanelWidth'
const LAYOUT_DETAIL_PANEL_COLLAPSED_KEY = 'studio.layout.detailPanelCollapsed'
const GENERATION_VIDEO_MODEL_AUDIO_KEY = 'studio.generation.videoModelAudio'
const SHOT_IMAGE_RATIO_KEY = 'studio.shot.imageRatio'

const SHORT_VIDEO_DURATION_PRESETS = [15, 30, 45, 60] as const

const PROMPT_FIELD_META: Array<{ field: PromptFieldKey; label: string }> = [
  { field: 'prompt', label: '起始帧提示词' },
  { field: 'end_prompt', label: '尾帧提示词' },
  { field: 'video_prompt', label: '视频提示词' },
]

import type { WorkbenchMode } from '../features/studio/types'


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
      ? ['elements', 'frames', 'key_frames', 'end_frames', 'videos']
      : ['elements', 'frames', 'key_frames', 'end_frames', 'videos', 'audio']
    const actualStages = stages && stages.length > 0 ? stages : defaultStages
    const required = new Set<ServiceKey>()
    if (actualStages.includes('elements') || actualStages.includes('frames') || actualStages.includes('key_frames') || actualStages.includes('end_frames')) required.add('image')
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


export function StatusDot({ status }: { status: string }) {
  const color =
    status === 'completed' ? 'bg-green-400' :
    status === 'in_progress' ? 'bg-yellow-400' :
    status === 'planned' ? 'bg-blue-400' :
    'bg-gray-600'
  return <span className={`w-1.5 h-1.5 rounded-full ${color} shrink-0`} />
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

