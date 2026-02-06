import { useState, useEffect } from 'react'
import {
  Image,
  Video as VideoIcon,
  Download,
  RefreshCw,
  Trash2,
  AlertCircle,
  History,
  Sparkles,
  X,
  Heart,
  Search,
  CheckSquare,
  Square,
  ChevronDown,
  Settings2,
  Maximize2,
  Copy,
  Filter,
  Shuffle,
  ZoomIn,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import ModuleChat from '../components/ModuleChat'
import ModuleModelSwitcher from '../components/ModuleModelSwitcher'
import ProjectBackButton from '../components/ProjectBackButton'
import {
  generateImage,
  getImageHistory,
  getAgentImageHistory,
  deleteImageHistory,
  deleteImagesHistoryBatch
} from '../services/api'
import { IMAGE_PROVIDERS, useSettingsStore } from '../store/settingsStore'

interface GeneratedImage {
  id: string
  prompt: string
  url: string
  negativePrompt?: string
  status: 'generating' | 'done' | 'error'
  createdAt?: string
  width?: number
  height?: number
  steps?: number
  seed?: number
  style?: string
  favorite?: boolean
}

// 尺寸预设
const SIZE_PRESETS = [
  { label: '横版 16:9', width: 1024, height: 576 },
  { label: '横版 3:2', width: 1024, height: 683 },
  { label: '正方形 1:1', width: 1024, height: 1024 },
  { label: '竖版 2:3', width: 683, height: 1024 },
  { label: '竖版 9:16', width: 576, height: 1024 },
  { label: '超宽 21:9', width: 1344, height: 576 },
]

// 风格预设
const STYLE_PRESETS = [
  { value: '', label: '无风格' },
  { value: 'cinematic', label: '电影感' },
  { value: 'anime', label: '动漫风' },
  { value: 'realistic', label: '写实风' },
  { value: 'ink', label: '水墨风' },
  { value: 'fantasy', label: '奇幻风' },
  { value: 'cyberpunk', label: '赛博朋克' },
  { value: 'watercolor', label: '水彩风' },
  { value: 'oil_painting', label: '油画风' },
]

const FAVORITES_KEY = 'storyboarder-image-favorites'

export default function ImagePage() {
  const { settings, updateImage, syncToBackend } = useSettingsStore()
  const location = useLocation()
  const navigate = useNavigate()
  const projectId = new URLSearchParams(location.search).get('project') || undefined
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [agentImages, setAgentImages] = useState<GeneratedImage[]>([])
  const [activeHistoryTab, setActiveHistoryTab] = useState<'module' | 'agent'>('module')
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  
  // 高级参数
  const [width, setWidth] = useState(1024)
  const [height, setHeight] = useState(576)
  const [steps, setSteps] = useState(25)
  const [seed, setSeed] = useState<number | undefined>(undefined)
  const [style, setStyle] = useState('')
  
  // 预览弹窗
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null)
  
  // 批量操作
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  
  // 搜索/筛选
  const [searchQuery, setSearchQuery] = useState('')
  const [filterFavorites, setFilterFavorites] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  
  // 收藏列表
  const [favorites, setFavorites] = useState<Set<string>>(new Set())

  useEffect(() => {
    setIsLoading(true)
    Promise.all([loadHistory(), loadAgentHistory()]).finally(() => setIsLoading(false))
    loadFavorites()
  }, [projectId])

  useEffect(() => {
    if (activeHistoryTab === 'agent') {
      setSelectMode(false)
      setSelectedIds(new Set())
    }
  }, [activeHistoryTab])

  const applyImageModel = async (updates: Partial<typeof settings.image>) => {
    updateImage(updates)
    try {
      await syncToBackend()
    } catch (error) {
      console.error('同步图像模型设置失败:', error)
    }
  }

  const loadFavorites = () => {
    try {
      const saved = localStorage.getItem(FAVORITES_KEY)
      if (saved) {
        setFavorites(new Set(JSON.parse(saved)))
      }
    } catch (e) {
      console.error('加载收藏失败:', e)
    }
  }

  const saveFavorites = (newFavorites: Set<string>) => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...newFavorites]))
    setFavorites(newFavorites)
  }

  const loadHistory = async () => {
    try {
      const history = await getImageHistory(100, projectId)
      const loadedImages: GeneratedImage[] = history.map((img) => ({
        id: img.id,
        prompt: img.prompt,
        url: img.image_url,
        negativePrompt: img.negative_prompt,
        status: 'done' as const,
        createdAt: img.created_at,
        width: img.width,
        height: img.height,
        steps: img.steps,
        seed: img.seed,
        style: img.style
      }))
      setImages(loadedImages)
    } catch (err) {
      console.error('加载历史记录失败:', err)
    }
  }

  const loadAgentHistory = async () => {
    try {
      const history = await getAgentImageHistory(100, projectId)
      const loadedImages: GeneratedImage[] = history.map((img) => ({
        id: img.id,
        prompt: img.prompt,
        url: img.image_url,
        negativePrompt: img.negative_prompt,
        status: 'done' as const,
        createdAt: img.created_at,
        width: img.width,
        height: img.height,
        steps: img.steps,
        seed: img.seed,
        style: img.style
      }))
      setAgentImages(loadedImages)
    } catch (err) {
      console.error('加载 Agent 图片历史失败:', err)
    }
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) return

    setIsGenerating(true)
    setError(null)

    const tempId = Date.now().toString()
    const newImage: GeneratedImage = {
      id: tempId,
      prompt: prompt,
      url: '',
      negativePrompt: negativePrompt,
      status: 'generating',
      width, height, steps, seed, style
    }
    setImages((prev) => [newImage, ...prev])

    try {
      const result = await generateImage(prompt, negativePrompt || undefined, {
        projectId,
        width,
        height,
        steps,
        seed,
        style: style || undefined,
        imageConfig: settings.image,
        local: settings.local
      })
      setImages((prev) =>
        prev.map((img) =>
          img.id === tempId
            ? { ...img, url: result.imageUrl, status: 'done' as const, seed: result.seed }
            : img
        )
      )
    } catch (err: any) {
      console.error('生成失败:', err)
      // 提取详细错误信息
      const errorDetail = err?.response?.data?.detail || err?.message || '未知错误'
      setError(`图像生成失败: ${errorDetail}`)
      setImages((prev) =>
        prev.map((img) =>
          img.id === tempId ? { ...img, status: 'error' as const } : img
        )
      )
    } finally {
      setIsGenerating(false)
    }
  }

  const handleRegenerate = async (img: GeneratedImage) => {
    setImages((prev) =>
      prev.map((i) =>
        i.id === img.id ? { ...i, status: 'generating' as const } : i
      )
    )

    try {
      const result = await generateImage(
        img.prompt,
        img.negativePrompt || undefined,
        {
          projectId,
          width: img.width,
          height: img.height,
          steps: img.steps,
          style: img.style,
          imageConfig: settings.image,
          local: settings.local
        }
      )
      setImages((prev) =>
        prev.map((i) =>
          i.id === img.id
            ? { ...i, url: result.imageUrl, status: 'done' as const, seed: result.seed }
            : i
        )
      )
    } catch (err) {
      console.error('重新生成失败:', err)
      setImages((prev) =>
        prev.map((i) =>
          i.id === img.id ? { ...i, status: 'error' as const } : i
        )
      )
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteImageHistory(id)
    } catch (err) {
      console.error('删除失败:', err)
    }
    setImages((prev) => prev.filter((img) => img.id !== id))
    if (selectedImage?.id === id) setSelectedImage(null)
    if (previewImage?.id === id) setPreviewImage(null)
    // 从收藏中移除
    if (favorites.has(id)) {
      const newFavorites = new Set(favorites)
      newFavorites.delete(id)
      saveFavorites(newFavorites)
    }
  }

  const handleDownload = (img: GeneratedImage) => {
    const a = document.createElement('a')
    a.href = img.url
    a.download = `image-${img.id}.png`
    a.click()
  }

  const toggleFavorite = (id: string) => {
    const newFavorites = new Set(favorites)
    if (newFavorites.has(id)) {
      newFavorites.delete(id)
    } else {
      newFavorites.add(id)
    }
    saveFavorites(newFavorites)
  }

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const selectAll = () => {
    setSelectedIds(new Set(filteredImages.map(img => img.id)))
  }

  const deselectAll = () => {
    setSelectedIds(new Set())
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`确定删除选中的 ${selectedIds.size} 张图片吗？`)) return
    
    try {
      await deleteImagesHistoryBatch([...selectedIds])
    } catch (err) {
      console.error('批量删除失败:', err)
    }
    
    setImages(prev => prev.filter(img => !selectedIds.has(img.id)))
    // 从收藏中移除
    const newFavorites = new Set(favorites)
    selectedIds.forEach(id => newFavorites.delete(id))
    saveFavorites(newFavorites)
    setSelectedIds(new Set())
    setSelectMode(false)
  }

  const handleBatchDownload = () => {
    const toDownload = images.filter(img => selectedIds.has(img.id) && img.status === 'done')
    toDownload.forEach((img, i) => {
      setTimeout(() => handleDownload(img), i * 200)
    })
  }

  const handleBatchFavorite = () => {
    const newFavorites = new Set(favorites)
    selectedIds.forEach(id => newFavorites.add(id))
    saveFavorites(newFavorites)
  }

  const handleSendToVideo = (img: GeneratedImage) => {
    const key = `storyboarder:video:pending:${projectId || 'global'}`
    const queued = (() => {
      try {
        const raw = sessionStorage.getItem(key)
        const parsed = raw ? JSON.parse(raw) : []
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    })()
    queued.unshift({
      sourceImage: img.url,
      prompt: img.prompt,
      createdAt: new Date().toISOString()
    })
    sessionStorage.setItem(key, JSON.stringify(queued.slice(0, 20)))
    navigate(projectId ? `/home/video?project=${encodeURIComponent(projectId)}` : '/home/video')
  }

  const copyPrompt = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const randomSeed = () => {
    setSeed(Math.floor(Math.random() * 2147483647))
  }

  const applySizePreset = (preset: typeof SIZE_PRESETS[0]) => {
    setWidth(preset.width)
    setHeight(preset.height)
  }

  // 筛选图片
  const activeImages = activeHistoryTab === 'agent' ? agentImages : images
  const filteredImages = activeImages.filter(img => {
    if (filterFavorites && !favorites.has(img.id)) return false
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return img.prompt.toLowerCase().includes(query) ||
             (img.negativePrompt?.toLowerCase().includes(query))
    }
    return true
  })

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fadeIn">
      {/* 项目返回按钮 */}
      <div className="px-4 pt-3">
        <ProjectBackButton />
      </div>
      
      <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        {/* 顶部工具栏 */}
        <div className="flex items-center justify-between px-6 py-4 glass-dark border-b border-white/5 animate-fadeInDown">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-pink-500 via-rose-500 to-orange-400 flex items-center justify-center shadow-lg shadow-pink-500/30">
              <Image size={20} className="text-white drop-shadow-md" strokeWidth={2.5} />
            </div>
            <h1 className="text-lg font-semibold">图像生成</h1>
          </div>
          <div className="flex items-center gap-2">
            <ModuleModelSwitcher
              category="image"
              title="图像模型"
              config={settings.image}
              providers={IMAGE_PROVIDERS}
              onApply={applyImageModel}
            />
            <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10">
              <button
                onClick={() => setActiveHistoryTab('module')}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  activeHistoryTab === 'module' ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400 hover:text-white'
                }`}
              >
                模块历史
              </button>
              <button
                onClick={() => setActiveHistoryTab('agent')}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  activeHistoryTab === 'agent' ? 'bg-violet-500/20 text-violet-300' : 'text-gray-400 hover:text-white'
                }`}
              >
                Agent历史
              </button>
            </div>
            {/* 搜索 */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索提示词..."
                className="glass-input pl-9 pr-3 py-1.5 text-sm w-48"
              />
            </div>
            {/* 筛选 */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`glass-button p-2 rounded-lg ${showFilters ? 'bg-purple-500/20' : ''}`}
            >
              <Filter size={16} />
            </button>
            {/* 批量选择 */}
            {activeHistoryTab === 'module' && (
              <button
                onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()) }}
                className={`glass-button px-3 py-1.5 rounded-lg text-sm ${selectMode ? 'bg-purple-500/20' : ''}`}
              >
                {selectMode ? '取消选择' : '批量操作'}
              </button>
            )}
            <div className="text-sm text-gray-400 glass-button px-3 py-1.5 rounded-full">
              <History size={14} className="inline mr-1" />
              {filteredImages.filter((i) => i.status === 'done').length} 张
            </div>
          </div>
        </div>

        {/* 筛选栏 */}
        {showFilters && (
          <div className="px-6 py-3 glass-dark border-b border-white/5 flex items-center gap-4 animate-fadeInDown">
            <button
              onClick={() => setFilterFavorites(!filterFavorites)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
                filterFavorites ? 'bg-pink-500/20 text-pink-400' : 'glass-button'
              }`}
            >
              <Heart size={14} fill={filterFavorites ? 'currentColor' : 'none'} />
              只看收藏
            </button>
          </div>
        )}

        {/* 批量操作栏 */}
        {activeHistoryTab === 'module' && selectMode && (
          <div className="px-6 py-3 glass-dark border-b border-white/5 flex items-center gap-3 animate-fadeInDown">
            <span className="text-sm text-gray-400">已选 {selectedIds.size} 项</span>
            <button onClick={selectAll} className="glass-button px-3 py-1 rounded-lg text-sm">全选</button>
            <button onClick={deselectAll} className="glass-button px-3 py-1 rounded-lg text-sm">取消全选</button>
            <div className="flex-1" />
            <button
              onClick={handleBatchFavorite}
              disabled={selectedIds.size === 0}
              className="glass-button px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"
            >
              <Heart size={14} /> 收藏
            </button>
            <button
              onClick={handleBatchDownload}
              disabled={selectedIds.size === 0}
              className="glass-button px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"
            >
              <Download size={14} /> 下载
            </button>
            <button
              onClick={handleBatchDelete}
              disabled={selectedIds.size === 0}
              className="glass-button px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 text-red-400 disabled:opacity-50"
            >
              <Trash2 size={14} /> 删除
            </button>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mx-6 mt-4 flex items-center gap-2 px-4 py-3 glass-card bg-red-500/10 border-red-500/20 text-red-400 rounded-xl text-sm animate-fadeInDown">
            <AlertCircle size={16} />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">×</button>
          </div>
        )}

        {/* 输入区域 */}
        <div className="p-6 border-b border-white/5 space-y-4 animate-fadeInUp delay-100" style={{ animationFillMode: 'backwards' }}>
          <div className="flex gap-4">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想要生成的图像...&#10;例如：一位穿着红色连衣裙的女孩站在樱花树下，电影感光影，浅景深"
              className="flex-1 glass-input p-4 text-sm resize-none h-24 placeholder-gray-500"
            />
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className="px-6 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-all hover:scale-105 hover:shadow-lg hover:shadow-purple-500/25 flex items-center gap-2"
            >
              {isGenerating ? (
                <RefreshCw size={18} className="animate-spin" />
              ) : (
                <Sparkles size={18} />
              )}
              生成
            </button>
          </div>

          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-2"
            >
              <Settings2 size={14} />
              <span className={`transform transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
              {showAdvanced ? '收起' : '展开'}高级选项
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4 animate-fadeIn">
                {/* 负面提示词 */}
                <div>
                  <label className="block text-sm text-gray-400 mb-2">负面提示词</label>
                  <input
                    type="text"
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    placeholder="blurry, low quality, distorted..."
                    className="w-full glass-input p-3 text-sm"
                  />
                </div>

                {/* 尺寸和风格 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">图像尺寸</label>
                    <div className="flex flex-wrap gap-2">
                      {SIZE_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          onClick={() => applySizePreset(preset)}
                          className={`px-3 py-1.5 rounded-lg text-xs transition-all ${
                            width === preset.width && height === preset.height
                              ? 'bg-purple-500/30 text-purple-300'
                              : 'glass-button'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                      <input
                        type="number"
                        value={width}
                        onChange={(e) => setWidth(Number(e.target.value))}
                        className="glass-input w-20 px-2 py-1 text-center"
                      />
                      <span>×</span>
                      <input
                        type="number"
                        value={height}
                        onChange={(e) => setHeight(Number(e.target.value))}
                        className="glass-input w-20 px-2 py-1 text-center"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">风格预设</label>
                    <div className="relative">
                      <select
                        value={style}
                        onChange={(e) => setStyle(e.target.value)}
                        className="w-full glass-input p-3 text-sm appearance-none cursor-pointer"
                      >
                        {STYLE_PRESETS.map((s) => (
                          <option key={s.value} value={s.value} className="bg-gray-900">{s.label}</option>
                        ))}
                      </select>
                      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* 采样步数和种子 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">采样步数: {steps}</label>
                    <input
                      type="range"
                      min="10"
                      max="50"
                      value={steps}
                      onChange={(e) => setSteps(Number(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">随机种子</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={seed ?? ''}
                        onChange={(e) => setSeed(e.target.value ? Number(e.target.value) : undefined)}
                        placeholder="随机"
                        className="flex-1 glass-input p-2 text-sm"
                      />
                      <button
                        onClick={randomSeed}
                        className="glass-button p-2 rounded-lg"
                        title="生成随机种子"
                      >
                        <Shuffle size={16} />
                      </button>
                      <button
                        onClick={() => setSeed(undefined)}
                        className="glass-button p-2 rounded-lg"
                        title="清除种子"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 图像展示区 */}
        <div 
          className="flex-1 min-h-0 p-6 overflow-y-auto"
          style={{ overscrollBehavior: 'contain' }}
        >
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 animate-fadeIn">
              <div className="w-16 h-16 rounded-2xl glass-card flex items-center justify-center mb-4 animate-pulse-glow">
                <RefreshCw size={28} className="animate-spin text-purple-400" />
              </div>
              <p className="text-sm">加载中...</p>
            </div>
          ) : filteredImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 animate-fadeIn">
              <div className="w-20 h-20 rounded-2xl glass-card flex items-center justify-center mb-4">
                <Image size={36} className="text-gray-600" />
              </div>
              <p className="text-lg font-medium text-gray-400">
                {searchQuery || filterFavorites ? '没有找到匹配的图像' : '还没有生成的图像'}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {searchQuery || filterFavorites ? '尝试调整筛选条件' : '输入提示词后点击生成'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {filteredImages.map((img, index) => (
                <ImageCard
                  key={img.id}
                  img={img}
                  index={index}
                  selectMode={activeHistoryTab === 'module' && selectMode}
                  isSelected={selectedIds.has(img.id)}
                  isFavorite={favorites.has(img.id)}
                  isHighlighted={selectedImage?.id === img.id}
                  onSelect={() => toggleSelect(img.id)}
                  onClick={() => !(activeHistoryTab === 'module' && selectMode) && img.status === 'done' && setSelectedImage(img)}
                  onPreview={() => setPreviewImage(img)}
                  onDownload={() => handleDownload(img)}
                  onRegenerate={() => handleRegenerate(img)}
                  onDelete={() => handleDelete(img.id)}
                  onToggleFavorite={() => toggleFavorite(img.id)}
                  readOnly={activeHistoryTab === 'agent'}
                />
              ))}
            </div>
          )}
        </div>

        {/* 选中图片信息 */}
        {selectedImage && selectedImage.status === 'done' && !selectMode && (
          <div className="p-4 glass-dark border-t border-white/5 animate-fadeInUp">
            <div className="flex items-center gap-4">
              <p className="text-sm text-gray-400 truncate flex-1">
                <span className="text-gray-500">提示词:</span> {selectedImage.prompt}
              </p>
              <button
                onClick={() => copyPrompt(selectedImage.prompt)}
                className="glass-button p-1.5 rounded-lg"
                title="复制提示词"
              >
                <Copy size={14} />
              </button>
              <button
                onClick={() => handleSendToVideo(selectedImage)}
                className="glass-button p-1.5 rounded-lg text-emerald-300"
                title="发送到视频模块"
              >
                <VideoIcon size={14} />
              </button>
              {selectedImage.seed && (
                <span className="text-xs text-gray-500">种子: {selectedImage.seed}</span>
              )}
              {selectedImage.width && selectedImage.height && (
                <span className="text-xs text-gray-500">{selectedImage.width}×{selectedImage.height}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 右侧 AI 对话 */}
      <div
        className={`border-l border-white/5 glass-dark animate-slideInRight relative overflow-hidden transition-[width] duration-300 ease-out ${
          chatCollapsed ? 'w-12' : 'w-96'
        }`}
      >
        <div
          className={`absolute inset-0 flex items-start justify-center pt-3 transition-opacity duration-200 ${
            chatCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <button
            onClick={() => setChatCollapsed(false)}
            className="p-2 glass-button rounded-lg text-gray-300 hover:text-white transition-transform duration-200 hover:scale-105"
            title="展开聊天"
          >
            <PanelRightOpen size={16} />
          </button>
        </div>
        <div
          className={`h-full flex flex-col min-h-0 transition-all duration-300 ${
            chatCollapsed ? 'opacity-0 translate-x-2 pointer-events-none' : 'opacity-100 translate-x-0'
          }`}
        >
          <button
            onClick={() => setChatCollapsed(true)}
            className="absolute top-2 left-2 z-10 p-1.5 glass-button rounded-lg text-gray-300 hover:text-white transition-transform duration-200 hover:scale-105"
            title="收起聊天"
          >
            <PanelRightClose size={14} />
          </button>
          <ModuleChat
            moduleType="image"
            placeholder="描述画面，或让 AI 帮你优化提示词..."
            context={prompt ? `当前提示词：${prompt}` : undefined}
            className="flex-1 min-h-0 m-2"
          />
        </div>
      </div>

      {/* 图片预览弹窗 */}
      {previewImage && (
        <ImagePreviewModal
          image={previewImage}
          isFavorite={favorites.has(previewImage.id)}
          onClose={() => setPreviewImage(null)}
          onDownload={() => handleDownload(previewImage)}
          onRegenerate={() => { handleRegenerate(previewImage); setPreviewImage(null) }}
          onDelete={() => { handleDelete(previewImage.id); setPreviewImage(null) }}
          onToggleFavorite={() => toggleFavorite(previewImage.id)}
          onCopyPrompt={() => copyPrompt(previewImage.prompt)}
          onUseParams={() => {
            setPrompt(previewImage.prompt)
            setNegativePrompt(previewImage.negativePrompt || '')
            if (previewImage.width) setWidth(previewImage.width)
            if (previewImage.height) setHeight(previewImage.height)
            if (previewImage.steps) setSteps(previewImage.steps)
            if (previewImage.seed) setSeed(previewImage.seed)
            if (previewImage.style) setStyle(previewImage.style)
            setShowAdvanced(true)
            setPreviewImage(null)
          }}
          readOnly={activeHistoryTab === 'agent'}
        />
      )}
      </div>
    </div>
  )
}

// 图片卡片组件
interface ImageCardProps {
  img: GeneratedImage
  index: number
  selectMode: boolean
  readOnly: boolean
  isSelected: boolean
  isFavorite: boolean
  isHighlighted: boolean
  onSelect: () => void
  onClick: () => void
  onPreview: () => void
  onDownload: () => void
  onRegenerate: () => void
  onDelete: () => void
  onToggleFavorite: () => void
}

function ImageCard({
  img, index, selectMode, readOnly, isSelected, isFavorite, isHighlighted,
  onSelect, onClick, onPreview, onDownload, onRegenerate, onDelete, onToggleFavorite
}: ImageCardProps) {
  return (
    <div
      onClick={selectMode ? onSelect : onClick}
      className={`relative group cursor-pointer glass-card overflow-hidden transition-all hover-lift animate-fadeInUp ${
        isSelected ? 'ring-2 ring-purple-500' : ''
      }`}
      style={{ animationDelay: `${index * 0.05}s`, animationFillMode: 'backwards' }}
    >
      {/* 选择框 */}
      {selectMode && (
        <div className="absolute top-2 left-2 z-10">
          {isSelected ? (
            <CheckSquare size={20} className="text-purple-400" />
          ) : (
            <Square size={20} className="text-gray-400" />
          )}
        </div>
      )}
      
      {/* 收藏标记 */}
      {isFavorite && !selectMode && (
        <div className="absolute top-2 left-2 z-10">
          <Heart size={16} className="text-pink-500" fill="currentColor" />
        </div>
      )}

      {img.status === 'generating' ? (
        <div className="w-full aspect-square flex items-center justify-center bg-gradient-to-br from-purple-500/10 to-pink-500/10">
          <div className="text-center">
            <RefreshCw size={32} className="animate-spin text-purple-400 mx-auto mb-2" />
            <p className="text-xs text-gray-400">生成中...</p>
          </div>
        </div>
      ) : img.status === 'error' ? (
        <div className="w-full aspect-square flex flex-col items-center justify-center text-red-400 bg-red-500/5">
          <AlertCircle size={32} className="mb-2" />
          <span className="text-sm">生成失败</span>
          {!readOnly && (
            <button
              onClick={(e) => { e.stopPropagation(); onRegenerate() }}
              className="mt-2 text-xs text-gray-400 hover:text-white glass-button px-3 py-1 rounded-lg"
            >
              重试
            </button>
          )}
        </div>
      ) : (
        <>
          <img src={img.url} alt={img.prompt} className="w-full aspect-square object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-3">
            <p className="text-xs text-gray-300 line-clamp-2 mb-2">{img.prompt}</p>
            <div className="flex items-center justify-center gap-2">
              <button onClick={(e) => { e.stopPropagation(); onPreview() }} className="p-2 glass-button rounded-lg hover:bg-white/20" title="预览">
                <ZoomIn size={14} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onToggleFavorite() }} className="p-2 glass-button rounded-lg hover:bg-white/20" title="收藏">
                <Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} className={isFavorite ? 'text-pink-500' : ''} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDownload() }} className="p-2 glass-button rounded-lg hover:bg-white/20" title="下载">
                <Download size={14} />
              </button>
              {!readOnly && (
                <button onClick={(e) => { e.stopPropagation(); onRegenerate() }} className="p-2 glass-button rounded-lg hover:bg-white/20" title="重新生成">
                  <RefreshCw size={14} />
                </button>
              )}
              {!readOnly && (
                <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="p-2 glass-button rounded-lg hover:bg-red-500/50" title="删除">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
          {isHighlighted && (
            <div className="absolute inset-0 border-2 border-purple-500 rounded-[20px] pointer-events-none" />
          )}
        </>
      )}
    </div>
  )
}

// 图片预览弹窗组件
interface ImagePreviewModalProps {
  image: GeneratedImage
  isFavorite: boolean
  readOnly: boolean
  onClose: () => void
  onDownload: () => void
  onRegenerate: () => void
  onDelete: () => void
  onToggleFavorite: () => void
  onCopyPrompt: () => void
  onUseParams: () => void
}

function ImagePreviewModal({
  image, isFavorite, readOnly, onClose, onDownload, onRegenerate, onDelete, onToggleFavorite, onCopyPrompt, onUseParams
}: ImagePreviewModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl max-h-[90vh] flex glass-card overflow-hidden animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 图片 */}
        <div className="flex-1 flex items-center justify-center bg-black/50 min-w-[500px]">
          <img
            src={image.url}
            alt={image.prompt}
            className="max-w-full max-h-[80vh] object-contain"
          />
        </div>
        
        {/* 信息面板 */}
        <div className="w-80 p-5 flex flex-col glass-dark">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">图片详情</h3>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
              <X size={18} />
            </button>
          </div>
          
          <div 
            className="flex-1 overflow-y-auto space-y-4"
            style={{ overscrollBehavior: 'contain' }}
          >
            {/* 提示词 */}
            <div>
              <label className="text-xs text-gray-500 block mb-1">提示词</label>
              <p className="text-sm text-gray-300 leading-relaxed">{image.prompt}</p>
            </div>
            
            {image.negativePrompt && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">负面提示词</label>
                <p className="text-sm text-gray-400">{image.negativePrompt}</p>
              </div>
            )}
            
            {/* 参数 */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {image.width && image.height && (
                <div className="glass-card p-2 rounded-lg">
                  <span className="text-xs text-gray-500 block">尺寸</span>
                  <span className="text-gray-300">{image.width}×{image.height}</span>
                </div>
              )}
              {image.steps && (
                <div className="glass-card p-2 rounded-lg">
                  <span className="text-xs text-gray-500 block">步数</span>
                  <span className="text-gray-300">{image.steps}</span>
                </div>
              )}
              {image.seed && (
                <div className="glass-card p-2 rounded-lg">
                  <span className="text-xs text-gray-500 block">种子</span>
                  <span className="text-gray-300">{image.seed}</span>
                </div>
              )}
              {image.style && (
                <div className="glass-card p-2 rounded-lg">
                  <span className="text-xs text-gray-500 block">风格</span>
                  <span className="text-gray-300">{STYLE_PRESETS.find(s => s.value === image.style)?.label || image.style}</span>
                </div>
              )}
            </div>
            
            {image.createdAt && (
              <div className="text-xs text-gray-500">
                创建于 {new Date(image.createdAt).toLocaleString()}
              </div>
            )}
          </div>
          
          {/* 操作按钮 */}
          <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
            <div className="flex gap-2">
              <button onClick={onToggleFavorite} className={`flex-1 glass-button py-2 rounded-lg text-sm flex items-center justify-center gap-1 ${isFavorite ? 'text-pink-400' : ''}`}>
                <Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} />
                {isFavorite ? '已收藏' : '收藏'}
              </button>
              <button onClick={onCopyPrompt} className="flex-1 glass-button py-2 rounded-lg text-sm flex items-center justify-center gap-1">
                <Copy size={14} /> 复制提示词
              </button>
            </div>
            <button onClick={onUseParams} className="w-full glass-button py-2 rounded-lg text-sm flex items-center justify-center gap-1 text-purple-400">
              <Maximize2 size={14} /> 使用相同参数
            </button>
            <div className="flex gap-2">
              <button onClick={onDownload} className="flex-1 glass-button py-2 rounded-lg text-sm flex items-center justify-center gap-1">
                <Download size={14} /> 下载
              </button>
              {!readOnly && (
                <button onClick={onRegenerate} className="flex-1 glass-button py-2 rounded-lg text-sm flex items-center justify-center gap-1">
                  <RefreshCw size={14} /> 重新生成
                </button>
              )}
            </div>
            {!readOnly && (
              <button onClick={onDelete} className="w-full glass-button py-2 rounded-lg text-sm flex items-center justify-center gap-1 text-red-400 hover:bg-red-500/20">
                <Trash2 size={14} /> 删除
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
