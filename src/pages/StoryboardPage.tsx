import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Film, Download, RefreshCw, Trash2, Save, Sparkles, Upload, Edit3, Copy,
  Plus, ChevronLeft, ChevronRight, X, Play, Pause, GripVertical, Image,
  FileText, FolderOpen, Clock, Eye, Settings2, ChevronDown, PanelRightClose, PanelRightOpen
} from 'lucide-react'
import ModuleChat from '../components/ModuleChat'
import ModuleModelSwitcher from '../components/ModuleModelSwitcher'
import ProjectBackButton from '../components/ProjectBackButton'
import { generateStoryboards, regenerateImage, uploadReference, parseStory } from '../services/api'
import { IMAGE_PROVIDERS, useSettingsStore } from '../store/settingsStore'

interface Storyboard {
  id: string
  index: number
  prompt: string
  fullPrompt?: string
  imageUrl: string | null
  status: 'pending' | 'generating' | 'done' | 'error'
}

interface SavedStoryboardProject {
  id: string
  projectId?: string
  name: string
  script: string
  style: string
  referenceImage?: string
  storyboards: Storyboard[]
  updatedAt: string
}

const STYLES = [
  { id: 'cinematic', name: '电影感', desc: '电影级光影、景深效果' },
  { id: 'anime', name: '动漫', desc: '日式动画风格' },
  { id: 'realistic', name: '写实', desc: '照片级真实感' },
  { id: 'ink', name: '水墨', desc: '中国传统水墨画风' },
  { id: 'fantasy', name: '奇幻', desc: '魔幻史诗风格' },
  { id: 'cyberpunk', name: '赛博朋克', desc: '霓虹科幻风格' },
]

const STORAGE_KEY = 'storyboarder-storyboards'

