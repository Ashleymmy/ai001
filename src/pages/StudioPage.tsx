import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Settings2, Plus, Film, Users, MapPin, Package,
  Loader2, Play, RefreshCw, Trash2, ChevronRight, ImageIcon,
  Video, Mic, Layers, Sparkles, Clock, CheckCircle, AlertCircle, X, Save,
  Star, Eye, Pencil, FileText,
} from 'lucide-react'
import { useStudioStore } from '../store/studioStore'
import { studioCheckConfig, studioGetSeriesStats, studioGetSettings, studioSaveSettings } from '../services/api'
import type { StudioSeriesStats } from '../services/api'
import type { StudioSeries, StudioEpisode, StudioElement, StudioShot } from '../store/studioStore'

type ServiceKey = 'llm' | 'image' | 'video' | 'tts'

interface StudioToast {
  id: string
  message: string
  code?: string | null
  context?: Record<string, unknown> | null
}

function formatStorage(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
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
  const [toasts, setToasts] = useState<StudioToast[]>([])

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

  const handleGenerateShotAsset = useCallback(async (shotId: string, stage: 'frame' | 'video' | 'audio') => {
    const required: ServiceKey[] =
      stage === 'frame' ? ['image'] : stage === 'video' ? ['video'] : ['tts']
    const ok = await ensureConfigReady(required)
    if (!ok) return
    await store.generateShotAsset(shotId, stage)
  }, [ensureConfigReady, store])

  const handleBatchGenerate = useCallback(async (episodeId: string, stages?: string[]) => {
    const actualStages = stages && stages.length > 0 ? stages : ['elements', 'frames', 'videos', 'audio']
    const required = new Set<ServiceKey>()
    if (actualStages.includes('elements') || actualStages.includes('frames')) required.add('image')
    if (actualStages.includes('videos')) required.add('video')
    if (actualStages.includes('audio')) required.add('tts')
    const ok = await ensureConfigReady(Array.from(required))
    if (!ok) return
    await store.batchGenerate(episodeId, stages)
  }, [ensureConfigReady, store])

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
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
            title="设置"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧导航面板 */}
        <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
          <div className="p-3 border-b border-gray-800">
            <button
              onClick={() => setShowCreateDialog(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              新建系列
            </button>
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
        </aside>

        {/* 主工作区 */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {store.loading && (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
            </div>
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
              onGenerateElementImage={async (elementId) => {
                const ok = await ensureConfigReady(['image'])
                if (!ok) return
                await store.generateElementImage(elementId)
              }}
              planning={store.planning}
              generating={store.generating}
            />
          )}

          {!store.loading && store.currentEpisode && (
            <EpisodeWorkbench
              episode={store.currentEpisode}
              shots={store.shots}
              elements={store.sharedElements}
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
              onUpdateShot={(shotId, updates) => store.updateShot(shotId, updates)}
              onUpdateEpisode={async (updates) => {
                if (!store.currentEpisodeId) return
                await store.updateEpisode(store.currentEpisodeId, updates)
              }}
              onBatchGenerate={async (stages) => {
                if (!store.currentEpisodeId) return
                await handleBatchGenerate(store.currentEpisodeId, stages)
              }}
              planning={store.planning}
              generating={store.generating}
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
          {store.generating && <span className="text-purple-400">生成中...</span>}
        </div>
      </footer>

      {toasts.length > 0 && (
        <ToastStack
          toasts={toasts}
          onClose={removeToast}
        />
      )}

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

      {isSelected && episodes.length > 0 && (
        <div className="ml-4 mt-0.5 space-y-0.5">
          {episodes.map((ep) => (
            <button
              key={ep.id}
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
  planning,
  generating,
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
  onGenerateElementImage: (elementId: string) => void | Promise<void>
  planning: boolean
  generating: boolean
}) {
  const [stats, setStats] = useState<StudioSeriesStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [elementTypeFilter, setElementTypeFilter] = useState<'all' | 'character' | 'scene' | 'object'>('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [editingBible, setEditingBible] = useState(false)
  const [bibleDraft, setBibleDraft] = useState(series.series_bible || '')
  const [showScriptPreview, setShowScriptPreview] = useState(false)
  const [showElementDialog, setShowElementDialog] = useState(false)
  const [editingElement, setEditingElement] = useState<StudioElement | null>(null)

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
          <button
            onClick={onDeleteSeries}
            className="p-2 rounded hover:bg-red-900/30 text-gray-500 hover:text-red-400 transition-colors"
            title="删除系列"
          >
            <Trash2 className="w-4 h-4" />
          </button>
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
                className="p-4 rounded-lg bg-gray-900 border border-gray-800 hover:border-purple-700 cursor-pointer transition-colors"
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
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    ep.status === 'planned' ? 'bg-blue-900/30 text-blue-300' :
                    ep.status === 'completed' ? 'bg-green-900/30 text-green-300' :
                    'bg-gray-800 text-gray-400'
                  }`}>
                    {ep.status === 'draft' ? '草稿' :
                     ep.status === 'planned' ? '已规划' :
                     ep.status === 'in_progress' ? '制作中' :
                     ep.status === 'completed' ? '已完成' : ep.status}
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
                className="p-3 rounded-lg bg-gray-900 border border-gray-800"
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
                <button
                  onClick={() => onGenerateElementImage(el.id)}
                  disabled={generating}
                  className="mt-2 text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-50 flex items-center gap-1 transition-colors"
                >
                  {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
                  生成参考图
                </button>
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
  onBack,
  onPlan,
  onEnhance,
  onGenerateAsset,
  onUpdateShot,
  onUpdateEpisode,
  onBatchGenerate,
  planning,
  generating,
}: {
  episode: StudioEpisode
  shots: StudioShot[]
  elements: StudioElement[]
  onBack: () => void
  onPlan: () => void | Promise<void>
  onEnhance: (mode: 'refine' | 'expand') => void | Promise<void>
  onGenerateAsset: (shotId: string, stage: 'frame' | 'video' | 'audio') => void | Promise<void>
  onUpdateShot: (shotId: string, updates: Record<string, unknown>) => void | Promise<void>
  onUpdateEpisode: (updates: Record<string, unknown>) => void | Promise<void>
  onBatchGenerate: (stages?: string[]) => void | Promise<void>
  planning: boolean
  generating: boolean
}) {
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [showScriptEditor, setShowScriptEditor] = useState(false)
  const [titleDraft, setTitleDraft] = useState(episode.title || '')
  const [summaryDraft, setSummaryDraft] = useState(episode.summary || '')
  const [scriptDraft, setScriptDraft] = useState(episode.script_excerpt || '')
  const selectedShot = shots.find((s) => s.id === selectedShotId)

  useEffect(() => {
    setTitleDraft(episode.title || '')
    setSummaryDraft(episode.summary || '')
    setScriptDraft(episode.script_excerpt || '')
  }, [episode.id, episode.title, episode.summary, episode.script_excerpt])

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
            onClick={() => setShowScriptEditor((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 transition-colors"
          >
            <FileText className="w-3 h-3" />
            {showScriptEditor ? '收起脚本' : '查看/编辑脚本'}
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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {shots.map((shot, idx) => (
                <ShotCard
                  key={shot.id}
                  shot={shot}
                  index={idx}
                  isSelected={shot.id === selectedShotId}
                  onClick={() => setSelectedShotId(shot.id === selectedShotId ? null : shot.id)}
                  onGenerateFrame={() => onGenerateAsset(shot.id, 'frame')}
                  onGenerateVideo={() => onGenerateAsset(shot.id, 'video')}
                  onGenerateAudio={() => onGenerateAsset(shot.id, 'audio')}
                  generating={generating}
                />
              ))}
            </div>
          )}
        </div>

        {/* 右侧详情面板 */}
        {selectedShot && (
          <div className="w-80 border-l border-gray-800 overflow-y-auto p-4 bg-gray-900/50 shrink-0">
            <ShotDetailPanel
              shot={selectedShot}
              elements={elements}
              onUpdate={(updates) => onUpdateShot(selectedShot.id, updates)}
              onClose={() => setSelectedShotId(null)}
            />
          </div>
        )}
      </div>
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
  onGenerateVideo,
  onGenerateAudio,
  generating,
}: {
  shot: StudioShot
  index: number
  isSelected: boolean
  onClick: () => void
  onGenerateFrame: () => void
  onGenerateVideo: () => void
  onGenerateAudio: () => void
  generating: boolean
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-lg border cursor-pointer transition-all ${
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
        <div className="flex items-center gap-1">
          {!shot.start_image_url && (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateFrame() }}
              disabled={generating}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              <ImageIcon className="w-3 h-3" />
              帧
            </button>
          )}
          {shot.start_image_url && !shot.video_url && (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateVideo() }}
              disabled={generating}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              <Video className="w-3 h-3" />
              视频
            </button>
          )}
          {(shot.narration || shot.dialogue_script) && !shot.audio_url && (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateAudio() }}
              disabled={generating}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              <Mic className="w-3 h-3" />
              音频
            </button>
          )}
          {shot.status === 'completed' && (
            <CheckCircle className="w-3.5 h-3.5 text-green-400 ml-auto" />
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 镜头详情面板
// ============================================================

function ShotDetailPanel({
  shot,
  elements,
  onUpdate,
  onClose,
}: {
  shot: StudioShot
  elements: StudioElement[]
  onUpdate: (updates: Record<string, unknown>) => void
  onClose: () => void
}) {
  const [editing, setEditing] = useState<Record<string, string>>({})

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-200">{shot.name || '镜头详情'}</h4>
        <button onClick={onClose} className="text-gray-500 hover:text-white">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 基本信息 */}
      <div className="space-y-3">
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
          onChange={(v) => setEditing((p) => ({ ...p, prompt: v }))}
          onBlur={() => handleSave('prompt')}
          multiline
        />
        <DetailField
          label="视频提示词"
          value={fieldValue('video_prompt')}
          onChange={(v) => setEditing((p) => ({ ...p, video_prompt: v }))}
          onBlur={() => handleSave('video_prompt')}
          multiline
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
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur: () => void
  multiline?: boolean
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
    openai: '按 API 支持的视频模型填写',
    volcano: 'kling-v1 / kling-v1-5',
    wanxiang: '按万相视频模型填写',
    relay: '按中转站支持的模型名填写',
  },
}

// 协议值 → 后端实际 provider 值
const PROTOCOL_TO_PROVIDER: Record<string, Record<string, string>> = {
  llm: { openai: 'openai', volcano: 'doubao', wanxiang: 'qwen', relay: 'openai' },
  image: { openai: 'openai', volcano: 'doubao', wanxiang: 'dashscope', relay: 'openai' },
  video: { openai: 'openai', volcano: 'kling', wanxiang: 'dashscope', relay: 'openai' },
}

// 后端 provider 值 → 协议值（反向映射，用于加载）
const PROVIDER_TO_PROTOCOL: Record<string, string> = {
  openai: 'openai',
  doubao: 'volcano',
  qwen: 'wanxiang',
  dashscope: 'wanxiang',
  kling: 'volcano',
  // 其他一律归为中转站
}

interface ServiceConfig {
  protocol: string
  apiKey: string
  baseUrl: string
  model: string
}

interface TTSConfig {
  appid: string
  accessToken: string
  cluster: string
  voiceType: string
}

interface GenerationDefaults {
  frame_width: number
  frame_height: number
  video_duration_seconds: number
  split_max_tokens: number
  plan_max_tokens: number
  enhance_max_tokens: number
}

function StudioSettingsPanel({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [llm, setLlm] = useState<ServiceConfig>({ protocol: 'openai', apiKey: '', baseUrl: '', model: '' })
  const [image, setImage] = useState<ServiceConfig>({ protocol: 'wanxiang', apiKey: '', baseUrl: '', model: '' })
  const [video, setVideo] = useState<ServiceConfig>({ protocol: 'volcano', apiKey: '', baseUrl: '', model: '' })
  const [tts, setTts] = useState<TTSConfig>({ appid: '', accessToken: '', cluster: 'volcano_tts', voiceType: 'BV700_V2_streaming' })
  const [defaults, setDefaults] = useState<GenerationDefaults>({
    frame_width: 1280,
    frame_height: 720,
    video_duration_seconds: 6,
    split_max_tokens: 8000,
    plan_max_tokens: 16000,
    enhance_max_tokens: 16000,
  })

  useEffect(() => {
    studioGetSettings().then((data) => {
      const mapLoad = (raw: Record<string, unknown>): ServiceConfig => {
        const provider = (raw.provider as string) || ''
        return {
          protocol: PROVIDER_TO_PROTOCOL[provider] || (provider ? 'relay' : 'openai'),
          apiKey: (raw.apiKey as string) || '',
          baseUrl: (raw.baseUrl as string) || '',
          model: (raw.model as string) || '',
        }
      }
      if (data.llm) setLlm(mapLoad(data.llm as Record<string, unknown>))
      if (data.image) setImage(mapLoad(data.image as Record<string, unknown>))
      if (data.video) setVideo(mapLoad(data.video as Record<string, unknown>))
      if (data.tts && typeof data.tts === 'object') {
        const raw = data.tts as Record<string, unknown>
        setTts({
          appid: (raw.appid as string) || '',
          accessToken: (raw.accessToken as string) || '',
          cluster: (raw.cluster as string) || 'volcano_tts',
          voiceType: (raw.voiceType as string) || 'BV700_V2_streaming',
        })
      }
      if (data.generation_defaults && typeof data.generation_defaults === 'object') {
        const raw = data.generation_defaults as Record<string, unknown>
        setDefaults((prev) => ({
          frame_width: Number(raw.frame_width) || prev.frame_width,
          frame_height: Number(raw.frame_height) || prev.frame_height,
          video_duration_seconds: Number(raw.video_duration_seconds) || prev.video_duration_seconds,
          split_max_tokens: Number(raw.split_max_tokens) || prev.split_max_tokens,
          plan_max_tokens: Number(raw.plan_max_tokens) || prev.plan_max_tokens,
          enhance_max_tokens: Number(raw.enhance_max_tokens) || prev.enhance_max_tokens,
        }))
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

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
        tts: {
          appid: tts.appid,
          accessToken: tts.accessToken,
          cluster: tts.cluster,
          voiceType: tts.voiceType,
        },
        generation_defaults: defaults,
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
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-xl max-h-[85vh] overflow-y-auto p-6">
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
                  <label className="text-xs text-gray-400 block mb-1">App ID</label>
                  <input
                    value={tts.appid}
                    onChange={(e) => setTts((prev) => ({ ...prev, appid: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                    placeholder="火山引擎 App ID"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Access Token</label>
                  <input
                    type="password"
                    value={tts.accessToken}
                    onChange={(e) => setTts((prev) => ({ ...prev, accessToken: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                    placeholder="火山引擎 Access Token"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Cluster</label>
                    <input
                      value={tts.cluster}
                      onChange={(e) => setTts((prev) => ({ ...prev, cluster: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                      placeholder="volcano_tts"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">默认音色</label>
                    <input
                      value={tts.voiceType}
                      onChange={(e) => setTts((prev) => ({ ...prev, voiceType: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                      placeholder="BV700_V2_streaming"
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
