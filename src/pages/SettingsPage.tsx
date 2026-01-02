import { useState } from 'react'
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
  Film
} from 'lucide-react'
import {
  useSettingsStore,
  LLM_PROVIDERS,
  IMAGE_PROVIDERS,
  VIDEO_PROVIDERS,
  ModelConfig
} from '../store/settingsStore'
import { updateSettings } from '../services/api'

function ModelConfigCard({
  title,
  icon: Icon,
  config,
  providers,
  onUpdate,
  gradientFrom,
  gradientTo
}: {
  title: string
  icon: React.ElementType
  config: ModelConfig
  providers: typeof LLM_PROVIDERS
  onUpdate: (updates: Partial<ModelConfig>) => void
  gradientFrom: string
  gradientTo: string
}) {
  const selectedProvider = providers.find((p) => p.id === config.provider)
  const isCustom = config.provider === 'custom'
  const isPlaceholder = config.provider === 'placeholder' || config.provider === 'none'
  const isDoubao = config.provider === 'doubao'
  
  // 判断是否需要显示 Base URL 输入框
  const needsBaseUrl = isCustom || config.provider === 'claude' || config.provider === 'midjourney'
  
  // 判断模型选择方式：有预设模型列表用下拉框，否则用输入框
  const hasPresetModels = selectedProvider && selectedProvider.models.length > 0 && !isCustom && !isDoubao

  return (
    <div className="glass-card p-5 hover-lift">
      <div className="flex items-center gap-3 mb-5">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradientFrom} ${gradientTo} flex items-center justify-center shadow-lg`}>
          <Icon size={18} className="text-white" />
        </div>
        <h3 className="font-semibold text-gradient">{title}</h3>
      </div>

      <div className="space-y-4">
        {/* 服务商选择 */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">服务商</label>
          <select
            value={config.provider}
            onChange={(e) => {
              const provider = providers.find((p) => p.id === e.target.value)
              onUpdate({
                provider: e.target.value,
                baseUrl: provider?.baseUrl || '',
                model: provider?.models[0] || ''
              })
            }}
            className="w-full glass-input p-3 text-sm bg-gray-900/80"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id} className="bg-gray-900 text-white">{p.name}</option>
            ))}
          </select>
        </div>

        {/* 自定义服务商名称 */}
        {isCustom && (
          <div className="animate-fadeIn">
            <label className="block text-sm text-gray-400 mb-2">自定义服务商名称</label>
            <input
              type="text"
              value={config.customProvider || ''}
              onChange={(e) => onUpdate({ customProvider: e.target.value })}
              placeholder="例如: LocalAI, Ollama"
              className="w-full glass-input p-3 text-sm"
            />
          </div>
        )}

        {/* API Key */}
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

        {/* API Base URL */}
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

        {/* 模型选择 - 有预设列表时显示下拉框 */}
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
            {/* 允许手动输入其他模型 */}
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

        {/* 豆包特殊处理 - 推理接入点 */}
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

        {/* 自定义或无预设模型时 - 手动输入模型名称 */}
        {!isPlaceholder && !hasPresetModels && !isDoubao && (
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
              onUpdate={updateLLM}
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
              onUpdate={updateImage}
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
              onUpdate={updateStoryboard}
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
              onUpdate={updateVideo}
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
    </div>
  )
}
