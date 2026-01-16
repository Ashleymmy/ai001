import type React from 'react'
import { AlertCircle, CheckCircle, Server } from 'lucide-react'
import type { ModelConfig } from '../../../store/settingsStore'
import type { CustomProvider } from '../../../services/api'
import type { ProviderPreset } from '../types'
import { ProviderSelect } from './ProviderSelect'

export function ModelConfigCard({
  title,
  icon: Icon,
  config,
  providers,
  customProviders,
  category,
  testState,
  onTestConnection,
  onUpdate,
  onEditCustom,
  onDeleteCustom,
  onAddCustom,
  onManageCustom,
  gradientFrom,
  gradientTo
}: {
  title: string
  icon: React.ElementType
  config: ModelConfig
  providers: ProviderPreset[]
  customProviders: CustomProvider[]
  category: string
  testState?: { status: 'idle' | 'testing' | 'success' | 'error'; message?: string }
  onTestConnection?: () => void
  onUpdate: (updates: Partial<ModelConfig>) => void
  onEditCustom: (provider: CustomProvider) => void
  onDeleteCustom: (providerId: string) => void
  onAddCustom: () => void
  onManageCustom: () => void
  gradientFrom: string
  gradientTo: string
}) {
  const selectedProvider = providers.find((p) => p.id === config.provider)
  const selectedCustom = customProviders.find((p) => p.id === config.provider)
  const isCustom = config.provider === 'custom' || config.provider?.startsWith('custom_')
  const isPlaceholder = config.provider === 'placeholder' || config.provider === 'none'
  const isDoubao = config.provider === 'doubao'

  const needsBaseUrl = isCustom || config.provider === 'claude' || config.provider === 'midjourney'

  const hasPresetModels = selectedProvider && selectedProvider.models.length > 0 && !isCustom && !isDoubao
  const hasCustomModels = selectedCustom && selectedCustom.models && selectedCustom.models.length > 0

  return (
    <div className="glass-card p-5 hover-lift">
      <div className="flex items-center gap-3 mb-5">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradientFrom} ${gradientTo} flex items-center justify-center shadow-lg`}>
          <Icon size={18} className="text-white" />
        </div>
        <h3 className="font-semibold text-gradient">{title}</h3>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-2">服务商</label>
          <ProviderSelect
            config={config}
            providers={providers}
            customProviders={customProviders}
            category={category}
            onUpdate={onUpdate}
            onEditCustom={onEditCustom}
            onDeleteCustom={onDeleteCustom}
            onAddCustom={onAddCustom}
            onManageCustom={onManageCustom}
          />
        </div>

        {!isPlaceholder && (
          <div className="animate-fadeIn">
            <label className="block text-sm text-gray-400 mb-2">API Key</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => onUpdate({ apiKey: e.target.value })}
              placeholder="输入 API Key"
              className="w-full glass-input p-3 text-sm"
            />
          </div>
        )}

        {needsBaseUrl && (
          <div className="animate-fadeIn">
            <label className="block text-sm text-gray-400 mb-2">API Base URL</label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) => onUpdate({ baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
              className="w-full glass-input p-3 text-sm"
            />
          </div>
        )}

        {hasPresetModels && selectedProvider && (
          <div className="animate-fadeIn">
            <label className="block text-sm text-gray-400 mb-2">模型</label>
            <select
              value={config.model}
              onChange={(e) => onUpdate({ model: e.target.value })}
              className="w-full glass-input p-3 text-sm bg-gray-900/80"
            >
              {selectedProvider.models.map((m) => (
                <option key={m} value={m} className="bg-gray-900 text-white">{m}</option>
              ))}
            </select>
            <div className="mt-2">
              <input
                type="text"
                value={config.model}
                onChange={(e) => onUpdate({ model: e.target.value })}
                placeholder="或手动输入其他模型名称"
                className="w-full glass-input p-2 text-xs text-gray-400"
              />
            </div>
          </div>
        )}

        {hasCustomModels && selectedCustom && (
          <div className="animate-fadeIn">
            <label className="block text-sm text-gray-400 mb-2">模型</label>
            <select
              value={config.model}
              onChange={(e) => onUpdate({ model: e.target.value })}
              className="w-full glass-input p-3 text-sm bg-gray-900/80"
            >
              {selectedCustom.models.map((m) => (
                <option key={m} value={m} className="bg-gray-900 text-white">{m}</option>
              ))}
            </select>
            <div className="mt-2">
              <input
                type="text"
                value={config.model}
                onChange={(e) => onUpdate({ model: e.target.value })}
                placeholder="或手动输入其他模型名称"
                className="w-full glass-input p-2 text-xs text-gray-400"
              />
            </div>
          </div>
        )}

        {isDoubao && (
          <div className="animate-fadeIn">
            <label className="block text-sm text-gray-400 mb-2">推理接入点 ID</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => onUpdate({ model: e.target.value })}
              placeholder="ep-xxx 或模型名称"
              className="w-full glass-input p-3 text-sm"
            />
            <p className="text-xs text-gray-500 mt-2">需要在火山引擎控制台创建推理接入点</p>
          </div>
        )}

        {!isPlaceholder && !hasPresetModels && !hasCustomModels && !isDoubao && (
          <div className="animate-fadeIn">
            <label className="block text-sm text-gray-400 mb-2">模型名称</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => onUpdate({ model: e.target.value })}
              placeholder="输入模型名称，如 gpt-4, claude-3-opus"
              className="w-full glass-input p-3 text-sm"
            />
          </div>
        )}

        {!isPlaceholder && onTestConnection && (
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={onTestConnection}
              disabled={testState?.status === 'testing'}
              className="glass-button px-4 py-2 rounded-xl text-sm text-gray-200 hover:text-white disabled:opacity-50"
              title="测试当前填写的配置是否可用（不保存）"
            >
              <span className="flex items-center gap-2">
                {testState?.status === 'testing' ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Server size={16} className="text-cyan-300" />
                )}
                {testState?.status === 'testing' ? '测试中...' : '测试连接'}
              </span>
            </button>

            {testState?.status === 'success' && (
              <span className="flex items-center gap-2 text-green-400 text-sm glass-button px-3 py-2 rounded-xl">
                <CheckCircle size={16} />
                {testState.message || '连接成功'}
              </span>
            )}

            {testState?.status === 'error' && (
              <span className="flex items-center gap-2 text-red-400 text-sm glass-button px-3 py-2 rounded-xl">
                <AlertCircle size={16} />
                {testState.message || '连接失败'}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs pt-2">
          {config.apiKey ? (
            <span className="flex items-center gap-1.5 text-green-400 glass-button px-3 py-1.5 rounded-full">
              <CheckCircle size={12} />
              已配置
            </span>
          ) : isPlaceholder ? (
            <span className="text-gray-500 glass-button px-3 py-1.5 rounded-full">无需配置</span>
          ) : (
            <span className="flex items-center gap-1.5 text-yellow-400 glass-button px-3 py-1.5 rounded-full">
              <AlertCircle size={12} />
              未配置 API Key
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

