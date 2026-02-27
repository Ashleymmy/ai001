/**
 * 功能模块：短视频工作台页面 — 面向 15-60 秒快节奏竖版内容的专用编辑器
 *
 * 布局：左侧脚本面板 + 中央竖屏预览/时间线 + 底部工具栏
 * 与 StudioPage 共享 store & 组件，但 UI 完全按短视频场景重新编排。
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Plus, Play, Loader2, Film, FileText, Settings2,
  Download, ChevronRight, ChevronLeft, GripVertical, Music,
} from 'lucide-react'
import { useStudioStore } from '../store/studioStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { studioCheckConfig, studioExportEpisode } from '../services/api'
import type { StudioSeries, StudioShot } from '../store/studioStore'
import Timeline from '../components/studio/Timeline'
import PreviewPlayer from '../components/studio/PreviewPlayer'
import ShotDetailPanel from '../components/studio/ShotDetailPanel'

// ============================================================
// 常量 & 类型
// ============================================================

const ROUTE_BASE = '/short-video'
const DURATION_PRESETS = [15, 30, 45, 60] as const

type RhythmTemplate = '快切' | '慢叙' | '高潮递进' | '自定义'
const RHYTHM_TEMPLATES: RhythmTemplate[] = ['快切', '慢叙', '高潮递进', '自定义']
const RHYTHM_DESCRIPTIONS: Record<RhythmTemplate, string> = {
  '快切': '每镜头 1-2 秒，节奏紧凑',
  '慢叙': '每镜头 4-6 秒，慢节奏叙事',
  '高潮递进': '由慢到快递进，结尾高潮',
  '自定义': '手动设定每个镜头时长',
}

interface PlatformExportPreset {
  label: string
  width: number
  height: number
}
const PLATFORM_PRESETS: PlatformExportPreset[] = [
  { label: '抖音', width: 1080, height: 1920 },
  { label: '快手', width: 1080, height: 1920 },
  { label: '小红书', width: 1080, height: 1440 },
]

type ServiceKey = 'llm' | 'image' | 'video' | 'tts'

// ============================================================
// 辅助函数
// ============================================================

function formatSec(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function totalDuration(shots: StudioShot[]): number {
  return shots.reduce((sum, s) => sum + Math.max(1, Number(s.duration) || 1), 0)
}

// ============================================================
// 主页面组件
// ============================================================

export default function ShortVideoWorkbenchPage() {
  const navigate = useNavigate()
  const params = useParams<{ seriesId?: string; episodeId?: string }>()

  const store = useStudioStore()
  const workspaceInitialized = useWorkspaceStore((s) => s.initialized)
  const initWorkspace = useWorkspaceStore((s) => s.init)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  // --- UI 状态 ---
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [scriptPanelCollapsed, setScriptPanelCollapsed] = useState(false)
  const [detailPanelOpen, setDetailPanelOpen] = useState(false)
  const [selectedRhythm, setSelectedRhythm] = useState<RhythmTemplate>('自定义')
  const [showRhythmDropdown, setShowRhythmDropdown] = useState(false)
  const [showPlatformDropdown, setShowPlatformDropdown] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformExportPreset>(PLATFORM_PRESETS[0])
  const [exporting, setExporting] = useState(false)
  const [configReady, setConfigReady] = useState<Record<ServiceKey, boolean | null>>({
    llm: null, image: null, video: null, tts: null,
  })
  const [draggingScriptIdx, setDraggingScriptIdx] = useState<number | null>(null)

  // --- 过滤系列列表 ---
  const visibleSeriesList = useMemo(
    () => store.seriesList.filter((series) => {
      const mode = String(series.settings?.workbench_mode || 'longform')
      if (!series.settings?.workbench_mode) return false
      return mode === 'short_video'
    }),
    [store.seriesList],
  )

  // --- 初始化 ---
  useEffect(() => {
    if (!workspaceInitialized) {
      initWorkspace()
    }
  }, [workspaceInitialized, initWorkspace])

  useEffect(() => {
    store.loadSeriesList()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // --- 路由同步 ---
  useEffect(() => {
    const { seriesId, episodeId } = params
    if (episodeId && episodeId !== store.currentEpisodeId) {
      store.selectEpisode(episodeId)
    } else if (seriesId && seriesId !== store.currentSeriesId) {
      store.selectSeries(seriesId)
    }
  }, [params.seriesId, params.episodeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 当选中系列后自动选中第一集
  useEffect(() => {
    if (store.currentSeries && store.episodes.length > 0 && !store.currentEpisodeId) {
      const firstEp = store.episodes[0]
      store.selectEpisode(firstEp.id)
      navigate(`${ROUTE_BASE}/${store.currentSeriesId}/${firstEp.id}`, { replace: true })
    }
  }, [store.currentSeries, store.episodes, store.currentEpisodeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 选中第一个镜头
  useEffect(() => {
    if (store.shots.length > 0 && !selectedShotId) {
      setSelectedShotId(store.shots[0].id)
    }
  }, [store.shots, selectedShotId])

  const selectedShot = useMemo(
    () => store.shots.find((s) => s.id === selectedShotId) ?? null,
    [store.shots, selectedShotId],
  )

  // --- 配置检查 ---
  const ensureConfigReady = useCallback(async (keys: ServiceKey[]): Promise<boolean> => {
    try {
      const result = await studioCheckConfig()
      const status: Record<string, boolean> = {}
      if (result && typeof result === 'object') {
        for (const [k, v] of Object.entries(result)) {
          status[k] = Boolean(v)
        }
      }
      const nextConfig = { ...configReady }
      let allReady = true
      for (const key of keys) {
        const ready = status[key] !== false
        nextConfig[key] = ready
        if (!ready) allReady = false
      }
      setConfigReady(nextConfig)
      return allReady
    } catch {
      return true // 如果检查失败，不阻拦操作
    }
  }, [configReady])

  // --- Handlers ---
  const handleSelectSeries = useCallback((id: string) => {
    store.selectSeries(id)
    navigate(`${ROUTE_BASE}/${id}`)
  }, [store, navigate])

  const handleSelectEpisode = useCallback((id: string) => {
    store.selectEpisode(id)
    navigate(`${ROUTE_BASE}/${store.currentSeriesId}/${id}`)
  }, [store, navigate])

  const handleSelectShot = useCallback((shotId: string) => {
    setSelectedShotId(shotId)
    setDetailPanelOpen(true)
  }, [])

  const handleCreateSeries = useCallback(async (createParams: {
    name: string
    script: string
    description?: string
    visual_style?: string
    episode_duration_seconds?: number
  }) => {
    const ok = await ensureConfigReady(['llm'])
    if (!ok) return null
    return store.createSeries({
      ...createParams,
      workspace_id: currentWorkspaceId || undefined,
      workbench_mode: 'short_video',
      target_episode_count: 1,
    })
  }, [ensureConfigReady, store, currentWorkspaceId])

  const handlePlanEpisode = useCallback(async () => {
    if (!store.currentEpisodeId) return
    const ok = await ensureConfigReady(['llm'])
    if (!ok) return
    await store.planEpisode(store.currentEpisodeId)
  }, [ensureConfigReady, store])

  const handleGenerateShotAsset = useCallback(async (
    shotId: string,
    stage: 'frame' | 'key_frame' | 'end_frame' | 'video' | 'audio',
  ) => {
    const required: ServiceKey[] =
      stage === 'frame' || stage === 'key_frame' || stage === 'end_frame'
        ? ['image']
        : stage === 'video' ? ['video'] : ['tts']
    const ok = await ensureConfigReady(required)
    if (!ok) return
    await store.generateShotAsset(shotId, stage)
  }, [ensureConfigReady, store])

  const handleBatchGenerate = useCallback(async () => {
    if (!store.currentEpisodeId) return
    const stages = ['elements', 'frames', 'end_frames', 'videos', 'audio']
    const ok = await ensureConfigReady(['image', 'video', 'tts'])
    if (!ok) return
    await store.batchGenerate(store.currentEpisodeId, stages)
  }, [ensureConfigReady, store])

  const handleQuickGenerate = useCallback(async () => {
    if (!store.currentEpisodeId) return
    // 快速生成：仅图片 + 视频（跳过音频）
    const stages = ['elements', 'frames', 'end_frames', 'videos']
    const ok = await ensureConfigReady(['image', 'video'])
    if (!ok) return
    await store.batchGenerate(store.currentEpisodeId, stages)
  }, [ensureConfigReady, store])

  const handleExport = useCallback(async () => {
    if (!store.currentEpisodeId || exporting) return
    setExporting(true)
    try {
      const result = await studioExportEpisode(store.currentEpisodeId, { mode: 'video' })
      const url = URL.createObjectURL(result.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = result.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // 静默失败：导出错误在此简化处理
    } finally {
      setExporting(false)
    }
  }, [store.currentEpisodeId, exporting])

  const handleUpdateShot = useCallback((shotId: string, updates: Record<string, unknown>) => {
    store.updateShot(shotId, updates)
  }, [store])

  const handleScriptLineChange = useCallback((shotId: string, value: string) => {
    store.updateShot(shotId, { description: value })
  }, [store])

  const handleShotReorder = useCallback(async (orderedIds: string[]) => {
    if (!store.currentEpisodeId) return
    await store.reorderShots(store.currentEpisodeId, orderedIds)
  }, [store])

  const handleApplyRhythm = useCallback((rhythm: RhythmTemplate) => {
    setSelectedRhythm(rhythm)
    setShowRhythmDropdown(false)
    if (rhythm === '自定义' || store.shots.length === 0) return

    const durationMap: Record<string, number> = {
      '快切': 2,
      '慢叙': 5,
      '高潮递进': 3, // 会逐步调整
    }

    store.shots.forEach((shot, idx) => {
      let dur = durationMap[rhythm] || 3
      if (rhythm === '高潮递进') {
        // 从慢到快：前半段 5 秒，中段 3 秒，后半段 1.5 秒
        const ratio = idx / Math.max(1, store.shots.length - 1)
        dur = ratio < 0.33 ? 5 : ratio < 0.66 ? 3 : 1.5
      }
      store.updateShot(shot.id, { duration: dur })
    })
  }, [store])

  const handleApplyDurationPreset = useCallback((totalSec: number) => {
    if (store.shots.length === 0) return
    const perShot = Math.max(1, Math.round(totalSec / store.shots.length * 10) / 10)
    store.shots.forEach((shot) => {
      store.updateShot(shot.id, { duration: perShot })
    })
  }, [store])

  // --- Script panel drag-to-reorder ---
  const handleScriptDragStart = useCallback((idx: number) => {
    setDraggingScriptIdx(idx)
  }, [])

  const handleScriptDragOver = useCallback((e: React.DragEvent, _targetIdx: number) => {
    e.preventDefault()
  }, [])

  const handleScriptDrop = useCallback((targetIdx: number) => {
    if (draggingScriptIdx === null || draggingScriptIdx === targetIdx) {
      setDraggingScriptIdx(null)
      return
    }
    const ids = store.shots.map((s) => s.id)
    const [moved] = ids.splice(draggingScriptIdx, 1)
    ids.splice(targetIdx, 0, moved)
    if (store.currentEpisodeId) {
      store.reorderShots(store.currentEpisodeId, ids)
    }
    setDraggingScriptIdx(null)
  }, [draggingScriptIdx, store])

  // --- 主 UI ---
  const isBusy = store.generating || store.planning || store.creating
  const hasEpisode = Boolean(store.currentEpisodeId)
  const hasShots = store.shots.length > 0
  const currentDuration = totalDuration(store.shots)

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {/* ======== 顶部栏 ======== */}
      <header className="shrink-0 h-12 flex items-center justify-between px-4 border-b border-gray-800 bg-gray-950/95 backdrop-blur z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            title="返回首页"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-semibold text-gray-100">短视频工作台</span>
          </div>
          {store.currentSeries && (
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <ChevronRight className="w-3 h-3" />
              <span className="text-gray-300 max-w-[180px] truncate">{store.currentSeries.name}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 节奏模板 */}
          <div className="relative">
            <button
              onClick={() => setShowRhythmDropdown(!showRhythmDropdown)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              <Music className="w-3.5 h-3.5 text-purple-400" />
              节奏：{selectedRhythm}
            </button>
            {showRhythmDropdown && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-30 py-1">
                {RHYTHM_TEMPLATES.map((rhythm) => (
                  <button
                    key={rhythm}
                    onClick={() => handleApplyRhythm(rhythm)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-800 transition-colors ${
                      selectedRhythm === rhythm ? 'text-purple-300 bg-purple-900/20' : 'text-gray-300'
                    }`}
                  >
                    <div className="font-medium">{rhythm}</div>
                    <div className="text-gray-500 mt-0.5">{RHYTHM_DESCRIPTIONS[rhythm]}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => navigate(`${ROUTE_BASE}`)}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            title="项目列表"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>

          {/* 平台导出 */}
          <div className="relative">
            <button
              onClick={() => setShowPlatformDropdown(!showPlatformDropdown)}
              disabled={!hasEpisode || exporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-purple-700 hover:bg-purple-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              导出
            </button>
            {showPlatformDropdown && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-30 py-1">
                <div className="px-3 py-1.5 text-[11px] text-gray-500 uppercase tracking-wider">平台分辨率预设</div>
                {PLATFORM_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      setSelectedPlatform(preset)
                      setShowPlatformDropdown(false)
                      handleExport()
                    }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-800 transition-colors ${
                      selectedPlatform.label === preset.label ? 'text-purple-300 bg-purple-900/20' : 'text-gray-300'
                    }`}
                  >
                    <span className="font-medium">{preset.label}</span>
                    <span className="text-gray-500 ml-2">{preset.width}x{preset.height}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ======== 主内容区 ======== */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ---- 左：系列 / 脚本面板 ---- */}
        <aside
          className={`shrink-0 border-r border-gray-800 bg-gray-950 flex flex-col transition-all duration-200 ${
            scriptPanelCollapsed ? 'w-10' : 'w-[320px]'
          }`}
        >
          {/* 折叠按钮 */}
          <button
            onClick={() => setScriptPanelCollapsed(!scriptPanelCollapsed)}
            className="shrink-0 h-8 flex items-center justify-center text-gray-500 hover:text-gray-300 transition-colors"
          >
            {scriptPanelCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          {!scriptPanelCollapsed && (
            <>
              {/* 项目选择区 */}
              {!store.currentSeries ? (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="px-3 py-2 flex items-center justify-between border-b border-gray-800">
                    <span className="text-xs font-semibold text-gray-400">短视频项目</span>
                    <button
                      onClick={() => setShowCreateDialog(true)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-purple-700/80 hover:bg-purple-600 text-white transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      新建
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {store.loading && (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                      </div>
                    )}
                    {!store.loading && visibleSeriesList.length === 0 && (
                      <div className="text-center py-10">
                        <Film className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                        <p className="text-xs text-gray-500">还没有短视频项目</p>
                        <button
                          onClick={() => setShowCreateDialog(true)}
                          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-purple-700 hover:bg-purple-600 text-white transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                          创建第一个项目
                        </button>
                      </div>
                    )}
                    {visibleSeriesList.map((series) => (
                      <SeriesCard
                        key={series.id}
                        series={series}
                        isSelected={store.currentSeriesId === series.id}
                        onSelect={handleSelectSeries}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* 系列标题 & 集列表 */}
                  <div className="px-3 py-2 border-b border-gray-800">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => {
                          store.selectSeries(null)
                          navigate(ROUTE_BASE)
                        }}
                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        &larr; 项目列表
                      </button>
                      <button
                        onClick={() => setShowCreateDialog(true)}
                        className="p-1 rounded text-gray-500 hover:text-purple-300 hover:bg-gray-800"
                        title="新建项目"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <h3 className="text-sm font-semibold text-gray-200 mt-1 truncate">{store.currentSeries.name}</h3>

                    {/* 集选择 */}
                    {store.episodes.length > 1 && (
                      <div className="mt-2 flex gap-1 flex-wrap">
                        {store.episodes.map((ep, idx) => (
                          <button
                            key={ep.id}
                            onClick={() => handleSelectEpisode(ep.id)}
                            className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                              store.currentEpisodeId === ep.id
                                ? 'bg-purple-700 text-white'
                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                          >
                            第{idx + 1}集
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 脚本面板标题 */}
                  <div className="px-3 py-2 flex items-center justify-between border-b border-gray-800/50">
                    <div className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-xs font-semibold text-gray-300">镜头脚本</span>
                      <span className="text-[10px] text-gray-500">{store.shots.length} 镜头</span>
                    </div>
                    {hasEpisode && !hasShots && (
                      <button
                        onClick={handlePlanEpisode}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-purple-700/80 hover:bg-purple-600 text-white disabled:opacity-40 transition-colors"
                      >
                        {store.planning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        AI 拆分镜头
                      </button>
                    )}
                  </div>

                  {/* 脚本列表（逐行编辑，拖拽排序） */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {!hasShots && !store.planning && hasEpisode && (
                      <div className="text-center py-8">
                        <p className="text-xs text-gray-500 mb-2">暂无镜头，点击上方按钮让 AI 拆分脚本</p>
                      </div>
                    )}
                    {store.planning && (
                      <div className="flex items-center justify-center py-8 gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                        <span className="text-xs text-gray-400">AI 正在拆分镜头脚本...</span>
                      </div>
                    )}
                    {store.shots.map((shot, idx) => (
                      <ScriptLineItem
                        key={shot.id}
                        shot={shot}
                        index={idx}
                        isSelected={selectedShotId === shot.id}
                        isDragging={draggingScriptIdx === idx}
                        onSelect={() => handleSelectShot(shot.id)}
                        onChange={(value) => handleScriptLineChange(shot.id, value)}
                        onDurationChange={(dur) => handleUpdateShot(shot.id, { duration: dur })}
                        onDragStart={() => handleScriptDragStart(idx)}
                        onDragOver={(e) => handleScriptDragOver(e, idx)}
                        onDrop={() => handleScriptDrop(idx)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </aside>

        {/* ---- 中央：竖屏预览 + 时间线 ---- */}
        <main className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* 预览区 */}
          <div className="flex-1 flex items-center justify-center p-4 min-h-0 relative">
            {hasShots ? (
              <div
                className="relative bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-2xl"
                style={{ aspectRatio: '9/16', maxHeight: '100%', height: '100%' }}
              >
                {/* 9:16 竖屏预览 */}
                <div className="w-full h-full flex items-center justify-center">
                  <PreviewPlayer
                    shots={store.shots}
                    currentShotId={selectedShotId}
                    onCurrentShotChange={handleSelectShot}
                  />
                </div>
                {/* 预览覆盖信息 */}
                <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                  <span className="text-[10px] bg-black/60 text-gray-300 px-2 py-0.5 rounded-full backdrop-blur">
                    9:16 竖屏
                  </span>
                  <span className="text-[10px] bg-black/60 text-gray-300 px-2 py-0.5 rounded-full backdrop-blur">
                    {formatSec(currentDuration)}
                  </span>
                </div>
                {/* 选定平台标签 */}
                <div className="absolute bottom-2 left-2 pointer-events-none">
                  <span className="text-[10px] bg-purple-700/80 text-white px-2 py-0.5 rounded-full">
                    {selectedPlatform.label} {selectedPlatform.width}x{selectedPlatform.height}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-gray-500 gap-3">
                <Film className="w-12 h-12 text-gray-700" />
                <p className="text-sm">
                  {store.currentSeries
                    ? '等待镜头生成后预览'
                    : '选择或创建一个短视频项目开始'}
                </p>
              </div>
            )}

            {/* 右侧镜头详情面板 */}
            {detailPanelOpen && selectedShot && (
              <div className="absolute top-0 right-0 h-full w-[380px] max-w-[50%] z-10 bg-gray-950/95 border-l border-gray-800 overflow-y-auto backdrop-blur">
                <ShotDetailPanel
                  shot={selectedShot}
                  elements={store.sharedElements}
                  onGenerateAsset={(stage) => handleGenerateShotAsset(selectedShot.id, stage)}
                  onInpaint={async (payload) => {
                    await store.inpaintShotFrame(selectedShot.id, {
                      edit_prompt: payload.editPrompt,
                      mask_data: payload.maskData,
                    })
                  }}
                  onUpdate={(updates) => handleUpdateShot(selectedShot.id, updates)}
                  onCollapse={() => setDetailPanelOpen(false)}
                  onClose={() => {
                    setDetailPanelOpen(false)
                    setSelectedShotId(null)
                  }}
                />
              </div>
            )}
          </div>

          {/* 紧凑时间线 */}
          <div className="shrink-0 h-[120px] border-t border-gray-800 bg-gray-950">
            {hasShots ? (
              <Timeline
                shots={store.shots}
                currentShotId={selectedShotId}
                onSelectShot={handleSelectShot}
                onReorder={handleShotReorder}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-gray-600">
                暂无时间线数据
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ======== 底部工具栏 ======== */}
      <footer className="shrink-0 h-14 flex items-center justify-between px-4 border-t border-gray-800 bg-gray-950/95 backdrop-blur z-20">
        {/* 左侧：时长预设 */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500 mr-1">目标时长</span>
          {DURATION_PRESETS.map((sec) => (
            <button
              key={sec}
              onClick={() => handleApplyDurationPreset(sec)}
              disabled={!hasShots}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                Math.abs(currentDuration - sec) < 2
                  ? 'bg-purple-700 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              } disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              {sec}s
            </button>
          ))}
          <span className="text-[11px] text-gray-500 ml-2">
            当前 {formatSec(currentDuration)}
          </span>
        </div>

        {/* 中央：状态 */}
        <div className="flex items-center gap-2">
          {store.generating && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-900/40 border border-purple-700/40">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
              <span className="text-xs text-purple-300">
                {store.generationMessage || '生成中...'}
              </span>
              {store.generationProgress.totalItems > 0 && (
                <span className="text-[10px] text-purple-400">
                  {store.generationProgress.currentIndex}/{store.generationProgress.totalItems}
                </span>
              )}
            </div>
          )}
          {store.planning && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-900/40 border border-blue-700/40">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span className="text-xs text-blue-300">AI 规划中...</span>
            </div>
          )}
        </div>

        {/* 右侧：操作按钮 */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleQuickGenerate}
            disabled={!hasEpisode || !hasShots || isBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="快速生成（跳过音频）"
          >
            <Play className="w-3.5 h-3.5" />
            快速生成
          </button>
          <button
            onClick={handleBatchGenerate}
            disabled={!hasEpisode || !hasShots || isBusy}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs bg-purple-700 hover:bg-purple-600 text-white font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="一键全流程生成（元素 + 图片 + 视频 + 音频）"
          >
            {store.generating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Film className="w-3.5 h-3.5" />
            )}
            一键生成全部
          </button>
        </div>
      </footer>

      {/* ======== 创建对话框 ======== */}
      {showCreateDialog && (
        <CreateShortVideoDialog
          onClose={() => setShowCreateDialog(false)}
          onSubmit={async (p) => {
            const s = await handleCreateSeries(p)
            if (s) {
              setShowCreateDialog(false)
              navigate(`${ROUTE_BASE}/${s.id}`)
            }
          }}
          creating={store.creating}
        />
      )}

      {/* 关闭下拉弹窗用的全局遮罩 */}
      {(showRhythmDropdown || showPlatformDropdown) && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => {
            setShowRhythmDropdown(false)
            setShowPlatformDropdown(false)
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// 脚本行项目
// ============================================================

function ScriptLineItem({
  shot,
  index,
  isSelected,
  isDragging,
  onSelect,
  onChange,
  onDurationChange,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  shot: StudioShot
  index: number
  isSelected: boolean
  isDragging: boolean
  onSelect: () => void
  onChange: (value: string) => void
  onDurationChange: (dur: number) => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
}) {
  const [localDesc, setLocalDesc] = useState(shot.description || '')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    setLocalDesc(shot.description || '')
  }, [shot.description])

  const handleBlur = () => {
    setEditing(false)
    if (localDesc.trim() !== (shot.description || '').trim()) {
      onChange(localDesc.trim())
    }
  }

  const thumbnailUrl = shot.start_image_url || shot.key_frame_url || ''

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onSelect}
      className={`group rounded-lg border p-2 cursor-pointer transition-all ${
        isSelected
          ? 'border-purple-600 bg-purple-900/20'
          : 'border-gray-800 bg-gray-900/40 hover:border-gray-700 hover:bg-gray-900/60'
      } ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-2">
        {/* 拖拽手柄 */}
        <div className="shrink-0 mt-1 cursor-grab text-gray-600 hover:text-gray-400">
          <GripVertical className="w-3.5 h-3.5" />
        </div>

        {/* 序号 & 缩略图 */}
        <div className="shrink-0 w-12">
          <div className="text-[10px] text-gray-500 mb-1">#{index + 1}</div>
          {thumbnailUrl ? (
            <div className="w-12 h-16 rounded overflow-hidden bg-gray-800">
              <img
                src={thumbnailUrl}
                alt={`镜头 ${index + 1}`}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-12 h-16 rounded bg-gray-800 flex items-center justify-center">
              <Film className="w-4 h-4 text-gray-700" />
            </div>
          )}
        </div>

        {/* 脚本文本 */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <textarea
              autoFocus
              value={localDesc}
              onChange={(e) => setLocalDesc(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleBlur()
              }}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 resize-none focus:outline-none focus:border-purple-500"
              rows={3}
            />
          ) : (
            <p
              onDoubleClick={() => setEditing(true)}
              className="text-xs text-gray-300 line-clamp-3 min-h-[2.5em] select-none"
              title="双击编辑"
            >
              {shot.description || shot.name || `镜头 ${index + 1}`}
            </p>
          )}

          {/* 底部信息栏 */}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-gray-500">{shot.type || '标准'}</span>
            <input
              type="number"
              value={Number(shot.duration) || 3}
              onChange={(e) => onDurationChange(parseFloat(e.target.value) || 3)}
              onClick={(e) => e.stopPropagation()}
              className="w-12 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px] text-gray-300 text-center focus:outline-none focus:border-purple-500"
              min={0.5}
              max={30}
              step={0.5}
            />
            <span className="text-[10px] text-gray-500">秒</span>
            {shot.video_url && (
              <span className="text-[10px] text-green-500">已生成</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 系列卡片（紧凑版）
// ============================================================

function SeriesCard({
  series,
  isSelected,
  onSelect,
}: {
  series: StudioSeries
  isSelected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      onClick={() => onSelect(series.id)}
      className={`w-full text-left rounded-lg border p-2.5 transition-all ${
        isSelected
          ? 'border-purple-600 bg-purple-900/20'
          : 'border-gray-800 bg-gray-900/40 hover:border-gray-700 hover:bg-gray-900/60'
      }`}
    >
      <div className="flex items-center gap-2">
        <Film className="w-4 h-4 text-purple-400 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-200 truncate">{series.name}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {series.episode_count ?? 0} 集 &middot; {series.element_count ?? 0} 元素
          </p>
        </div>
      </div>
      {series.description && (
        <p className="text-[10px] text-gray-500 mt-1 line-clamp-2">{series.description}</p>
      )}
    </button>
  )
}

// ============================================================
// 创建短视频项目对话框
// ============================================================

function CreateShortVideoDialog({
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
    episode_duration_seconds?: number
  }) => void | Promise<void>
  creating: boolean
}) {
  const [name, setName] = useState('')
  const [script, setScript] = useState('')
  const [description, setDescription] = useState('')
  const [visualStyle, setVisualStyle] = useState('')
  const [duration, setDuration] = useState(30)

  const handleSubmit = () => {
    if (!name.trim() || !script.trim()) return
    onSubmit({
      name: name.trim(),
      script: script.trim(),
      description: description.trim() || undefined,
      visual_style: visualStyle.trim() || undefined,
      episode_duration_seconds: duration,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-lg font-semibold text-gray-100 mb-1">创建短视频项目</h2>
        <p className="text-xs text-gray-500 mb-5">适用于 15-60 秒快节奏竖版内容</p>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">项目名称 *</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
              placeholder="例如：新品发布 15 秒预告"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-1">短视频脚本 *</label>
            <textarea
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500 resize-none"
              rows={6}
              placeholder="粘贴短视频脚本（建议 15-60 秒内容），AI 会按行拆分为镜头..."
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">{script.length} 字</p>
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
                placeholder="例如：电影级写实 / 动漫风"
                value={visualStyle}
                onChange={(e) => setVisualStyle(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-1">目标时长（秒）</label>
            <div className="flex items-center gap-2">
              {DURATION_PRESETS.map((sec) => (
                <button
                  key={sec}
                  onClick={() => setDuration(sec)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    duration === sec
                      ? 'bg-purple-700 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {sec}s
                </button>
              ))}
              <input
                type="number"
                className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 text-center focus:outline-none focus:border-purple-500"
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value) || 30)}
                min={10}
                max={90}
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
            {creating ? '创建中...' : '创建项目'}
          </button>
        </div>
      </div>
    </div>
  )
}
