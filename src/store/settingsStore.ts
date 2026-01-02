import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getSavedSettings, updateSettings as apiUpdateSettings } from '../services/api'

// 预设的模型提供商
export const LLM_PROVIDERS = [
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'] },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-coder'] },
  { id: 'zhipu', name: '智谱AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-flash', 'glm-4', 'glm-4-plus'] },
  { id: 'moonshot', name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
  { id: 'baichuan', name: '百川', baseUrl: 'https://api.baichuan-ai.com/v1', models: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan2-Turbo'] },
  { id: 'yi', name: '零一万物', baseUrl: 'https://api.lingyiwanwu.com/v1', models: ['yi-large', 'yi-medium', 'yi-spark'] },
  { id: 'doubao', name: '豆包(字节)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: [] },
  { id: 'claude', name: 'Claude (via Proxy)', baseUrl: '', models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'] },
  { id: 'custom', name: '自定义', baseUrl: '', models: [] }
]

export const IMAGE_PROVIDERS = [
  { id: 'placeholder', name: '占位图(测试)', baseUrl: '', models: [] },
  { id: 'comfyui', name: 'ComfyUI (本地)', baseUrl: 'http://127.0.0.1:8188', models: ['SDXL', 'SD1.5', 'Flux'] },
  { id: 'sd-webui', name: 'SD WebUI (本地)', baseUrl: 'http://127.0.0.1:7860', models: ['SDXL', 'SD1.5'] },
  { id: 'qwen-image', name: '通义万相', baseUrl: 'https://dashscope.aliyuncs.com/api/v1', models: ['wanx-v1', 'wanx2.1-t2i-turbo'] },
  { id: 'midjourney', name: 'Midjourney (代理)', baseUrl: '', models: ['mj-v6', 'mj-v5', 'niji-v6'] },
  { id: 'dalle', name: 'DALL·E', baseUrl: 'https://api.openai.com/v1', models: ['dall-e-3', 'dall-e-2'] },
  { id: 'stability', name: 'Stability AI', baseUrl: 'https://api.stability.ai/v1', models: ['stable-diffusion-xl-1024-v1-0', 'stable-diffusion-v1-6'] },
  { id: 'ideogram', name: 'Ideogram', baseUrl: 'https://api.ideogram.ai', models: ['ideogram-v2', 'ideogram-v1'] },
  { id: 'flux', name: 'Flux (Replicate)', baseUrl: 'https://api.replicate.com/v1', models: ['flux-1.1-pro', 'flux-schnell'] },
  { id: 'custom', name: '自定义', baseUrl: '', models: [] }
]

export const VIDEO_PROVIDERS = [
  { id: 'none', name: '未配置', baseUrl: '', models: [] },
  { id: 'runway', name: 'Runway', baseUrl: 'https://api.runwayml.com/v1', models: ['gen-3-alpha', 'gen-2'] },
  { id: 'pika', name: 'Pika', baseUrl: '', models: ['pika-1.0'] },
  { id: 'kling', name: '可灵(快手)', baseUrl: 'https://api.klingai.com/v1', models: ['kling-v1', 'kling-v1-pro'] },
  { id: 'qwen-video', name: '通义(视频)', baseUrl: 'https://dashscope.aliyuncs.com/api/v1', models: ['wanx-v1-video'] },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', models: ['video-01'] },
  { id: 'luma', name: 'Luma AI', baseUrl: 'https://api.lumalabs.ai/v1', models: ['dream-machine'] },
  { id: 'custom', name: '自定义', baseUrl: '', models: [] }
]

export interface ModelConfig {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
  customProvider?: string
}

interface Settings {
  // 文本模型配置
  llm: ModelConfig
  // 图像模型配置
  image: ModelConfig
  // 分镜图像模型配置（独立于普通图像生成）
  storyboard: ModelConfig
  // 视频模型配置
  video: ModelConfig
  // 本地部署配置
  local: {
    enabled: boolean
    comfyuiUrl: string
    sdWebuiUrl: string
    vramStrategy: string
  }
}

interface SettingsState {
  settings: Settings
  isLoaded: boolean
  updateLLM: (updates: Partial<ModelConfig>) => void
  updateImage: (updates: Partial<ModelConfig>) => void
  updateStoryboard: (updates: Partial<ModelConfig>) => void
  updateVideo: (updates: Partial<ModelConfig>) => void
  updateLocal: (updates: Partial<Settings['local']>) => void
  loadFromBackend: () => Promise<void>
  syncToBackend: () => Promise<void>
}

const defaultSettings: Settings = {
  llm: {
    provider: 'qwen',
    apiKey: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus'
  },
  image: {
    provider: 'placeholder',
    apiKey: '',
    baseUrl: '',
    model: ''
  },
  storyboard: {
    provider: 'placeholder',
    apiKey: '',
    baseUrl: '',
    model: ''
  },
  video: {
    provider: 'none',
    apiKey: '',
    baseUrl: '',
    model: ''
  },
  local: {
    enabled: false,
    comfyuiUrl: 'http://127.0.0.1:8188',
    sdWebuiUrl: 'http://127.0.0.1:7860',
    vramStrategy: 'auto'
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      isLoaded: false,

      loadFromBackend: async () => {
        try {
          const saved = await getSavedSettings()
          if (saved && saved.llm) {
            // 强制使用后端数据，覆盖 localStorage
            const newSettings = {
              llm: saved.llm,
              image: saved.image,
              storyboard: saved.storyboard || defaultSettings.storyboard,
              video: saved.video,
              local: saved.local
            }
            set({ 
              settings: newSettings,
              isLoaded: true 
            })
            // 同步更新 localStorage
            localStorage.setItem('storyboarder-settings-v2', JSON.stringify({
              state: { settings: newSettings, isLoaded: true },
              version: 2
            }))
            console.log('[Settings] 从后端加载设置成功')
          } else {
            set({ isLoaded: true })
          }
        } catch (error) {
          console.error('[Settings] 加载设置失败:', error)
          set({ isLoaded: true })
        }
      },

      syncToBackend: async () => {
        const { settings } = get()
        try {
          await apiUpdateSettings(settings)
          console.log('[Settings] 同步到后端成功')
        } catch (error) {
          console.error('[Settings] 同步失败:', error)
        }
      },

      updateLLM: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            llm: { ...state.settings.llm, ...updates }
          }
        })),

      updateImage: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            image: { ...state.settings.image, ...updates }
          }
        })),

      updateStoryboard: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            storyboard: { ...state.settings.storyboard, ...updates }
          }
        })),

      updateVideo: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            video: { ...state.settings.video, ...updates }
          }
        })),

      updateLocal: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            local: { ...state.settings.local, ...updates }
          }
        }))
    }),
    {
      name: 'storyboarder-settings-v2',
      // 迁移旧数据
      migrate: (persistedState: unknown) => {
        const state = persistedState as SettingsState | undefined
        if (!state?.settings?.llm) {
          return { settings: defaultSettings }
        }
        return state
      },
      version: 2
    }
  )
)
