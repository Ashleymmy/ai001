import { useState, useRef, useEffect } from 'react'
import { Send, Square, ChevronDown, Bot, Check } from 'lucide-react'
import { useSettingsStore, LLM_PROVIDERS } from '../store/settingsStore'

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop?: () => void
  isLoading: boolean
  placeholder?: string
  rows?: number
  showModelSelector?: boolean
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  isLoading,
  placeholder = '输入消息...',
  rows = 2,
  showModelSelector = true
}: ChatInputProps) {
  const [showModelMenu, setShowModelMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { settings, updateLLM } = useSettingsStore()

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowModelMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isLoading) onSend()
    }
  }

  // 获取当前模型显示名称
  const getCurrentModelName = () => {
    const provider = LLM_PROVIDERS.find(p => p.id === settings.llm.provider)
    const providerName = provider?.name || settings.llm.provider
    const modelName = settings.llm.model || '默认'
    return `${providerName} / ${modelName}`
  }

  // 获取可用的模型列表
  const getAvailableModels = () => {
    const models: { provider: string; providerName: string; model: string }[] = []
    
    LLM_PROVIDERS.forEach(provider => {
      if (provider.id === 'custom') return
      if (provider.models.length > 0) {
        provider.models.forEach(model => {
          models.push({
            provider: provider.id,
            providerName: provider.name,
            model
          })
        })
      } else if (provider.id === 'doubao') {
        if (settings.llm.provider === 'doubao' && settings.llm.model) {
          models.push({
            provider: 'doubao',
            providerName: '豆包(字节)',
            model: settings.llm.model
          })
        }
      }
    })
    
    return models
  }

  const handleSelectModel = (provider: string, model: string) => {
    const providerConfig = LLM_PROVIDERS.find(p => p.id === provider)
    updateLLM({
      provider,
      model,
      baseUrl: providerConfig?.baseUrl || settings.llm.baseUrl
    })
    setShowModelMenu(false)
  }

  return (
    <div className="space-y-3">
      {/* 模型选择器 */}
      {showModelSelector && (
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowModelMenu(!showModelMenu)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400 hover:text-white glass-button transition-apple"
          >
            <Bot size={12} />
            <span className="max-w-[200px] truncate">{getCurrentModelName()}</span>
            <ChevronDown size={12} className={`transition-apple ${showModelMenu ? 'rotate-180' : ''}`} />
          </button>

          {/* 模型下拉菜单 */}
          {showModelMenu && (
            <div className="absolute bottom-full left-0 mb-2 w-72 glass-dark rounded-2xl shadow-2xl z-50 max-h-72 overflow-auto animate-scaleIn">
              <div className="p-3 border-b border-white/5">
                <p className="text-xs text-gray-500 font-medium">选择模型</p>
              </div>
              <div className="py-2">
                {getAvailableModels().map((item, index) => {
                  const isSelected = settings.llm.provider === item.provider && settings.llm.model === item.model
                  return (
                    <button
                      key={`${item.provider}-${item.model}-${index}`}
                      onClick={() => handleSelectModel(item.provider, item.model)}
                      className={`w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 flex items-center justify-between transition-apple ${
                        isSelected ? 'bg-white/5' : ''
                      }`}
                    >
                      <div>
                        <span className="text-gray-400">{item.providerName}</span>
                        <span className="mx-2 text-gray-600">/</span>
                        <span className="text-white">{item.model}</span>
                      </div>
                      {isSelected && <Check size={14} className="text-primary" />}
                    </button>
                  )
                })}
              </div>
              <div className="p-3 border-t border-white/5">
                <p className="text-xs text-gray-600">在设置页面配置更多模型</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 输入区域 */}
      <div className="flex gap-3">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 glass-input px-4 py-3 text-sm resize-none"
          rows={rows}
          disabled={isLoading}
        />
        
        {isLoading ? (
          <button
            onClick={onStop}
            className="px-4 bg-red-500/20 text-red-400 rounded-xl hover:bg-red-500/30 transition-apple self-end border border-red-500/30"
            title="停止生成"
          >
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!value.trim()}
            className="px-4 btn-primary self-end disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
