import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Settings2, Plus, Film, Users, MapPin, Package,
  Loader2, Play, RefreshCw, Trash2, ChevronRight, ImageIcon,
  Video, Mic, Layers, Sparkles, Clock, CheckCircle, AlertCircle, X, Save,
} from 'lucide-react'
import { useStudioStore } from '../store/studioStore'
import { studioGetSettings, studioSaveSettings } from '../services/api'
import type { StudioSeries, StudioEpisode, StudioElement, StudioShot } from '../store/studioStore'

// ============================================================
// StudioPage - 长篇制作工作台
// ============================================================

export default function StudioPage() {
  const navigate = useNavigate()
  const { seriesId, episodeId } = useParams()
  const store = useStudioStore()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // 初始化加载
  useEffect(() => {
    store.loadSeriesList()
  }, [])

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
          {store.error && (
            <span className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {store.error}
            </span>
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
              onPlanEpisode={(id) => store.planEpisode(id)}
              onDeleteSeries={() => {
                if (store.currentSeriesId) {
                  store.deleteSeries(store.currentSeriesId)
                  navigate('/studio')
                }
              }}
              planning={store.planning}
            />
          )}

          {!store.loading && store.currentEpisode && (
            <EpisodeWorkbench
              episode={store.currentEpisode}
              shots={store.shots}
              elements={store.sharedElements}
              onBack={handleBackToSeries}
              onPlan={() => store.currentEpisodeId && store.planEpisode(store.currentEpisodeId)}
              onEnhance={(mode) => store.currentEpisodeId && store.enhanceEpisode(store.currentEpisodeId, mode)}
              onGenerateAsset={(shotId, stage) => store.generateShotAsset(shotId, stage)}
              onUpdateShot={(shotId, updates) => store.updateShot(shotId, updates)}
              onBatchGenerate={(stages) => store.currentEpisodeId && store.batchGenerate(store.currentEpisodeId, stages)}
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

      {/* 创建对话框 */}
      {showCreateDialog && (
        <CreateSeriesDialog
          onClose={() => setShowCreateDialog(false)}
          onSubmit={async (params) => {
            const s = await store.createSeries(params)
            setShowCreateDialog(false)
            if (s) navigate(`/studio/${s.id}`)
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
  planning,
}: {
  series: StudioSeries
  episodes: StudioEpisode[]
  elements: StudioElement[]
  onSelectEpisode: (id: string) => void
  onPlanEpisode: (id: string) => void
  onDeleteSeries: () => void
  planning: boolean
}) {
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
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Users className="w-4 h-4" />
            共享元素库（{elements.length}）
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {elements.map((el) => (
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
                  <span className="text-xs text-gray-500 ml-auto">[{el.id}]</span>
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
              </div>
            ))}
          </div>
        </section>

        {/* Series Bible */}
        {series.series_bible && (
          <section>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">世界观设定</h3>
            <pre className="p-4 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-400 whitespace-pre-wrap max-h-64 overflow-y-auto">
              {series.series_bible}
            </pre>
          </section>
        )}
      </div>
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
  onBatchGenerate,
  planning,
  generating,
}: {
  episode: StudioEpisode
  shots: StudioShot[]
  elements: StudioElement[]
  onBack: () => void
  onPlan: () => void
  onEnhance: (mode: 'refine' | 'expand') => void
  onGenerateAsset: (shotId: string, stage: 'frame' | 'video' | 'audio') => void
  onUpdateShot: (shotId: string, updates: Record<string, unknown>) => void
  onBatchGenerate: (stages?: string[]) => void
  planning: boolean
  generating: boolean
}) {
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const selectedShot = shots.find((s) => s.id === selectedShotId)

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
          <h3 className="text-sm font-semibold text-gray-200">
            第{episode.act_number}幕: {episode.title}
          </h3>
          <StatusDot status={episode.status} />
          <span className="text-xs text-gray-500">{episode.status}</span>
        </div>
        <div className="flex items-center gap-2">
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
  }) => void
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

function StudioSettingsPanel({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [llm, setLlm] = useState<ServiceConfig>({ protocol: 'openai', apiKey: '', baseUrl: '', model: '' })
  const [image, setImage] = useState<ServiceConfig>({ protocol: 'wanxiang', apiKey: '', baseUrl: '', model: '' })
  const [video, setVideo] = useState<ServiceConfig>({ protocol: 'volcano', apiKey: '', baseUrl: '', model: '' })

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
