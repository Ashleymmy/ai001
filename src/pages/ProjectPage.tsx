import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Clock,
  History,
  ChevronRight,
  ChevronDown,
  X,
  Pencil,
  Check,
  Sparkles,
  Layout,
  MoreHorizontal,
  Trash2,
  Settings,
  Film
} from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import { getProjectHistory } from '../services/api'
import { MODULE_CARDS } from '../shared/moduleCards'
import type { HistoryItem } from '../features/project/types'
import { formatTime, getActionText } from '../features/project/utils'

export default function ProjectPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { currentProject, fetchProject, updateProject, deleteProject } = useProjectStore()
  
  // 从 URL 中提取 projectId
  const projectId = location.pathname.split('/project/')[1]?.split('/')[0]
  
  const [loading, setLoading] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState('')
  const [showMenu, setShowMenu] = useState(false)

  useEffect(() => {
    if (projectId) {
      loadProject()
    }
  }, [projectId])

  const loadProject = async () => {
    if (!projectId) return
    setLoading(true)
    await fetchProject(projectId)
    setLoading(false)
  }

  const loadHistory = async () => {
    if (!projectId || historyLoading) return
    setHistoryLoading(true)
    try {
      const data = await getProjectHistory(projectId)
      setHistory(data.history || [])
    } catch (err) {
      console.error('加载历史失败:', err)
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleToggleHistory = () => {
    if (!historyOpen && history.length === 0) {
      loadHistory()
    }
    setHistoryOpen(!historyOpen)
  }

  const handleSaveName = async () => {
    if (!currentProject || !newName.trim()) return
    await updateProject(currentProject.id, { name: newName.trim() })
    setEditingName(false)
  }

  const handleDelete = async () => {
    if (!currentProject) return
    if (confirm('确定要删除这个项目吗？此操作不可恢复。')) {
      await deleteProject(currentProject.id)
      navigate('/home')
    }
  }

  const navigateToModule = (module: (typeof MODULE_CARDS)[0]) => {
    // 所有模块都带上项目ID，方便返回
    if (module.id === 'storyboard') {
      navigate(`/home/storyboard/${projectId}`)
    } else if (module.id === 'script') {
      navigate(`/home/script?project=${projectId}`)
    } else if (module.id === 'image') {
      navigate(`/home/image?project=${projectId}`)
    } else if (module.id === 'video') {
      navigate(`/home/video?project=${projectId}`)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">加载项目中...</p>
        </div>
      </div>
    )
  }

  if (!currentProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">项目不存在或已被删除</p>
          <button onClick={() => navigate('/home')} className="btn-primary">
            返回首页
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-6 py-4 glass-dark border-b border-white/5">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/home')}
            className="p-2 hover:bg-white/10 rounded-xl transition-all"
          >
            <ArrowLeft size={20} />
          </button>
          
          {/* 项目名称 */}
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="glass-input px-3 py-1.5 text-lg font-semibold"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName()
                  if (e.key === 'Escape') setEditingName(false)
                }}
              />
              <button
                onClick={handleSaveName}
                className="p-1.5 hover:bg-green-500/20 rounded-lg text-green-400"
              >
                <Check size={18} />
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="p-1.5 hover:bg-white/10 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{currentProject.name}</h1>
              <button
                onClick={() => {
                  setNewName(currentProject.name)
                  setEditingName(true)
                }}
                className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white"
              >
                <Pencil size={14} />
              </button>
            </div>
          )}
          
          {currentProject.description && (
            <span className="text-sm text-gray-500 hidden md:block">
              {currentProject.description}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 历史记录按钮 */}
          <button
            onClick={handleToggleHistory}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all ${
              historyOpen ? 'bg-blue-500/20 text-blue-400' : 'glass-button hover:bg-white/10'
            }`}
          >
            <History size={16} />
            <span className="hidden sm:inline">历史记录</span>
            {historyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {/* 更多菜单 */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 glass-button rounded-xl hover:bg-white/10"
            >
              <MoreHorizontal size={18} />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-2 w-48 glass-card py-2 z-50 animate-fadeIn">
                  <button
                    onClick={() => {
                      setShowMenu(false)
                      navigate('/home/settings')
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/10 text-left text-sm"
                  >
                    <Settings size={16} className="text-gray-400" />
                    项目设置
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false)
                      handleDelete()
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-red-500/10 text-left text-sm text-red-400"
                  >
                    <Trash2 size={16} />
                    删除项目
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 主内容区 */}
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-4xl mx-auto">
            {/* 项目信息卡片 */}
            <div className="glass-card p-6 mb-8 animate-fadeInUp">
              <div className="flex items-start gap-6">
                {/* 缩略图 */}
                <div className="w-32 h-20 rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 overflow-hidden flex-shrink-0">
                  {currentProject.storyboards.length > 0 && currentProject.storyboards[0].imageUrl ? (
                    <img
                      src={currentProject.storyboards[0].imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Film size={28} className="text-gray-600" />
                    </div>
                  )}
                </div>
                
                <div className="flex-1">
                  <div className="flex items-center gap-4 text-sm text-gray-500 mb-3">
                    <span className="flex items-center gap-1.5">
                      <Clock size={14} />
                      创建于 {formatTime(currentProject.createdAt)}
                    </span>
                    <span className="glass-button px-2 py-0.5 rounded-full">
                      {currentProject.storyboards.length} 个分镜
                    </span>
                    <span className="glass-button px-2 py-0.5 rounded-full">
                      风格: {currentProject.style}
                    </span>
                  </div>
                  {currentProject.storyText && (
                    <p className="text-sm text-gray-400 line-clamp-2">
                      {currentProject.storyText}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* 功能模块入口 */}
            <h2 className="text-lg font-semibold mb-4 text-gray-300">开始创作</h2>
            <div className="grid grid-cols-2 gap-4 mb-8">
              {MODULE_CARDS.map((module, index) => (
                <button
                  key={module.id}
                  onClick={() => navigateToModule(module)}
                  className="glass-card p-5 text-left group hover-lift animate-fadeInUp"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${module.gradient} flex items-center justify-center shadow-lg ${module.shadow} transition-transform group-hover:scale-110`}>
                      <module.icon size={22} className="text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium mb-0.5">{module.name}</h3>
                      <p className="text-xs text-gray-500">{module.description}</p>
                    </div>
                    <ChevronRight size={18} className="text-gray-500 group-hover:text-white group-hover:translate-x-1 transition-all" />
                  </div>
                </button>
              ))}
            </div>

            {/* 高级模式入口 */}
            <h2 className="text-lg font-semibold mb-4 text-gray-300">高级模式</h2>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => navigate(`/agent/${projectId}`)}
                className="glass-card p-5 text-left group hover-lift animate-fadeInUp"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-500 flex items-center justify-center shadow-lg shadow-purple-500/30 animate-pulse-glow">
                    <Sparkles size={22} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-medium">Agent 模式</h3>
                      <span className="text-xs bg-purple-500/30 text-purple-300 px-1.5 py-0.5 rounded">AI</span>
                    </div>
                    <p className="text-xs text-gray-500">AI 驱动的一站式创作</p>
                  </div>
                  <ChevronRight size={18} className="text-gray-500 group-hover:text-white group-hover:translate-x-1 transition-all" />
                </div>
              </button>

              <button
                onClick={() => navigate(`/canvas/${projectId}`)}
                className="glass-card p-5 text-left group hover-lift animate-fadeInUp delay-100"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
                    <Layout size={22} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-medium">Canvas 画布</h3>
                      <span className="text-xs bg-blue-500/30 text-blue-300 px-1.5 py-0.5 rounded">节点</span>
                    </div>
                    <p className="text-xs text-gray-500">可视化节点编排</p>
                  </div>
                  <ChevronRight size={18} className="text-gray-500 group-hover:text-white group-hover:translate-x-1 transition-all" />
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* 历史记录侧边栏 */}
        {historyOpen && (
          <div className="w-80 border-l border-white/5 glass-dark flex flex-col animate-slideInRight">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <h3 className="font-medium flex items-center gap-2">
                <History size={16} className="text-blue-400" />
                操作历史
              </h3>
              <button
                onClick={() => setHistoryOpen(false)}
                className="p-1.5 hover:bg-white/10 rounded-lg"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-4">
              {historyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : history.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <History size={32} className="mx-auto mb-3 text-gray-600" />
                  <p className="text-sm">暂无操作记录</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {history.map((item, index) => (
                    <div key={index} className="relative flex group">
                      {/* 时间线 */}
                      <div className="flex flex-col items-center mr-3">
                        <div className="w-2.5 h-2.5 rounded-full bg-blue-500/50 border-2 border-blue-400 z-10" />
                        {index < history.length - 1 && (
                          <div className="w-0.5 flex-1 bg-gray-700" />
                        )}
                      </div>
                      
                      {/* 内容 */}
                      <div className="flex-1 pb-4">
                        <p className="text-sm font-medium">{getActionText(item.action)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {formatTime(item.timestamp)}
                        </p>
                        {item.data !== undefined && item.data !== null && (
                          <div className="mt-1.5 text-xs text-gray-600 glass-button px-2 py-1 rounded inline-block">
                            {(() => {
                              const str = JSON.stringify(item.data)
                              return str.length > 50 ? str.slice(0, 50) + '...' : str
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
