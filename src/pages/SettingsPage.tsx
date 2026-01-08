import { useState, useEffect, useRef } from 'react'
import {
  Save,
  MessageSquare,
  Image,
  Video,
  Server,
  CheckCircle,
  AlertCircle,
  Settings,
  Sparkles,
  Film,
  ChevronDown,
  ChevronRight,
  Edit2,
  Trash2,
  Plus,
  FolderCog,
  X
} from 'lucide-react'
import {
  useSettingsStore,
  LLM_PROVIDERS,
  IMAGE_PROVIDERS,
  VIDEO_PROVIDERS,
  ModelConfig
} from '../store/settingsStore'
import {
  updateSettings,
  listCustomProviders,
  addCustomProvider,
  updateCustomProvider,
  deleteCustomProvider,
  CustomProvider
} from '../services/api'

// 自定义配置编辑弹窗
function CustomProviderModal({
  isOpen,
  onClose,
  onSave,
  provider,
  category
}: {
  isOpen: boolean
  onClose: () => void
  onSave: (data: { name: string; apiKey: string; baseUrl: string; model: string; models: string[] }) => void
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


// 带操作按钮的下拉选择器
function ProviderSelect({
  config,
  providers,
  customProviders,
  category,
  onUpdate,
  onEditCustom,
  onDeleteCustom,
  onAddCustom,
  onManageCustom
}: {
  config: ModelConfig
  providers: typeof LLM_PROVIDERS
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

  // 点击外部关闭
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

  // 获取当前选中的显示名称
  const getDisplayName = () => {
    // 检查是否是自定义配置
    const customProvider = customProviders.find(p => p.id === config.provider)
    if (customProvider) {
      return customProvider.name
    }
    // 系统预设
    const preset = providers.find(p => p.id === config.provider)
    return preset?.name || config.provider
  }

  const handleSelectPreset = (provider: typeof providers[0]) => {
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

  // 过滤掉 'custom' 选项，因为我们会单独处理
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
          {/* 系统预设选项 */}
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
              {/* 系统预设的编辑和删除按钮（仅显示，实际不可删除系统预设） */}
              {provider.id !== 'placeholder' && provider.id !== 'none' && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      // 编辑系统预设 - 实际上是基于它创建自定义配置
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

          {/* 分隔线 */}
          <div className="border-t border-white/10 my-1" />

          {/* 自定义选项组 */}
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

            {/* 自定义配置列表 */}
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


function ModelConfigCard({
  title,
  icon: Icon,
  config,
  providers,
  customProviders,
  category,
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
  providers: typeof LLM_PROVIDERS
  customProviders: CustomProvider[]
  category: string
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
  
  // 判断是否需要显示 Base URL 输入框
  const needsBaseUrl = isCustom || config.provider === 'claude' || config.provider === 'midjourney'
  
  // 判断模型选择方式
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
        {/* 服务商选择 - 使用新的下拉组件 */}
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

        {/* API Key - 非占位图时显示 */}
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

        {/* API Base URL - 自定义或特定服务商时显示 */}
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

        {/* 模型选择 - 系统预设有模型列表时 */}
        {hasPresetModels && (
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

        {/* 模型选择 - 自定义配置有模型列表时 */}
        {hasCustomModels && (
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

        {/* 豆包特殊处理 */}
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

        {/* 手动输入模型名称 - 无预设模型时 */}
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

        {/* 配置状态 */}
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


export default function SettingsPage() {
  const { settings, updateLLM, updateImage, updateStoryboard, updateVideo, updateLocal } = useSettingsStore()
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [activeTab, setActiveTab] = useState<'models' | 'local'>('models')
  
  // 自定义配置状态
  const [customProviders, setCustomProviders] = useState<Record<string, CustomProvider[]>>({
    llm: [],
    image: [],
    storyboard: [],
    video: []
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<CustomProvider | null>(null)
  const [editingCategory, setEditingCategory] = useState<string>('llm')

  // 加载自定义配置
  useEffect(() => {
    loadCustomProviders()
  }, [])

  const loadCustomProviders = async () => {
    try {
      const [llm, image, video] = await Promise.all([
        listCustomProviders('llm'),
        listCustomProviders('image'),
        listCustomProviders('video')
      ])
      setCustomProviders({
        llm,
        image,
        storyboard: image, // storyboard 和 image 共用
        video
      })
    } catch (error) {
      console.error('加载自定义配置失败:', error)
    }
  }

  const handleAddCustom = (category: string) => {
    setEditingCategory(category)
    setEditingProvider(null)
    setModalOpen(true)
  }

  const handleEditCustom = (provider: CustomProvider) => {
    setEditingCategory(provider.category)
    setEditingProvider(provider)
    setModalOpen(true)
  }

  const handleDeleteCustom = async (providerId: string) => {
    if (!confirm('确定要删除这个自定义配置吗？')) return
    try {
      await deleteCustomProvider(providerId)
      await loadCustomProviders()
    } catch (error) {
      console.error('删除失败:', error)
    }
  }

  const handleSaveCustom = async (data: { name: string; apiKey: string; baseUrl: string; model: string; models: string[] }) => {
    try {
      // storyboard 实际存储为 image 类别
      const actualCategory = editingCategory === 'storyboard' ? 'image' : editingCategory
      
      if (editingProvider) {
        await updateCustomProvider(editingProvider.id, data)
      } else {
        await addCustomProvider(data.name, actualCategory, data)
      }
      await loadCustomProviders()
      setModalOpen(false)
    } catch (error) {
      console.error('保存失败:', error)
    }
  }

  const handleManageCustom = () => {
    // 可以跳转到专门的管理页面，或者打开管理弹窗
    // 这里简单处理：展开自定义配置列表
    alert('提示：点击下拉框中的"自定义配置"可展开查看和管理所有自定义配置')
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')

    try {
      await updateSettings({
        llm: settings.llm,
        image: settings.image,
        storyboard: settings.storyboard,
        video: settings.video,
        local: settings.local
      })
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch (error) {
      console.error('保存失败:', error)
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-auto p-8 animate-fadeIn">
      <div className="max-w-4xl mx-auto">
        {/* 页面标题 */}
        <div className="flex items-center gap-4 mb-8 animate-fadeInDown">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-slate-500 via-gray-500 to-zinc-400 flex items-center justify-center shadow-lg shadow-slate-500/30">
            <Settings size={24} className="text-white drop-shadow-md" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gradient">设置</h1>
            <p className="text-sm text-gray-500">配置 AI 模型和本地服务</p>
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-2 mb-8 animate-fadeInUp delay-100" style={{ animationFillMode: 'backwards' }}>
          <button
            onClick={() => setActiveTab('models')}
            className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'models'
                ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-lg shadow-blue-500/25'
                : 'glass-button text-gray-400 hover:text-white'
            }`}
          >
            <span className="flex items-center gap-2">
              <Sparkles size={16} />
              模型配置
            </span>
          </button>
          <button
            onClick={() => setActiveTab('local')}
            className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'local'
                ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-lg shadow-blue-500/25'
                : 'glass-button text-gray-400 hover:text-white'
            }`}
          >
            <span className="flex items-center gap-2">
              <Server size={16} />
              本地部署
            </span>
          </button>
        </div>

        {activeTab === 'models' && (
          <div className="space-y-8 animate-fadeIn">
            <section className="animate-fadeInUp delay-200" style={{ animationFillMode: 'backwards' }}>
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare size={18} className="text-blue-400" />
                <h2 className="text-lg font-semibold">文本模型 (LLM)</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">用于剧本拆解、分镜描述生成和 AI 对话</p>
              <ModelConfigCard
                title="文本生成"
                icon={MessageSquare}
                config={settings.llm}
                providers={LLM_PROVIDERS}
                customProviders={customProviders.llm}
                category="llm"
                onUpdate={updateLLM}
                onEditCustom={handleEditCustom}
                onDeleteCustom={handleDeleteCustom}
                onAddCustom={() => handleAddCustom('llm')}
                onManageCustom={handleManageCustom}
                gradientFrom="from-blue-500"
                gradientTo="to-cyan-500"
              />
            </section>

            <section className="animate-fadeInUp delay-300" style={{ animationFillMode: 'backwards' }}>
              <div className="flex items-center gap-2 mb-4">
                <Image size={18} className="text-purple-400" />
                <h2 className="text-lg font-semibold">图像模型</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">用于图像生成页面的独立图像生成</p>
              <ModelConfigCard
                title="图像生成"
                icon={Image}
                config={settings.image}
                providers={IMAGE_PROVIDERS}
                customProviders={customProviders.image}
                category="image"
                onUpdate={updateImage}
                onEditCustom={handleEditCustom}
                onDeleteCustom={handleDeleteCustom}
                onAddCustom={() => handleAddCustom('image')}
                onManageCustom={handleManageCustom}
                gradientFrom="from-purple-500"
                gradientTo="to-pink-500"
              />
            </section>

            <section className="animate-fadeInUp delay-350" style={{ animationFillMode: 'backwards' }}>
              <div className="flex items-center gap-2 mb-4">
                <Film size={18} className="text-orange-400" />
                <h2 className="text-lg font-semibold">分镜图像模型</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">用于分镜制作页面的图像生成（可独立配置不同的模型）</p>
              <ModelConfigCard
                title="分镜图像"
                icon={Film}
                config={settings.storyboard}
                providers={IMAGE_PROVIDERS}
                customProviders={customProviders.storyboard}
                category="storyboard"
                onUpdate={updateStoryboard}
                onEditCustom={handleEditCustom}
                onDeleteCustom={handleDeleteCustom}
                onAddCustom={() => handleAddCustom('storyboard')}
                onManageCustom={handleManageCustom}
                gradientFrom="from-orange-500"
                gradientTo="to-amber-500"
              />
            </section>

            <section className="animate-fadeInUp delay-400" style={{ animationFillMode: 'backwards' }}>
              <div className="flex items-center gap-2 mb-4">
                <Video size={18} className="text-green-400" />
                <h2 className="text-lg font-semibold">视频模型</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">用于将分镜图片生成视频片段（可选）</p>
              <ModelConfigCard
                title="视频生成"
                icon={Video}
                config={settings.video}
                providers={VIDEO_PROVIDERS}
                customProviders={customProviders.video}
                category="video"
                onUpdate={updateVideo}
                onEditCustom={handleEditCustom}
                onDeleteCustom={handleDeleteCustom}
                onAddCustom={() => handleAddCustom('video')}
                onManageCustom={handleManageCustom}
                gradientFrom="from-green-500"
                gradientTo="to-emerald-500"
              />
            </section>
          </div>
        )}

        {activeTab === 'local' && (
          <div className="space-y-6 animate-fadeIn">
            <section className="animate-fadeInUp delay-200" style={{ animationFillMode: 'backwards' }}>
              <div className="flex items-center gap-2 mb-4">
                <Server size={18} className="text-cyan-400" />
                <h2 className="text-lg font-semibold">本地部署配置</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">配置本地运行的 AI 服务，支持 ComfyUI 和 Stable Diffusion WebUI</p>

              <div className="glass-card p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">启用本地部署</h3>
                    <p className="text-sm text-gray-500 mt-1">优先使用本地服务生成图像</p>
                  </div>
                  <button
                    onClick={() => updateLocal({ enabled: !settings.local.enabled })}
                    className={`w-14 h-7 rounded-full transition-all ${
                      settings.local.enabled 
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-500 shadow-lg shadow-cyan-500/25' 
                        : 'bg-gray-700'
                    }`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transition-transform shadow-md ${
                      settings.local.enabled ? 'translate-x-8' : 'translate-x-1'
                    }`} />
                  </button>
                </div>

                {settings.local.enabled && (
                  <div className="space-y-4 pt-4 border-t border-white/5 animate-fadeIn">
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">ComfyUI 地址</label>
                      <input
                        type="text"
                        value={settings.local.comfyuiUrl}
                        onChange={(e) => updateLocal({ comfyuiUrl: e.target.value })}
                        placeholder="http://127.0.0.1:8188"
                        className="w-full glass-input p-3 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-gray-400 mb-2">SD WebUI 地址</label>
                      <input
                        type="text"
                        value={settings.local.sdWebuiUrl}
                        onChange={(e) => updateLocal({ sdWebuiUrl: e.target.value })}
                        placeholder="http://127.0.0.1:7860"
                        className="w-full glass-input p-3 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-gray-400 mb-2">显存策略</label>
                      <select
                        value={settings.local.vramStrategy}
                        onChange={(e) => updateLocal({ vramStrategy: e.target.value })}
                        className="w-full glass-input p-3 text-sm bg-gray-900/80"
                      >
                        <option value="auto" className="bg-gray-900 text-white">自动检测</option>
                        <option value="low" className="bg-gray-900 text-white">低显存 (4-6GB)</option>
                        <option value="medium" className="bg-gray-900 text-white">中等显存 (8-12GB)</option>
                        <option value="high" className="bg-gray-900 text-white">高显存 (16GB+)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="glass-card p-6 animate-fadeInUp delay-300" style={{ animationFillMode: 'backwards' }}>
              <h3 className="font-medium mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
                本地部署说明
              </h3>
              <ul className="text-sm text-gray-400 space-y-2">
                <li>• <strong className="text-gray-300">ComfyUI</strong>: 推荐使用，支持更灵活的工作流配置</li>
                <li>• <strong className="text-gray-300">SD WebUI</strong>: 简单易用，适合快速生成</li>
                <li>• 启用本地部署后，图像生成将优先使用本地服务</li>
                <li>• 确保本地服务已启动并可访问对应地址</li>
                <li>• 建议显存 8GB 以上以获得最佳体验</li>
              </ul>
            </section>
          </div>
        )}

        {/* 保存按钮 */}
        <div className="flex items-center gap-4 mt-10 pt-6 border-t border-white/5 animate-fadeInUp delay-500" style={{ animationFillMode: 'backwards' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl font-medium hover:opacity-90 transition-all hover:scale-105 hover:shadow-lg hover:shadow-blue-500/25 disabled:opacity-50 disabled:hover:scale-100"
          >
            <Save size={18} />
            {saving ? '保存中...' : '保存设置'}
          </button>

          {saveStatus === 'success' && (
            <span className="flex items-center gap-2 text-green-400 text-sm glass-button px-4 py-2 rounded-xl animate-fadeIn">
              <CheckCircle size={16} />
              设置已保存并生效
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="flex items-center gap-2 text-red-400 text-sm glass-button px-4 py-2 rounded-xl animate-fadeIn">
              <AlertCircle size={16} />
              保存失败，请检查后端服务
            </span>
          )}
        </div>
      </div>

      {/* 自定义配置编辑弹窗 */}
      <CustomProviderModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSaveCustom}
        provider={editingProvider}
        category={editingCategory}
      />
    </div>
  )
}