export default function StoryboardPage() {
  const location = useLocation()
  const { settings, updateStoryboard, syncToBackend } = useSettingsStore()
  const projectPathMatch = location.pathname.match(/\/home\/storyboard\/([^/?#]+)/)
  const projectId = projectPathMatch ? decodeURIComponent(projectPathMatch[1]) : null
  const storageKey = projectId ? `${STORAGE_KEY}:${projectId}` : STORAGE_KEY

  const [script, setScript] = useState('')
  const [style, setStyle] = useState('cinematic')
  const [count, setCount] = useState(4)
  const [storyboards, setStoryboards] = useState<Storyboard[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [storyboardId, setStoryboardId] = useState<string | null>(null)
  const [storyboardName, setStoryboardName] = useState('未命名分镜')
  
  // 参考图
  const [referenceImage, setReferenceImage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // 编辑模式
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPrompt, setEditPrompt] = useState('')
  
  // 预览模式
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [slideshowMode, setSlideshowMode] = useState(false)
  const [slideshowInterval, setSlideshowInterval] = useState(3000)
  
  // 历史记录
  const [showHistory, setShowHistory] = useState(false)
  const [savedProjects, setSavedProjects] = useState<SavedStoryboardProject[]>([])
  
  // 拖拽排序
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  
  // 高级选项
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [generateMode, setGenerateMode] = useState<'auto' | 'manual'>('auto')
  const [chatCollapsed, setChatCollapsed] = useState(false)

  const applyStoryboardModel = async (updates: Partial<typeof settings.storyboard>) => {
    updateStoryboard(updates)
    try {
      await syncToBackend()
    } catch (error) {
      console.error('同步分镜模型设置失败:', error)
    }
  }

  useEffect(() => {
    setStoryboardId(null)
    setStoryboardName('未命名分镜')
    setScript('')
    setStyle('cinematic')
    setReferenceImage(null)
    setStoryboards([])
    setShowHistory(false)
    loadSavedProjects()
  }, [storageKey])

  // 幻灯片自动播放
  useEffect(() => {
    if (slideshowMode && previewIndex !== null && storyboards.length > 0) {
      const timer = setInterval(() => {
        setPreviewIndex(prev => {
          if (prev === null) return 0
          return (prev + 1) % storyboards.length
        })
      }, slideshowInterval)
      return () => clearInterval(timer)
    }
  }, [slideshowMode, storyboards.length, slideshowInterval])

  const loadSavedProjects = () => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        setSavedProjects(JSON.parse(saved))
      } else {
        setSavedProjects([])
      }
    } catch (e) {
      console.error('加载历史记录失败:', e)
    }
  }

  const handleSaveStoryboard = (showAlert = true) => {
    if (storyboards.length === 0 && !script.trim()) return
    
    const data: SavedStoryboardProject = {
      id: storyboardId || `storyboard-${Date.now()}`,
      projectId: projectId || undefined,
      name: storyboardName,
      script,
      style,
      referenceImage: referenceImage || undefined,
      storyboards,
      updatedAt: new Date().toISOString()
    }
    
    const savedList = [...savedProjects]
    const existingIndex = savedList.findIndex(s => s.id === data.id)
    
    if (existingIndex >= 0) {
      savedList[existingIndex] = data
    } else {
      savedList.unshift(data)
      setStoryboardId(data.id)
    }
    
    localStorage.setItem(storageKey, JSON.stringify(savedList))
    setSavedProjects(savedList)
    
    if (showAlert) {
      alert('保存成功')
    }
  }

  const handleLoadProject = (project: SavedStoryboardProject) => {
    setStoryboardId(project.id)
    setStoryboardName(project.name)
    setScript(project.script)
    setStyle(project.style)
    setReferenceImage(project.referenceImage || null)
    setStoryboards(project.storyboards)
    setShowHistory(false)
  }

  const handleDeleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('确定删除这个分镜项目吗？')) return
    
    const newList = savedProjects.filter(p => p.id !== id)
    localStorage.setItem(storageKey, JSON.stringify(newList))
    setSavedProjects(newList)
    
    if (storyboardId === id) {
      handleNewProject()
    }
  }

  const handleNewProject = () => {
    setStoryboardId(null)
    setStoryboardName('未命名分镜')
    setScript('')
    setStyle('cinematic')
    setReferenceImage(null)
    setStoryboards([])
    setShowHistory(false)
  }

  const handleNameBlur = () => {
    if (storyboardName.trim() && (storyboards.length > 0 || script.trim())) {
      handleSaveStoryboard(false)
    }
  }

  const handleUploadReference = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    try {
      const dataUrl = await uploadReference(file)
      setReferenceImage(dataUrl)
    } catch (error) {
      console.error('上传失败:', error)
      alert('上传参考图失败')
    }
  }

  const handleGenerate = async () => {
    if (!script.trim()) return
    
    setIsGenerating(true)
    
    try {
      if (generateMode === 'auto') {
        // 自动模式：一次性生成所有分镜
        const results = await generateStoryboards({
          referenceImage,
          storyText: script,
          style,
          count,
          llm: settings.llm,
          storyboard: settings.storyboard,
          local: settings.local
        })
        
        setStoryboards(results.map((r, i) => ({
          id: r.id,
          index: i + 1,
          prompt: r.prompt,
          fullPrompt: r.fullPrompt,
          imageUrl: r.imageUrl,
          status: 'done' as const
        })))
      } else {
        // 手动模式：先拆解剧本，再逐个生成
        const prompts = await parseStory(script, count, style, settings.llm)
        
        const newStoryboards: Storyboard[] = prompts.map((prompt, i) => ({
          id: `sb-${Date.now()}-${i}`,
          index: i + 1,
          prompt,
          imageUrl: null,
          status: 'pending' as const
        }))
        
        setStoryboards(newStoryboards)
      }
    } catch (error) {
      console.error('生成失败:', error)
      alert('生成分镜失败，请检查设置')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleGenerateSingle = async (sb: Storyboard) => {
    setStoryboards(prev => prev.map(s => 
      s.id === sb.id ? { ...s, status: 'generating' as const } : s
    ))
    
    try {
      const newUrl = await regenerateImage(sb.prompt, referenceImage, style, {
        storyboard: settings.storyboard,
        local: settings.local
      })
      setStoryboards(prev => prev.map(s => 
        s.id === sb.id ? { ...s, imageUrl: newUrl, status: 'done' as const } : s
      ))
    } catch (error) {
      console.error('生成失败:', error)
      setStoryboards(prev => prev.map(s => 
        s.id === sb.id ? { ...s, status: 'error' as const } : s
      ))
    }
  }

  const handleRegenerate = async (sb: Storyboard) => {
    await handleGenerateSingle(sb)
  }

  const handleDelete = (id: string) => {
    setStoryboards(prev => {
      const filtered = prev.filter(s => s.id !== id)
      return filtered.map((s, i) => ({ ...s, index: i + 1 }))
    })
  }

  const handleEditPrompt = (sb: Storyboard) => {
    setEditingId(sb.id)
    setEditPrompt(sb.prompt)
  }

  const handleSavePrompt = (id: string) => {
    setStoryboards(prev => prev.map(s => 
      s.id === id ? { ...s, prompt: editPrompt } : s
    ))
    setEditingId(null)
    setEditPrompt('')
  }

  const handleCopyStoryboard = (sb: Storyboard) => {
    const newSb: Storyboard = {
      ...sb,
      id: `sb-${Date.now()}`,
      index: storyboards.length + 1
    }
    setStoryboards(prev => [...prev, newSb])
  }

  const handleAddStoryboard = () => {
    const newSb: Storyboard = {
      id: `sb-${Date.now()}`,
      index: storyboards.length + 1,
      prompt: '',
      imageUrl: null,
      status: 'pending'
    }
    setStoryboards(prev => [...prev, newSb])
    setEditingId(newSb.id)
    setEditPrompt('')
  }

  // 拖拽排序
  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return
    
    const newStoryboards = [...storyboards]
    const [dragged] = newStoryboards.splice(draggedIndex, 1)
    newStoryboards.splice(index, 0, dragged)
    
    // 更新索引
    const reindexed = newStoryboards.map((s, i) => ({ ...s, index: i + 1 }))
    setStoryboards(reindexed)
    setDraggedIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  // 导出功能
  const handleExportHTML = () => {
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${storyboardName}</title>
<style>body{font-family:system-ui,sans-serif;max-width:1200px;margin:0 auto;padding:20px;background:#1a1a2e;color:#fff}
h1{text-align:center;margin-bottom:30px}.script{background:#16213e;padding:20px;border-radius:12px;margin-bottom:30px}
.sb{display:flex;margin-bottom:20px;background:#16213e;border-radius:12px;overflow:hidden}
.sb img{width:400px;height:auto;object-fit:cover}.sb .info{padding:20px;flex:1}
.sb .idx{font-size:24px;font-weight:bold;color:#f39c12;margin-bottom:10px}.sb .prompt{color:#ccc;line-height:1.6}</style></head>
<body><h1>${storyboardName}</h1>
<div class="script"><strong>剧本：</strong><p>${script}</p></div>
${storyboards.map(sb => `<div class="sb"><img src="${sb.imageUrl}"><div class="info"><div class="idx">#${sb.index}</div><div class="prompt">${sb.prompt}</div></div></div>`).join('')}
</body></html>`
    
    downloadFile(html, `${storyboardName}.html`, 'text/html')
  }

  const handleExportJSON = () => {
    const data = {
      name: storyboardName,
      script,
      style,
      storyboards: storyboards.map(sb => ({
        index: sb.index,
        prompt: sb.prompt,
        imageUrl: sb.imageUrl
      })),
      exportedAt: new Date().toISOString()
    }
    downloadFile(JSON.stringify(data, null, 2), `${storyboardName}.json`, 'application/json')
  }

  const handleExportMarkdown = () => {
    const md = `# ${storyboardName}\n\n## 剧本\n\n${script}\n\n## 分镜\n\n${storyboards.map(sb => 
      `### 第 ${sb.index} 镜\n\n![分镜${sb.index}](${sb.imageUrl})\n\n${sb.prompt}\n`
    ).join('\n')}`
    downloadFile(md, `${storyboardName}.md`, 'text/markdown')
  }

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadImages = async () => {
    // 逐个下载图片
    storyboards.forEach((sb, i) => {
      if (sb.imageUrl) {
        setTimeout(() => {
          const a = document.createElement('a')
          a.href = sb.imageUrl!
          a.download = `${storyboardName}-${sb.index}.png`
          a.click()
        }, i * 300)
      }
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fadeIn">
      {/* 项目返回按钮 */}
      <div className="px-4 pt-3">
        <ProjectBackButton />
      </div>
      
      <div className="flex-1 min-h-0 flex">
      {/* 左侧主区域 */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        {/* 工具栏 */}
        <div className="relative z-40 flex items-center justify-between px-6 py-4 glass-dark border-b border-white/5 animate-fadeInDown">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-400 flex items-center justify-center shadow-lg shadow-orange-500/30">
              <Film size={20} className="text-white drop-shadow-md" strokeWidth={2.5} />
            </div>
            <input
              type="text"
              value={storyboardName}
              onChange={(e) => setStoryboardName(e.target.value)}
              onBlur={handleNameBlur}
              className="bg-transparent text-lg font-semibold focus:outline-none border-b-2 border-transparent focus:border-orange-500/50 transition-colors"
            />
          </div>
          <div className="flex items-center gap-2">
            <ModuleModelSwitcher
              category="storyboard"
              title="分镜模型"
              config={settings.storyboard}
              providers={IMAGE_PROVIDERS}
              onApply={applyStoryboardModel}
            />
            <button 
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-2 px-3 py-2 glass-button rounded-xl text-sm hover:bg-white/10 transition-all"
              title="历史记录"
            >
              <Clock size={16} />
            </button>
            <button 
              onClick={handleNewProject}
              className="flex items-center gap-2 px-3 py-2 glass-button rounded-xl text-sm hover:bg-white/10 transition-all"
              title="新建项目"
            >
              <Plus size={16} />
            </button>
            <button 
              onClick={() => handleSaveStoryboard(true)}
              className="flex items-center gap-2 px-4 py-2 glass-button rounded-xl text-sm hover:bg-orange-500/20 hover:border-orange-500/30 transition-all"
            >
              <Save size={16} />
              保存
            </button>
            {storyboards.length > 0 && (
              <ExportDropdown
                onExportHTML={handleExportHTML}
                onExportJSON={handleExportJSON}
                onExportMarkdown={handleExportMarkdown}
                onDownloadImages={handleDownloadImages}
              />
            )}
          </div>
        </div>

        {/* 输入区 */}
        <div className="p-6 border-b border-white/5 space-y-4 animate-fadeInUp delay-100" style={{ animationFillMode: 'backwards' }}>
          {/* 参考图和剧本 */}
          <div className="flex gap-4">
            {/* 参考图上传 */}
            <div 
              onClick={() => fileInputRef.current?.click()}
              className={`w-32 h-32 rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all overflow-hidden ${
                referenceImage ? 'border-orange-500/50' : 'border-white/10 hover:border-white/30'
              }`}
            >
              {referenceImage ? (
                <div className="relative w-full h-full group">
                  <img src={referenceImage} alt="参考图" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); setReferenceImage(null) }}
                      className="p-2 glass-button rounded-lg"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <Upload size={24} className="text-gray-500 mb-2" />
                  <span className="text-xs text-gray-500">参考图</span>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleUploadReference}
              className="hidden"
            />
            
            {/* 剧本输入 */}
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="输入剧本或场景描述...&#10;例如：主角走进一间昏暗的房间，发现桌上有一封信。他拿起信，脸上露出惊讶的表情。"
              className="flex-1 glass-input p-4 text-sm resize-none h-32 placeholder-gray-500"
            />
          </div>
          
          {/* 高级选项切换 */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-2"
          >
            <Settings2 size={14} />
            <span className={`transform transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
            {showAdvanced ? '收起' : '展开'}高级选项
          </button>

          {/* 高级选项 */}
          {showAdvanced && (
            <div className="space-y-4 animate-fadeIn">
              {/* 生成模式 */}
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-400">生成模式:</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setGenerateMode('auto')}
                    className={`px-4 py-1.5 rounded-xl text-sm transition-all ${
                      generateMode === 'auto' 
                        ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white' 
                        : 'glass-button text-gray-400'
                    }`}
                  >
                    自动生成
                  </button>
                  <button
                    onClick={() => setGenerateMode('manual')}
                    className={`px-4 py-1.5 rounded-xl text-sm transition-all ${
                      generateMode === 'manual' 
                        ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white' 
                        : 'glass-button text-gray-400'
                    }`}
                  >
                    手动控制
                  </button>
                </div>
                <span className="text-xs text-gray-500">
                  {generateMode === 'auto' ? '一次性生成所有分镜' : '先拆解剧本，再逐个生成图片'}
                </span>
              </div>
            </div>
          )}
          
          {/* 风格和数量选择 */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">风格:</span>
              <div className="flex gap-1 flex-wrap">
                {STYLES.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setStyle(s.id)}
                    className={`px-4 py-1.5 rounded-xl text-sm transition-all ${
                      style === s.id 
                        ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-lg shadow-orange-500/25' 
                        : 'glass-button text-gray-400 hover:text-white'
                    }`}
                    title={s.desc}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">数量:</span>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="glass-input px-3 py-1.5 text-sm rounded-xl"
              >
                {[2, 4, 6, 8, 10, 12, 16, 20].map(n => (
                  <option key={n} value={n} className="bg-gray-900">{n} 张</option>
                ))}
              </select>
            </div>
            
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !script.trim()}
              className="ml-auto flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-orange-500 to-yellow-500 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-all hover:scale-105 hover:shadow-lg hover:shadow-orange-500/25"
            >
              {isGenerating ? (
                <>
                  <RefreshCw size={18} className="animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  {generateMode === 'auto' ? '生成分镜' : '拆解剧本'}
                </>
              )}
            </button>
          </div>
        </div>

        {/* 分镜展示区 */}
        <div 
          className="flex-1 min-h-0 p-6 overflow-y-auto"
          style={{ overscrollBehavior: 'contain' }}
        >
          {storyboards.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 animate-fadeIn">
              <div className="w-20 h-20 rounded-2xl glass-card flex items-center justify-center mb-4">
                <Film size={36} className="text-gray-600" />
              </div>
              <p className="text-lg font-medium text-gray-400">还没有分镜画面</p>
              <p className="text-sm text-gray-500 mt-1">输入剧本后点击生成</p>
            </div>
          ) : (
            <>
              {/* 工具栏 */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAddStoryboard}
                    className="flex items-center gap-1 px-3 py-1.5 glass-button rounded-lg text-sm"
                  >
                    <Plus size={14} /> 添加分镜
                  </button>
                  {storyboards.some(s => s.status === 'pending') && (
                    <button
                      onClick={() => {
                        storyboards.filter(s => s.status === 'pending').forEach(sb => {
                          handleGenerateSingle(sb)
                        })
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 glass-button rounded-lg text-sm text-orange-400"
                    >
                      <Sparkles size={14} /> 生成所有待处理
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setPreviewIndex(0); setSlideshowMode(false) }}
                    className="flex items-center gap-1 px-3 py-1.5 glass-button rounded-lg text-sm"
                  >
                    <Eye size={14} /> 预览
                  </button>
                  <button
                    onClick={() => { setPreviewIndex(0); setSlideshowMode(true) }}
                    className="flex items-center gap-1 px-3 py-1.5 glass-button rounded-lg text-sm"
                  >
                    <Play size={14} /> 幻灯片
                  </button>
                </div>
              </div>

              {/* 分镜网格 */}
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                {storyboards.map((sb, index) => (
                  <div
                    key={sb.id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`glass-card overflow-hidden group hover-lift animate-fadeInUp ${
                      draggedIndex === index ? 'opacity-50' : ''
                    }`}
                    style={{ animationDelay: `${index * 0.05}s`, animationFillMode: 'backwards' }}
                  >
                    <div className="aspect-video relative overflow-hidden">
                      {sb.imageUrl && sb.status === 'done' ? (
                        <img
                          src={sb.imageUrl}
                          alt={`分镜 ${sb.index}`}
                          className="w-full h-full object-cover cursor-pointer"
                          onClick={() => setPreviewIndex(index)}
                        />
                      ) : sb.status === 'generating' ? (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-500/10 to-yellow-500/10">
                          <RefreshCw size={24} className="text-orange-400 animate-spin" />
                        </div>
                      ) : sb.status === 'error' ? (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-red-500/10 text-red-400">
                          <X size={24} className="mb-2" />
                          <span className="text-xs">生成失败</span>
                          <button
                            onClick={() => handleGenerateSingle(sb)}
                            className="mt-2 text-xs glass-button px-3 py-1 rounded-lg"
                          >
                            重试
                          </button>
                        </div>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-500/10 to-gray-600/10">
                          <Image size={24} className="text-gray-500 mb-2" />
                          <button
                            onClick={() => handleGenerateSingle(sb)}
                            className="text-xs glass-button px-3 py-1 rounded-lg text-orange-400"
                          >
                            生成图片
                          </button>
                        </div>
                      )}
                      
                      {/* 拖拽手柄 */}
                      <div className="absolute top-2 left-2 p-1.5 glass-dark rounded-lg cursor-grab opacity-0 group-hover:opacity-100 transition-opacity">
                        <GripVertical size={14} />
                      </div>
                      
                      {/* 序号 */}
                      <div className="absolute top-2 left-10 px-2.5 py-1 glass-dark rounded-lg text-xs font-bold">
                        #{sb.index}
                      </div>
                      
                      {/* 操作按钮 */}
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => handleEditPrompt(sb)} className="p-1.5 glass-dark rounded-lg hover:bg-white/20" title="编辑">
                          <Edit3 size={12} />
                        </button>
                        <button onClick={() => handleCopyStoryboard(sb)} className="p-1.5 glass-dark rounded-lg hover:bg-white/20" title="复制">
                          <Copy size={12} />
                        </button>
                        {sb.imageUrl && (
                          <button onClick={() => handleRegenerate(sb)} className="p-1.5 glass-dark rounded-lg hover:bg-white/20" title="重新生成">
                            <RefreshCw size={12} />
                          </button>
                        )}
                        <button onClick={() => handleDelete(sb.id)} className="p-1.5 glass-dark rounded-lg hover:bg-red-500/50" title="删除">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    
                    {/* 提示词 */}
                    <div className="p-3">
                      {editingId === sb.id ? (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={editPrompt}
                            onChange={(e) => setEditPrompt(e.target.value)}
                            className="flex-1 glass-input px-2 py-1 text-xs"
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleSavePrompt(sb.id)}
                          />
                          <button onClick={() => handleSavePrompt(sb.id)} className="px-2 py-1 glass-button rounded text-xs">保存</button>
                          <button onClick={() => setEditingId(null)} className="px-2 py-1 glass-button rounded text-xs">取消</button>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 line-clamp-2">{sb.prompt || '点击编辑添加提示词'}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
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
            moduleType="storyboard"
            placeholder="描述场景，或让 AI 帮你设计分镜..."
            context={script ? `当前剧本：${script.slice(0, 300)}...` : undefined}
            className="flex-1 min-h-0 m-2"
          />
        </div>
      </div>

      {/* 历史记录弹窗 */}
      {showHistory && (
        <HistoryModal
          projects={savedProjects}
          onLoad={handleLoadProject}
          onDelete={handleDeleteProject}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* 预览弹窗 */}
      {previewIndex !== null && (
        <PreviewModal
          storyboards={storyboards}
          currentIndex={previewIndex}
          slideshowMode={slideshowMode}
          slideshowInterval={slideshowInterval}
          onSetIndex={setPreviewIndex}
          onToggleSlideshow={() => setSlideshowMode(!slideshowMode)}
          onSetInterval={setSlideshowInterval}
          onClose={() => { setPreviewIndex(null); setSlideshowMode(false) }}
        />
      )}
      </div>
    </div>
  )
}

// 导出下拉菜单组件
function ExportDropdown({ onExportHTML, onExportJSON, onExportMarkdown, onDownloadImages }: {
  onExportHTML: () => void
  onExportJSON: () => void
  onExportMarkdown: () => void
  onDownloadImages: () => void
}) {
  const [open, setOpen] = useState(false)
  
  return (
    <div className="relative">
      <button 
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2 glass-button rounded-xl text-sm hover:bg-white/10 transition-all"
      >
        <Download size={16} />
        导出
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-48 glass-card rounded-xl overflow-hidden z-50 animate-fadeIn">
            <button onClick={() => { onExportHTML(); setOpen(false) }} className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/10 flex items-center gap-2">
              <FileText size={14} /> 导出 HTML
            </button>
            <button onClick={() => { onExportJSON(); setOpen(false) }} className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/10 flex items-center gap-2">
              <FileText size={14} /> 导出 JSON
            </button>
            <button onClick={() => { onExportMarkdown(); setOpen(false) }} className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/10 flex items-center gap-2">
              <FileText size={14} /> 导出 Markdown
            </button>
            <div className="border-t border-white/5" />
            <button onClick={() => { onDownloadImages(); setOpen(false) }} className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/10 flex items-center gap-2">
              <Image size={14} /> 下载所有图片
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// 历史记录弹窗组件
function HistoryModal({ projects, onLoad, onDelete, onClose }: {
  projects: SavedStoryboardProject[]
  onLoad: (project: SavedStoryboardProject) => void
  onDelete: (id: string, e: React.MouseEvent) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <div className="w-[600px] max-h-[80vh] glass-card rounded-2xl overflow-hidden animate-scaleIn" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <FolderOpen size={18} className="text-orange-400" />
            <h3 className="font-medium">历史项目</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg">
            <X size={18} />
          </button>
        </div>
        
        <div 
          className="p-4 max-h-[60vh] overflow-y-auto"
          style={{ overscrollBehavior: 'contain' }}
        >
          {projects.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Clock size={32} className="mx-auto mb-2 opacity-50" />
              <p>暂无历史项目</p>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map(project => (
                <div
                  key={project.id}
                  onClick={() => onLoad(project)}
                  className="p-4 glass-button rounded-xl cursor-pointer hover:bg-white/10 transition-all group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{project.name}</h4>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{project.script}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                        <span>{project.storyboards.length} 个分镜</span>
                        <span>{STYLES.find(s => s.id === project.style)?.name || project.style}</span>
                        <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => onDelete(project.id, e)}
                      className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded-lg transition-all"
                    >
                      <Trash2 size={14} className="text-red-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// 预览弹窗组件
function PreviewModal({ storyboards, currentIndex, slideshowMode, slideshowInterval, onSetIndex, onToggleSlideshow, onSetInterval, onClose }: {
  storyboards: Storyboard[]
  currentIndex: number
  slideshowMode: boolean
  slideshowInterval: number
  onSetIndex: (index: number) => void
  onToggleSlideshow: () => void
  onSetInterval: (interval: number) => void
  onClose: () => void
}) {
  const current = storyboards[currentIndex]
  
  const handlePrev = () => {
    onSetIndex(currentIndex > 0 ? currentIndex - 1 : storyboards.length - 1)
  }
  
  const handleNext = () => {
    onSetIndex(currentIndex < storyboards.length - 1 ? currentIndex + 1 : 0)
  }
  
  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handlePrev()
      else if (e.key === 'ArrowRight') handleNext()
      else if (e.key === 'Escape') onClose()
      else if (e.key === ' ') { e.preventDefault(); onToggleSlideshow() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex])
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm animate-fadeIn">
      {/* 关闭按钮 */}
      <button onClick={onClose} className="absolute top-4 right-4 p-2 glass-button rounded-lg z-10">
        <X size={20} />
      </button>
      
      {/* 主图 */}
      <div className="relative w-full h-full flex items-center justify-center p-16">
        {current?.imageUrl ? (
          <img
            src={current.imageUrl}
            alt={`分镜 ${current.index}`}
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl animate-fadeIn"
            key={currentIndex}
          />
        ) : (
          <div className="w-96 h-64 glass-card rounded-xl flex items-center justify-center">
            <span className="text-gray-500">暂无图片</span>
          </div>
        )}
        
        {/* 左右导航 */}
        <button
          onClick={handlePrev}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 glass-button rounded-xl hover:bg-white/20"
        >
          <ChevronLeft size={24} />
        </button>
        <button
          onClick={handleNext}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 glass-button rounded-xl hover:bg-white/20"
        >
          <ChevronRight size={24} />
        </button>
      </div>
      
      {/* 底部信息栏 */}
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <span className="text-2xl font-bold text-orange-400">#{current?.index}</span>
              <span className="text-sm text-gray-400">{currentIndex + 1} / {storyboards.length}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onToggleSlideshow}
                className={`p-2 rounded-lg transition-all ${slideshowMode ? 'bg-orange-500/30 text-orange-400' : 'glass-button'}`}
              >
                {slideshowMode ? <Pause size={18} /> : <Play size={18} />}
              </button>
              {slideshowMode && (
                <select
                  value={slideshowInterval}
                  onChange={(e) => onSetInterval(Number(e.target.value))}
                  className="glass-input px-2 py-1 text-sm rounded-lg"
                >
                  <option value={2000} className="bg-gray-900">2秒</option>
                  <option value={3000} className="bg-gray-900">3秒</option>
                  <option value={5000} className="bg-gray-900">5秒</option>
                  <option value={8000} className="bg-gray-900">8秒</option>
                </select>
              )}
            </div>
          </div>
          <p className="text-sm text-gray-300">{current?.prompt}</p>
          
          {/* 缩略图导航 */}
          <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
            {storyboards.map((sb, i) => (
              <button
                key={sb.id}
                onClick={() => onSetIndex(i)}
                className={`flex-shrink-0 w-16 h-10 rounded-lg overflow-hidden border-2 transition-all ${
                  i === currentIndex ? 'border-orange-500' : 'border-transparent opacity-50 hover:opacity-100'
                }`}
              >
                {sb.imageUrl ? (
                  <img src={sb.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gray-800 flex items-center justify-center text-xs">{sb.index}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
