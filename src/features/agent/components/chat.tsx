import { CheckCircle, Zap } from 'lucide-react'
import type { ChatMessage, ChatOption } from '../types'
import { JsonDataCard } from './cards'

// 聊天消息组件 - 美化输出格式
export function ChatMessageItem({ 
  message, 
  onOptionClick, 
  onConfirmClick 
}: { 
  message: ChatMessage
  onOptionClick: (opt: ChatOption) => void
  onConfirmClick: (action: string, payload?: unknown) => void
}) {
  // 解析消息内容，检测是否包含 JSON
  const renderContent = (content: string) => {
    // 检查是否是纯 JSON 格式
    const jsonMatch = content.match(/^\s*\{[\s\S]*\}\s*$/)
    if (jsonMatch) {
      try {
        const data = JSON.parse(content)
        return <JsonDataCard data={data} />
      } catch {
        // 不是有效 JSON，正常渲染
      }
    }
    
    // 检查是否包含 JSON 代码块
    const parts = content.split(/(```json[\s\S]*?```)/g)
    if (parts.length > 1) {
      return (
        <div className="space-y-3">
          {parts.map((part, idx) => {
            if (part.startsWith('```json')) {
              const jsonStr = part.replace(/```json\s*/, '').replace(/\s*```$/, '')
              try {
                const data = JSON.parse(jsonStr)
                return <JsonDataCard key={idx} data={data} />
              } catch {
                return <pre key={idx} className="text-xs glass p-3 rounded-lg overflow-auto">{jsonStr}</pre>
              }
            }
            return part.trim() ? (
              <div key={idx} className="text-sm leading-relaxed whitespace-pre-wrap">{part}</div>
            ) : null
          })}
        </div>
      )
    }
    
    // 普通文本，支持 Markdown 风格
    return <FormattedText content={content} />
  }
  
  if (message.role === 'user') {
    return (
      <div className="ml-8">
        <div className="glass-card p-3 rounded-2xl text-sm">{message.content}</div>
      </div>
    )
  }

  // 欢迎消息特殊布局（带立绘）
  const isWelcomeMessage = message.id === '1'

  return (
    <div>
      {isWelcomeMessage ? (
        // 欢迎消息：立绘 + 文字横向布局
        <div className="flex gap-4 items-start">
          <img
            src="/yuanyuan/standing.png"
            alt="YuanYuan"
            className="w-24 h-auto flex-shrink-0 drop-shadow-lg"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-pink-400">YuanYuan</span>
            </div>
            <div className="text-gray-300">
              {renderContent(message.content)}
            </div>
          </div>
        </div>
      ) : (
        // 普通消息布局
        <>
          <div className="flex items-center gap-2 mb-2">
            <img
              src="/yuanyuan/avatar-small.png"
              alt="YuanYuan"
              className="w-6 h-6 rounded-lg object-cover"
            />
            <span className="text-sm font-medium text-pink-400">YuanYuan</span>
          </div>

          <div className="text-gray-300">
            {renderContent(message.content)}
          </div>

            {message.confirmButton?.action === 'apply_agent_actions' &&
              message.data &&
              typeof message.data === 'object' &&
              'actions' in (message.data as Record<string, unknown>) && (
              <div className="mt-3">
                <JsonDataCard data={message.data as Record<string, unknown>} />
              </div>
            )}
        </>
      )}
      
      {/* 进度指示器 - 静态显示完成状态 */}
      {message.progress && message.progress.length > 0 && (
        <div className="mt-3 glass p-3 rounded-xl space-y-2">
          {message.progress.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              {item.completed ? (
                <CheckCircle size={14} className="text-green-400" />
              ) : (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-500" />
              )}
              <span className={item.completed ? 'text-green-400' : 'text-gray-500'}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      )}
      
      {/* 选项按钮 */}
      {message.options && message.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {message.options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => onOptionClick(opt)}
              className="px-3 py-1.5 glass-button rounded-lg text-xs hover:bg-white/10 transition-apple"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      
      {/* 确认按钮 */}
      {message.confirmButton && (
        <button
          onClick={() => onConfirmClick(message.confirmButton!.action, message.confirmButton!.payload)}
          className="mt-3 px-4 py-2 gradient-primary rounded-xl text-sm font-medium flex items-center gap-2"
        >
          <Zap size={14} />
          {message.confirmButton.label}
        </button>
      )}
    </div>
  )
}

// 格式化文本组件 - 支持简单 Markdown
export function FormattedText({ content }: { content: string }) {
  const lines = content.split('\n')
  
  return (
    <div className="text-sm leading-relaxed space-y-2">
      {lines.map((line, idx) => {
        // 标题
        if (line.startsWith('**') && line.endsWith('**')) {
          return <p key={idx} className="font-semibold text-white">{line.slice(2, -2)}</p>
        }
        // 加粗文本
        if (line.includes('**')) {
          const parts = line.split(/(\*\*.*?\*\*)/g)
          return (
            <p key={idx}>
              {parts.map((part, i) => 
                part.startsWith('**') && part.endsWith('**') 
                  ? <strong key={i} className="text-white">{part.slice(2, -2)}</strong>
                  : part
              )}
            </p>
          )
        }
        // 分隔线
        if (line.trim() === '---') {
          return <hr key={idx} className="border-white/10 my-2" />
        }
        // 列表项
        if (line.trim().startsWith('- ')) {
          return <p key={idx} className="pl-4">• {line.trim().slice(2)}</p>
        }
        // 空行
        if (!line.trim()) {
          return <div key={idx} className="h-2" />
        }
        // 普通文本
        return <p key={idx}>{line}</p>
      })}
    </div>
  )
}
