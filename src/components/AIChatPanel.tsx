import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send,
  X,
  Minimize2,
  Maximize2,
  Bot,
  User,
  Loader2,
  Lightbulb,
  History,
  Plus
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
}

interface ChatSession {
  session_id: string
  message_count: number
  created_at: string
  updated_at: string
}

const MODULE_TYPE = 'creative'
const DEFAULT_MESSAGE =
  '你好！我是创意助手 ✨\n\n我可以帮你：\n- 激发创作灵感\n- 解答使用问题\n- 提供创意建议\n- 优化工作流程\n\n有什么我可以帮你的吗？'

function generateSessionId(): string {
  return `${MODULE_TYPE}-${Date.now()}`
}

export default function AIChatPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [sessionId, setSessionId] = useState(() => generateSessionId())
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', content: DEFAULT_MESSAGE }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadSessionMessages = useCallback(async (sid: string) => {
    try {
      const history = await getChatHistory(sid, MODULE_TYPE, 100)
      if (history.length > 0) {
        const loadedMessages: Message[] = history.map((msg) => ({
          id: msg.id,
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        }))
        setMessages(loadedMessages)
      } else {
        setMessages([{ id: '1', role: 'assistant', content: DEFAULT_MESSAGE }])
      }
    } catch (error) {
      console.error('加载聊天历史失败:', error)
    }
  }, [])

  const loadSessions = async () => {
    setLoadingSessions(true)
    try {
      const allSessions = await listChatSessions(50)
      const moduleSessions = allSessions.filter((s) =>
        s.session_id.startsWith(MODULE_TYPE)
      )
      setSessions(moduleSessions)
    } catch (error) {
      console.error('加载会话列表失败:', error)
    } finally {
      setLoadingSessions(false)
    }
  }

  const switchToSession = async (sid: string) => {
    setSessionId(sid)
    await loadSessionMessages(sid)
    setShowHistory(false)
  }

  const createNewSession = () => {
    const newSid = generateSessionId()
    setSessionId(newSid)
    setMessages([{ id: '1', role: 'assistant', content: DEFAULT_MESSAGE }])
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

    try {
      await saveChatMessage(sessionId, MODULE_TYPE, 'user', userMessage.content)
    } catch (e) {
      console.error('保存用户消息失败:', e)
    }

    try {
      const response = await chatWithAI(
        input.trim(),
        '[创意助手模式] 用户正在使用 AI Storyboarder 进行视频分镜创作'
      )

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response
      }
      setMessages((prev) => [...prev, assistantMessage])

      try {
        await saveChatMessage(
          sessionId,
          MODULE_TYPE,
          'assistant',
          assistantMessage.content
        )
      } catch (e) {
        console.error('保存助手消息失败:', e)
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '抱歉，出现了问题。请检查设置中的 API 配置。'
        }
      ])
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
      await clearChatHistory(sessionId, MODULE_TYPE)
    } catch (e) {
      console.error('清除历史失败:', e)
    }
    setMessages([
      {
        id: Date.now().toString(),
        role: 'assistant',
        content: '对话已清空，有什么新的创意想法吗？'
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

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 p-4 bg-gradient-to-r from-primary to-secondary rounded-full shadow-lg hover:scale-105 transition-transform z-50 group"
        title="创意助手"
      >
        <Lightbulb size={24} />
        <span className="absolute right-full mr-3 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-[#1a1a1a] rounded-lg text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
          创意助手
        </span>
      </button>
    )
  }

  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] rounded-full border border-gray-700 shadow-lg z-50">
        <Lightbulb size={18} className="text-primary" />
        <span className="text-sm">创意助手</span>
        <button
          onClick={() => setIsMinimized(false)}
          className="p-1 hover:bg-gray-700 rounded"
        >
          <Maximize2 size={14} />
        </button>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 hover:bg-gray-700 rounded"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 w-80 h-[450px] bg-[#1a1a1a] rounded-xl border border-gray-700 shadow-2xl flex flex-col z-50">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Lightbulb size={18} className="text-primary" />
          <span className="font-medium text-sm">创意助手</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setShowHistory(!showHistory)
              if (!showHistory) loadSessions()
            }}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
            title="历史会话"
          >
            <History size={14} />
          </button>
          <button
            onClick={handleClearHistory}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded"
          >
            清空
          </button>
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 hover:bg-gray-700 rounded"
          >
            <Minimize2 size={14} />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 hover:bg-gray-700 rounded"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 历史会话面板 */}
      {showHistory && (
        <div className="absolute top-12 left-2 right-2 bg-[#252525] border border-gray-700 rounded-lg z-10 shadow-xl max-h-48 overflow-auto">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
            <span className="text-xs font-medium">历史会话</span>
            <div className="flex items-center gap-1">
              <button
                onClick={createNewSession}
                className="p-1 text-primary hover:bg-gray-700 rounded"
                title="新建会话"
              >
                <Plus size={12} />
              </button>
              <button
                onClick={() => setShowHistory(false)}
                className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
              >
                <X size={12} />
              </button>
            </div>
          </div>
          {loadingSessions ? (
            <div className="p-3 text-center text-gray-500">
              <Loader2 size={14} className="animate-spin mx-auto" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-3 text-center text-gray-500 text-xs">
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
                    <span className="text-xs truncate">
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
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                msg.role === 'user' ? 'bg-primary/20' : 'bg-gray-700'
              }`}
            >
              {msg.role === 'user' ? (
                <User size={12} className="text-primary" />
              ) : (
                <Bot size={12} className="text-gray-300" />
              )}
            </div>
            <div
              className={`max-w-[80%] px-3 py-2 rounded-lg text-xs ${
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
            <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center">
              <Bot size={12} className="text-gray-300" />
            </div>
            <div className="px-3 py-2 bg-[#252525] rounded-lg">
              <Loader2 size={12} className="animate-spin text-gray-400" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 */}
      <div className="p-3 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="问我任何问题..."
            className="flex-1 bg-[#252525] rounded-lg px-3 py-2 text-xs border border-gray-700 focus:border-primary/50 focus:outline-none"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="px-3 bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
