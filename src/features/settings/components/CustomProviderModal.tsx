import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { CustomProvider } from '../../../services/api'
import type { CustomProviderFormData } from '../types'

export function CustomProviderModal({
  isOpen,
  onClose,
  onSave,
  provider,
}: {
  isOpen: boolean
  onClose: () => void
  onSave: (data: CustomProviderFormData) => void
  provider?: CustomProvider | null
  category: string
}) {
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [modelsText, setModelsText] = useState('')

  useEffect(() => {
    if (provider) {
      setName(provider.name)
      setApiKey(provider.apiKey)
      setBaseUrl(provider.baseUrl)
      setModel(provider.model)
      setModelsText(provider.models?.join(', ') || '')
    } else {
      setName('')
      setApiKey('')
      setBaseUrl('')
      setModel('')
      setModelsText('')
    }
  }, [provider, isOpen])

  if (!isOpen) return null

  const handleSubmit = () => {
    const models = modelsText.split(',').map(m => m.trim()).filter(Boolean)
    onSave({ name, apiKey, baseUrl, model, models })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fadeIn">
      <div className="glass-card p-6 w-full max-w-md mx-4 animate-scaleIn">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold">
            {provider ? '编辑自定义配置' : '新增自定义配置'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">配置名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: 我的OpenAI、通义万相Pro"
              className="w-full glass-input p-3 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="输入 API Key"
              className="w-full glass-input p-3 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">API Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full glass-input p-3 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">默认模型</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="例如: gpt-4, qwen-plus"
              className="w-full glass-input p-3 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">可选模型列表 (逗号分隔)</label>
            <input
              type="text"
              value={modelsText}
              onChange={(e) => setModelsText(e.target.value)}
              placeholder="gpt-4, gpt-4-turbo, gpt-3.5-turbo"
              className="w-full glass-input p-3 text-sm"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 glass-button rounded-xl text-gray-400 hover:text-white"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl font-medium disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

