import { useEffect, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, ArrowRight, Plus, Trash2, FolderOpen, Sparkles, Layout, X, Film } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import { listAgentProjects, deleteAgentProject, type AgentProject } from '../services/api'
import { MODULE_CARDS } from '../shared/moduleCards'

// 统一的项目类型
interface UnifiedProject {
  id: string
  name: string
  description?: string
  type: 'normal' | 'agent' | 'canvas'
  thumbnail?: string
  itemCount: number
  itemLabel: string
  updatedAt: string
  createdAt: string
}

export default function HomePage() {
  const navigate = useNavigate()
  const { projects, loading, fetchProjects, createProject, deleteProject } = useProjectStore()
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  const [creating, setCreating] = useState(false)
  
  // Agent 项目
  const [agentProjects, setAgentProjects] = useState<AgentProject[]>([])
  const [loadingAgent, setLoadingAgent] = useState(false)

  useEffect(() => {
    fetchProjects()
    loadAgentProjects()
  }, [fetchProjects])

  const loadAgentProjects = async () => {
    setLoadingAgent(true)
    try {
      const projects = await listAgentProjects(50)
      setAgentProjects(projects)
    } catch (error) {
      console.error('加载 Agent 项目失败:', error)
    } finally {
      setLoadingAgent(false)
    }
  }

  // 合并所有项目并按更新时间排序
  const allProjects: UnifiedProject[] = [
    // 普通项目
    ...projects.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      type: 'normal' as const,
      thumbnail: p.storyboards?.[0]?.imageUrl || undefined,
      itemCount: p.storyboards?.length || 0,
      itemLabel: '分镜',
      updatedAt: p.updatedAt,
      createdAt: p.createdAt
    })),
    // Agent 项目
    ...agentProjects.map(p => ({
      id: p.id,
      name: p.name,
      description: (p.creative_brief as Record<string, string>)?.visualStyle,
      type: 'agent' as const,
      thumbnail: Object.values(p.elements || {})[0]?.image_url || undefined,
      itemCount: (p.segments || []).reduce((acc, s) => acc + (s.shots?.length || 0), 0),
      itemLabel: '镜头',
      updatedAt: p.updated_at,
      createdAt: p.created_at
    }))
  ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return
    setCreating(true)
    try {
      const project = await createProject(newProjectName.trim(), newProjectDesc.trim())
      setShowNewProject(false)
      setNewProjectName('')
      setNewProjectDesc('')
      // 使用 replace 避免返回时退出应用
      navigate(`/home/project/${project.id}`, { replace: true })
    } catch (error) {
      console.error('创建项目失败:', error)
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteProject = async (e: MouseEvent, id: string, type: 'normal' | 'agent' | 'canvas') => {
    e.stopPropagation()
    if (confirm('确定要删除这个项目吗？')) {
      if (type === 'agent') {
        await deleteAgentProject(id)
        await loadAgentProjects()
      } else {
        await deleteProject(id)
      }
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-6xl mx-auto">
        {/* 头部 */}
        <div className="mb-12 animate-fadeInUp">
          <h1 className="text-4xl font-bold mb-3 text-gradient">AI Storyboarder</h1>
          <p className="text-gray-400 text-lg">视频分镜制作助手 - 从创意到画面，一站式创作</p>
        </div>

        {/* 功能模块 */}
        <div className="mb-10">
          <h2 className="text-lg font-semibold mb-5 text-gray-300 animate-fadeInUp delay-100">创作工具</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {MODULE_CARDS.map((module, index) => (
              <button
                key={module.id}
                onClick={() => navigate(module.path)}
                className="glass-card p-6 text-left group hover-lift animate-fadeInUp"
                style={{ animationDelay: `${(index + 2) * 0.1}s` }}
              >
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${module.gradient} flex items-center justify-center mb-5 transition-apple group-hover:scale-110 shadow-lg ${module.shadow}`}>
                  <module.icon size={26} className="text-white drop-shadow-md" strokeWidth={2} />
                </div>
                
                <h3 className="font-semibold text-lg mb-2">{module.name}</h3>
                <p className="text-sm text-gray-500 mb-4">{module.description}</p>
                
                <div className="flex items-center text-sm text-gray-500 group-hover:text-white transition-apple">
                  <span>开始创作</span>
                  <ArrowRight size={16} className="ml-2 group-hover:translate-x-2 transition-apple" />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Agent 和 Canvas 入口 */}
        <div className="mb-12 grid grid-cols-2 gap-4">
          <button
            onClick={() => navigate('/agent')}
            className="glass-card p-6 text-left group hover-lift animate-fadeInUp delay-300"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-fuchsia-500 via-purple-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-500/30 animate-pulse-glow">
                  <Sparkles size={30} className="text-white drop-shadow-md" strokeWidth={2} />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-xl font-semibold">Agent 模式</h3>
                    <span className="text-xs bg-gradient-to-r from-fuchsia-500 to-purple-500 px-2.5 py-1 rounded-full text-white font-medium">全新</span>
                  </div>
                  <p className="text-gray-400 text-sm">AI 驱动的一站式视频创作流程</p>
                </div>
              </div>
              <ArrowRight size={24} className="text-gray-500 group-hover:text-white group-hover:translate-x-2 transition-apple" />
            </div>
          </button>
          
          <button
            onClick={() => navigate('/canvas')}
            className="glass-card p-6 text-left group hover-lift animate-fadeInUp delay-400"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 via-blue-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
                  <Layout size={30} className="text-white drop-shadow-md" strokeWidth={2} />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-xl font-semibold">短剧工作台</h3>
                    <span className="text-xs bg-gradient-to-r from-cyan-500 to-blue-500 px-2.5 py-1 rounded-full text-white font-medium">Demo</span>
                  </div>
                  <p className="text-gray-400 text-sm">短剧制作工作流（剧本→角色→分镜→视频）</p>
                </div>
              </div>
              <ArrowRight size={24} className="text-gray-500 group-hover:text-white group-hover:translate-x-2 transition-apple" />
            </div>
          </button>
        </div>

        {/* 项目管理 */}
        <div className="animate-fadeInUp delay-500">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <FolderOpen size={20} className="text-gray-400" />
              <h2 className="text-lg font-semibold">我的项目</h2>
              <span className="text-sm text-gray-500 glass-button px-2 py-0.5 rounded-full">
                {allProjects.length}
              </span>
            </div>
            <button
              onClick={() => setShowNewProject(true)}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Plus size={18} />
              新建项目
            </button>
          </div>

          {/* 新建项目弹窗 */}
          {showNewProject && (
            <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 animate-fadeIn">
              <div className="glass-card p-8 w-full max-w-md animate-scaleIn">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-semibold">新建项目</h3>
                  <button
                    onClick={() => {
                      setShowNewProject(false)
                      setNewProjectName('')
                      setNewProjectDesc('')
                    }}
                    className="p-2 hover:bg-white/10 rounded-xl transition-apple"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">项目名称</label>
                    <input
                      type="text"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder="输入项目名称"
                      className="w-full glass-input px-4 py-3 text-sm"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">项目描述（可选）</label>
                    <textarea
                      value={newProjectDesc}
                      onChange={(e) => setNewProjectDesc(e.target.value)}
                      placeholder="简单描述一下这个项目"
                      rows={3}
                      className="w-full glass-input px-4 py-3 text-sm resize-none"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-8">
                  <button
                    onClick={() => {
                      setShowNewProject(false)
                      setNewProjectName('')
                      setNewProjectDesc('')
                    }}
                    className="btn-secondary px-5 py-2.5 text-sm"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCreateProject}
                    disabled={!newProjectName.trim() || creating}
                    className="btn-primary px-5 py-2.5 text-sm disabled:opacity-50"
                  >
                    {creating ? '创建中...' : '创建项目'}
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {loading || loadingAgent ? (
            <div className="text-center py-16 glass-card">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-gray-500">加载中...</p>
            </div>
          ) : allProjects.length === 0 ? (
            <div className="text-center py-16 glass-card">
              <FolderOpen size={56} className="mx-auto mb-5 text-gray-600" />
              <p className="text-gray-400 mb-2">暂无项目</p>
              <p className="text-sm text-gray-600">点击上方"新建项目"开始创作</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allProjects.map((project, index) => (
                <div
                  key={`${project.type}-${project.id}`}
                  onClick={() => {
                    if (project.type === 'agent') {
                      navigate(`/agent/${project.id}`)
                    } else if (project.type === 'canvas') {
                      navigate(`/canvas/${project.id}`)
                    } else {
                      navigate(`/home/project/${project.id}`)
                    }
                  }}
                  className="glass-card p-5 cursor-pointer group hover-lift animate-fadeInUp"
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  {/* 缩略图 */}
                  <div className="aspect-video bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl mb-4 overflow-hidden flex items-center justify-center relative">
                    {project.thumbnail ? (
                      <img 
                        src={project.thumbnail} 
                        alt="" 
                        className="w-full h-full object-cover transition-apple group-hover:scale-105"
                      />
                    ) : project.type === 'agent' ? (
                      <Sparkles size={36} className="text-purple-500" />
                    ) : project.type === 'canvas' ? (
                      <Layout size={36} className="text-blue-500" />
                    ) : (
                      <Film size={36} className="text-gray-600" />
                    )}
                    
                    {/* 项目类型标签 */}
                    {project.type !== 'normal' && (
                      <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        project.type === 'agent' 
                          ? 'bg-gradient-to-r from-fuchsia-500 to-purple-500 text-white' 
                          : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white'
                      }`}>
                        {project.type === 'agent' ? 'Agent' : 'Canvas'}
                      </div>
                    )}
                  </div>
                  
                  {/* 信息 */}
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-lg truncate mb-1">{project.name}</h3>
                      {project.description && (
                        <p className="text-sm text-gray-500 truncate mb-2">{project.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1.5">
                          <Clock size={12} />
                          {formatDate(project.updatedAt)}
                        </span>
                        <span className="glass-button px-2 py-0.5 rounded-full">
                          {project.itemCount} {project.itemLabel}
                        </span>
                      </div>
                    </div>
                    
                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => handleDeleteProject(e, project.id, project.type)}
                      className="p-2.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl opacity-0 group-hover:opacity-100 transition-apple"
                      title="删除项目"
                    >
                      <Trash2 size={18} />
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
