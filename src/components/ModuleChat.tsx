import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send,
  Bot,
  User,
  Loader2,
  Trash2,
  History,
  Plus,
  X
} from 'lucide-react'
import {
  chatWithAI,
  saveChatMessage,
  getChatHistory,
  clearChatHistory,
  listChatSessions
} from '../services/api'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt?: string
}

interface ChatSession {
  session_id: string
  message_count: number
  created_at: string
  updated_at: string
}

interface ModuleChatProps {
  moduleType: 'script' | 'image' | 'storyboard' | 'video'
  placeholder?: string
  systemPrompt?: string
  context?: string
}

const MODULE_CONFIG = {
  script: {
    title: '剧本助手',
    defaultPrompt:
      '我是剧本创作助手，可以帮你：\n- 构思故事大纲\n- 完善剧情细节\n- 优化对白台词\n- 分析角色设定\n\n请描述你的创作需求...'
  },
  image: {
    title: '图像助手',
    defaultPrompt:
      '我是图像生成助手，可以帮你：\n- 优化图像提示词\n- 描述画面构图\n- 调整风格参数\n- 解释生成结果\n\n请描述你想要的画面...'
  },
  storyboard: {
    title: '分镜助手',
    defaultPrompt:
      '我是分镜制作助手，可以帮你：\n- 拆解剧本为分镜\n- 设计镜头语言\n- 规划画面转场\n- 标注技术参数\n\n请输入剧本或描述场景...'
  },
  video: {
    title: '视频助手',
    defaultPrompt:
      '我是视频生成助手，可以帮你：\n- 规划视频节奏\n- 设计运镜方式\n- 优化动态效果\n- 调整时长参数\n\n请描述你的视频需求...'
  }
}

// 生成会话 ID
function generateSessionId(moduleType: string): string {
  return `${moduleType}-${Date.now()}`
}

export default function ModuleChat({
  moduleType,
  placeholder,
  context
}: ModuleChatProps) {
  const config = MODULE_CONFIG[moduleType]
  const [sessionId, setSessionId] = useState(() =>
    generateSessionId(moduleType)
  )
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: config.defaultPrompt
    }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 加载当前会话的历史消息
  const loadSessionMessages = useCallback(
    async (sid: string) => {
      try {
        const history = await getChatHistory(sid, moduleType, 100)
        if (history.length > 0) {
          const loadedMessages: Message[] = history.map((msg) => ({
            id: msg.id,
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
            createdAt: msg.created_at
          }))
          setMessages(loadedMessages)
        } else {
          // 新会话，显示默认提示
          setMessages([
            {
              id: '1',
              role: 'assistant',
              content: config.defaultPrompt
            }
          ])
        }
      } catch (error) {
        console.error('加载聊天历史失败:', error)
      }
    },
    [moduleType, config.defaultPrompt]
  )

  // 加载历史会话列表
  const loadSessions = async () => {
    setLoadingSessions(true)
    try {
      const allSessions = await listChatSessions(50)
      // 过滤当前模块的会话
      const moduleSessions = allSessions.filter((s) =>
        s.session_id.startsWith(moduleType)
      )
      setSessions(moduleSessions)
    } catch (error) {
      console.error('加载会话列表失败:', error)
    } finally {
      setLoadingSessions(false)
    }
  }

  // 切换到历史会话
  const switchToSession = async (sid: string) => {
    setSessionId(sid)
    await loadSessionMessages(sid)
    setShowHistory(false)
  }

  // 创建新会话
  const createNewSession = () => {
    const newSid = generateSessionId(moduleType)
    setSessionId(newSid)
    setMessages([
      {
        id: '1',
        role: 'assistant',
        content: config.defaultPrompt
      }
    ])
    setShowHistory(false)
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim()
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    // 保存用户消息到后端
    try {
      await saveChatMessage(sessionId, moduleType, 'user', userMessage.content)
    } catch (e) {
      console.error('保存用户消息失败:', e)
    }

    try {
      const moduleContext = `[${config.title}模式] ${context || ''}`
      const response = await chatWithAI(input.trim(), moduleContext)

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response
      }
      setMessages((prev) => [...prev, assistantMessage])

      // 保存助手消息到后端
      try {
        await saveChatMessage(
          sessionId,
          moduleType,
          'assistant',
          assistantMessage.content
        )
      } catch (e) {
        console.error('保存助手消息失败:', e)
      }
    } catch (error) {
      console.error('对话失败:', error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '抱歉，出现了问题。请检查设置中的 API 配置。'
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClearHistory = async () => {
    try {
      await clearChatHistory(sessionId, moduleType)
    } catch (e) {
      console.error('清除历史失败:', e)
    }
    setMessages([
      {
        id: Date.now().toString(),
        role: 'assistant',
        content: config.defaultPrompt
      }
    ])
  }

  const formatTime = (isoString: string) => {
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] rounded-xl border border-gray-800 relative">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-primary" />
          <span className="font-medium text-sm">{config.title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setShowHistory(!showHistory)
              if (!showHistory) loadSessions()
            }}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            title="历史会话"
          >
            <History size={14} />
          </button>
          <button
            onClick={handleClearHistory}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            title="清空当前对话"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* 历史会话面板 */}
      {showHistory && (
        <div className="absolute top-12 left-0 right-0 bg-[#252525] border border-gray-700 rounded-lg mx-2 z-10 shadow-xl max-h-64 overflow-auto">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
            <span className="text-sm font-medium">历史会话</span>
            <div className="flex items-center gap-1">
              <button
                onClick={createNewSession}
                className="p-1 text-primary hover:bg-gray-700 rounded"
                title="新建会话"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => setShowHistory(false)}
                className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          {loadingSessions ? (
            <div className="p-4 text-center text-gray-500">
              <Loader2 size={16} className="animate-spin mx-auto" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              暂无历史会话
            </div>
          ) : (
            <div className="py-1">
              {sessions.map((session) => (
                <button
                  key={session.session_id}
                  onClick={() => switchToSession(session.session_id)}
                  className={`w-full px-3 py-2 text-left hover:bg-gray-700 transition-colors ${
                    session.session_id === sessionId ? 'bg-gray-700' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm truncate">
                      {session.message_count} 条消息
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatTime(session.updated_at)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 消息列表 */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                msg.role === 'user' ? 'bg-primary/20' : 'bg-gray-700'
              }`}
            >
              {msg.role === 'user' ? (
                <User size={14} className="text-primary" />
              ) : (
                <Bot size={14} className="text-gray-300" />
              )}
            </div>
            <div
              className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                msg.role === 'user'
                  ? 'bg-primary/20 text-white'
                  : 'bg-[#252525] text-gray-200'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center">
              <Bot size={14} className="text-gray-300" />
            </div>
            <div className="px-3 py-2 bg-[#252525] rounded-lg">
              <Loader2 size={14} className="animate-spin text-gray-400" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 */}
      <div className="p-3 border-t border-gray-800">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || '输入消息...'}
            className="flex-1 bg-[#252525] rounded-lg px-3 py-2 text-sm resize-none border border-gray-700 focus:border-primary/50 focus:outline-none"
            rows={2}
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="px-3 bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
