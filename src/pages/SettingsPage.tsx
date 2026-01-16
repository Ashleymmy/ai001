import { useState, useEffect } from 'react'
import {
  Save,
  MessageSquare,
  Image,
  Video,
  Mic,
  Server,
  CheckCircle,
  AlertCircle,
  Settings,
  Sparkles,
  Film,
} from 'lucide-react'
import {
  useSettingsStore,
  LLM_PROVIDERS,
  IMAGE_PROVIDERS,
  VIDEO_PROVIDERS,
  ModelConfig,
} from '../store/settingsStore'
import {
  updateSettings,
  testConnection,
  type TestConnectionCategory,
  testTTSConnection,
  listCustomProviders,
  addCustomProvider,
  updateCustomProvider,
  deleteCustomProvider,
  CustomProvider
} from '../services/api'
import { CustomProviderModal, ModelConfigCard } from '../features/settings/components'
import { FishVoiceLibraryModal } from '../shared/fish/FishVoiceLibraryModal'

export default function SettingsPage() {
  const {
    settings,
    updateLLM,
    updateImage,
    updateStoryboard,
    updateVideo,
    updateTTS,
    updateVolcTTS,
    updateFishTTS,
    updateBailianTTS,
    updateCustomTTS,
    updateLocal,
  } = useSettingsStore()
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [activeTab, setActiveTab] = useState<'models' | 'local'>('models')
  const ttsProvider = (settings.tts.provider || 'volc_tts_v1_http').trim() || 'volc_tts_v1_http'
  const isFishTTS = ttsProvider.startsWith('fish')
  const isVolcTTS = ttsProvider === 'volc_tts_v1_http'
  const isBailianTTS = ttsProvider === 'aliyun_bailian_tts_v2'
  const isCustomTTS = ttsProvider.startsWith('custom_')
  const [fishLibraryOpen, setFishLibraryOpen] = useState(false)

  const [testStates, setTestStates] = useState<Record<TestConnectionCategory, { status: 'idle' | 'testing' | 'success' | 'error'; message?: string }>>({
    llm: { status: 'idle' },
    image: { status: 'idle' },
    storyboard: { status: 'idle' },
    video: { status: 'idle' }
  })
  
  // 自定义配置状态
  const [customProviders, setCustomProviders] = useState<Record<string, CustomProvider[]>>({
    llm: [],
    image: [],
    storyboard: [],
    video: [],
    tts: []
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<CustomProvider | null>(null)
  const [editingCategory, setEditingCategory] = useState<string>('llm')

  const [ttsTest, setTtsTest] = useState<{ status: 'idle' | 'testing' | 'success' | 'error'; message?: string }>({ status: 'idle' })

  const handleTestTTS = async () => {
    setTtsTest({ status: 'testing' })
    try {
      const defaults = isFishTTS
        ? settings.tts.fish
        : isBailianTTS
          ? settings.tts.bailian
          : isCustomTTS
            ? settings.tts.custom
            : settings.tts.volc
      const voiceType =
        defaults.narratorVoiceType ||
        defaults.dialogueMaleVoiceType ||
        defaults.dialogueFemaleVoiceType ||
        defaults.dialogueVoiceType
      const result = await testTTSConnection(settings.tts, voiceType, '测试语音合成')
      setTtsTest({ status: result.success ? 'success' : 'error', message: result.message })
    } catch (error) {
      const message =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (error as Error)?.message ||
        '测试失败'
      setTtsTest({ status: 'error', message })
    }
  }

  const handleTestConnection = async (category: TestConnectionCategory, config: ModelConfig) => {
    setTestStates(prev => ({ ...prev, [category]: { status: 'testing' } }))
    try {
      const result = await testConnection(category, config, settings.local)
      setTestStates(prev => ({
        ...prev,
        [category]: { status: result.success ? 'success' : 'error', message: result.message }
      }))
    } catch (error) {
      const message =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (error as Error)?.message ||
        '测试失败'
      setTestStates(prev => ({ ...prev, [category]: { status: 'error', message } }))
    }
  }

  // 加载自定义配置
  useEffect(() => {
    loadCustomProviders()
  }, [])

  const loadCustomProviders = async () => {
    try {
      const [llm, image, video, tts] = await Promise.all([
        listCustomProviders('llm'),
        listCustomProviders('image'),
        listCustomProviders('video'),
        listCustomProviders('tts')
      ])
      setCustomProviders({
        llm,
        image,
        storyboard: image, // storyboard 和 image 共用
        video,
        tts
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
        tts: settings.tts,
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
                testState={testStates.llm}
                onTestConnection={() => handleTestConnection('llm', settings.llm)}
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
                testState={testStates.image}
                onTestConnection={() => handleTestConnection('image', settings.image)}
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
                testState={testStates.storyboard}
                onTestConnection={() => handleTestConnection('storyboard', settings.storyboard)}
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
                testState={testStates.video}
                onTestConnection={() => handleTestConnection('video', settings.video)}
                onUpdate={updateVideo}
                onEditCustom={handleEditCustom}
                onDeleteCustom={handleDeleteCustom}
                onAddCustom={() => handleAddCustom('video')}
                onManageCustom={handleManageCustom}
                gradientFrom="from-green-500"
                gradientTo="to-emerald-500"
              />
            </section>

            <section className="animate-fadeInUp delay-450" style={{ animationFillMode: 'backwards' }}>
              <div className="flex items-center gap-2 mb-4">
                <Mic size={18} className="text-cyan-400" />
                <h2 className="text-lg font-semibold">语音合成 (旁白/对白)</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">用于独立生成旁白/对白的人声轨（保留视频环境音/音效）</p>

              <div className="glass-card p-6 space-y-4 hover-lift">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm text-gray-400">Provider</label>
                      <button
                        onClick={() => handleAddCustom('tts')}
                        className="text-xs text-gray-300 hover:text-white glass-button px-3 py-1.5 rounded-lg"
                        title="新增一个自定义 TTS Provider（OpenAI 兼容语音接口）"
                      >
                        新增自定义
                      </button>
                    </div>
                    <select
                      value={ttsProvider}
                      onChange={(e) => {
                        const provider = e.target.value
                        updateTTS({ provider })
                        if (provider.startsWith('fish')) {
                          const cur = (settings.tts.fish.model || '').trim()
                          if (!cur || cur.startsWith('seed-')) {
                            updateFishTTS({ model: 'speech-1.5' })
                          }
                        }
                      }}
                      className="w-full glass-input p-3 text-sm bg-gray-900/80"
                    >
                      <option value="volc_tts_v1_http" className="bg-gray-900 text-white">Volc OpenSpeech</option>
                      <option value="fish_tts_v1" className="bg-gray-900 text-white">Fish Audio</option>
                      <option value="aliyun_bailian_tts_v2" className="bg-gray-900 text-white">阿里百炼（通用语音）</option>
                      {customProviders.tts.length > 0 && (
                        <option disabled className="bg-gray-900 text-gray-500">────────</option>
                      )}
                      {customProviders.tts.map((p) => (
                        <option key={p.id} value={p.id} className="bg-gray-900 text-white">
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {isCustomTTS && (
                      <div className="flex items-center gap-2 mt-2">
                        <div className="text-xs text-gray-500 truncate flex-1">
                          当前自定义：{customProviders.tts.find((p) => p.id === ttsProvider)?.name || ttsProvider}
                        </div>
                        {customProviders.tts.find((p) => p.id === ttsProvider) && (
                          <button
                            onClick={() => handleEditCustom(customProviders.tts.find((p) => p.id === ttsProvider)!)}
                            className="text-xs text-gray-200 hover:text-white glass-button px-3 py-1.5 rounded-lg"
                          >
                            编辑
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {isFishTTS ? (
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">Base URL</label>
                      <input
                        type="text"
                        value={settings.tts.fish.baseUrl}
                        onChange={(e) => updateFishTTS({ baseUrl: e.target.value })}
                        placeholder="https://api.fish.audio"
                        className="w-full glass-input p-3 text-sm"
                      />
                    </div>
                  ) : isBailianTTS ? (
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">WebSocket URL（可选）</label>
                      <input
                        type="text"
                        value={settings.tts.bailian.baseUrl}
                        onChange={(e) => updateBailianTTS({ baseUrl: e.target.value })}
                        placeholder="wss://dashscope.aliyuncs.com/api-ws/v1/inference"
                        className="w-full glass-input p-3 text-sm"
                      />
                    </div>
                  ) : isCustomTTS ? (
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">API Base URL（自定义）</label>
                      <input
                        type="text"
                        value={customProviders.tts.find((p) => p.id === ttsProvider)?.baseUrl || ''}
                        readOnly
                        placeholder="请点击“编辑”在自定义配置里设置"
                        className="w-full glass-input p-3 text-sm opacity-80"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">AppID</label>
                      <input
                        type="text"
                        value={settings.tts.volc.appid}
                        onChange={(e) => updateVolcTTS({ appid: e.target.value })}
                        placeholder="控制台 AppID"
                        className="w-full glass-input p-3 text-sm"
                      />
                    </div>
                  )}
                </div>

                {isCustomTTS ? (
                  <div className="glass-dark rounded-2xl p-4 text-sm text-gray-300">
                    <div className="font-medium">自定义 TTS（OpenAI 兼容语音接口）</div>
                    <div className="text-xs text-gray-500 mt-1">
                      鉴权/Base URL/模型在“自定义配置”里管理；这里填写默认 voice 与测试即可。
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">
                          {isFishTTS || isBailianTTS ? 'API Key' : 'Access Token'}
                        </label>
                        <input
                          type="password"
                          value={
                            isFishTTS
                              ? settings.tts.fish.apiKey
                              : isBailianTTS
                                ? settings.tts.bailian.apiKey
                                : settings.tts.volc.accessToken
                          }
                          onChange={(e) => {
                            const v = e.target.value
                            if (isFishTTS) updateFishTTS({ apiKey: v })
                            else if (isBailianTTS) updateBailianTTS({ apiKey: v })
                            else updateVolcTTS({ accessToken: v })
                          }}
                          placeholder={isFishTTS ? 'Fish API Key' : isBailianTTS ? '阿里百炼 API Key' : '控制台 Access Token'}
                          className="w-full glass-input p-3 text-sm"
                        />
                      </div>

                      {isFishTTS ? (
                        <div>
                          <label className="block text-sm text-gray-400 mb-2">Model (Header: model)</label>
                          <input
                            type="text"
                            value={settings.tts.fish.model}
                            onChange={(e) => updateFishTTS({ model: e.target.value })}
                            placeholder="speech-1.5 或 s1"
                            className="w-full glass-input p-3 text-sm"
                          />
                        </div>
                      ) : isBailianTTS ? (
                        <div>
                          <label className="block text-sm text-gray-400 mb-2">Model</label>
                          <input
                            type="text"
                            value={settings.tts.bailian.model}
                            onChange={(e) => updateBailianTTS({ model: e.target.value })}
                            placeholder="cosyvoice-v1"
                            className="w-full glass-input p-3 text-sm"
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="block text-sm text-gray-400 mb-2">Cluster</label>
                          <input
                            type="text"
                            value={settings.tts.volc.cluster}
                            onChange={(e) => updateVolcTTS({ cluster: e.target.value })}
                            placeholder="volcano_tts"
                            className="w-full glass-input p-3 text-sm"
                          />
                        </div>
                      )}
                    </div>

                    {isBailianTTS && (
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">Workspace（可选）</label>
                        <input
                          type="text"
                          value={settings.tts.bailian.workspace}
                          onChange={(e) => updateBailianTTS({ workspace: e.target.value })}
                          placeholder="百炼 workspace id（可留空）"
                          className="w-full glass-input p-3 text-sm"
                        />
                      </div>
                    )}

                    {isVolcTTS && (
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">模型版本</label>
                        <input
                          type="text"
                          value={settings.tts.volc.model}
                          onChange={(e) => updateVolcTTS({ model: e.target.value })}
                          placeholder="seed-tts-1.1"
                          className="w-full glass-input p-3 text-sm"
                        />
                      </div>
                    )}
                  </>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      默认旁白 {isFishTTS ? 'reference_id' : isVolcTTS ? 'voice_type' : 'voice'}
                    </label>
                    <input
                      type="text"
                      value={
                        isFishTTS
                          ? settings.tts.fish.narratorVoiceType
                          : isBailianTTS
                            ? settings.tts.bailian.narratorVoiceType
                            : isCustomTTS
                              ? settings.tts.custom.narratorVoiceType
                              : settings.tts.volc.narratorVoiceType
                      }
                      onChange={(e) => {
                        const v = e.target.value
                        if (isFishTTS) updateFishTTS({ narratorVoiceType: v })
                        else if (isBailianTTS) updateBailianTTS({ narratorVoiceType: v })
                        else if (isCustomTTS) updateCustomTTS({ narratorVoiceType: v })
                        else updateVolcTTS({ narratorVoiceType: v })
                      }}
                      placeholder={
                        isFishTTS
                          ? '例如：802e3bc2b27e49c2995d23ef70e6ac89'
                          : isVolcTTS
                            ? '例如：zh_female_cancan_mars_bigtts'
                            : '例如：your_voice_name'
                      }
                      className="w-full glass-input p-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      默认对白（男） {isFishTTS ? 'reference_id' : isVolcTTS ? 'voice_type' : 'voice'}
                    </label>
                    <input
                      type="text"
                      value={
                        isFishTTS
                          ? settings.tts.fish.dialogueMaleVoiceType
                          : isBailianTTS
                            ? settings.tts.bailian.dialogueMaleVoiceType
                            : isCustomTTS
                              ? settings.tts.custom.dialogueMaleVoiceType
                              : settings.tts.volc.dialogueMaleVoiceType
                      }
                      onChange={(e) => {
                        const v = e.target.value
                        if (isFishTTS) updateFishTTS({ dialogueMaleVoiceType: v })
                        else if (isBailianTTS) updateBailianTTS({ dialogueMaleVoiceType: v })
                        else if (isCustomTTS) updateCustomTTS({ dialogueMaleVoiceType: v })
                        else updateVolcTTS({ dialogueMaleVoiceType: v })
                      }}
                      placeholder={
                        isFishTTS
                          ? '例如：802e3bc2b27e49c2995d23ef70e6ac89'
                          : isVolcTTS
                            ? '例如：zh_male_M392_conversation_wvae_bigtts'
                            : '例如：your_voice_name'
                      }
                      className="w-full glass-input p-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      默认对白（女） {isFishTTS ? 'reference_id' : isVolcTTS ? 'voice_type' : 'voice'}
                    </label>
                    <input
                      type="text"
                      value={
                        isFishTTS
                          ? settings.tts.fish.dialogueFemaleVoiceType
                          : isBailianTTS
                            ? settings.tts.bailian.dialogueFemaleVoiceType
                            : isCustomTTS
                              ? settings.tts.custom.dialogueFemaleVoiceType
                              : settings.tts.volc.dialogueFemaleVoiceType
                      }
                      onChange={(e) => {
                        const v = e.target.value
                        if (isFishTTS) updateFishTTS({ dialogueFemaleVoiceType: v })
                        else if (isBailianTTS) updateBailianTTS({ dialogueFemaleVoiceType: v })
                        else if (isCustomTTS) updateCustomTTS({ dialogueFemaleVoiceType: v })
                        else updateVolcTTS({ dialogueFemaleVoiceType: v })
                      }}
                      placeholder={
                        isFishTTS
                          ? '例如：802e3bc2b27e49c2995d23ef70e6ac89'
                          : isVolcTTS
                            ? '例如：zh_female_meilinyyou_moon_bigtts'
                            : '例如：your_voice_name'
                      }
                      className="w-full glass-input p-3 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    默认对白（通用/兼容旧）{isFishTTS ? 'reference_id' : isVolcTTS ? 'voice_type' : 'voice'}（可选）
                  </label>
                  <input
                    type="text"
                    value={
                      isFishTTS
                        ? settings.tts.fish.dialogueVoiceType
                        : isBailianTTS
                          ? settings.tts.bailian.dialogueVoiceType
                          : isCustomTTS
                            ? settings.tts.custom.dialogueVoiceType
                            : settings.tts.volc.dialogueVoiceType
                    }
                    onChange={(e) => {
                      const v = e.target.value
                      if (isFishTTS) updateFishTTS({ dialogueVoiceType: v })
                      else if (isBailianTTS) updateBailianTTS({ dialogueVoiceType: v })
                      else if (isCustomTTS) updateCustomTTS({ dialogueVoiceType: v })
                      else updateVolcTTS({ dialogueVoiceType: v })
                    }}
                    placeholder={
                      isFishTTS
                        ? '可留空：建议优先填男女默认 reference_id'
                        : isVolcTTS
                          ? '可留空：未配置时将根据角色名/描述自动匹配内置音色库'
                          : '可留空：建议优先填旁白/男女默认 voice'
                    }
                    className="w-full glass-input p-3 text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    说明：若具体角色在 Agent 里填写了 <code className="px-1">voice_type</code>（或 <code className="px-1">voice_profile</code> 里直接填 voice_type），会优先使用角色配置覆盖。
                  </p>
                </div>

                <div className="space-y-2 pt-1">
                  {false && (
                  <details className="w-full glass-dark rounded-2xl p-4 mb-2">
                    <summary className="cursor-pointer text-sm text-gray-300 select-none">
                      {isFishTTS ? '配置 Volc OpenSpeech（备用，不影响当前）' : '配置 Fish Audio（备用，不影响当前）'}
                    </summary>
                    <div className="mt-4 space-y-4">
                      {isFishTTS ? (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">AppID</label>
                              <input
                                type="text"
                                value={settings.tts.volc.appid}
                                onChange={(e) => updateVolcTTS({ appid: e.target.value })}
                                placeholder="控制台 AppID"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">Access Token</label>
                              <input
                                type="password"
                                value={settings.tts.volc.accessToken}
                                onChange={(e) => updateVolcTTS({ accessToken: e.target.value })}
                                placeholder="控制台 Access Token"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">Endpoint</label>
                              <input
                                type="text"
                                value={settings.tts.volc.endpoint}
                                onChange={(e) => updateVolcTTS({ endpoint: e.target.value })}
                                placeholder="https://openspeech.bytedance.com/api/v1/tts"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">Cluster</label>
                              <input
                                type="text"
                                value={settings.tts.volc.cluster}
                                onChange={(e) => updateVolcTTS({ cluster: e.target.value })}
                                placeholder="volcano_tts"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">模型版本</label>
                              <input
                                type="text"
                                value={settings.tts.volc.model}
                                onChange={(e) => updateVolcTTS({ model: e.target.value })}
                                placeholder="seed-tts-1.1"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">默认旁白 voice_type</label>
                              <input
                                type="text"
                                value={settings.tts.volc.narratorVoiceType}
                                onChange={(e) => updateVolcTTS({ narratorVoiceType: e.target.value })}
                                placeholder="例如：zh_female_cancan_mars_bigtts"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">默认对白（男）voice_type</label>
                              <input
                                type="text"
                                value={settings.tts.volc.dialogueMaleVoiceType}
                                onChange={(e) => updateVolcTTS({ dialogueMaleVoiceType: e.target.value })}
                                placeholder="例如：zh_male_M392_conversation_wvae_bigtts"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">默认对白（女）voice_type</label>
                              <input
                                type="text"
                                value={settings.tts.volc.dialogueFemaleVoiceType}
                                onChange={(e) => updateVolcTTS({ dialogueFemaleVoiceType: e.target.value })}
                                placeholder="例如：zh_female_meilinyyou_moon_bigtts"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm text-gray-400 mb-2">默认对白（通用/兼容旧）voice_type（可选）</label>
                            <input
                              type="text"
                              value={settings.tts.volc.dialogueVoiceType}
                              onChange={(e) => updateVolcTTS({ dialogueVoiceType: e.target.value })}
                              placeholder="可留空：未配置时将根据角色名/描述自动匹配内置音色库"
                              className="w-full glass-input p-3 text-sm"
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">Base URL</label>
                              <input
                                type="text"
                                value={settings.tts.fish.baseUrl}
                                onChange={(e) => updateFishTTS({ baseUrl: e.target.value })}
                                placeholder="https://api.fish.audio"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">API Key</label>
                              <input
                                type="password"
                                value={settings.tts.fish.apiKey}
                                onChange={(e) => updateFishTTS({ apiKey: e.target.value })}
                                placeholder="Fish API Key"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                            <div className="md:col-span-2">
                              <label className="block text-sm text-gray-400 mb-2">Model (Header: model)</label>
                              <input
                                type="text"
                                value={settings.tts.fish.model}
                                onChange={(e) => updateFishTTS({ model: e.target.value })}
                                placeholder="speech-1.5 或 s1"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                            <div>
                              <button
                                onClick={() => setFishLibraryOpen(true)}
                                disabled={!settings.tts.fish.apiKey}
                                className="w-full glass-button px-4 py-2 rounded-xl text-sm text-gray-200 hover:text-white disabled:opacity-50"
                                title={settings.tts.fish.apiKey ? '列出 Fish voice models，并可上传音频创建 voice clone' : '请先填写 Fish.apiKey'}
                              >
                                音色库
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">默认旁白 reference_id</label>
                              <input
                                type="text"
                                value={settings.tts.fish.narratorVoiceType}
                                onChange={(e) => updateFishTTS({ narratorVoiceType: e.target.value })}
                                placeholder="例如：802e3bc2b27e49c2995d23ef70e6ac89"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">默认对白（男）reference_id</label>
                              <input
                                type="text"
                                value={settings.tts.fish.dialogueMaleVoiceType}
                                onChange={(e) => updateFishTTS({ dialogueMaleVoiceType: e.target.value })}
                                placeholder="例如：802e3bc2b27e49c2995d23ef70e6ac89"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-400 mb-2">默认对白（女）reference_id</label>
                              <input
                                type="text"
                                value={settings.tts.fish.dialogueFemaleVoiceType}
                                onChange={(e) => updateFishTTS({ dialogueFemaleVoiceType: e.target.value })}
                                placeholder="例如：802e3bc2b27e49c2995d23ef70e6ac89"
                                className="w-full glass-input p-3 text-sm"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm text-gray-400 mb-2">默认对白（通用/兼容旧）reference_id（可选）</label>
                            <input
                              type="text"
                              value={settings.tts.fish.dialogueVoiceType}
                              onChange={(e) => updateFishTTS({ dialogueVoiceType: e.target.value })}
                              placeholder="可留空：建议优先填男女默认 reference_id"
                              className="w-full glass-input p-3 text-sm"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </details>
                  )}
                  <div className="flex items-center gap-3">
                  <button
                    onClick={() => setFishLibraryOpen(true)}
                    disabled={!settings.tts.fish.apiKey}
                    className="glass-button px-4 py-2 rounded-xl text-sm text-gray-200 hover:text-white disabled:opacity-50"
                    title={settings.tts.fish.apiKey ? '列出 Fish voice models，并可上传音频创建 voice clone' : '请先填写 Fish.apiKey'}
                  >
                    音色库
                  </button>
                  <button
                    onClick={handleTestTTS}
                    disabled={ttsTest.status === 'testing'}
                    className="glass-button px-4 py-2 rounded-xl text-sm text-gray-200 hover:text-white disabled:opacity-50"
                    title="发起一次最小 TTS 请求验证鉴权与参数（不保存）"
                  >
                    <span className="flex items-center gap-2">
                      {ttsTest.status === 'testing' ? (
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Server size={16} className="text-cyan-300" />
                      )}
                      {ttsTest.status === 'testing' ? '测试中...' : '测试 TTS'}
                    </span>
                  </button>

                  {ttsTest.status === 'success' && (
                    <span className="flex items-center gap-2 text-green-400 text-sm glass-button px-3 py-2 rounded-xl">
                      <CheckCircle size={16} />
                      {ttsTest.message || '连接成功'}
                    </span>
                  )}
                  {ttsTest.status === 'error' && (
                    <span className="flex items-center gap-2 text-red-400 text-sm glass-button px-3 py-2 rounded-xl">
                      <AlertCircle size={16} />
                      {ttsTest.message || '连接失败'}
                    </span>
                  )}
                  </div>
                </div>
              </div>
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

      <FishVoiceLibraryModal
        isOpen={fishLibraryOpen}
        onClose={() => setFishLibraryOpen(false)}
        mode="manage"
      />
    </div>
  )
}
