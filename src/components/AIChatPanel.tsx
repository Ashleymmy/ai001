import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircle, X, Bot, User, Loader2, Minimize2 } from 'lucide-react'
import { chatWithAI, stopChatGeneration } from '../services/api'
import ChatInput from './ChatInput'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export default function AIChatPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '你好！我是你的创意助手 ✨\n\n有什么我可以帮助你的吗？'
    }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  
  // 拖拽相关状态 - 使用右下角为基准
  const [position, setPosition] = useState({ right: 24, bottom: 24 })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ 
    startX: number
    startY: number
    startRight: number
    startBottom: number 
  } | null>(null)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 限制位置在可视区域内
  const clampPosition = useCallback((right: number, bottom: number) => {
    const padding = 10
    const buttonSize = 56
    const maxRight = window.innerWidth - buttonSize - padding
    const maxBottom = window.innerHeight - buttonSize - padding
    
    return {
      right: Math.max(padding, Math.min(right, maxRight)),
      bottom: Math.max(padding, Math.min(bottom, maxBottom))
    }
  }, [])

  // 窗口大小变化时重新校正位置
  useEffect(() => {
    const handleResize = () => {
      setPosition(prev => clampPosition(prev.right, prev.bottom))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [clampPosition])

  // 拖拽处理
  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startRight: position.right,
      startBottom: position.bottom
    }
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !dragRef.current) return
      
      // 计算鼠标移动的距离
      const deltaX = e.clientX - dragRef.current.startX
      const deltaY = e.clientY - dragRef.current.startY
      
      // 右下角定位：鼠标右移时 right 减小，鼠标下移时 bottom 减小
      const newRight = dragRef.current.startRight - deltaX
      const newBottom = dragRef.current.startBottom - deltaY
      
      setPosition(clampPosition(newRight, newBottom))
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      dragRef.current = null
    }

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, clampPosition])

  const handleStop = () => {
    stopChatGeneration()
    setIsLoading(false)
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input
    }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const response = await chatWithAI(input, '创意助手模式')
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response
      }
      setMessages(prev => [...prev, assistantMessage])
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'CanceledError') {
        return
      }
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '抱歉，出现了问题。请检查设置中的 API 配置。'
      }])
    } finally {
      setIsLoading(false)
    }
  }

  const handleClick = () => {
    if (!isDragging) {
      setIsOpen(true)
    }
  }

  // 悬浮球
  if (!isOpen) {
    return (
      <button
        onClick={handleClick}
        onMouseDown={handleDragStart}
        className="fixed z-50 w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center shadow-2xl hover:scale-110 transition-spring glow-primary animate-bounce-soft"
        style={{
          right: `${position.right}px`,
          bottom: `${position.bottom}px`,
          cursor: isDragging ? 'grabbing' : 'grab'
        }}
      >
        <MessageCircle size={24} className="text-white" />
      </button>
    )
  }

  // 最小化状态
  if (isMinimized) {
    return (
      <div
        className="fixed z-50 glass-dark rounded-2xl shadow-2xl flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-apple animate-scaleIn"
        style={{
          right: `${position.right}px`,
          bottom: `${position.bottom}px`,
          cursor: isDragging ? 'grabbing' : 'pointer'
        }}
        onClick={() => !isDragging && setIsMinimized(false)}
        onMouseDown={handleDragStart}
      >
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
          <Bot size={20} className="text-white drop-shadow-md" strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-sm font-medium">创意助手</p>
          <p className="text-xs text-gray-500">点击展开</p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setIsOpen(false); setIsMinimized(false) }}
          className="p-1.5 hover:bg-white/10 rounded-lg transition-apple ml-2"
        >
          <X size={16} />
        </button>
      </div>
    )
  }

  // 完整面板
  return (
    <div
      className="fixed z-50 w-[380px] h-[560px] glass-dark rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-scaleIn"
      style={{
        right: `${position.right}px`,
        bottom: `${position.bottom}px`
      }}
    >
      {/* 头部 - 可拖拽 */}
      <div
        className="px-5 py-4 flex items-center justify-between border-b border-white/5"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Bot size={20} className="text-white drop-shadow-md" strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="font-semibold">创意助手</h3>
            <p className="text-xs text-gray-500">随时为你提供灵感</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(true)}
            className="p-2 hover:bg-white/10 rounded-xl transition-apple"
          >
            <Minimize2 size={16} />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 hover:bg-white/10 rounded-xl transition-apple"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 消息区域 */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.map((msg, index) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-fadeInUp`}
            style={{ animationDelay: `${index * 0.05}s` }}
          >
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
              msg.role === 'user' 
                ? 'bg-primary/20' 
                : 'gradient-primary'
            }`}>
              {msg.role === 'user' 
                ? <User size={14} className="text-primary" /> 
                : <Bot size={14} className="text-white" />
              }
            </div>
            <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm ${
              msg.role === 'user' 
                ? 'bg-primary/20 rounded-tr-md' 
                : 'glass rounded-tl-md'
            }`}>
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3 animate-fadeIn">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 flex items-center justify-center shadow-md">
              <Bot size={14} className="text-white drop-shadow" strokeWidth={2.5} />
            </div>
            <div className="px-4 py-3 glass rounded-2xl rounded-tl-md">
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-primary" />
                <span className="text-sm text-gray-400">思考中...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="p-4 border-t border-white/5">
        <ChatInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onStop={handleStop}
          isLoading={isLoading}
          placeholder="有什么想法？"
          rows={1}
          showModelSelector={false}
        />
      </div>
    </div>
  )
}
