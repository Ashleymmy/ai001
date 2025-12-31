import { useState } from 'react'
import {
  Save,
  MessageSquare,
  Image,
  Video,
  Server,
  CheckCircle,
  AlertCircle
} from 'lucide-react'
import {
  useSettingsStore,
  LLM_PROVIDERS,
  IMAGE_PROVIDERS,
  VIDEO_PROVIDERS,
  ModelConfig
} from '../store/settingsStore'
import { updateSettings } from '../services/api'

// 模型配置卡片组件
function ModelConfigCard({
  title,
  icon: Icon,
  config,
  providers,
  onUpdate
}: {
  title: string
  icon: React.ElementType
  config: ModelConfig
  providers: typeof LLM_PROVIDERS
  onUpdate: (updates: Partial<ModelConfig>) => void
}) {
  const selectedProvider = providers.find((p) => p.id === config.provider)
  const isCustom = config.provider === 'custom'

  return (
    <div className="bg-[#1a1a1a] rounded-xl p-5 border border-gray-800">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={20} className="text-primary" />
        <h3 className="font-semibold">{title}</h3>
      </div>

      <div className="space-y-4">
        {/* 服务商选择 */}
        <div>
          <label className="block text-sm text-gray-400 mb-1.5">服务商</label>
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
            className="w-full bg-[#252525] rounded-lg p-2.5 border border-gray-700 focus:border-primary/50 focus:outline-none text-sm"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* 自定义服务商名称 */}
        {isCustom && (
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              自定义服务商名称
            </label>
            <input
              type="text"
              value={config.customProvider || ''}
              onChange={(e) => onUpdate({ customProvider: e.target.value })}
              placeholder="例如: LocalAI"
              className="w-full bg-[#252525] rounded-lg p-2.5 border border-gray-700 focus:border-primary/50 focus:outline-none text-sm"
            />
          </div>
        )}

        {/* API Key */}
        {config.provider !== 'placeholder' && config.provider !== 'none' && (
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">API Key</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => onUpdate({ apiKey: e.target.value })}
              placeholder="输入 API Key"
              className="w-full bg-[#252525] rounded-lg p-2.5 border border-gray-700 focus:border-primary/50 focus:outline-none text-sm"
            />
          </div>
        )}

        {/* Base URL */}
        {(isCustom ||
          config.provider === 'claude' ||
          config.provider === 'midjourney') && (
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              API Base URL
            </label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) => onUpdate({ baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
              className="w-full bg-[#252525] rounded-lg p-2.5 border border-gray-700 focus:border-primary/50 focus:outline-none text-sm"
            />
          </div>
        )}

        {/* 模型选择 - 有预设模型列表的服务商 */}
        {selectedProvider && selectedProvider.models.length > 0 && config.provider !== 'doubao' && (
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">模型</label>
            <select
              value={config.model}
              onChange={(e) => onUpdate({ model: e.target.value })}
              className="w-full bg-[#252525] rounded-lg p-2.5 border border-gray-700 focus:border-primary/50 focus:outline-none text-sm"
            >
              {selectedProvider.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 豆包特殊处理 - 需要输入推理接入点 ID */}
        {config.provider === 'doubao' && (
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">推理接入点 ID</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => onUpdate({ model: e.target.value })}
              placeholder="ep-xxx"
              className="w-full bg-[#252525] rounded-lg p-2.5 border border-gray-700 focus:border-primary/50 focus:outline-none text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              需要在火山引擎控制台创建推理接入点，填入接入点 ID（如 ep-xxx）
            </p>
          </div>
        )}

        {/* 需要手动输入模型名称的服务商（models 数组为空，且不是特殊类型） */}
        {selectedProvider && 
         selectedProvider.models.length === 0 && 
         !isCustom && 
         config.provider !== 'doubao' &&
         config.provider !== 'placeholder' && 
         config.provider !== 'none' && (
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">模型名称</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => onUpdate({ model: e.target.value })}
              placeholder="输入模型名称"
              className="w-full bg-[#252525] rounded-lg p-2.5 border border-gray-700 focus:border-primary/50 focus:outline-none text-sm"
            />
          </div>
        )}

        {/* 自定义服务商 - 模型名称 */}
        {isCustom && (
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">模型名称</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => onUpdate({ model: e.target.value })}
              placeholder="例如: gpt-4"
              className="w-full bg-[#252525] rounded-lg p-2.5 border border-gray-700 focus:border-primary/50 focus:outline-none text-sm"
            />
          </div>
        )}

        {/* 状态指示 */}
        <div className="flex items-center gap-2 text-xs">
          {config.apiKey ? (
            <span className="flex items-center gap-1 text-green-400">
              <CheckCircle size={12} />
              已配置
            </span>
          ) : config.provider === 'placeholder' || config.provider === 'none' ? (
            <span className="text-gray-500">无需配置</span>
          ) : (
            <span className="flex items-center gap-1 text-yellow-400">
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
  const { settings, updateLLM, updateImage, updateVideo, updateLocal } =
    useSettingsStore()
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>(
    'idle'
  )
  const [activeTab, setActiveTab] = useState<'models' | 'local'>('models')

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')

    try {
      await updateSettings({
        llm: settings.llm,
        image: settings.image,
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
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">设置</h1>

      {/* Tab 切换 */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('models')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'models'
              ? 'bg-primary text-white'
              : 'bg-[#1a1a1a] text-gray-400 hover:text-white'
          }`}
        >
          模型配置
        </button>
        <button
          onClick={() => setActiveTab('local')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'local'
              ? 'bg-primary text-white'
              : 'bg-[#1a1a1a] text-gray-400 hover:text-white'
          }`}
        >
          本地部署
        </button>
      </div>

      {activeTab === 'models' && (
        <div className="space-y-6">
          {/* 文本模型 */}
          <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <MessageSquare size={20} />
              文本模型 (LLM)
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              用于剧本拆解、分镜描述生成和 AI 对话
            </p>
            <ModelConfigCard
              title="文本生成"
              icon={MessageSquare}
              config={settings.llm}
              providers={LLM_PROVIDERS}
              onUpdate={updateLLM}
            />
          </section>

          {/* 图像模型 */}
          <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Image size={20} />
              图像模型
            </h2>
            <p className="text-sm text-gray-500 mb-4">用于生成分镜画面</p>
            <ModelConfigCard
              title="图像生成"
              icon={Image}
              config={settings.image}
              providers={IMAGE_PROVIDERS}
              onUpdate={updateImage}
            />
          </section>

          {/* 视频模型 */}
          <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Video size={20} />
              视频模型
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              用于将分镜图片生成视频片段（可选）
            </p>
            <ModelConfigCard
              title="视频生成"
              icon={Video}
              config={settings.video}
              providers={VIDEO_PROVIDERS}
              onUpdate={updateVideo}
            />
          </section>
        </div>
      )}

      {activeTab === 'local' && (
        <div className="space-y-6">
          <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Server size={20} />
              本地部署配置
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              配置本地运行的 AI 服务，支持 ComfyUI 和 Stable Diffusion WebUI
            </p>

            <div className="bg-[#1a1a1a] rounded-xl p-5 border border-gray-800 space-y-4">
              {/* 启用本地部署 */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">启用本地部署</h3>
                  <p className="text-sm text-gray-500">
                    优先使用本地服务生成图像
                  </p>
                </div>
                <button
                  onClick={() =>
                    updateLocal({ enabled: !settings.local.enabled })
                  }
                  className={`w-12 h-6 rounded-full transition-colors ${
                    settings.local.enabled ? 'bg-primary' : 'bg-gray-600'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transition-transform ${
                      settings.local.enabled
                        ? 'translate-x-6'
                        : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {settings.local.enabled && (
                <>
                  {/* ComfyUI */}
                  <div>
                    <label className="block text-sm text-gray-400 mb-1.5">
                      ComfyUI 地址
                    </label>
                    <input
                      type="text"
                      value={settings.local.comfyuiUrl}
                      onChange={(e) =>
                        updateLocal({ comfyuiUrl: e.target.value })
                      }
                      placeholder="http://127.0.0.1:8188"
                      className="w-full bg-[#252525] rounded-lg p-2.5 border border-gray-700 focus:border-primary/50 focus:outline-none text-sm"
                    />
                  </div>

                  {/* SD WebUI */}
                  <div>
                    <label className="block text-sm text-gray-400 mb-1.5">
                      SD WebUI 地址
                    </label>
                    <input
                      type="text"
                      value={settings.local.sdWebuiUrl}
                      onChange={(e) =>
                        updateLocal({ sdWebuiUrl: e.target.value })
                      }
                      placeholder="http://127.0.0.1:7860"
                      className="w-full bg-[#252525] rounded-lg p-2.5 border border-gray-700 focus:border-primary/50 focus:outline-none text-sm"
                    />
                  </div>

                  {/* 显存策略 */}
                  <div>
                    <label className="block text-sm text-gray-400 mb-1.5">
                      显存策略
                    </label>
                    <select
                      value={settings.local.vramStrategy}
                      onChange={(e) =>
                        updateLocal({ vramStrategy: e.target.value })
                      }
                      className="w-full bg-[#252525] rounded-lg p-2.5 border border-gray-700 focus:border-primary/50 focus:outline-none text-sm"
                    >
                      <option value="auto">自动检测</option>
                      <option value="low">低显存 (4-6GB)</option>
                      <option value="medium">中等显存 (8-12GB)</option>
                      <option value="high">高显存 (16GB+)</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* 使用说明 */}
          <section className="bg-[#1a1a1a] rounded-xl p-5 border border-gray-800">
            <h3 className="font-medium mb-3">本地部署说明</h3>
            <ul className="text-sm text-gray-400 space-y-2">
              <li>
                • <strong>ComfyUI</strong>: 推荐使用，支持更灵活的工作流配置
              </li>
              <li>
                • <strong>SD WebUI</strong>: 简单易用，适合快速生成
              </li>
              <li>• 启用本地部署后，图像生成将优先使用本地服务</li>
              <li>• 确保本地服务已启动并可访问对应地址</li>
              <li>• 建议显存 8GB 以上以获得最佳体验</li>
            </ul>
          </section>
        </div>
      )}

      {/* 保存按钮 */}
      <div className="flex items-center gap-4 mt-8 pt-6 border-t border-gray-800">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-primary rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Save size={18} />
          {saving ? '保存中...' : '保存设置'}
        </button>

        {saveStatus === 'success' && (
          <span className="flex items-center gap-1 text-green-400 text-sm">
            <CheckCircle size={16} />
            设置已保存并生效
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="flex items-center gap-1 text-red-400 text-sm">
            <AlertCircle size={16} />
            保存失败，请检查后端服务
          </span>
        )}
      </div>
    </div>
  )
}
