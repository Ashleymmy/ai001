/**
 * SeriesOverview -- 系列总览面板
 * 从 StudioPage.tsx 中提取，负责展示系列信息、项目统计、分集卡片、共享元素库和世界观设定。
 */

import { useState, useEffect, useMemo } from 'react'
import {
  Plus, Users, MapPin, Package,
  Loader2, Trash2, ImageIcon,
  Mic, Layers, Clock,
  Star, Eye, Pencil, X,
} from 'lucide-react'
import { studioGetSeriesStats } from '../../services/api'
import type { StudioSeriesStats } from '../../services/api'
import type { StudioElementRenderMode, StudioElementReferenceMode } from '../../services/api'
import type {
  StudioSeries,
  StudioEpisode,
  StudioElement,
  StudioGenerationScope,
} from '../../store/studioStore'
import DocumentUploadButton from './DocumentUploadButton'
import {
  StatusDot,
  getEpisodeStatusText,
  getEpisodeStatusBadgeClass,
} from '../../pages/StudioPage'
import type { WorkbenchMode } from '../../pages/StudioPage'
import HoverOverviewPanel from './HoverOverviewPanel'
import ElementEditDialog from './ElementEditDialog'
import ImageHistoryDialog from './ImageHistoryDialog'
import ElementLibraryPanel from './ElementLibraryPanel'
import {
  STUDIO_IMAGE_RATIO_PRESETS,
  isStudioImageRatioValue,
  resolveStudioImageSizeByRatio,
  type StudioImageRatioValue,
} from './imageRatio'

// ── helpers only used by SeriesOverview ──────────────────────

function formatStorage(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
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

// ── main component ──────────────────────────────────────────

export default function SeriesOverview({
  workbenchMode,
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
  workbenchMode: WorkbenchMode
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
  onBatchGenerateElementImages?: (options?: {
    width?: number
    height?: number
    useReference?: boolean
    referenceMode?: StudioElementReferenceMode
  }) => void | Promise<void>
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
  const [historyDeletingUrl, setHistoryDeletingUrl] = useState<string | null>(null)
  const [characterRefModeMap, setCharacterRefModeMap] = useState<Record<string, 'none' | 'light' | 'full'>>({})
  const [elementImageRatio, setElementImageRatio] = useState<StudioImageRatioValue>(() => {
    if (typeof window === 'undefined') return '1:1'
    try {
      const raw = window.localStorage.getItem('studio.elementLibrary.imageRatio')
      return raw && isStudioImageRatioValue(raw) ? raw : '1:1'
    } catch {
      return '1:1'
    }
  })
  const elementImageRatioPreset = useMemo(
    () => resolveStudioImageSizeByRatio(elementImageRatio, 2048, '1:1'),
    [elementImageRatio],
  )

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
    return characterRefModeMap[element.id] || 'none'
  }

  const persistElementImageRatio = (next: StudioImageRatioValue) => {
    setElementImageRatio(next)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem('studio.elementLibrary.imageRatio', next)
    } catch {
      // ignore local persistence errors
    }
  }

  const normalizeImageList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  }

  const buildElementImageDeleteUpdates = (element: StudioElement, targetUrl: string): Record<string, unknown> => {
    const target = String(targetUrl || '').trim()
    if (!target) return {}

    const current = String(element.image_url || '').trim()
    const history = normalizeImageList(element.image_history)
    const refs = normalizeImageList(element.reference_images)
    const filteredHistory = history.filter((url) => url !== target)
    const filteredRefs = refs.filter((url) => url !== target)
    const updates: Record<string, unknown> = {}

    if (filteredHistory.length !== history.length) {
      updates.image_history = filteredHistory
    }
    if (filteredRefs.length !== refs.length) {
      updates.reference_images = filteredRefs
    }

    if (current === target) {
      const nextHistory = filteredHistory.slice()
      let nextCurrent = ''
      if (nextHistory.length > 0) {
        nextCurrent = nextHistory[nextHistory.length - 1]
        const nextCurrentIndex = nextHistory.lastIndexOf(nextCurrent)
        if (nextCurrentIndex >= 0) nextHistory.splice(nextCurrentIndex, 1)
      }
      updates.image_url = nextCurrent
      updates.image_history = nextHistory
    }
    return updates
  }

  const handleDeleteElementImage = async (element: StudioElement, targetUrl: string) => {
    const updates = buildElementImageDeleteUpdates(element, targetUrl)
    if (Object.keys(updates).length <= 0) return
    setHistoryDeletingUrl(targetUrl)
    try {
      await Promise.resolve(onUpdateElement(element.id, updates))
      if (historyElement && historyElement.id === element.id) {
        setHistoryElement({
          ...historyElement,
          image_url: typeof updates.image_url === 'string' ? updates.image_url : historyElement.image_url,
          image_history: Array.isArray(updates.image_history)
            ? updates.image_history as string[]
            : (historyElement.image_history || []),
          reference_images: Array.isArray(updates.reference_images)
            ? updates.reference_images as string[]
            : (historyElement.reference_images || []),
        })
      }
    } finally {
      setHistoryDeletingUrl(null)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {workbenchMode === 'short_video' && (
          <section className="rounded-lg border border-purple-700/40 bg-purple-900/12 p-3 text-xs text-purple-100">
            <p className="font-medium">短视频快编模式</p>
            <p className="text-purple-200/80 mt-1">
              推荐每集时长 15-60 秒，优先保证节奏密度与转场连贯性。
            </p>
          </section>
        )}
        {workbenchMode === 'digital_human' && (
          <section className="rounded-lg border border-indigo-700/40 bg-indigo-900/12 p-3 text-xs text-indigo-100">
            <p className="font-medium">数字人创作模式</p>
            <p className="text-indigo-200/80 mt-1">
              先在"数字人台"维护角色阶段配置，再进行镜头规划和素材生成，可显著降低角色漂移。
            </p>
          </section>
        )}

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
              <select
                value={elementImageRatio}
                onChange={(e) => {
                  const next = e.target.value
                  if (isStudioImageRatioValue(next)) persistElementImageRatio(next)
                }}
                className="px-2 py-1 rounded text-xs bg-gray-800 border border-gray-700 text-gray-300 focus:outline-none focus:border-purple-500"
                title="素材生成画面比例"
              >
                {STUDIO_IMAGE_RATIO_PRESETS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.value}
                  </option>
                ))}
              </select>
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
                  <div className="relative mt-2">
                    <img
                      src={el.image_url}
                      alt={el.name}
                      className="w-full h-24 object-contain bg-gray-900/60 rounded"
                    />
                    <button
                      onClick={() => handleDeleteElementImage(el, el.image_url)}
                      className="absolute top-1 right-1 p-1 rounded bg-black/60 hover:bg-black/80 text-red-300 hover:text-red-200 transition-colors"
                      title="删除当前图片"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
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
                        width: elementImageRatioPreset.width,
                        height: elementImageRatioPreset.height,
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
                          <img src={el.image_url} alt={el.name} className="w-full h-full object-contain" />
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
                  <DocumentUploadButton
                    onTextExtracted={(text) => setBibleDraft((prev) => prev ? prev + '\n\n' + text : text)}
                    label="上传文档"
                  />
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
          onDelete={(url) => handleDeleteElementImage(historyElement, url)}
          deletingUrl={historyDeletingUrl}
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
