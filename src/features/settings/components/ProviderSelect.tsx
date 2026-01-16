import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Edit2, FolderCog, Plus, Trash2 } from 'lucide-react'
import type { ModelConfig } from '../../../store/settingsStore'
import type { CustomProvider } from '../../../services/api'
import type { ProviderPreset } from '../types'

export function ProviderSelect({
  config,
  providers,
  customProviders,
  onUpdate,
  onEditCustom,
  onDeleteCustom,
  onAddCustom,
  onManageCustom,
}: {
  config: ModelConfig
  providers: ProviderPreset[]
  customProviders: CustomProvider[]
  category: string
  onUpdate: (updates: Partial<ModelConfig>) => void
  onEditCustom: (provider: CustomProvider) => void
  onDeleteCustom: (providerId: string) => void
  onAddCustom: () => void
  onManageCustom: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [customExpanded, setCustomExpanded] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setCustomExpanded(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const getDisplayName = () => {
    const customProvider = customProviders.find(p => p.id === config.provider)
    if (customProvider) return customProvider.name
    const preset = providers.find(p => p.id === config.provider)
    return preset?.name || config.provider
  }

  const handleSelectPreset = (provider: ProviderPreset) => {
    onUpdate({
      provider: provider.id,
      baseUrl: provider.baseUrl || '',
      model: provider.models[0] || '',
      customProvider: undefined
    })
    setIsOpen(false)
    setCustomExpanded(false)
  }

  const handleSelectCustom = (custom: CustomProvider) => {
    onUpdate({
      provider: custom.id,
      baseUrl: custom.baseUrl,
      model: custom.model,
      apiKey: custom.apiKey,
      customProvider: custom.name
    })
    setIsOpen(false)
    setCustomExpanded(false)
  }

  const presetProviders = providers.filter(p => p.id !== 'custom')

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full glass-input p-3 text-sm bg-gray-900/80 flex items-center justify-between"
      >
        <span>{getDisplayName()}</span>
        <ChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden z-50 animate-fadeIn max-h-80 overflow-y-auto bg-gray-900/95 backdrop-blur-xl border border-white/20 shadow-2xl shadow-black/50">
          {presetProviders.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center justify-between px-3 py-2.5 hover:bg-white/10 group transition-colors"
            >
              <button
                onClick={() => handleSelectPreset(provider)}
                className="flex-1 text-left text-sm"
              >
                {provider.name}
              </button>
              {provider.id !== 'placeholder' && provider.id !== 'none' && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddCustom()
                    }}
                    className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-blue-400"
                    title="基于此创建自定义配置"
                  >
                    <Edit2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}

          <div className="border-t border-white/10 my-1" />

          <div>
            <div
              className="flex items-center justify-between px-3 py-2.5 hover:bg-white/10 cursor-pointer transition-colors"
              onClick={() => setCustomExpanded(!customExpanded)}
            >
              <div className="flex items-center gap-2">
                {customExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="text-sm font-medium text-blue-400">自定义配置</span>
                {customProviders.length > 0 && (
                  <span className="text-xs text-gray-500">({customProviders.length})</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onManageCustom()
                  }}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-cyan-400"
                  title="管理"
                >
                  <FolderCog size={14} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddCustom()
                  }}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-green-400"
                  title="新增"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {customExpanded && (
              <div className="bg-gray-800/60 border-t border-white/5">
                {customProviders.length === 0 ? (
                  <div className="px-6 py-3 text-sm text-gray-500">
                    暂无自定义配置，点击 + 添加
                  </div>
                ) : (
                  customProviders.map((custom) => (
                    <div
                      key={custom.id}
                      className="flex items-center justify-between px-6 py-2.5 hover:bg-white/10 group transition-colors"
                    >
                      <button
                        onClick={() => handleSelectCustom(custom)}
                        className="flex-1 text-left text-sm"
                      >
                        {custom.name}
                      </button>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onEditCustom(custom)
                          }}
                          className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-blue-400"
                          title="编辑"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteCustom(custom.id)
                          }}
                          className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-red-400"
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
