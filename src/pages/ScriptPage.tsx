import { useState, useRef, useEffect } from 'react'
import { Save, Download, FileText, Bot, User, Loader2, Check, Clock, ChevronRight, Trash2, Feather } from 'lucide-react'
import { chatWithAI, stopChatGeneration, listScripts, saveScript, deleteScript, updateScript, Script } from '../services/api'
import ChatInput from '../components/ChatInput'
import ProjectBackButton from '../components/ProjectBackButton'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface TimelineItem {
  id: string
  type: 'user_input' | 'ai_thinking' | 'ai_output' | 'confirmed'
  content: string
  timestamp: Date
}

type PageState = 'chat' | 'workspace'

export default function ScriptPage() {
  const [pageState, setPageState] = useState<PageState>('chat')
  const [script, setScript] = useState('')
  const [title, setTitle] = useState('未命名剧本')
  const [currentScriptId, setCurrentScriptId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [pendingContent, setPendingContent] = useState('')
  const [historyScripts, setHistoryScripts] = useState<Script[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [isEditMode, setIsEditMode] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 加载历史剧本
  useEffect(() => {
    loadHistoryScripts()
  }, [])

  const loadHistoryScripts = async () => {
    try {
      setLoadingHistory(true)
      const scripts = await listScripts()
      setHistoryScripts(scripts)
    } catch (error) {
      console.error('加载历史剧本失败:', error)
    } finally {
      setLoadingHistory(false)
    }
  }

  // 打开历史剧本
  const openScript = (scriptItem: Script) => {
    setCurrentScriptId(scriptItem.id)
    setTitle(scriptItem.title || '未命名剧本')
    setScript(scriptItem.content || '')
    setPageState('workspace')
    setMessages([])
    setTimeline([{
      id: `tl-${Date.now()}`,
      type: 'confirmed',
      content: '打开历史剧本',
      timestamp: new Date()
    }])
  }

  // 删除剧本
  const handleDeleteScript = async (scriptId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('确定删除这个剧本吗？')) return
    try {
      await deleteScript(scriptId)
      setHistoryScripts(prev => prev.filter(s => s.id !== scriptId))
      // 如果删除的是当前正在编辑的剧本，清除状态
      if (currentScriptId === scriptId) {
        setCurrentScriptId(null)
      }
    } catch (error) {
      console.error('删除失败:', error)
    }
  }

  // 保存剧本
  const handleSaveScript = async (showAlert = true) => {
    if (!script.trim() && !title.trim()) return
    try {
      if (currentScriptId) {
        try {
          await updateScript(currentScriptId, title, script)
        } catch {
          // 如果更新失败（可能已被删除），创建新的
          const saved = await saveScript(title, script)
          setCurrentScriptId(saved.id)
        }
      } else {
        const saved = await saveScript(title, script)
        setCurrentScriptId(saved.id)
      }
      await loadHistoryScripts()
      if (showAlert) alert('保存成功')
    } catch (error) {
      console.error('保存失败:', error)
      if (showAlert) alert('保存失败')
    }
  }

  // 标题失焦时自动保存
  const handleTitleBlur = () => {
    if (currentScriptId && title.trim()) {
      handleSaveScript(false)
    }
  }

  // 新建剧本
  const handleNewScript = () => {
    setCurrentScriptId(null)
    setTitle('未命名剧本')
    setScript('')
    setMessages([{
      id: '1',
      role: 'assistant',
      content: '你好！我是剧本创作助手 ✨\n\n告诉我你想创作什么样的故事？\n\n比如：\n• "写一个关于时间旅行的科幻短片剧本"\n• "帮我构思一个温馨的家庭喜剧"\n• "创作一个悬疑推理的开场"'
    }])
    setTimeline([])
    setPendingContent('')
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (pageState === 'chat' && messages.length === 0) {
      setMessages([{
        id: '1',
        role: 'assistant',
        content: '你好！我是剧本创作助手 ✨\n\n告诉我你想创作什么样的故事？\n\n比如：\n• "写一个关于时间旅行的科幻短片剧本"\n• "帮我构思一个温馨的家庭喜剧"\n• "创作一个悬疑推理的开场"'
      }])
    }
  }, [pageState, messages.length])

  const handleStop = () => {
    stopChatGeneration()
    setIsLoading(false)
    setTimeline(prev => prev.filter(item => item.type !== 'ai_thinking'))
  }

  const handleSend = async (text?: string) => {
    const messageText = text || input.trim()
    if (!messageText || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageText
    }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    // 如果在聊天界面，立即跳转到工作区
    const wasInChat = pageState === 'chat'
    if (wasInChat) {
      setPageState('workspace')
      setTimeline([{
        id: `tl-${Date.now()}`,
        type: 'user_input',
        content: messageText,
        timestamp: new Date()
      }, {
        id: `tl-${Date.now() + 1}`,
        type: 'ai_thinking',
        content: '正在思考...',
        timestamp: new Date()
      }])
    } else {
      setTimeline(prev => [...prev, {
        id: `tl-${Date.now()}`,
        type: 'user_input',
        content: messageText,
        timestamp: new Date()
      }, {
        id: `tl-${Date.now() + 1}`,
        type: 'ai_thinking',
        content: '正在思考...',
        timestamp: new Date()
      }])
    }

    try {
      const context = script 
        ? `[剧本助手模式] 当前剧本标题：${title}\n当前剧本内容：${script.slice(0, 1000)}` 
        : '[剧本助手模式] 用户正在开始创作新剧本'
      
      const response = await chatWithAI(messageText, context)

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response
      }
      setMessages(prev => [...prev, assistantMessage])
      setPendingContent(response)

      setTimeline(prev => {
        const filtered = prev.filter(item => item.type !== 'ai_thinking')
        return [...filtered, {
          id: `tl-${Date.now() + 2}`,
          type: 'ai_output',
          content: response.slice(0, 100) + '...',
          timestamp: new Date()
        }]
      })
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'CanceledError') {
        setTimeline(prev => prev.filter(item => item.type !== 'ai_thinking'))
        return // 用户主动取消
      }
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '抱歉，出现了问题。请检查设置中的 API 配置。'
      }])
      setTimeline(prev => prev.filter(item => item.type !== 'ai_thinking'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleConfirm = () => {
    if (!pendingContent) return
    setScript(prev => prev ? `${prev}\n\n${pendingContent}` : pendingContent)
    setTimeline(prev => [...prev, {
      id: `tl-${Date.now()}`,
      type: 'confirmed',
      content: '已采纳到剧本',
      timestamp: new Date()
    }])
    setPendingContent('')
  }

  const handleExport = () => {
    const blob = new Blob([`# ${title}\n\n${script}`], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  // 初始聊天界面
  if (pageState === 'chat') {
    return (
      <div className="h-full flex flex-col gradient-mesh">
        {/* 项目返回按钮 */}
        <div className="px-4 pt-3">
          <ProjectBackButton />
        </div>
        
        <div className="flex-1 flex">
        {/* 左侧历史记录 */}
        <div className="w-72 glass-dark m-3 rounded-2xl flex flex-col animate-slideInLeft">
          <div className="p-4 border-b border-white/5 flex items-center justify-between">
            <h3 className="font-medium text-sm text-gray-300">历史创作</h3>
            <button
              onClick={handleNewScript}
              className="px-3 py-1.5 text-xs btn-primary"
            >
              + 新建
            </button>
          </div>
          <div 
            className="flex-1 overflow-y-auto"
            style={{ overscrollBehavior: 'contain' }}
          >
            {loadingHistory ? (
              <div className="p-8 text-center">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : historyScripts.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                <FileText size={32} className="mx-auto mb-3 opacity-30" />
                暂无历史记录
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {historyScripts.map((item, index) => (
                  <div
                    key={item.id}
                    onClick={() => openScript(item)}
                    className="p-3 rounded-xl hover:bg-white/5 cursor-pointer group transition-apple animate-fadeInUp"
                    style={{ animationDelay: `${index * 0.05}s` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.title || '未命名剧本'}</p>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                          {item.content ? `${item.content.slice(0, 60)}...` : '暂无内容'}
                        </p>
                        <p className="text-xs text-gray-600 mt-2">
                          {new Date(item.updated_at).toLocaleDateString('zh-CN')}
                        </p>
                      </div>
                      <button
                        onClick={(e) => handleDeleteScript(item.id, e)}
                        className="p-1.5 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-apple"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右侧聊天区 */}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-2xl animate-fadeInUp">
            <div className="text-center mb-10">
              <div className="w-20 h-20 mx-auto mb-5 bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 rounded-3xl flex items-center justify-center shadow-xl shadow-purple-500/30 animate-float">
                <FileText size={36} className="text-white drop-shadow-md" strokeWidth={2} />
              </div>
              <h1 className="text-3xl font-bold mb-3 text-gradient">剧本创作助手</h1>
              <p className="text-gray-400 text-lg">告诉我你的创意，让我们一起创作精彩故事</p>
            </div>

            <div className="glass-card overflow-hidden">
              <div 
                className="max-h-[320px] overflow-y-auto p-5 space-y-4"
                style={{ overscrollBehavior: 'contain' }}
              >
                {messages.map((msg, index) => (
                  <div 
                    key={msg.id} 
                    className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-fadeInUp`}
                    style={{ animationDelay: `${index * 0.1}s` }}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      msg.role === 'user' ? 'bg-primary/20' : 'gradient-cool'
                    }`}>
                      {msg.role === 'user' ? <User size={16} className="text-primary" /> : <Bot size={16} className="text-white" />}
                    </div>
                    <div className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                      msg.role === 'user' ? 'bg-primary/20 rounded-tr-md' : 'glass rounded-tl-md'
                    }`}>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex gap-3 animate-fadeIn">
                    <div className="w-9 h-9 rounded-xl gradient-cool flex items-center justify-center">
                      <Bot size={16} className="text-white" />
                    </div>
                    <div className="px-4 py-3 glass rounded-2xl rounded-tl-md">
                      <div className="flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin text-primary" />
                        <span className="text-sm text-gray-400">思考中...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-5 border-t border-white/5">
                <ChatInput
                  value={input}
                  onChange={setInput}
                  onSend={() => handleSend()}
                  onStop={handleStop}
                  isLoading={isLoading}
                  placeholder="描述你想创作的故事..."
                  showModelSelector={true}
                />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3 justify-center">
              {['科幻冒险', '爱情喜剧', '悬疑推理', '历史传奇'].map((tag, index) => (
                <button
                  key={tag}
                  onClick={() => handleSend(`帮我写一个${tag}类型的短片剧本`)}
                  className="px-5 py-2.5 glass-button text-sm text-gray-400 hover:text-white animate-fadeInUp"
                  style={{ animationDelay: `${(index + 4) * 0.1}s` }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>
        </div>
      </div>
    )
  }

  // 工作区界面
  return (
    <div className="flex flex-col h-full animate-fadeIn gradient-mesh">
      {/* 项目返回按钮 */}
      <div className="px-4 pt-3">
        <ProjectBackButton />
      </div>
      
      <div className="flex-1 flex">
      {/* 左侧 - 剧本展示/编辑区 */}
      <div className="flex-1 flex flex-col m-3 mr-0 glass-dark rounded-2xl overflow-hidden animate-slideInLeft">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setPageState('chat')
                loadHistoryScripts()
              }}
              className="p-2 hover:bg-white/10 rounded-xl transition-apple"
              title="返回"
            >
              <ChevronRight size={18} className="rotate-180" />
            </button>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-purple-500/30">
              <FileText size={18} className="text-white drop-shadow-md" strokeWidth={2.5} />
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              className="bg-transparent text-lg font-semibold focus:outline-none border-b border-transparent focus:border-white/20 transition-apple"
            />
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => handleSaveScript(true)}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
            >
              <Save size={16} />
              保存
            </button>
            <button 
              onClick={handleExport}
              className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm"
            >
              <Download size={16} />
              导出
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* 时间轴 */}
          <div 
            className="w-64 border-r border-white/5 overflow-y-auto"
            style={{ overscrollBehavior: 'contain' }}
          >
            <div className="p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-4 flex items-center gap-2">
                <Clock size={14} />
                创作时间轴
              </h3>
              <div className="space-y-3">
                {timeline.map((item, index) => (
                  <div 
                    key={item.id} 
                    className="relative pl-7 animate-fadeInUp"
                    style={{ animationDelay: `${index * 0.05}s` }}
                  >
                    {index < timeline.length - 1 && (
                      <div className="absolute left-[11px] top-6 w-0.5 h-full bg-gradient-to-b from-white/20 to-transparent" />
                    )}
                    <div className={`absolute left-0 top-1 w-6 h-6 rounded-lg flex items-center justify-center transition-apple ${
                      item.type === 'confirmed' ? 'bg-green-500 glow-soft' :
                      item.type === 'ai_thinking' ? 'bg-yellow-500 animate-pulse' :
                      item.type === 'ai_output' ? 'gradient-primary' : 'bg-white/10'
                    }`}>
                      {item.type === 'confirmed' ? <Check size={12} /> :
                       item.type === 'ai_thinking' ? <Loader2 size={12} className="animate-spin" /> :
                       <ChevronRight size={12} />}
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">{formatTime(item.timestamp)}</p>
                      <p className="text-sm text-gray-300 line-clamp-2 mt-0.5">{item.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 剧本展示区 */}
          <div className="flex-1 flex flex-col relative">
            <div 
              className="flex-1 p-6 overflow-y-auto"
              style={{ overscrollBehavior: 'contain' }}
            >
              {isEditMode ? (
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  placeholder="在这里编辑剧本内容..."
                  className="w-full h-full bg-transparent text-sm leading-relaxed resize-none focus:outline-none text-gray-200"
                  autoFocus
                />
              ) : script ? (
                <div className="prose prose-invert max-w-none animate-fadeIn">
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-gray-200 bg-transparent p-0">
                    {script}
                  </pre>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  <div className="text-center animate-fadeIn">
                    <FileText size={56} className="mx-auto mb-4 opacity-20" />
                    <p className="text-lg">与右侧助手对话</p>
                    <p className="text-sm text-gray-600 mt-1">确认后内容将显示在这里</p>
                  </div>
                </div>
              )}
            </div>

            {/* 底部状态栏 */}
            <div className="border-t border-white/5 px-5 py-2.5 flex justify-between items-center text-xs text-gray-500">
              <span>{script.length} 字</span>
              <span className="glass-button px-2 py-1 rounded-lg">{isEditMode ? '编辑模式' : '预览模式'}</span>
            </div>

            {/* 右下角羽毛笔按钮 */}
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className={`absolute bottom-14 right-5 p-3.5 rounded-2xl shadow-2xl transition-spring ${
                isEditMode 
                  ? 'gradient-primary glow-primary' 
                  : 'glass-button hover:scale-110'
              }`}
              title={isEditMode ? '退出编辑' : '编辑剧本'}
            >
              <Feather size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* 右侧 - 剧本助手对话 */}
      <aside className="w-[400px] glass-dark m-3 rounded-2xl flex flex-col animate-slideInRight">
        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl gradient-cool flex items-center justify-center glow-soft">
            <Bot size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold">剧本助手</h3>
            <p className="text-xs text-gray-500">随时为你提供创作建议</p>
          </div>
        </div>

        <div 
          className="flex-1 overflow-y-auto"
          style={{ overscrollBehavior: 'contain' }}
        >
          <div className="p-4 space-y-4">
            {messages.filter(msg => msg.id !== '1').map((msg, index) => {
              const isLongContent = msg.content.length > 200
              return (
                <div 
                  key={msg.id} 
                  className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-fadeInUp`}
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    msg.role === 'user' ? 'bg-primary/20' : 'gradient-cool'
                  }`}>
                    {msg.role === 'user' ? <User size={14} className="text-primary" /> : <Bot size={14} className="text-white" />}
                  </div>
                  <div className={`${msg.role === 'user' ? 'max-w-[80%]' : isLongContent ? 'max-w-[95%]' : 'max-w-[85%]'} transition-apple`}>
                    <div className={`px-4 py-3 rounded-2xl text-sm ${
                      msg.role === 'user' ? 'bg-primary/20 rounded-tr-md' : 'glass rounded-tl-md'
                    }`}>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    </div>
                    {msg.role === 'assistant' && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={handleConfirm}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 text-green-400 rounded-xl text-xs hover:bg-green-500/30 transition-apple"
                        >
                          <Check size={12} />
                          采纳到剧本
                        </button>
                        <button
                          onClick={() => handleSend('继续扩展这部分内容')}
                          className="px-3 py-1.5 glass-button text-gray-400 text-xs hover:text-white"
                        >
                          继续扩展
                        </button>
                        <button
                          onClick={() => handleSend('换一个方向重写')}
                          className="px-3 py-1.5 glass-button text-gray-400 text-xs hover:text-white"
                        >
                          重写
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {isLoading && (
              <div className="flex gap-3 animate-fadeIn">
                <div className="w-8 h-8 rounded-xl gradient-cool flex items-center justify-center">
                  <Bot size={14} className="text-white" />
                </div>
                <div className="px-4 py-3 glass rounded-2xl rounded-tl-md">
                  <div className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-primary" />
                    <span className="text-sm text-gray-400">正在创作...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="p-4 border-t border-white/5">
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={() => handleSend()}
            onStop={handleStop}
            isLoading={isLoading}
            placeholder="继续对话，完善剧本..."
            showModelSelector={true}
          />
          <div className="flex gap-2 mt-3 flex-wrap">
            {['优化对白', '增加场景', '添加动作', '下一场'].map((action, index) => (
              <button
                key={action}
                onClick={() => handleSend(`帮我${action}`)}
                className="px-3 py-1.5 text-xs glass-button text-gray-400 hover:text-white animate-fadeInUp"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                {action}
              </button>
            ))}
          </div>
        </div>
      </aside>
      </div>
    </div>
  )
}
