import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { 
  Sparkles, Layers, Film, Clock, ChevronDown, ChevronRight,
  Plus, RotateCcw, Image as ImageIcon, Grid3X3,
  Play, Pause, SkipBack, SkipForward, Maximize2, Bot, ChevronLeft, Save
} from 'lucide-react'
import { chatWithAI, stopChatGeneration } from '../services/api'
import ChatInput from '../components/ChatInput'

type ModuleType = 'elements' | 'storyboard' | 'timeline'

interface Element {
  id: string
  name: string
  description: string
  imageUrl?: string
}

interface Segment {
  id: string
  name: string
  description: string
  shots: Shot[]
}

interface Shot {
  id: string
  name: string
  description: string
  imageUrl?: string
  duration?: number
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface VisualAsset {
  id: string
  url: string
  duration?: string
}

export default function AgentPage() {
  const navigate = useNavigate()
  const location = useLocation()
  
  // 从 URL 路径中提取项目ID
  const urlProjectId = location.pathname.match(/\/agent\/([^/]+)/)?.[1] || null
  
  const [activeModule, setActiveModule] = useState<ModuleType>('elements')
  const [projectName, setProjectName] = useState('未命名项目')
  const [projectId, setProjectId] = useState<string | null>(urlProjectId)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showExitDialog, setShowExitDialog] = useState(false)
  const [elements, setElements] = useState<Element[]>([
    {
      id: '1',
      name: 'Element_CLUMSY_HANS',
      description: '笨汉汉斯，一个真诚朴实、单纯生动的少年，穿着简朴的乡下服饰，天真明朗，古卜力画风。',
      imageUrl: 'https://picsum.photos/seed/hans/400/300'
    },
    {
      id: '2', 
      name: 'Element_SMART_BROTHERS',
      description: '汉斯的两个"聪明"兄弟，衣着华丽，骑着高头大马，带着高傲自负、古卜力画风。'
    }
  ])
  
