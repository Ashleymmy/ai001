/**
 * 功能模块：Studio 组件模块，素材库面板（ElementLibraryPanel）
 */

import { useMemo, useState } from 'react'
import {
  X, Star, Pencil, Trash2, Loader2, Play, ImageIcon, Upload, Settings2, Link2, Unlink2,
} from 'lucide-react'
import type {
  StudioElement,
  StudioEpisodeElement,
  StudioGenerationScope,
} from '../../store/studioStore'
import HoverOverviewPanel from './HoverOverviewPanel'
import ElementEditDialog from './ElementEditDialog'
import ImageHistoryDialog from './ImageHistoryDialog'
import { uploadFile } from '../../services/api'
import type { StudioElementRenderMode, StudioElementReferenceMode } from '../../services/api'
import {
  STUDIO_IMAGE_RESOLUTION_PRESETS,
  clampStudioImageDimension,
  STUDIO_IMAGE_RATIO_PRESETS,
  isStudioImageResolutionValue,
  isStudioImageRatioValue,
  resolveStudioImageResolutionPreset,
  resolveStudioImageRatioPreset,
  resolveStudioImageSizeByRatio,
  type StudioImageResolutionValue,
  type StudioImageRatioValue,
} from './imageRatio'

type ElementImageQualityMode = 'standard' | 'high'

type ElementImageSettings = {
  ratio: StudioImageRatioValue
  resolution: StudioImageResolutionValue
  width: number
  height: number
  lockAspect: boolean
  renderMode: StudioElementRenderMode
  batchReferenceMode: StudioElementReferenceMode
  maxImages: number
  qualityMode: ElementImageQualityMode
}

const ELEMENT_IMAGE_SETTINGS_KEY = 'studio.elementLibrary.imageSettings.v2'

function clampGenerateCount(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(15, Math.round(value)))
}

function getElementImageSteps(qualityMode: ElementImageQualityMode): number {
  return qualityMode === 'high' ? 40 : 28
}

function resolveInitialElementImageSettings(): ElementImageSettings {
  const fallbackRatio: StudioImageRatioValue = '1:1'
  const fallbackResolution: StudioImageResolutionValue = '2k'
  const fallbackSize = resolveStudioImageSizeByRatio(fallbackRatio, 2048, fallbackRatio)
  const fallback: ElementImageSettings = {
    ratio: fallbackRatio,
    resolution: fallbackResolution,
    width: fallbackSize.width,
    height: fallbackSize.height,
    lockAspect: true,
    renderMode: 'auto',
    batchReferenceMode: 'light',
    maxImages: 1,
    qualityMode: 'high',
  }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(ELEMENT_IMAGE_SETTINGS_KEY)
    const parsed = raw ? JSON.parse(raw) as Partial<ElementImageSettings> : {}
    const legacyRatio = window.localStorage.getItem('studio.elementLibrary.imageRatio')
    const ratio = parsed?.ratio && isStudioImageRatioValue(parsed.ratio)
      ? parsed.ratio
      : legacyRatio && isStudioImageRatioValue(legacyRatio)
        ? legacyRatio
        : fallbackRatio
    const resolution = parsed?.resolution && isStudioImageResolutionValue(parsed.resolution)
      ? parsed.resolution
      : fallbackResolution
    const longEdge = resolveStudioImageResolutionPreset(resolution, fallbackResolution).longEdge
    const baseSize = resolveStudioImageSizeByRatio(ratio, longEdge, fallbackRatio)
    const width = clampStudioImageDimension(Number(parsed?.width), baseSize.width)
    const height = clampStudioImageDimension(Number(parsed?.height), baseSize.height)
    const renderMode = (parsed?.renderMode === 'storybook' || parsed?.renderMode === 'comic' || parsed?.renderMode === 'auto')
      ? parsed.renderMode
      : 'auto'
    const batchReferenceMode: StudioElementReferenceMode = (
      parsed?.batchReferenceMode === 'full' || parsed?.batchReferenceMode === 'light' || parsed?.batchReferenceMode === 'none'
    )
      ? parsed.batchReferenceMode
      : 'light'
    const qualityMode: ElementImageQualityMode = parsed?.qualityMode === 'standard' ? 'standard' : 'high'
    return {
      ratio,
      resolution,
      width,
      height,
      lockAspect: parsed?.lockAspect !== false,
      renderMode,
      batchReferenceMode,
      maxImages: clampGenerateCount(Number(parsed?.maxImages)),
      qualityMode,
    }
  } catch {
    return fallback
  }
}

export default function ElementLibraryPanel({
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
  onBatchGenerateMissingSharedElements?: (options?: {
    width?: number
    height?: number
    useReference?: boolean
    referenceMode?: StudioElementReferenceMode
  }) => void | Promise<void>
  generating?: boolean
  generationScope?: StudioGenerationScope
  onClose: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'character' | 'scene' | 'object'>('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [editingElement, setEditingElement] = useState<StudioElement | null>(null)
  const [historyElement, setHistoryElement] = useState<StudioElement | null>(null)
  const [historyDeletingUrl, setHistoryDeletingUrl] = useState<string | null>(null)
  const [characterRefModeMap, setCharacterRefModeMap] = useState<Record<string, 'none' | 'light' | 'full'>>({})
  const [uploadingRefFor, setUploadingRefFor] = useState<string | null>(null)
  const [showModelSettings, setShowModelSettings] = useState(false)
  const [imageSettings, setImageSettings] = useState<ElementImageSettings>(() => resolveInitialElementImageSettings())

  const imageRatioPreset = useMemo(
    () => resolveStudioImageRatioPreset(imageSettings.ratio, '1:1'),
    [imageSettings.ratio],
  )
  const imageSteps = useMemo(
    () => getElementImageSteps(imageSettings.qualityMode),
    [imageSettings.qualityMode],
  )

  const updateImageSettings = (
    updater: Partial<ElementImageSettings> | ((prev: ElementImageSettings) => ElementImageSettings),
  ) => {
    setImageSettings((prev) => {
      const next = typeof updater === 'function'
        ? updater(prev)
        : { ...prev, ...updater }
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(ELEMENT_IMAGE_SETTINGS_KEY, JSON.stringify(next))
          window.localStorage.setItem('studio.elementLibrary.imageRatio', next.ratio)
        } catch {
          // ignore local persistence errors
        }
      }
      return next
    })
  }

  const applyRatioAndResolution = (
    ratio: StudioImageRatioValue,
    resolution: StudioImageResolutionValue,
    fallback: ElementImageSettings,
  ): ElementImageSettings => {
    const longEdge = resolveStudioImageResolutionPreset(resolution, '2k').longEdge
    const nextSize = resolveStudioImageSizeByRatio(ratio, longEdge, ratio)
    return {
      ...fallback,
      ratio,
      resolution,
      width: nextSize.width,
      height: nextSize.height,
    }
  }

  const handleUploadRefImage = async (elementId: string, file: File) => {
    setUploadingRefFor(elementId)
    try {
      const result = await uploadFile(file)
      if (result.success && result.file.url && onUpdateSharedElement) {
        const uploadedUrl = String(result.file.url || '').trim()
        const target = sharedElements.find((item) => item.id === elementId)
        const existingRefs = Array.isArray(target?.reference_images)
          ? target.reference_images.map((url) => String(url || '').trim()).filter(Boolean)
          : []
        const nextRefs = uploadedUrl && !existingRefs.includes(uploadedUrl)
          ? [uploadedUrl, ...existingRefs].slice(0, 8)
          : existingRefs
        await onUpdateSharedElement(elementId, {
          image_url: uploadedUrl,
          reference_images: nextRefs,
        })
      }
    } catch (err) {
      console.error('上传参考图失败:', err)
    } finally {
      setUploadingRefFor(null)
    }
  }

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
    return characterRefModeMap[element.id] || 'none'
  }

  const renderModeText: Record<StudioElementRenderMode, string> = {
    auto: '自动',
    storybook: '故事书',
    comic: '连环画',
  }
  const batchRefModeText: Record<StudioElementReferenceMode, string> = {
    none: '关',
    light: '轻',
    full: '强',
  }

  const handleRatioChange = (nextRatio: StudioImageRatioValue) => {
    updateImageSettings((prev) => applyRatioAndResolution(nextRatio, prev.resolution, prev))
  }

  const handleResolutionChange = (nextResolution: StudioImageResolutionValue) => {
    updateImageSettings((prev) => applyRatioAndResolution(prev.ratio, nextResolution, prev))
  }

  const handleWidthChange = (nextRaw: number) => {
    updateImageSettings((prev) => {
      const nextWidth = clampStudioImageDimension(nextRaw, prev.width)
      if (!prev.lockAspect) return { ...prev, width: nextWidth }
      const ratio = Math.max(0.1, imageRatioPreset.width / Math.max(1, imageRatioPreset.height))
      const nextHeight = clampStudioImageDimension(Math.round(nextWidth / ratio), prev.height)
      return { ...prev, width: nextWidth, height: nextHeight }
    })
  }

  const handleHeightChange = (nextRaw: number) => {
    updateImageSettings((prev) => {
      const nextHeight = clampStudioImageDimension(nextRaw, prev.height)
      if (!prev.lockAspect) return { ...prev, height: nextHeight }
      const ratio = Math.max(0.1, imageRatioPreset.width / Math.max(1, imageRatioPreset.height))
      const nextWidth = clampStudioImageDimension(Math.round(nextHeight * ratio), prev.width)
      return { ...prev, width: nextWidth, height: nextHeight }
    })
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

    if (filteredHistory.length !== history.length) updates.image_history = filteredHistory
    if (filteredRefs.length !== refs.length) updates.reference_images = filteredRefs

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
    if (!onUpdateSharedElement) return
    const updates = buildElementImageDeleteUpdates(element, targetUrl)
    if (Object.keys(updates).length <= 0) return
    setHistoryDeletingUrl(targetUrl)
    try {
      await Promise.resolve(onUpdateSharedElement(element.id, updates))
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
                onClick={() => onBatchGenerateMissingSharedElements({
                  width: imageSettings.width,
                  height: imageSettings.height,
                  useReference: imageSettings.batchReferenceMode !== 'none',
                  referenceMode: imageSettings.batchReferenceMode,
                })}
                disabled={generating || sharedMissingCount <= 0}
                className="px-2 py-1 rounded text-xs bg-purple-700/70 hover:bg-purple-600/70 text-white disabled:opacity-40 inline-flex items-center gap-1 transition-colors"
                title="批量生成当前筛选中缺少参考图的共享素材"
              >
                {isBatchGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                批量生成缺图({sharedMissingCount})
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-gray-500">
                {renderModeText[imageSettings.renderMode]} · {imageSettings.resolution.toUpperCase()} · {imageSettings.ratio} · {imageSettings.width}x{imageSettings.height} · 批量一致性:{batchRefModeText[imageSettings.batchReferenceMode]}
              </span>
              <button
                onClick={() => setShowModelSettings((prev) => !prev)}
                className={`px-2 py-1 rounded text-xs border inline-flex items-center gap-1 transition-colors ${
                  showModelSettings
                    ? 'bg-purple-700/40 border-purple-500/50 text-purple-100'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'
                }`}
                title="素材图片模型参数"
              >
                <Settings2 className="w-3 h-3" />
                模型参数
              </button>
            </div>
          </div>
          {showModelSettings && (
            <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <p className="text-[11px] text-gray-400">生成图</p>
                  <div className="flex items-center gap-1.5">
                    {([
                      { value: 'auto', label: '自动模式' },
                      { value: 'storybook', label: '故事书' },
                      { value: 'comic', label: '连环画' },
                    ] as const).map((mode) => (
                      <button
                        key={mode.value}
                        onClick={() => updateImageSettings({ renderMode: mode.value })}
                        className={`px-2 py-1 rounded text-xs transition-colors ${
                          imageSettings.renderMode === mode.value
                            ? 'bg-purple-700/50 text-purple-100 border border-purple-500/40'
                            : 'bg-gray-800 text-gray-300 border border-gray-700 hover:text-white'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[11px] text-gray-400">分辨率</p>
                  <div className="inline-flex items-center rounded bg-gray-900 border border-gray-700 overflow-hidden">
                    {STUDIO_IMAGE_RESOLUTION_PRESETS.filter((item) => item.value === '2k' || item.value === '4k').map((item) => (
                      <button
                        key={item.value}
                        onClick={() => handleResolutionChange(item.value)}
                        className={`px-4 py-1.5 text-xs transition-colors ${
                          imageSettings.resolution === item.value
                            ? 'bg-gray-100 text-gray-900'
                            : 'text-gray-300 hover:bg-gray-800'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] text-gray-400">图片比例</p>
                <div className="grid grid-cols-4 md:grid-cols-8 gap-1.5">
                  {STUDIO_IMAGE_RATIO_PRESETS.map((item) => (
                    <button
                      key={item.value}
                      onClick={() => handleRatioChange(item.value)}
                      className={`px-2 py-1 rounded text-xs border transition-colors ${
                        imageSettings.ratio === item.value
                          ? 'bg-purple-700/50 border-purple-500/40 text-purple-100'
                          : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'
                      }`}
                    >
                      {item.value}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <p className="text-[11px] text-gray-400">图片尺寸</p>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-gray-400">
                      <span>W</span>
                      <input
                        type="number"
                        min={128}
                        max={4096}
                        value={imageSettings.width}
                        onChange={(e) => handleWidthChange(Number(e.target.value))}
                        className="w-24 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-100 focus:outline-none focus:border-purple-500"
                      />
                    </label>
                    <button
                      onClick={() => updateImageSettings({ lockAspect: !imageSettings.lockAspect })}
                      className="p-1.5 rounded bg-gray-800 border border-gray-700 text-gray-300 hover:text-white"
                      title={imageSettings.lockAspect ? '已锁定宽高比' : '未锁定宽高比'}
                    >
                      {imageSettings.lockAspect ? <Link2 className="w-3.5 h-3.5" /> : <Unlink2 className="w-3.5 h-3.5" />}
                    </button>
                    <label className="flex items-center gap-1 text-xs text-gray-400">
                      <span>H</span>
                      <input
                        type="number"
                        min={128}
                        max={4096}
                        value={imageSettings.height}
                        onChange={(e) => handleHeightChange(Number(e.target.value))}
                        className="w-24 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-100 focus:outline-none focus:border-purple-500"
                      />
                    </label>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[11px] text-gray-400">质量档位</p>
                  <div className="flex items-center gap-1.5">
                    {([
                      { value: 'standard', label: '标准' },
                      { value: 'high', label: '高质量' },
                    ] as const).map((item) => (
                      <button
                        key={item.value}
                        onClick={() => updateImageSettings({ qualityMode: item.value })}
                        className={`px-3 py-1 rounded text-xs border transition-colors ${
                          imageSettings.qualityMode === item.value
                            ? 'bg-purple-700/50 border-purple-500/40 text-purple-100'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                    <span className="text-[11px] text-gray-500">steps={imageSteps}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-gray-400">最大生成张数</p>
                  <span className="text-xs text-gray-300">{imageSettings.maxImages}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={15}
                  value={imageSettings.maxImages}
                  onChange={(e) => updateImageSettings({ maxImages: clampGenerateCount(Number(e.target.value)) })}
                  className="w-full accent-purple-500"
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] text-gray-400">批量角色一致性</p>
                <div className="inline-flex items-center rounded bg-gray-900 border border-gray-700 overflow-hidden">
                  {([
                    { value: 'none', label: '关' },
                    { value: 'light', label: '轻' },
                    { value: 'full', label: '强' },
                  ] as const).map((item) => (
                    <button
                      key={item.value}
                      onClick={() => updateImageSettings({ batchReferenceMode: item.value })}
                      className={`px-3 py-1.5 text-xs transition-colors ${
                        imageSettings.batchReferenceMode === item.value
                          ? 'bg-gray-100 text-gray-900'
                          : 'text-gray-300 hover:bg-gray-800'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-500">仅作用于“批量生成缺图”，单张生成仍按卡片上的一致性档位。</p>
              </div>
            </div>
          )}
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
                    <div className="relative w-full h-24 mb-2">
                      <img src={el.image_url} alt={el.name} className="w-full h-24 rounded object-contain bg-gray-900/60" />
                      {onUpdateSharedElement && (
                        <button
                          onClick={() => handleDeleteElementImage(el, el.image_url)}
                          className="absolute top-1 right-1 p-1 rounded bg-black/60 hover:bg-black/80 text-red-300 hover:text-red-200 transition-colors"
                          title="删除当前图片"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                      {onUpdateSharedElement && (
                        <label
                          className="absolute bottom-1 right-1 p-1 rounded bg-black/60 hover:bg-black/80 text-gray-300 hover:text-white cursor-pointer transition-colors"
                          title="上传参考图"
                        >
                          {uploadingRefFor === el.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) handleUploadRefImage(el.id, file)
                              e.target.value = ''
                            }}
                          />
                        </label>
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-24 rounded bg-gray-800 mb-2 flex items-center justify-center text-gray-600 relative">
                      <ImageIcon className="w-5 h-5" />
                      {onUpdateSharedElement && (
                        <label
                          className="absolute inset-0 flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-gray-300 cursor-pointer hover:bg-gray-700/30 rounded transition-colors"
                          title="上传参考图"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>上传</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) handleUploadRefImage(el.id, file)
                              e.target.value = ''
                            }}
                          />
                        </label>
                      )}
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
                            width: imageSettings.width,
                            height: imageSettings.height,
                            renderMode: imageSettings.renderMode,
                            maxImages: imageSettings.maxImages,
                            steps: imageSteps,
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
          onDelete={(url) => handleDeleteElementImage(historyElement, url)}
          deletingUrl={historyDeletingUrl}
        />
      )}

    </div>
  )
}