  const [segments, setSegments] = useState<Segment[]>([
    {
      id: '1',
      name: 'Segment_The_Story_Of_Hans',
      description: '故事讲述了笨汉汉斯如何凭借真诚和公主赢得公主的故事。',
      shots: [
        {
          id: 's1',
          name: 'Shot_Opening_Countryside',
          description: '深晨曦光，照亮清晨的乡间小路，门大的阳光穿云雾笼罩在田野天空中。',
          imageUrl: 'https://picsum.photos/seed/countryside/400/250'
        }
      ]
    }
  ])

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: '欢迎！我将开始为你打造精彩故事画面与人物动态生命力。\n\n为了确保优质画面效果，我会分批次进行动画脚本化。'
    }
  ])
  
  const [inputMessage, setInputMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [visualAssets] = useState<VisualAsset[]>([
    { id: '1', url: 'https://picsum.photos/seed/v1/80/60', duration: '00:04' },
    { id: '2', url: 'https://picsum.photos/seed/v2/80/60', duration: '00:04' },
    { id: '3', url: 'https://picsum.photos/seed/v3/80/60', duration: '00:04' },
    { id: '4', url: 'https://picsum.photos/seed/v4/80/60', duration: '00:04' },
    { id: '5', url: 'https://picsum.photos/seed/v5/80/60', duration: '00:04' }
  ])
  
  const [expandedElements, setExpandedElements] = useState<Set<string>>(new Set(['1']))
  const [expandedSegments, setExpandedSegments] = useState<Set<string>>(new Set(['1']))
  const [assetsExpanded, setAssetsExpanded] = useState(true)
  const [assetViewMode, setAssetViewMode] = useState<'grid' | 'list'>('grid')
  
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 标记有未保存的更改
  useEffect(() => {
    if (elements.length > 0 || segments.length > 0 || messages.length > 1) {
      setHasUnsavedChanges(true)
    }
  }, [elements, segments, messages])

  // 保存项目
  const handleSaveProject = useCallback((showAlert = true) => {
    const projectData = {
      id: projectId || `agent-${Date.now()}`,
      name: projectName,
      type: 'agent',
      elements,
      segments,
      messages,
      visualAssets,
      updatedAt: new Date().toISOString()
    }
    
    const savedProjects = JSON.parse(localStorage.getItem('storyboarder-agent-projects') || '[]')
    const existingIndex = savedProjects.findIndex((p: { id: string }) => p.id === projectData.id)
    
    if (existingIndex >= 0) {
      savedProjects[existingIndex] = projectData
    } else {
      savedProjects.unshift(projectData)
      setProjectId(projectData.id)
    }
    
    localStorage.setItem('storyboarder-agent-projects', JSON.stringify(savedProjects))
    setHasUnsavedChanges(false)
    
    if (showAlert) {
      alert('保存成功')
    }
  }, [projectId, projectName, elements, segments, messages, visualAssets])

  // 获取返回目标
  const getBackTarget = () => urlProjectId ? `/project/${urlProjectId}` : '/'

  // 返回处理
  const handleBack = () => {
    if (hasUnsavedChanges) {
      setShowExitDialog(true)
    } else {
      navigate(getBackTarget())
    }
  }

  // 保存并退出
  const handleSaveAndExit = () => {
    handleSaveProject(false)
    navigate(getBackTarget())
  }

  // 不保存退出
  const handleExitWithoutSave = () => {
    navigate(getBackTarget())
  }

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || sending) return
    
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: inputMessage }
    setMessages(prev => [...prev, userMsg])
    setInputMessage('')
    setSending(true)

    try {
      const reply = await chatWithAI(inputMessage, '视频分镜创作Agent模式')
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: reply }])
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'CanceledError') return
      console.error('发送失败:', error)
    } finally {
      setSending(false)
    }
  }

  const handleStopMessage = () => {
    stopChatGeneration()
    setSending(false)
  }

  const toggleElement = (id: string) => {
    setExpandedElements(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSegment = (id: string) => {
    setExpandedSegments(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const modules = [
    { id: 'elements' as ModuleType, icon: Sparkles, label: '关键元素' },
    { id: 'storyboard' as ModuleType, icon: Film, label: '分镜' },
    { id: 'timeline' as ModuleType, icon: Clock, label: '时间线' }
  ]

  return (
    <div className="flex h-full animate-fadeIn">
      {/* 退出确认对话框 */}
      {showExitDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fadeIn">
          <div className="glass-card p-6 rounded-2xl w-96 animate-scaleIn">
            <h3 className="text-lg font-semibold mb-2">保存项目？</h3>
            <p className="text-sm text-gray-400 mb-6">你有未保存的更改，是否在离开前保存？</p>
            <div className="flex gap-3">
              <button
                onClick={handleExitWithoutSave}
                className="flex-1 py-2.5 glass-button rounded-xl text-sm hover:bg-white/10 transition-apple"
              >
                不保存
              </button>
              <button
                onClick={() => setShowExitDialog(false)}
                className="flex-1 py-2.5 glass-button rounded-xl text-sm hover:bg-white/10 transition-apple"
              >
                取消
              </button>
              <button
                onClick={handleSaveAndExit}
                className="flex-1 py-2.5 gradient-primary rounded-xl text-sm font-medium hover:opacity-90 transition-apple"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 左侧模块导航 */}
      <aside className="w-16 glass-dark flex flex-col items-center py-4 border-r border-white/5 animate-slideInLeft">
        {/* 返回按钮 */}
        <button
          onClick={handleBack}
          className="p-3 rounded-xl mb-3 text-gray-400 hover:text-white glass-button transition-apple"
          title={urlProjectId ? "返回项目" : "返回首页"}
        >
          <ChevronLeft size={20} />
        </button>
        
        <div className="w-8 h-px bg-white/10 mb-3" />
        
        {modules.map(({ id, icon: Icon, label }, index) => (
          <button
            key={id}
            onClick={() => setActiveModule(id)}
            className={`p-3 rounded-xl mb-2 transition-all relative group animate-fadeInUp ${
              activeModule === id
                ? 'glass-button text-white glow-soft'
                : 'text-gray-500 hover:text-white hover:bg-white/5'
            }`}
            title={label}
            style={{ animationDelay: `${index * 0.1}s`, animationFillMode: 'backwards' }}
          >
            <Icon size={20} />
            <span className="absolute left-full ml-3 px-3 py-1.5 glass rounded-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-apple pointer-events-none z-10">
              {label}
            </span>
          </button>
        ))}
        
        <div className="flex-1" />
        
        {/* 保存按钮 */}
        <button
          onClick={() => handleSaveProject(true)}
          className={`p-3 rounded-xl transition-apple ${hasUnsavedChanges ? 'text-primary glass-button' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
          title="保存项目"
        >
          <Save size={20} />
        </button>
      </aside>

      {/* 中间主内容区 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部标题栏 */}
        <header className="h-14 px-5 flex items-center justify-between border-b border-white/5 glass-dark animate-fadeInDown">
          <div className="flex items-center">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500 via-purple-500 to-indigo-500 flex items-center justify-center mr-3 shadow-lg shadow-purple-500/30">
              <Layers size={16} className="text-white drop-shadow-md" strokeWidth={2.5} />
            </div>
            <input
              type="text"
              value={projectName}
              onChange={(e) => { setProjectName(e.target.value); setHasUnsavedChanges(true) }}
              className="bg-transparent text-sm font-medium focus:outline-none border-b-2 border-transparent focus:border-primary/50 transition-colors"
            />
          </div>
          {hasUnsavedChanges && (
            <span className="text-xs text-yellow-400 glass-button px-2 py-1 rounded-full">未保存</span>
          )}
        </header>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-5 animate-fadeIn">
          {activeModule === 'elements' && (
            <ElementsPanel 
              elements={elements}
              expandedElements={expandedElements}
              toggleElement={toggleElement}
            />
          )}
          
          {activeModule === 'storyboard' && (
            <StoryboardPanel
              segments={segments}
              expandedSegments={expandedSegments}
              toggleSegment={toggleSegment}
            />
          )}
          
          {activeModule === 'timeline' && (
            <TimelinePanel />
          )}
        </div>
      </main>

      {/* 右侧 AI 助手面板 */}
      <aside className="w-96 glass-dark border-l border-white/5 flex flex-col animate-slideInRight">
        {/* AI 助手标题 */}
        <div className="h-14 px-5 flex items-center border-b border-white/5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-500 flex items-center justify-center mr-3 shadow-lg shadow-pink-500/30">
            <Bot size={16} className="text-white drop-shadow-md" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-medium">AI 助手</span>
        </div>

        {/* 对话区域 */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {messages.map((msg, index) => (
            <div 
              key={msg.id} 
              className={`${msg.role === 'user' ? 'ml-8' : ''} animate-fadeInUp`}
              style={{ animationDelay: `${index * 0.05}s`, animationFillMode: 'backwards' }}
            >
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-lg gradient-warm flex items-center justify-center">
                    <span className="text-xs font-bold">F</span>
                  </div>
                  <span className="text-sm font-medium text-orange-400">Flova</span>
                </div>
              )}
              <div className={`text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user' 
                  ? 'glass-card p-3 rounded-2xl' 
                  : 'text-gray-300'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-gray-500 animate-fadeIn">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              思考中...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Visual Assets */}
        <div className="border-t border-white/5">
          <button
            onClick={() => setAssetsExpanded(!assetsExpanded)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-apple"
          >
            <div className="flex items-center gap-2">
              <ImageIcon size={16} className="text-gray-400" />
              <span className="text-sm font-medium">Visual Assets</span>
              <span className="text-xs text-green-400 glass-button px-2 py-0.5 rounded-full">已完成</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setAssetViewMode(assetViewMode === 'grid' ? 'list' : 'grid') }}
                className="p-1 hover:bg-white/10 rounded-lg transition-apple"
              >
                <Grid3X3 size={14} className="text-gray-400" />
              </button>
              <span className="text-xs text-gray-500">{visualAssets.length}</span>
              {assetsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>
          </button>
          
          {assetsExpanded && (
            <div className="px-4 pb-4 animate-fadeIn">
              <div className="flex gap-2 overflow-x-auto pb-2">
                {visualAssets.map((asset, index) => (
                  <div 
                    key={asset.id} 
                    className="relative flex-shrink-0 animate-fadeInUp"
                    style={{ animationDelay: `${index * 0.05}s`, animationFillMode: 'backwards' }}
                  >
                    <img 
                      src={asset.url} 
                      alt="" 
                      className="w-16 h-12 object-cover rounded-lg glass-card"
                    />
                    {asset.duration && (
                      <span className="absolute bottom-1 right-1 text-[10px] glass-dark px-1.5 rounded">
                        {asset.duration}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 输入区域 */}
        <div className="p-4 border-t border-white/5">
          <ChatInput
            value={inputMessage}
            onChange={setInputMessage}
            onSend={handleSendMessage}
            onStop={handleStopMessage}
            isLoading={sending}
            placeholder="请输入你的问题..."
            showModelSelector={true}
          />
        </div>
      </aside>
    </div>
  )
}

// 关键元素面板
function ElementsPanel({ 
  elements, 
  expandedElements, 
  toggleElement 
}: { 
  elements: Element[]
  expandedElements: Set<string>
  toggleElement: (id: string) => void
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold mb-4 text-gradient animate-fadeInDown">关键元素</h2>
      
      {elements.map((element, index) => (
        <div 
          key={element.id} 
          className="glass-card overflow-hidden animate-fadeInUp"
          style={{ animationDelay: `${index * 0.1}s`, animationFillMode: 'backwards' }}
        >
          <button
            onClick={() => toggleElement(element.id)}
            className="w-full px-4 py-3 flex items-center gap-2 hover:bg-white/5 transition-apple"
          >
            {expandedElements.has(element.id) ? (
              <ChevronDown size={16} className="text-gray-400" />
            ) : (
              <ChevronRight size={16} className="text-gray-400" />
            )}
            <span className="font-medium text-sm">{element.name}</span>
            <button className="ml-auto p-1.5 glass-button rounded-lg hover:bg-white/10">
              <Plus size={14} className="text-gray-400" />
            </button>
          </button>
          
          {expandedElements.has(element.id) && (
            <div className="px-4 pb-4 animate-fadeIn">
              <p className="text-sm text-gray-400 mb-3">{element.description}</p>
              
              {element.imageUrl && (
                <div className="relative group">
                  <img 
                    src={element.imageUrl} 
                    alt={element.name}
                    className="w-full max-w-md rounded-xl glass-card"
                  />
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-apple">
                    <button className="p-2 glass-dark rounded-lg hover:bg-white/20">
                      <RotateCcw size={14} />
                    </button>
                  </div>
                </div>
              )}
              
              {!element.imageUrl && (
                <div className="w-24 h-24 glass-card rounded-xl flex items-center justify-center border border-dashed border-white/20">
                  <Plus size={24} className="text-gray-500" />
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      
      <button className="w-full p-4 glass-card border border-dashed border-white/20 rounded-xl text-gray-500 hover:text-white hover:border-white/40 transition-apple flex items-center justify-center gap-2">
        <Plus size={18} />
        添加关键元素
      </button>
    </div>
  )
}

// 分镜面板
function StoryboardPanel({
  segments,
  expandedSegments,
  toggleSegment
}: {
  segments: Segment[]
  expandedSegments: Set<string>
  toggleSegment: (id: string) => void
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold mb-4 text-gradient animate-fadeInDown">分镜</h2>
      
      {segments.map((segment, index) => (
        <div 
          key={segment.id} 
          className="glass-card overflow-hidden animate-fadeInUp"
          style={{ animationDelay: `${index * 0.1}s`, animationFillMode: 'backwards' }}
        >
          <button
            onClick={() => toggleSegment(segment.id)}
            className="w-full px-4 py-3 flex items-center gap-2 hover:bg-white/5 transition-apple"
          >
            {expandedSegments.has(segment.id) ? (
              <ChevronDown size={16} className="text-gray-400" />
            ) : (
              <ChevronRight size={16} className="text-gray-400" />
            )}
            <span className="font-medium text-sm">{segment.name}</span>
            <button className="ml-auto p-1.5 glass-button rounded-lg hover:bg-white/10">
              <Plus size={14} className="text-gray-400" />
            </button>
          </button>
          
          {expandedSegments.has(segment.id) && (
            <div className="px-4 pb-4 space-y-4 animate-fadeIn">
              <p className="text-sm text-gray-400">{segment.description}</p>
              
              {segment.shots.map((shot, shotIndex) => (
                <div 
                  key={shot.id} 
                  className="glass p-4 rounded-xl animate-fadeInUp"
                  style={{ animationDelay: `${shotIndex * 0.05}s`, animationFillMode: 'backwards' }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <ChevronDown size={14} className="text-gray-400" />
                    <span className="text-sm font-medium">{shot.name}</span>
                  </div>
                  
                  <div className="pl-6">
                    <p className="text-xs text-gray-500 mb-3">{shot.description}</p>
                    
                    {shot.imageUrl && (
                      <div className="relative group">
                        <img 
                          src={shot.imageUrl}
                          alt={shot.name}
                          className="w-full max-w-lg rounded-xl"
                        />
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-apple">
                          <button className="p-2 glass-dark rounded-lg hover:bg-white/20">
                            <RotateCcw size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      
      <button className="w-full p-4 glass-card border border-dashed border-white/20 rounded-xl text-gray-500 hover:text-white hover:border-white/40 transition-apple flex items-center justify-center gap-2">
        <Plus size={18} />
        添加分镜段落
      </button>
    </div>
  )
}

// 时间线面板
function TimelinePanel() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime] = useState(0)
  const totalDuration = 25

  return (
    <div className="h-full flex flex-col animate-fadeIn">
      {/* 视频预览区 */}
      <div className="flex-1 flex items-center justify-center glass-card rounded-2xl mb-4">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 glass rounded-2xl flex items-center justify-center">
            <Film size={36} className="text-gray-500" />
          </div>
          <h3 className="text-lg font-medium mb-2 text-gradient">Timeline 尚未创建</h3>
          <p className="text-sm text-gray-500 max-w-sm">请在右侧对话框与 Flova 一起协作，生成属于你的视频时间线。</p>
        </div>
      </div>

      {/* 播放控制 */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-center gap-4 mb-4">
          <span className="text-sm text-gray-400 w-16 font-mono">
            {formatTime(currentTime)}
          </span>
          
          <div className="flex items-center gap-2">
            <button className="p-2.5 glass-button rounded-xl hover:bg-white/10 transition-apple">
              <SkipBack size={18} />
            </button>
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-4 gradient-primary rounded-2xl hover:opacity-90 transition-apple shadow-lg glow-primary"
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button className="p-2.5 glass-button rounded-xl hover:bg-white/10 transition-apple">
              <SkipForward size={18} />
            </button>
          </div>
          
          <span className="text-sm text-gray-400 w-16 text-right font-mono">
            {formatTime(totalDuration)}
          </span>
          
          <button className="p-2.5 glass-button rounded-xl hover:bg-white/10 transition-apple ml-4">
            <Maximize2 size={18} />
          </button>
        </div>

        {/* 时间轴 */}
        <div className="relative">
          <div className="flex justify-between text-xs text-gray-500 mb-3 px-1">
            {[0, 5, 10, 15, 20, 25].map((t) => (
              <span key={t} className="font-mono">{t.toString().padStart(2, '0')}:00</span>
            ))}
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-8">GH</span>
              <div className="flex-1 h-10 glass rounded-xl relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-blue-500/30 to-purple-500/30 rounded-lg m-1" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-8">♪</span>
              <div className="flex-1 h-10 glass rounded-xl relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-2/3 bg-gradient-to-r from-green-500/30 to-emerald-500/30 rounded-lg m-1" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}
